/* LuxCalc offline cache. Changing any file changes CACHE, so phones pick up the new version when online. */
var CACHE = 'luxcalc-1.17.0-ad0a55136e';
var FILES = [
"./",
"calc.js",
"fonts.css",
"fonts/LICENSES.txt",
"fonts/ibm-plex-mono-latin-500-normal.woff2",
"fonts/ibm-plex-sans-arabic-arabic-400-normal.woff2",
"fonts/ibm-plex-sans-arabic-arabic-500-normal.woff2",
"fonts/ibm-plex-sans-arabic-arabic-600-normal.woff2",
"fonts/ibm-plex-sans-arabic-latin-400-normal.woff2",
"fonts/ibm-plex-sans-arabic-latin-500-normal.woff2",
"fonts/ibm-plex-sans-arabic-latin-600-normal.woff2",
"fonts/readex-pro-arabic-500-normal.woff2",
"fonts/readex-pro-arabic-600-normal.woff2",
"fonts/readex-pro-latin-500-normal.woff2",
"fonts/readex-pro-latin-600-normal.woff2",
"icons/apple-touch-icon.png",
"icons/icon-192.png",
"icons/icon-512.png",
"index.html",
"jspdf-LICENSE.txt",
"jspdf.umd.min.js",
"manifest.webmanifest",
"three-LICENSE.txt",
"three.min.js"
];
self.addEventListener('install', function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(FILES.map(function(f){ return new Request(f, { cache: 'reload' }); })); }).then(function(){ return self.skipWaiting(); }));
});
self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){ return Promise.all(keys.filter(function(k){ return k.indexOf('luxcalc-') === 0 && k !== CACHE; }).map(function(k){ return caches.delete(k); })); }).then(function(){ return self.clients.claim(); }));
});
self.addEventListener('fetch', function(e){
  if (e.request.method !== 'GET') return;
  var u = new URL(e.request.url);
  if (u.origin !== self.location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(function(hit){
    if (hit) return hit;
    return fetch(e.request).catch(function(){ return e.request.mode === 'navigate' ? caches.match('index.html') : Response.error(); });
  }));
});
