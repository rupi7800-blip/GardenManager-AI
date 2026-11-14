// IndexedDB: archivio locale dell'app (funziona offline).
const DB_NAME = 'garden-manager-ai';
const DB_VERSION = 1;
export const STORES = ['gardens', 'species', 'plants', 'tasks', 'events', 'photos', 'designs', 'beds', 'chats', 'kv'];

let dbp = null;
export function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (db.objectStoreNames.contains(s)) continue;
        const st = db.createObjectStore(s, { keyPath: s === 'kv' ? 'key' : 'id' });
        if (['plants', 'tasks', 'events', 'designs', 'beds', 'chats'].includes(s)) st.createIndex('gardenId', 'gardenId');
        if (['events', 'photos', 'tasks'].includes(s)) st.createIndex('plantId', 'plantId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const st = t.objectStore(store);
    let out;
    Promise.resolve(fn(st)).then(r => { out = r; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}
const wrap = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export const db = {
  get: (store, id) => tx(store, 'readonly', st => wrap(st.get(id))),
  all: (store) => tx(store, 'readonly', st => wrap(st.getAll())),
  byIndex: (store, index, value) => tx(store, 'readonly', st => wrap(st.index(index).getAll(value))),
  put: (store, obj) => tx(store, 'readwrite', st => { st.put(obj); return obj; }),
  putMany: (store, arr) => tx(store, 'readwrite', st => { arr.forEach(o => st.put(o)); return arr.length; }),
  del: (store, id) => tx(store, 'readwrite', st => { st.delete(id); }),
  clear: (store) => tx(store, 'readwrite', st => { st.clear(); }),
};

// Key-value per impostazioni e cache
export async function kvGet(key, fallback = null) {
  const r = await db.get('kv', key);
  return r ? r.value : fallback;
}
export function kvSet(key, value) { return db.put('kv', { key, value }); }

// Cache con scadenza
export async function cacheGet(key, maxAgeMs) {
  const r = await db.get('kv', 'cache:' + key);
  if (!r) return null;
  if (maxAgeMs && Date.now() - r.t > maxAgeMs) return null;
  return r.value;
}
export function cacheSet(key, value) { return db.put('kv', { key: 'cache:' + key, value, t: Date.now() }); }

// Backup completo (foto incluse come data URL)
export async function exportAll() {
  const out = { app: 'garden-manager-ai', version: DB_VERSION, exportedAt: new Date().toISOString(), data: {} };
  for (const s of STORES) {
    let rows = await db.all(s);
    if (s === 'photos') rows = await Promise.all(rows.map(async p => ({ ...p, blob: undefined, dataUrl: await blobToDataURL(p.blob) })));
    // la chiave API non entra mai nei backup
    if (s === 'kv') rows = rows.filter(r => !r.key.startsWith('cache:')).map(r => r.key === 'settings' ? { ...r, value: { ...r.value, apiKey: '' } } : r);
    out.data[s] = rows;
  }
  return out;
}
export async function importAll(json, { replace = false } = {}) {
  if (!json || json.app !== 'garden-manager-ai' || !json.data) throw new Error('File di backup non valido');
  for (const s of STORES) {
    let rows = json.data[s] || [];
    if (replace && s !== 'kv') await db.clear(s);
    if (s === 'kv') {
      const cur = await db.get('kv', 'settings');
      rows = rows.map(r => r.key === 'settings' ? { ...r, value: { ...r.value, apiKey: cur?.value?.apiKey || '' } } : r);
    }
    const fixed = s === 'photos' ? await Promise.all(rows.map(async p => ({ ...p, blob: await (await fetch(p.dataUrl)).blob(), dataUrl: undefined }))) : rows;
    await db.putMany(s, fixed);
  }
}
export function blobToDataURL(blob) {
  return new Promise((res, rej) => { if (!blob) return res(null); const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
}
