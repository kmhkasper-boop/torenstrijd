/* Torenstrijd – service worker (offline spelen + snelle updates)
   - HTML: eerst netwerk (zo komen nieuwe werelden/versies meteen binnen), offline uit de cache
   - iconen/manifest: eerst cache
   - Google Fonts: stale-while-revalidate
   Game-updates in index.html (nieuwe werelden e.d.) komen vanzelf binnen; VERSION hoeft daarvoor niet omhoog.
   Verhoog VERSION alleen als iconen/manifest veranderen of als er losse bestanden (js/afbeeldingen) bijkomen
   die later nog wijzigen: die worden 'eerst cache' geserveerd. */
const ID = 'torenstrijd';
const VERSION = 'v1';
const CORE = ID + '-core-' + VERSION;
const FONTS = ID + '-fonts-' + VERSION;
const PAGE = new URL('./', self.registration.scope).href;
const ASSETS = ['./', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-maskable-512.png', './icons/apple-touch-icon.png', './icons/favicon-48.png'];

const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&display=swap';

// Lettertype alvast bewaren, zodat het spel ook offline in Fredoka verschijnt (mislukken is niet erg).
async function precacheFonts() {
  try {
    const cache = await caches.open(FONTS);
    const res = await fetch(FONT_CSS, { mode: 'cors' });
    if (!res.ok) return;
    await cache.put(FONT_CSS, res.clone());
    const urls = [...(await res.text()).matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(m => m[1]);
    await Promise.all(urls.map(u => fetch(u, { mode: 'cors' }).then(r => r.ok && cache.put(u, r)).catch(() => {})));
  } catch (err) { /* geen netwerk: dan later via de runtime-cache */ }
}

self.addEventListener('install', e => {
  e.waitUntil(Promise.all([
    caches.open(CORE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))),
    precacheFonts()
  ]).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  // Alleen caches van DIT spel opruimen (de drie spellen delen hetzelfde domein).
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith(ID + '-') && k !== CORE && k !== FONTS).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function isPage(req, url) {
  return req.mode === 'navigate' || (url.origin === location.origin && /\/(index\.html)?$/.test(url.pathname) && url.href.startsWith(self.registration.scope));
}

async function networkFirst(req) {
  const cache = await caches.open(CORE);
  const net = fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(res => {
    if (res && res.ok && res.type === 'basic') cache.put(PAGE, res.clone());
    return res;
  });
  net.catch(() => {});
  // Bij een heel trage verbinding na 6 s de bewaarde versie tonen (de nieuwe komt dan bij de volgende start).
  const timeout = new Promise(r => setTimeout(r, 6000)).then(() => cache.match(PAGE));
  try {
    const res = await Promise.race([net, timeout.then(r => r || net)]);
    if (res) return res;
  } catch (err) { /* offline */ }
  return (await cache.match(PAGE)) || (await cache.match(req, { ignoreSearch: true })) || Response.error();
}

async function cacheFirst(req) {
  const hit = await caches.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok && res.type === 'basic') (await caches.open(CORE)).put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(e) {
  const cache = await caches.open(FONTS);
  const hit = await cache.match(e.request.url, { ignoreVary: true });
  const net = fetch(e.request).then(res => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(e.request.url, res.clone());
    return res;
  });
  if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
  return net;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(staleWhileRevalidate(e));
    return;
  }
  if (url.origin !== location.origin || !url.href.startsWith(self.registration.scope)) return;
  if (url.pathname.endsWith('/sw.js')) return;
  e.respondWith(isPage(req, url) ? networkFirst(req) : cacheFirst(req));
});
