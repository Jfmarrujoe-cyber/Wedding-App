# Deploy guide — Wedding Media Uploader

The app has two pieces:

1. **`worker.js`** → a **Cloudflare Worker** (free). It holds your Google
   service-account credentials and hands the web page short-lived Drive upload
   links + the slideshow photos. Your secret key lives only here.
2. **`index.html`** → the web page guests see, hosted on **GitHub Pages** (free).
   The browser uploads files **straight to Google Drive** — fast, no middleman.

Uploaded files land in your Drive shared drive exactly as before.

---

## Part A — Put up the Cloudflare Worker

You'll need three values you already used in Apps Script. Find them in Apps Script
→ **Project Settings → Script Properties** (or in your service-account JSON file):
`FOLDER_ID`, `SERVICE_ACCOUNT_EMAIL`, `SERVICE_ACCOUNT_PRIVATE_KEY`.

1. Make a free account at **cloudflare.com** and sign in.
2. Left sidebar → **Workers & Pages** → **Create application** → **Create Worker**.
3. Give it a name like **`wedding-uploader`** → **Deploy** (this makes a starter worker).
4. Click **Edit code**. Select everything, delete it, and paste in the full contents
   of **`worker.js`** from this repo. Click **Deploy** (top right).
5. Click **← (back)** to the worker, then **Settings → Variables and Secrets**.
   Add these three (click **+ Add**), then **Save and deploy**:
   | Name | Value | Type |
   |------|-------|------|
   | `FOLDER_ID` | your shared drive ID (e.g. `0ABooH9szrxV4Uk9PVA`) | Text |
   | `SERVICE_ACCOUNT_EMAIL` | `wedding-uploader@…iam.gserviceaccount.com` | Text |
   | `SERVICE_ACCOUNT_PRIVATE_KEY` | the whole `private_key` value, including the `-----BEGIN…` / `…END-----` lines | **Secret** (Encrypt) |
6. At the top of the worker page, copy its URL. It looks like:
   **`https://wedding-uploader.YOURNAME.workers.dev`**
7. **Quick test:** open **`https://wedding-uploader.YOURNAME.workers.dev/listPhotos`**
   in your browser. You should see something like `{"success":true,"ids":[...]}`.
   If you see an error about credentials, re-check the three variables in step 5.

## Part B — Put the page on GitHub Pages

1. Put your Worker URL into `index.html`: find the line
   `const WORKER_URL = 'PASTE_YOUR_CLOUDFLARE_WORKER_URL_HERE';`
   and replace the placeholder with your worker URL (keep the quotes, no trailing slash).
   _Or just send the Worker URL to me and I'll paste it in and push._
2. Get that change onto your **main** branch (I can merge it for you).
3. On GitHub: your repo → **Settings → Pages**.
4. Under **Source**, choose **Deploy from a branch** → Branch **`main`** / **`/ (root)`** → **Save**.
   (If GitHub says Pages needs a public repo, make the repo public — it's safe, there
   are **no passwords or keys in this repo**; the secret key lives only in Cloudflare.)
5. Wait ~1 minute. GitHub shows **"Your site is live at
   `https://YOURNAME.github.io/wedding-app/`"** — that's your guest link.

## Part C — Test

1. Open your GitHub Pages link.
2. Upload a big video — it should be **much** faster now, with a smooth progress bar.
3. Click **View the Slideshow** to confirm photos appear.

---

## Changing things later

- Changed **`worker.js`?** → paste it into the Cloudflare editor again and **Deploy**.
- Changed **`index.html`?** → push to `main`; GitHub Pages redeploys automatically.
- New Worker name/URL? → update `WORKER_URL` in `index.html` and push.

## Make a QR code

Once you're happy with the GitHub Pages link, paste it into any QR-code generator to
print on your wedding signage.

## Notes

- The Worker currently accepts calls from any website (`Access-Control-Allow-Origin: *`).
  That's fine for a wedding. If you later want to lock it to only your site, change that
  line in `worker.js` to your GitHub Pages URL.
- The old Google Apps Script backend was removed (it's still in this repo's git history
  if you ever need it). Cloudflare is the backend now.
