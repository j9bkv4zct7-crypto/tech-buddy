// Tech Buddy service worker (locked build). Caches ONLY the lock screen/loader, icons, manifest, the public OCR engine
// files and the ENCRYPTED app (app.bin + keys.json) so the app can be unlocked with a code offline. It never sees a key
// or any decrypted app code. Also receives Android "Share to Tech Buddy" (Web Share Target) posts.
const VERSION = 'techbuddy-v5-e8d6d7f2c462';
const ASSETS = [
 "./",
 "./app.bin",
 "./icons/apple-touch-icon.png",
 "./icons/icon-192.png",
 "./icons/icon-512.png",
 "./icons/icon.svg",
 "./icons/maskable-192.png",
 "./icons/maskable-512.png",
 "./icons/maskable.svg",
 "./index.html",
 "./keys.json",
 "./loader.js",
 "./lock.css",
 "./manifest.webmanifest",
 "./vendor/exceljs.min.js",
 "./vendor/tesseract/core/tesseract-core-lstm.js",
 "./vendor/tesseract/core/tesseract-core-lstm.wasm",
 "./vendor/tesseract/core/tesseract-core-lstm.wasm.js",
 "./vendor/tesseract/core/tesseract-core-simd-lstm.js",
 "./vendor/tesseract/core/tesseract-core-simd-lstm.wasm",
 "./vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js",
 "./vendor/tesseract/lang/eng.traineddata.gz",
 "./vendor/tesseract/tesseract.min.js",
 "./vendor/tesseract/worker.min.js"
];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== 'techbuddy-share').map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) { e.respondWith(handleShare(e.request)); return; }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(c => c.match(e.request, { ignoreSearch: true })).then(hit => hit || fetch(e.request).catch(() =>
    e.request.mode === 'navigate' || url.pathname.endsWith('/') ? caches.open(VERSION).then(c => c.match('./index.html')) : Response.error())));
});
async function handleShare(req){
  const f = await req.formData(); const c = await caches.open('techbuddy-share');
  await c.put('shared-text', new Response(JSON.stringify({ title: f.get('title') || '', text: f.get('text') || '', url: f.get('url') || '' }), { headers: { 'content-type':'application/json' } }));
  const img = f.get('image'); if (img && img.size) await c.put('shared-image', new Response(img, { headers: { 'content-type': img.type || 'image/png' } }));
  return Response.redirect('./?shared=1', 303);
}
