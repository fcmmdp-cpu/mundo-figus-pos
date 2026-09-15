// service-worker.js — Cachea el shell de la app para que funcione 100% offline
// después de la primera carga. Los datos de negocio viven en IndexedDB, no acá.

const CACHE_NAME = 'mundo-figus-pos-v1';
const ARCHIVOS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/db.js',
  './js/idgen.js',
  './js/stock.js',
  './js/cart.js',
  './js/sync.js',
  './js/catalog.js',
  './js/sales.js',
  './js/espera.js',
  './js/reports.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ARCHIVOS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Estrategia: cache-first para el shell. Las llamadas a Google Apps Script
// (sync/catálogo) van directo a red y nunca se cachean.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // dejar pasar llamadas externas (GAS)

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).catch(() => caches.match('./index.html'));
    })
  );
});
