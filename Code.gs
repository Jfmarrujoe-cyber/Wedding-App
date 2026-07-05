/**
 * Wedding Media Uploader — Resumable Upload Version
 * 
 * This version bypasses the 50MB Apps Script limit by using the Drive API
 * directly. Apps Script just issues upload URLs; the browser uploads files
 * straight to Google Drive.
 * 
 * SETUP — See the accompanying SETUP.md for detailed step-by-step instructions.
 * You will need:
 *   1. A Google Cloud project with the Drive API enabled
 *   2. A service account with a JSON key
 *   3. A Google Drive folder shared with the service account as "Editor"
 *   4. Script Properties configured (Project Settings → Script Properties):
 *        - FOLDER_ID: your Drive folder ID
 *        - SERVICE_ACCOUNT_EMAIL: the service account's email
 *        - SERVICE_ACCOUNT_PRIVATE_KEY: the private_key value from the JSON
 */

// ============ CONFIGURATION ============
// Optional: simple rate limit per session to prevent abuse
const MAX_UPLOADS_PER_HOUR = 50;
// =======================================

/**
 * Serves the HTML page.
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Share Your Wedding Memories')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Called by the frontend after each chunk to verify how many bytes Drive received.
 * Uses the Drive resumable upload status query protocol.
 * Returns { success: true, bytesReceived: N } where N is the number of bytes
 * Drive currently has, or the total size if the upload is complete.
 */
function checkUploadStatus(uploadUrl, totalSize) {
  try {
    const response = UrlFetchApp.fetch(uploadUrl, {
      method: 'put',
      headers: {
        'Content-Range': 'bytes */' + totalSize,
        'Content-Length': '0'
      },
      muteHttpExceptions: true
    });
    /**
 * Proxies a chunk upload from the browser to Drive.
 * The browser can't PUT directly to googleapis.com due to CORS,
 * so it sends the chunk (base64-encoded) to us and we forward it.
 */
function uploadChunkProxy(uploadUrl, base64Data, start, end, total) {
  try {
    const bytes = Utilities.base64Decode(base64Data);
    const response = UrlFetchApp.fetch(uploadUrl, {
      method: 'put',
      contentType: 'application/octet-stream',
      headers: {
        'Content-Range': 'bytes ' + start + '-' + end + '/' + total
      },
      payload: bytes,
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    // 200/201 = whole file complete, 308 = chunk accepted more to come
    if (code === 200 || code === 201 || code === 308) {
      return { success: true, status: code };
    }
    return {
      success: false,
      error: 'Drive returned ' + code + ': ' + response.getContentText().substring(0, 200)
    };
  } catch (error) {
    return { success: false, error: 'Proxy error: ' + error.message };
  }
}

    const code = response.getResponseCode();

    // 200 or 201 = upload complete
    if (code === 200 || code === 201) {
      return { success: true, bytesReceived: totalSize };
    }

    // 308 = incomplete, check Range header for how much was received
    if (code === 308) {
      const headers = response.getHeaders();
      const range = headers['Range'] || headers['range'] || '';
      // Range format: "bytes=0-N" — means bytes 0 through N received (N+1 total)
      const match = range.match(/bytes=0-(\d+)/);
      if (match) {
        return { success: true, bytesReceived: parseInt(match[1]) + 1 };
      }
      // No range header = 0 bytes received yet
      return { success: true, bytesReceived: 0 };
    }

    return {
      success: false,
      error: 'Unexpected status: ' + code + ' - ' + response.getContentText().substring(0, 200)
    };
  } catch (error) {
    return { success: false, error: 'Status check failed: ' + error.message };
  }
}

/**
 * Called by the frontend to request a resumable upload session.
 * Returns an upload URL the browser can PUT file data to directly.
 */
function createUploadSession(fileInfo) {
  try {
    const props = PropertiesService.getScriptProperties();
    const folderId = props.getProperty('FOLDER_ID');

    if (!folderId) {
      return { success: false, error: 'Server not configured (missing FOLDER_ID).' };
    }

    // Rate limiting — simple per-session counter
    if (!checkRateLimit()) {
      return { success: false, error: 'Too many uploads recently. Please wait a few minutes.' };
    }

    // Build the filename with uploader + timestamp
    const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HH-mm-ss');
    const uploaderPrefix = fileInfo.uploaderName
      ? sanitizeName(fileInfo.uploaderName) + '_'
      : '';
    const baseName = fileInfo.fileName.replace(/\.[^/.]+$/, '');
    const extension = getFileExtension(fileInfo.fileName);
    const newFileName = `${uploaderPrefix}${timestamp}_${baseName}${extension}`;

    // Get an OAuth access token for the service account
    const accessToken = getServiceAccountAccessToken();

    // Ask Drive API for a resumable upload session
    const metadata = {
      name: newFileName,
      parents: [folderId]
    };

    // NOTE: supportsAllDrives=true is REQUIRED for shared drive uploads.
    const initResponse = UrlFetchApp.fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&includeItemsFromAllDrives=true',
      {
        method: 'post',
        headers: {
          'Authorization': 'Bearer ' + accessToken,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': fileInfo.mimeType,
          'X-Upload-Content-Length': String(fileInfo.fileSize)
        },
        payload: JSON.stringify(metadata),
        muteHttpExceptions: true
      }
    );

    if (initResponse.getResponseCode() !== 200) {
      console.error('Drive init failed: ' + initResponse.getContentText());
      return {
        success: false,
        error: 'Could not start upload session. Check setup.'
      };
    }

    const uploadUrl = initResponse.getHeaders()['Location'] || initResponse.getHeaders()['location'];

    if (!uploadUrl) {
      return { success: false, error: 'No upload URL returned from Drive.' };
    }

    // Log the attempt
    try { logUpload(fileInfo.uploaderName, newFileName, fileInfo.fileSize); } catch (e) {}

    return {
      success: true,
      uploadUrl: uploadUrl,
      fileName: newFileName
    };

  } catch (error) {
    console.error('createUploadSession error: ' + error.message);
    return { success: false, error: 'Server error: ' + error.message };
  }
}

/**
 * Generates an OAuth 2.0 access token for the service account using JWT.
 * This is what lets our script act as the service account.
 */
function getServiceAccountAccessToken() {
  // Cache tokens — they last an hour, no need to regenerate every call
  const cache = CacheService.getScriptCache();
  const cached = cache.get('sa_access_token');
  if (cached) return cached;

  const props = PropertiesService.getScriptProperties();
  const clientEmail = props.getProperty('SERVICE_ACCOUNT_EMAIL');
  let privateKey = props.getProperty('SERVICE_ACCOUNT_PRIVATE_KEY');

  if (!clientEmail || !privateKey) {
    throw new Error('Service account credentials not configured in Script Properties.');
  }

  // The private key in the JSON file has literal \n characters — normalize
  privateKey = privateKey.replace(/\\n/g, '\n');

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/drive.file',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const encodedHeader = Utilities.base64EncodeWebSafe(JSON.stringify(header)).replace(/=+$/, '');
  const encodedClaim = Utilities.base64EncodeWebSafe(JSON.stringify(claim)).replace(/=+$/, '');
  const toSign = encodedHeader + '.' + encodedClaim;

  const signatureBytes = Utilities.computeRsaSha256Signature(toSign, privateKey);
  const encodedSignature = Utilities.base64EncodeWebSafe(signatureBytes).replace(/=+$/, '');
  const jwt = toSign + '.' + encodedSignature;

  const tokenResponse = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    },
    muteHttpExceptions: true
  });

  if (tokenResponse.getResponseCode() !== 200) {
    console.error('Token request failed: ' + tokenResponse.getContentText());
    throw new Error('Failed to get access token. Check service account setup.');
  }

  const tokenData = JSON.parse(tokenResponse.getContentText());
  const accessToken = tokenData.access_token;

  // Cache for 55 minutes (tokens last 60)
  cache.put('sa_access_token', accessToken, 3300);

  return accessToken;
}

/**
 * Simple per-user rate limit using the script's cache.
 */
function checkRateLimit() {
  const cache = CacheService.getScriptCache();
  const key = 'rate_' + Session.getTemporaryActiveUserKey();
  const count = parseInt(cache.get(key) || '0');

  if (count >= MAX_UPLOADS_PER_HOUR) return false;

  cache.put(key, String(count + 1), 3600);
  return true;
}

/**
 * Logs uploads to Script Properties as a simple audit trail.
 * (The old sheet-based logger doesn't play nicely with shared drives.)
 * You can view the log with the viewUploadLog function or check console logs.
 */
function logUpload(uploaderName, fileName, fileSize) {
  const sizeMB = (fileSize / (1024 * 1024)).toFixed(2);
  console.log(`UPLOAD: ${new Date().toISOString()} | ${uploaderName || 'Anonymous'} | ${fileName} | ${sizeMB} MB`);
}

/**
 * View recent uploads by checking execution logs.
 * Go to "Executions" in the left sidebar to see all upload records.
 */

function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 30);
}

function getFileExtension(fileName) {
  const match = fileName.match(/\.[^/.]+$/);
  return match ? match[0] : '';
}

/**
 * Test function — run this manually to verify your setup is correct.
 * Select "testSetup" in the function dropdown and click Run.
 */
function testSetup() {
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty('FOLDER_ID');
  const email = props.getProperty('SERVICE_ACCOUNT_EMAIL');
  const key = props.getProperty('SERVICE_ACCOUNT_PRIVATE_KEY');

  Logger.log('=== Configuration Check ===');
  Logger.log('FOLDER_ID: ' + (folderId ? '✓ set' : '✗ MISSING'));
  Logger.log('SERVICE_ACCOUNT_EMAIL: ' + (email ? '✓ ' + email : '✗ MISSING'));
  Logger.log('SERVICE_ACCOUNT_PRIVATE_KEY: ' + (key ? '✓ set (' + key.length + ' chars)' : '✗ MISSING'));

  if (!folderId || !email || !key) {
    Logger.log('✗ Fix missing Script Properties first.');
    return;
  }

  try {
    Logger.log('\n=== Testing folder/shared drive access via service account ===');
    // For shared drives, we test via the API since DriveApp may not see it
    const token = getServiceAccountAccessToken();
    const testUrl = 'https://www.googleapis.com/drive/v3/files/' + folderId +
      '?supportsAllDrives=true&fields=id,name,mimeType,driveId';
    const testResp = UrlFetchApp.fetch(testUrl, {
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    });
    if (testResp.getResponseCode() === 200) {
      const info = JSON.parse(testResp.getContentText());
      Logger.log('✓ Access confirmed: ' + info.name + ' (' + info.mimeType + ')');
      if (info.driveId) Logger.log('✓ This is a Shared Drive — uploads will work');
    } else {
      Logger.log('✗ Cannot access folder/drive: ' + testResp.getContentText());
      Logger.log('  → Did you add the service account to the shared drive as Content Manager?');
      return;
    }
  } catch (e) {
    Logger.log('✗ Access test failed: ' + e.message);
    return;
  }

  try {
    Logger.log('\n=== Testing service account auth ===');
    const token = getServiceAccountAccessToken();
    Logger.log('✓ Got access token (' + token.substring(0, 20) + '...)');
  } catch (e) {
    Logger.log('✗ Auth failed: ' + e.message);
    return;
  }

  try {
    Logger.log('\n=== Testing Drive API upload session ===');
    const result = createUploadSession({
      fileName: 'setup-test.txt',
      mimeType: 'text/plain',
      fileSize: 100,
      uploaderName: 'Setup Test'
    });
    if (result.success) {
      Logger.log('✓ Upload session created successfully!');
      Logger.log('✓ ALL CHECKS PASSED — you are ready to go.');
    } else {
      Logger.log('✗ Upload session failed: ' + result.error);
    }
  } catch (e) {
    Logger.log('✗ Upload test failed: ' + e.message);
  }
}
