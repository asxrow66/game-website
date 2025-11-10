
const CACHE_NAME = 'Golf Orbit';
const urlsToCache = [
    '/',
    '/index.html',
    '/Build/0937c35466157d4e9e687a93feaa995b.data.unityweb',
    '/Build/f4ecbadad57c4ebc88341fe9350e277e.wasm.unityweb',
    '/Build/c5e3ce1a0242c704135be4d866484562.framework.js.unityweb',
    '/Build/9853637125e801e9aae48e78dbbdcfca.loader.js',
    '/TemplateData/style.css',
    '/icon-1920x1080.png',
    '/icon-512x512.png'
];

self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            return cache.addAll(urlsToCache);
        })
    );
});

self.addEventListener('fetch', function(event) {
    event.respondWith(
        caches.match(event.request).then(function(response) {
            return response || fetch(event.request);
        })
    );
});
