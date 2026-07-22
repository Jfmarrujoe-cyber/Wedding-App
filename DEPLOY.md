# Deploy guide — Wedding Media Uploader

Everything runs on **one Cloudflare Worker**, connected to this GitHub repo:

- `public/index.html` — the web page guests see (served by the Worker).
- `worker.js` — the backend: talks to Google Drive with your service account
  and mints upload links. Your secret key lives only in Cloudflare.
- `wrangler.jsonc` — tells Cloudflare how to deploy the two together.

Because the page and backend share one address, there's **no URL to paste and
no CORS to worry about**. And once it's connected to GitHub, **every push
auto-deploys** — no more copy-pasting code into dashboards.

Uploaded files land in your Google Drive shared drive. The browser uploads
straight to Drive, so big videos are fast.

---

## One-time setup

### What you'll need first
Three values (the same ones you used in Apps Script — find them in Apps Script →
**Project Settings → Script Properties**, or in your service-account JSON file):
`FOLDER_ID`, `SERVICE_ACCOUNT_EMAIL`, `SERVICE_ACCOUNT_PRIVATE_KEY`.

### Step 1 — Connect the repo to Cloudflare
1. Make a free account at **cloudflare.com** and sign in.
2. Left sidebar → **Workers & Pages** → **Create** → the **Import a repository** tab.
3. Click **Connect GitHub**, authorize Cloudflare, and pick the repo
   **`Jfmarrujoe-cyber/wedding-app`**.
4. Cloudflare reads `wrangler.jsonc` automatically. Leave the build settings at their
   defaults and click **Create and deploy**. (The first deploy will run but won't
   fully work until Step 2 adds the secrets — that's expected.)

### Step 2 — Add your three secrets
1. Open the new Worker → **Settings → Variables and Secrets** → **Add**:
   | Name | Value | Type |
   |------|-------|------|
   | `FOLDER_ID` | your shared drive ID (e.g. `0ABooH9szrxV4Uk9PVA`) | Text |
   | `SERVICE_ACCOUNT_EMAIL` | `wedding-uploader@…iam.gserviceaccount.com` | Text |
   | `SERVICE_ACCOUNT_PRIVATE_KEY` | the whole `private_key` value, including the `-----BEGIN…END-----` lines | **Secret** |
2. Click **Deploy** (or **Save and deploy**) so the secrets take effect.

### Step 3 — Get your link and test
1. At the top of the Worker page, find its URL:
   **`https://wedding-uploader.YOURNAME.workers.dev`** — this is your guest link.
2. **Test the backend:** open `…workers.dev/listPhotos`. You should see
   `{"success":true,"ids":[...]}`. (If it mentions credentials, re-check Step 2.)
3. **Test the page:** open the main `…workers.dev` link, upload a big video (should be
   fast, with a smooth progress bar), and try **View the Slideshow**.

---

## From now on: automatic deploys

Because Cloudflare is connected to GitHub, **any change pushed to the `main` branch
deploys itself** within a minute — whether it's the page (`public/index.html`) or the
backend (`worker.js`). You (or I) just push; Cloudflare does the rest. You never have
to paste code into the dashboard again. (You only revisit the dashboard to change a
secret.)

## Custom domain (optional, later)
Worker → **Settings → Domains & Routes → Add** → **Custom domain** → e.g.
`photos.wedding.com`. If your domain's DNS is on Cloudflare, this is a couple of clicks.

## Make a QR code
Once you're happy with the link, paste it into any QR-code generator for your signage.

## Notes
- The Worker allows calls from any site (`Access-Control-Allow-Origin: *`) — fine for a
  wedding, and harmless since the page is same-origin anyway.
- The old Google Apps Script backend was removed; it's still in this repo's git history
  if ever needed.
