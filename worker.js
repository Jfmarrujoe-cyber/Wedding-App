/**
 * Wedding Media Uploader — Cloudflare Worker backend
 *
 * Replaces the old Google Apps Script backend. This Worker holds the Google
 * service-account credentials and does three small jobs for the web page:
 *   GET /createSession?fileName=&mimeType=&fileSize=&uploaderName=
 *        → mints a Drive resumable upload URL (the browser then uploads chunks
 *          straight to Drive — fast, no proxying of the file bytes through here)
 *   GET /listPhotos    → shuffled list of uploaded photo IDs (for the slideshow)
 *   GET /photo?id=..   → streams one photo's image bytes (for the slideshow)
 *
 * It sends CORS headers on every response, so the page on GitHub Pages can call
 * it directly with fetch().
 *
 * ---- SETUP (Cloudflare dashboard → your Worker → Settings → Variables) ----
 * Add these as *Secret* / environment variables (same values you used in the
 * old Apps Script Script Properties):
 *   FOLDER_ID                     - your shared drive ID (e.g. 0ABooH9szrxV4Uk9PVA)
 *   SERVICE_ACCOUNT_EMAIL         - wedding-uploader@...iam.gserviceaccount.com
 *   SERVICE_ACCOUNT_PRIVATE_KEY   - the private_key from the service account JSON
 *                                   (paste it exactly, including the BEGIN/END lines;
 *                                    literal \n sequences are fine — handled below)
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path.endsWith('/put') && request.method === 'PUT') {
        return await proxyChunk(request, url);
      }

      if (path.endsWith('/createSession')) {
        const params = Object.fromEntries(url.searchParams);
        return json(await createSession(env, params));
      }

      if (path.endsWith('/drives')) {
        return json(await listDrives(env));
      }

      if (path.endsWith('/listPhotos')) {
        return json(await listPhotos(env));
      }

      if (path.endsWith('/photo')) {
        const img = await getPhoto(env, url.searchParams.get('id'));
        if (!img) return new Response('Not found', { status: 404, headers: CORS });
        return new Response(img.bytes, {
          headers: {
            ...CORS,
            'Content-Type': img.contentType,
            'Cache-Control': 'public, max-age=3600'
          }
        });
      }

      return json({ success: true, message: 'Wedding uploader worker is running.' });
    } catch (err) {
      return json({ success: false, error: String((err && err.message) || err) }, 500);
    }
  }
};

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

// Forwards one upload chunk from the browser to Drive's resumable session URL.
// The browser can't PUT to that URL directly (Drive doesn't send CORS headers
// on it), but it can PUT to us (same origin), and we forward it server-side.
// We return Drive's status code (200/201 = done, 308 = more to come) as JSON.
async function proxyChunk(request, url) {
  const target = url.searchParams.get('target') || '';
  // Only ever forward to Google's upload endpoint (never an open proxy).
  if (!target.startsWith('https://www.googleapis.com/upload/')) {
    return json({ success: false, error: 'Invalid upload target.' }, 400);
  }

  const headers = {};
  const contentRange = request.headers.get('Content-Range');
  if (contentRange) headers['Content-Range'] = contentRange;

  const body = await request.arrayBuffer();
  const driveResp = await fetch(target, { method: 'PUT', headers: headers, body: body });
  const status = driveResp.status;

  // On an error status, capture Drive's explanation so the browser can show it.
  let driveError = '';
  if (status !== 200 && status !== 201 && status !== 308) {
    driveError = (await driveResp.text()).slice(0, 500);
  }

  return json({ success: true, driveStatus: status, driveError: driveError });
}

async function createSession(env, params) {
  if (!env.FOLDER_ID) return { success: false, error: 'Worker not configured (missing FOLDER_ID).' };

  const token = await getAccessToken(env);
  const fileName = buildFileName(params);
  const metadata = { name: fileName, parents: [env.FOLDER_ID] };

  const init = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': params.mimeType || 'application/octet-stream'
      },
      body: JSON.stringify(metadata)
    }
  );

  if (init.status !== 200) {
    return { success: false, error: 'Drive init failed (' + init.status + '): ' + (await init.text()).slice(0, 200) };
  }

  const uploadUrl = init.headers.get('Location');
  if (!uploadUrl) return { success: false, error: 'Drive did not return an upload URL.' };

  return { success: true, uploadUrl: uploadUrl, fileName: fileName };
}

// Diagnostic: lists every Shared Drive the service account can actually see.
// Open /drives in a browser to check whether your target drive is in the list.
async function listDrives(env) {
  const token = await getAccessToken(env);
  const resp = await fetch(
    'https://www.googleapis.com/drive/v3/drives?pageSize=100&fields=drives(id,name)',
    { headers: { 'Authorization': 'Bearer ' + token } }
  );
  const data = await resp.json();
  if (resp.status !== 200) {
    return { success: false, status: resp.status, error: JSON.stringify(data).slice(0, 300) };
  }
  return {
    success: true,
    configuredFolderId: env.FOLDER_ID || '(not set)',
    serviceAccount: env.SERVICE_ACCOUNT_EMAIL || '(not set)',
    drivesTheServiceAccountCanSee: data.drives || []
  };
}

async function listPhotos(env) {
  if (!env.FOLDER_ID) return { success: false, error: 'Worker not configured (missing FOLDER_ID).' };

  const token = await getAccessToken(env);
  const ids = [];
  let pageToken = '';

  do {
    const q = "'" + env.FOLDER_ID + "' in parents and mimeType contains 'image/' and trashed = false";
    const listUrl = 'https://www.googleapis.com/drive/v3/files'
      + '?q=' + encodeURIComponent(q)
      + '&fields=nextPageToken,files(id)'
      + '&pageSize=1000'
      + '&orderBy=createdTime desc'
      + '&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives'
      + (pageToken ? '&pageToken=' + pageToken : '');

    const resp = await fetch(listUrl, { headers: { 'Authorization': 'Bearer ' + token } });
    if (resp.status !== 200) {
      return { success: false, error: 'Could not list photos (' + resp.status + ').' };
    }
    const data = await resp.json();
    (data.files || []).forEach((f) => ids.push(f.id));
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  // Fisher–Yates shuffle so the slideshow order is random.
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = ids[i]; ids[i] = ids[j]; ids[j] = t;
  }

  return { success: true, ids: ids };
}

async function getPhoto(env, fileId) {
  if (!fileId) return null;
  const token = await getAccessToken(env);

  // Prefer Drive's thumbnail (upscaled) for speed; fall back to the full image.
  const meta = await fetch(
    'https://www.googleapis.com/drive/v3/files/' + fileId + '?fields=thumbnailLink,mimeType&supportsAllDrives=true',
    { headers: { 'Authorization': 'Bearer ' + token } }
  );

  let bytes = null;
  let contentType = 'image/jpeg';

  if (meta.status === 200) {
    const m = await meta.json();
    if (m.thumbnailLink) {
      const thumbUrl = m.thumbnailLink.replace(/=s\d+(-c)?$/, '=s1600');
      const tr = await fetch(thumbUrl, { headers: { 'Authorization': 'Bearer ' + token } });
      if (tr.status === 200) {
        bytes = await tr.arrayBuffer();
        contentType = tr.headers.get('content-type') || 'image/jpeg';
      }
    }
    if (m.mimeType && !bytes) contentType = m.mimeType;
  }

  if (!bytes) {
    const media = await fetch(
      'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media&supportsAllDrives=true',
      { headers: { 'Authorization': 'Bearer ' + token } }
    );
    if (media.status !== 200) return null;
    bytes = await media.arrayBuffer();
    contentType = media.headers.get('content-type') || contentType;
  }

  return { bytes: bytes, contentType: contentType };
}

// ---------------------------------------------------------------------------
// Google service-account auth (JWT → OAuth access token), via WebCrypto
// ---------------------------------------------------------------------------

let cachedToken = null;
let cachedTokenExpiry = 0;

async function getAccessToken(env) {
  // Reuse a token while it's still valid (tokens last ~1h).
  if (cachedToken && cachedTokenExpiry > Date.now() + 60000) return cachedToken;

  if (!env.SERVICE_ACCOUNT_EMAIL || !env.SERVICE_ACCOUNT_PRIVATE_KEY) {
    throw new Error('Worker not configured (missing service account email or key).');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: env.SERVICE_ACCOUNT_EMAIL,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const unsigned = b64urlFromString(JSON.stringify(header)) + '.' + b64urlFromString(JSON.stringify(claim));
  const key = await importPrivateKey(env.SERVICE_ACCOUNT_PRIVATE_KEY);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned)
  );
  const jwt = unsigned + '.' + b64urlFromBytes(new Uint8Array(signature));

  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + encodeURIComponent(jwt)
  });

  const tokenData = await tokenResp.json();
  if (!tokenData.access_token) {
    throw new Error('Token request failed: ' + JSON.stringify(tokenData).slice(0, 200));
  }

  cachedToken = tokenData.access_token;
  cachedTokenExpiry = Date.now() + (tokenData.expires_in || 3600) * 1000;
  return cachedToken;
}

async function importPrivateKey(pem) {
  const normalized = pem.replace(/\\n/g, '\n');
  const b64 = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const der = bytesFromB64(b64);
  return crypto.subtle.importKey(
    'pkcs8',
    der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildFileName(params) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ts = now.getUTCFullYear() + '-' + pad(now.getUTCMonth() + 1) + '-' + pad(now.getUTCDate())
    + '_' + pad(now.getUTCHours()) + '-' + pad(now.getUTCMinutes()) + '-' + pad(now.getUTCSeconds());
  const uploader = (params.uploaderName || '').replace(/[^a-zA-Z0-9]/g, '-').slice(0, 30);
  const orig = params.fileName || 'file';
  const dot = orig.lastIndexOf('.');
  const base = dot > 0 ? orig.slice(0, dot) : orig;
  const ext = dot > 0 ? orig.slice(dot) : '';
  return (uploader ? uploader + '_' : '') + ts + '_' + base + ext;
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}

function b64urlFromString(str) {
  return b64urlFromBytes(new TextEncoder().encode(str));
}

function b64urlFromBytes(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesFromB64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
