# Deploy guide — Wedding Media Uploader

The app is now in **two pieces**:

1. **`Code.gs`** → a tiny API that runs in **Google Apps Script** (mints Drive
   upload links, feeds the slideshow). Your service-account key stays secret here.
2. **`index.html`** → the web page guests actually see. It now lives on a **normal
   website** (not Apps Script) so the browser can upload **straight to Google Drive** —
   many times faster than before.

Uploaded files still land in your Drive shared drive exactly as before.

---

## One-time setup

### Step 1 — Update the Apps Script API and get its URL

1. Open your Apps Script project.
2. Open `Code.gs`, select all, delete, and paste in the new `Code.gs` from this repo.
3. Click **Deploy → Manage deployments → ✏️ (edit) → Version: New version → Deploy**.
4. Copy the **Web app URL**. It ends in **`/exec`**. Keep it handy.

### Step 2 — Put your URL into the web page

1. Open `index.html` in this repo.
2. Near the top of the `<script>` section, find this line:
   ```js
   const API_URL = 'PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE';
   ```
3. Replace the placeholder with the `/exec` URL you copied. Keep the quotes:
   ```js
   const API_URL = 'https://script.google.com/macros/s/AKfy..../exec';
   ```

### Step 3 — Publish `index.html` to a website

**Recommended: GitHub Pages** (your code is already on GitHub, and it's free):

1. Go to your repo on GitHub → **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Pick the branch that has `index.html`, folder **/ (root)**, then **Save**.
4. Wait ~1 minute. GitHub shows a link like `https://YOURNAME.github.io/wedding-app/`.
   That's your guest link.

_Alternatives:_ Netlify Drop (drag `index.html` onto app.netlify.com/drop) for an
instant link, or Cloudflare Pages if you want the custom domain `photos.wedding.com`.

### Step 4 — Test

1. Open your new website link.
2. Upload a big video. It should be **much** faster, with a smooth progress bar.
3. Click **View the Slideshow** to confirm photos appear.

---

## Whenever you change the code later

- Changed **`Code.gs`?** → redeploy in Apps Script (Step 1.3) **New version**.
- Changed **`index.html`?** → re-publish it (GitHub Pages auto-updates on push;
  Netlify Drop needs a re-drag).
- If you ever create a **brand-new** Apps Script deployment, its `/exec` URL changes —
  paste the new one into `index.html` (Step 2).

## Make a QR code / sign

Once you're happy with the website link, paste it into any QR code generator to print
on your wedding signage.
