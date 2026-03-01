// ─── PsychoPharm PWA Service Worker ──────────────────────────────────────────
// Strategy:
//   • App shell (HTML + JS deps) → Cache-first, update in background
//   • All other requests → Network-first with cache fallback
//   • On new SW activation → purge old caches immediately
//   • Clients are notified when an update is ready so they can reload

const CACHE_VERSION = 'v1';
const SHELL_CACHE   = `psychopharm-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `psychopharm-runtime-${CACHE_VERSION}`;

// Everything needed to run fully offline — all local files
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png',
];

// React, ReactDOM, and Babel are loaded from CDN (cdnjs.cloudflare.com).
// The service worker caches them in RUNTIME_CACHE on first fetch so they
// are available offline after the initial load — no local copies needed.

// ── Install: pre-cache the entire app shell ───────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing…');
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => {
        console.log('[SW] Pre-caching app shell');
        // Use {cache: 'reload'} so we always get fresh copies on install,
        // not stale HTTP-cached versions
        return Promise.all(
          SHELL_FILES.map(url =>
            fetch(url, { cache: 'reload' })
              .then(response => {
                if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
                return cache.put(url, response);
              })
              .catch(err => {
                // Non-fatal: icons may not exist yet — log and continue
                console.warn(`[SW] Could not cache ${url}:`, err.message);
              })
          )
        );
      })
      .then(() => {
        console.log('[SW] App shell cached — skipping waiting');
        // Take control immediately without waiting for old SW to die
        return self.skipWaiting();
      })
  );
});

// ── Activate: clean up old caches, claim all clients ─────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating…');
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        const valid = [SHELL_CACHE, RUNTIME_CACHE];
        return Promise.all(
          cacheNames
            .filter(name => name.startsWith('psychopharm-') && !valid.includes(name))
            .map(name => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[SW] Claiming all clients');
        return self.clients.claim();
      })
  );
});

// ── Fetch: cache-first for shell, network-first for everything else ───────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests from our own origin
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // Determine if this is an app shell file.
  // Normalise both sides to absolute pathnames for reliable comparison.
  const swDir = self.location.pathname.replace(/sw\.js$/, ''); // e.g. "/psychopharm/"
  const normalised = SHELL_FILES.map(f => {
    // Turn './' → swDir, './foo' → swDir + 'foo'
    const rel = f.replace(/^\.\//, '');
    return rel === '' ? swDir : swDir + rel;
  });
  // Also treat a bare directory hit as the index
  const isShellFile = normalised.includes(url.pathname) ||
    (url.pathname === swDir) ||
    (url.pathname === swDir.replace(/\/$/, ''));

  if (isShellFile) {
    // Cache-first: serve from cache, refresh in background (stale-while-revalidate)
    event.respondWith(cacheFirst(request, SHELL_CACHE));
  } else {
    // Network-first with cache fallback for anything else
    event.respondWith(networkFirst(request, RUNTIME_CACHE));
  }
});

// ── Strategies ────────────────────────────────────────────────────────────────

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  if (cached) {
    // Serve from cache immediately, update in background
    refreshInBackground(request, cache);
    return cached;
  }

  // Not in cache yet — fetch, store, return
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    console.warn('[SW] Cache-first fetch failed, no cached fallback for:', request.url);
    return offlineFallback();
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);

  // Manual 8-second timeout — AbortSignal.timeout() isn't available on all
  // Android Chrome / WebView versions so we use a controller + setTimeout.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (_err) {
    clearTimeout(timer);
    // Network failed or timed out — try cache
    const cached = await cache.match(request);
    if (cached) return cached;
    return offlineFallback();
  }
}

function refreshInBackground(request, cache) {
  fetch(request, { cache: 'no-cache' })
    .then(response => {
      if (response.ok) {
        cache.put(request, response.clone());
        // If the main HTML changed, notify all open clients to show update banner
        if (request.url.includes('index.html') || request.url.endsWith('/')) {
          notifyClientsOfUpdate();
        }
      }
    })
    .catch(() => { /* Background refresh failed — not critical */ });
}

function offlineFallback() {
  // Return a minimal offline page if nothing is cached at all
  return new Response(
    `<!DOCTYPE html>
     <html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width">
     <style>body{background:#0c0f15;color:#5a6580;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:12px}
     h2{color:#e8ecf4;font-size:18px;margin:0}p{font-size:13px;margin:0;text-align:center}</style></head>
     <body><h2>PsychoPharm</h2><p>You appear to be offline.<br>Open the app once while connected to cache it for offline use.</p></body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  );
}

// ── Update notifications ──────────────────────────────────────────────────────

async function notifyClientsOfUpdate() {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  clients.forEach(client => client.postMessage({ type: 'SW_UPDATE_READY' }));
}

// Listen for client messages (e.g. "skip waiting" request from update banner)
self.addEventListener('message', event => {
  if (event.data?.type === 'SW_SKIP_WAITING') {
    console.log('[SW] Client requested skip waiting — activating new SW');
    self.skipWaiting();
  }
});
