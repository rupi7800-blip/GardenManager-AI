// Service worker: app installabile e consultabile offline, notifiche in background.
const VERSION = 'gm-v5';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/ai-providers.js', 'js/db.js', 'js/ui.js', 'js/store.js', 'js/weather.js', 'js/ai.js', 'js/botany.js', 'js/tasks.js', 'js/irrigation.js', 'js/tips.js', 'js/notify.js', 'js/data/species.js',
  'js/views/dashboard.js', 'js/views/garden.js', 'js/views/garden-form.js', 'js/views/plants.js', 'js/views/plant-form.js', 'js/views/plant-detail.js', 'js/views/species-detail.js',
  'js/views/recognize.js', 'js/views/calendar.js', 'js/views/task-ui.js', 'js/views/diagnose.js', 'js/views/design.js', 'js/views/orto.js', 'js/views/lawn.js',
  'js/views/assistant.js', 'js/views/settings.js', 'js/views/onboarding.js',
];
const LAZY = ['vendor/anthropic-sdk.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => caches.open(VERSION)).then(c => c.addAll(LAZY).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Stale-while-revalidate per i file dell'app; le API esterne passano direttamente in rete
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(r => { if (r.ok) cache.put(e.request, r.clone()); return r; }).catch(() => hit || (e.request.mode === 'navigate' ? cache.match('index.html') : Response.error()));
    return hit || net;
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) { c.navigate(target).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(target);
  }));
});

// Controllo periodico (Chrome/Edge con app installata): riepilogo attività del giorno
function idb() { return new Promise((res, rej) => { const r = indexedDB.open('garden-manager-ai'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
function get(db, store, key) { return new Promise((res) => { const r = db.transaction(store).objectStore(store).get(key); r.onsuccess = () => res(r.result); r.onerror = () => res(null); }); }
function byIndex(db, store, idx, v) { return new Promise((res) => { const r = db.transaction(store).objectStore(store).index(idx).getAll(v); r.onsuccess = () => res(r.result || []); r.onerror = () => res([]); }); }
function put(db, store, obj) { return new Promise((res) => { const t = db.transaction(store, 'readwrite'); t.objectStore(store).put(obj); t.oncomplete = res; t.onerror = res; }); }
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const CAT = (t) => ['semina', 'trapianto', 'rinvaso'].includes(t) ? 'semina' : ['controllo', 'trattamento'].includes(t) ? 'controllo' : ['potatura', 'concimazione', 'raccolta', 'irrigazione'].includes(t) ? t : 'attività';

async function periodicCheck() {
  const db = await idb();
  const settings = (await get(db, 'kv', 'settings'))?.value;
  const gid = (await get(db, 'kv', 'activeGarden'))?.value;
  if (!settings?.notify?.enabled || !gid) return;
  const ns = settings.notify;
  const now = new Date(), today = iso(now);
  if (now.toTimeString().slice(0, 5) < (ns.time || '08:00')) return;
  const sentRec = await get(db, 'kv', 'notifSent');
  const sent = sentRec?.value || {};
  const key = `day:${gid}:${today}`;
  if (sent[key]) return;
  const h = new Date(now); h.setDate(h.getDate() + (ns.advanceDays || 0));
  const horizon = iso(h);
  const tasks = (await byIndex(db, 'tasks', 'gardenId', gid)).filter(t => t.status === 'todo' && !t.suspended && t.date <= horizon && (t.due || t.date) >= today && (t.priority || 1) >= (ns.minPriority || 1) && (ns.types || []).includes(CAT(t.type)));
  if (tasks.length) {
    tasks.sort((a, b) => (b.priority || 1) - (a.priority || 1));
    await self.registration.showNotification(`Giardino: ${tasks.length} attività`, { body: tasks.slice(0, 3).map(t => '• ' + t.title).join('\n'), tag: key, icon: 'icons/icon-192.png', data: { url: './#/calendario' } });
  }
  sent[key] = today;
  await put(db, 'kv', { key: 'notifSent', value: sent });
}
self.addEventListener('periodicsync', (e) => { if (e.tag === 'garden-check') e.waitUntil(periodicCheck()); });
