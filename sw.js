/* Voxel Island service worker: caches the game and Three.js so it runs offline. */
const VERSION = 'v6.1.0';
const CACHE = 'voxel-island-' + VERSION;
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'logo.png', 'three.min.js'];
const CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // the core files are cached one by one, so a missing optional file (like logo.png) never blocks the install
    await Promise.all(CORE.map(async url => {
      try { const r = await fetch(new Request(url, { cache: 'reload' })); if (r.ok) await cache.put(url, r); } catch (e) { /* skip */ }
    }));
    // Three.js from a CDN: one copy is enough (they are the same build), but try both
    let have = !!(await cache.match('three.min.js'));
    for (const url of CDN) {
      if (have) break;
      try {
        const r = await fetch(new Request(url, { mode: 'cors', credentials: 'omit' }));
        if (r.ok) { await cache.put(url, r); have = true; }
      } catch (e) { /* try the next */ }
    }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('voxel-island-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // page loads: network first when online (so updates arrive), cached copy when offline
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const r = await fetch(req);
        if (r.ok) { const c = await caches.open(CACHE); c.put('index.html', r.clone()); }
        return r;
      } catch (e) {
        const c = await caches.open(CACHE);
        return (await c.match('index.html')) || (await c.match('./')) || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  // Three.js: cache first. Any of the three copies will do when offline.
  const isThree = /three(\.min)?\.js/.test(url.pathname);
  if (isThree) {
    event.respondWith((async () => {
      const c = await caches.open(CACHE);
      const hit = (await c.match(req)) || (await c.match('three.min.js')) || (await c.match(CDN[0])) || (await c.match(CDN[1]));
      if (hit) return hit;
      try {
        const r = await fetch(req);
        if (r.ok) c.put(req, r.clone());
        return r;
      } catch (e) { return Response.error(); }
    })());
    return;
  }

  // everything else on our own origin: serve the cached copy, refresh it in the background
  if (url.origin === location.origin) {
    event.respondWith((async () => {
      const c = await caches.open(CACHE);
      const hit = await c.match(req, { ignoreSearch: true });
      const fresh = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => null);
      return hit || (await fresh) || Response.error();
    })());
  }
});
