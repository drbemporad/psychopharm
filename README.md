# PsychoPharm PK/PD Reference — PWA Setup

## File structure

```
psychopharm/
├── index.html                  ← App entry point (JSX compiled in-browser)
├── manifest.json               ← PWA manifest (install prompt, icons, shortcuts)
├── sw.js                       ← Service worker (offline caching)
├── react.production.min.js     ← React 18 UMD  ← YOU MUST DOWNLOAD THESE
├── react-dom.production.min.js ← ReactDOM 18    ← (see Step 1 below)
├── babel.min.js                ← Babel standalone ← 
├── icon-192.png                ← Home screen icon (replace with your own)
├── icon-512.png                ← Splash/store icon
├── icon-maskable-192.png       ← Maskable icon (Android adaptive icons)
└── icon-maskable-512.png
```

---

## Step 1 — Download the 3 required JS libraries

These must be local files for offline to work. Download once, drop in the folder.

```bash
# React 18
curl -o react.production.min.js \
  https://unpkg.com/react@18/umd/react.production.min.js

# ReactDOM 18
curl -o react-dom.production.min.js \
  https://unpkg.com/react-dom@18/umd/react-dom.production.min.js

# Babel standalone (for in-browser JSX compilation)
curl -o babel.min.js \
  https://unpkg.com/@babel/standalone/babel.min.js
```

Or download them manually in a browser and rename accordingly.

**Expected sizes:** react ~11 KB, react-dom ~130 KB, babel ~900 KB

---

## Step 2 — Replace the placeholder icons (recommended)

The included icons work but are minimal placeholders. For a polished install:

1. Go to https://realfavicongenerator.net
2. Upload a 512×512 image (your logo or a medical symbol)
3. Download the package and replace `icon-192.png`, `icon-512.png`
4. For maskable icons (safe zone = center 80%), use https://maskable.app

---

## Step 3 — Serve it (required for PWA install prompt)

Service workers only register on HTTPS or localhost. You need a server.

### Option A — GitHub Pages (free, permanent, recommended)
```bash
# Create a repo at github.com, push the folder, enable Pages in Settings
git init && git add . && git commit -m "init"
git remote add origin https://github.com/YOUR_USER/psychopharm.git
git push -u origin main
# Enable: Settings → Pages → Source: main branch
```
Your app will be at `https://YOUR_USER.github.io/psychopharm/`

### Option B — Netlify (drag & drop)
Go to https://app.netlify.com/drop, drag the entire folder onto the page.
Done — live HTTPS URL in 30 seconds.

### Option C — Cloudflare Pages
Similar to Netlify. Connect GitHub repo or upload folder directly.

### Option D — Local testing only
```bash
# Python (any machine with Python installed)
python3 -m http.server 8080
# Visit http://localhost:8080 in Chrome
```
Note: localhost counts as a secure context, so the SW registers fine for testing.

---

## Step 4 — Install on Android

1. Open Chrome on Android
2. Navigate to your HTTPS URL
3. Chrome will show an **"Add to Home screen"** banner automatically
   — or tap the ⋮ menu → "Add to Home screen" / "Install app"
4. Tap "Install" — the app appears on your home screen
5. Open it once while on WiFi; after that it works fully offline

The first load compiles the JSX in-browser (1–2 seconds). Every subsequent
load is instant from cache.

---

## Step 5 (optional) — Eliminate the Babel compile delay

For instant startup, pre-compile the JSX to plain JS on a machine with Node:

```bash
npm install -g @babel/core @babel/cli @babel/preset-react

# Pre-compile
babel psychopharm-pk.jsx --presets @babel/preset-react -o app.compiled.js

# Then in index.html, replace:
#   <script type="text/babel" data-presets="react">...</script>
# With:
#   <script src="app.compiled.js"></script>
# And remove the babel.min.js <script> tag and the const {useState,useMemo}=React; line
```

This eliminates babel.min.js (~900 KB) from the bundle and makes first load instant.

---

## How the service worker works

| Request type | Strategy | Behaviour |
|---|---|---|
| App shell (HTML, JS, icons) | Cache-first + background refresh | Instant load; updates silently in background |
| Other same-origin requests | Network-first with cache fallback | Fresh when online; cached when offline |
| Cross-origin requests | Pass-through | Not intercepted |

**Update flow:** When a new version of `index.html` is detected in the background
refresh, the SW posts a `SW_UPDATE_READY` message to all open tabs. You can
use this to show an "Update available — tap to reload" banner in the app.

**Cache versioning:** Change `CACHE_VERSION = 'v1'` in `sw.js` to `'v2'` (etc.)
when you deploy an update. The activate event will automatically purge old caches.

---

## Troubleshooting

**"Add to Home screen" prompt doesn't appear**
- Must be served over HTTPS (not http://)
- manifest.json must be reachable and valid — check DevTools → Application tab
- User must have visited the page at least twice (Chrome heuristic)

**App shows blank screen**
- Open Chrome DevTools (USB debugging) → Console tab
- Most likely: one of the 3 JS files isn't found (check filenames match exactly)
- Or: a `</script>` in the JSX wasn't escaped — check index.html was generated correctly

**SW not registering**
- Check DevTools → Application → Service Workers
- Must be HTTPS or localhost
- Hard-reload with Ctrl+Shift+R to force re-registration during development

**Offline not working after install**
- Open the app once while online to prime the cache
- Check DevTools → Application → Cache Storage to confirm files are cached
