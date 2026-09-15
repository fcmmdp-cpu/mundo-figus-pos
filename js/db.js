// db.js — Capa de persistencia local (IndexedDB)
// Toda venta se guarda PRIMERO acá. Nunca se depende de la red para persistir.

const DB_NAME = 'mundoFigusPOS';
const DB_VERSION = 1;

let dbInstance = null;

function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains('articulos')) {
        db.createObjectStore('articulos', { keyPath: 'ID' });
      }
      if (!db.objectStoreNames.contains('combos')) {
        db.createObjectStore('combos', { keyPath: 'IDCombo' });
      }
      if (!db.objectStoreNames.contains('detalleCombos')) {
        const s = db.createObjectStore('detalleCombos', { keyPath: 'id', autoIncrement: true });
        s.createIndex('byCombo', 'IDCombo', { unique: false });
      }
      if (!db.objectStoreNames.contains('ventas')) {
        const s = db.createObjectStore('ventas', { keyPath: 'IDVenta' });
        s.createIndex('byFecha', 'Fecha', { unique: false });
        s.createIndex('bySync', 'syncStatus', { unique: false });
      }
      if (!db.objectStoreNames.contains('espera')) {
        db.createObjectStore('espera', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('syncQueue')) {
        db.createObjectStore('syncQueue', { keyPath: 'opId' });
      }
      if (!db.objectStoreNames.contains('config')) {
        db.createObjectStore('config', { keyPath: 'key' });
      }
    };

    req.onsuccess = (e) => {
      dbInstance = e.target.result;
      resolve(dbInstance);
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

function tx(storeName, mode = 'readonly') {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

// --- Helpers genéricos ---
async function putAll(storeName, items) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, 'readwrite');
    const store = t.objectStore(storeName);
    items.forEach((item) => store.put(item));
    t.oncomplete = () => resolve();
    t.onerror = (e) => reject(e.target.error);
  });
}

async function clearStore(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, 'readwrite');
    t.objectStore(storeName).clear();
    t.oncomplete = () => resolve();
    t.onerror = (e) => reject(e.target.error);
  });
}

async function getAll(storeName) {
  const store = await tx(storeName);
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function getByKey(storeName, key) {
  const store = await tx(storeName);
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function put(storeName, item) {
  const store = await tx(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(item);
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function del(storeName, key) {
  const store = await tx(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e.target.error);
  });
}

async function getByIndex(storeName, indexName, value) {
  const store = await tx(storeName);
  return new Promise((resolve, reject) => {
    const req = store.index(indexName).getAll(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function getConfig(key, fallback = null) {
  const row = await getByKey('config', key);
  return row ? row.value : fallback;
}

async function setConfig(key, value) {
  return put('config', { key, value });
}

window.DB = {
  openDB, putAll, clearStore, getAll, getByKey, put, del, getByIndex,
  getConfig, setConfig,
};
