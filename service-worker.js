// service-worker.js — Cachea el shell de la app para que funcione 100% offline
// después de la primera carga. Los datos de negocio viven en IndexedDB, no acá.
//
// La app vive en el subdirectorio /mundo-figus-pos/ de GitHub Pages. Todas las
// rutas de acá son absolutas (no relativas) a propósito: una PWA instalada en
// Android resuelve start_url/scope de forma independiente del documento que
// la abrió, y una ruta relativa ambigua entre el manifest, el registro del
// Service Worker y esta lista de archivos es la fuente más común de que una
// PWA instalada deje de abrir después del primer uso.
//
// IMPORTANTE: CACHE_NAME hay que incrementarlo cada vez que se publica una
// nueva versión de estos archivos. Mientras el nombre no cambie, un
// dispositivo que ya instaló la PWA sigue sirviendo lo que tenía cacheado
// —aunque el hosting tenga archivos más nuevos— hasta que detecte un cambio acá.

const BASE = '/mundo-figus-pos/';
const CACHE_NAME = 'mundo-figus-pos-v3';
const INDEX_URL = BASE + 'index.html';

const ARCHIVOS = [
  BASE,
  INDEX_URL,
  BASE + 'manifest.json',
  BASE + 'css/styles.css',
  BASE + 'js/db.js',
  BASE + 'js/idgen.js',
  BASE + 'js/stock.js',
  BASE + 'js/cart.js',
  BASE + 'js/sync.js',
  BASE + 'js/catalog.js',
  BASE + 'js/sales.js',
  BASE + 'js/espera.js',
  BASE + 'js/reports.js',
  BASE + 'js/app.js',
  BASE + 'icons/icon-192.png',
  BASE + 'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // { cache: 'reload' } evita que el propio navegador sirva estos
      // archivos desde SU caché HTTP: sin esto, un CACHE_NAME nuevo podía
      // seguir empaquetando contenido viejo si el navegador lo tenía
      // en caché por su cuenta.
      Promise.all(ARCHIVOS.map((url) =>
        fetch(url, { cache: 'reload' }).then((res) => cache.put(url, res))
      ))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // dejar pasar llamadas externas (GAS)

  // Solicitudes de NAVEGACIÓN (abrir/reabrir la app, tocar el ícono
  // instalado): estrategia dedicada, network-first con fallback explícito
  // y absoluto al index.html cacheado. Nunca se delega esto al mismo
  // camino que los assets — es justamente la falta de este caso especial
  // la causa más común de que una PWA instalada quede en blanco al reabrir.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match(INDEX_URL, { ignoreSearch: true }))
    );
    return;
  }

  // Resto del shell: cache-first, con red como respaldo y el index
  // cacheado como último recurso si todo lo demás falla.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).catch(() => caches.match(INDEX_URL));
    })
  );
});
