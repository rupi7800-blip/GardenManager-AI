import { openDB, kvGet } from './db.js';
import { state, loadSettings, loadGardens, setActiveGarden, gardenPlants, getSpecies } from './store.js';
import { getForecast, weatherAlerts } from './weather.js';
import { generateAutoTasks, gardenTasks } from './tasks.js';
import { runNotificationChecks } from './notify.js';
import { esc, $, toast, todayISO } from './ui.js';

const ROUTES = [
  { path: 'dashboard', label: 'Dashboard', icon: '🏡', mod: () => import('./views/dashboard.js') },
  { path: 'giardino', label: 'Il mio giardino', icon: '🌳', mod: () => import('./views/garden.js') },
  { path: 'piante', label: 'Piante', icon: '📚', mod: () => import('./views/plants.js') },
  { path: 'riconosci', label: 'Riconoscimento', icon: '📷', mod: () => import('./views/recognize.js') },
  { path: 'calendario', label: 'Calendario e attività', icon: '📅', mod: () => import('./views/calendar.js') },
  { path: 'diagnosi', label: 'Diagnostica', icon: '🩺', mod: () => import('./views/diagnose.js') },
  { path: 'progetta', label: 'Progettazione', icon: '📐', mod: () => import('./views/design.js') },
  { path: 'orto', label: 'Orto', icon: '🥕', mod: () => import('./views/orto.js'), sec: true },
  { path: 'prato', label: 'Prato', icon: '🟩', mod: () => import('./views/lawn.js'), sec: true },
  { path: 'consulente', label: 'Consulente AI', icon: '💬', mod: () => import('./views/assistant.js') },
  { path: 'impostazioni', label: 'Impostazioni', icon: '⚙️', mod: () => import('./views/settings.js') },
  { path: 'pianta', hidden: true, mod: () => import('./views/plant-detail.js') },
  { path: 'specie', hidden: true, mod: () => import('./views/species-detail.js') },
  { path: 'benvenuto', hidden: true, mod: () => import('./views/onboarding.js') },
];
const TABS = ['dashboard', 'giardino', 'calendario', 'riconosci', 'consulente'];

export function applyTheme(t = state.settings.theme) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

function renderNav(active) {
  const items = ROUTES.filter(r => !r.hidden);
  $('#nav').innerHTML = items.map((r, i) => `${r.sec && !items[i - 1]?.sec ? '<div class="sep">Sezioni</div>' : ''}${!r.sec && items[i - 1]?.sec ? '<div class="sep">Strumenti</div>' : ''}<a href="#/${r.path}" class="${r.path === active ? 'active' : ''}"><span class="ico">${r.icon}</span>${r.label}</a>`).join('');
  $('#tabbar').innerHTML = TABS.map(p => { const r = ROUTES.find(x => x.path === p); return `<a href="#/${p}" class="${p === active ? 'active' : ''}"><span class="ico">${r.icon}</span>${({ dashboard: 'Home', giardino: 'Giardino', calendario: 'Calendario', riconosci: 'Riconosci', consulente: 'Consulente' })[p]}</a>`; }).join('');
  const sw = $('#gardenSwitch');
  sw.innerHTML = state.gardens.map(g => `<option value="${g.id}" ${g.id === state.garden?.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('') + '<option value="__new">+ Nuovo giardino</option>';
  sw.hidden = !state.gardens.length;
}

let renderId = 0;
export async function route() {
  const [main, qs] = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?');
  const [path, ...params] = main.split('/');
  const query = new URLSearchParams(qs || '');
  if (!state.garden && path !== 'benvenuto' && path !== 'impostazioni') { location.hash = '#/benvenuto'; return; }
  const r = ROUTES.find(x => x.path === path) || ROUTES[0];
  const id = ++renderId;
  renderNav(r.hidden ? ({ pianta: 'giardino', specie: 'piante' })[r.path] : r.path);
  $('#sidebar').classList.remove('open');
  $('#pageTitle').textContent = r.label || ({ pianta: 'Scheda pianta', specie: 'Scheda botanica', benvenuto: 'Benvenuto' })[r.path];
  const view = $('#view');
  view.innerHTML = '<div class="loading"><span class="spinner"></span>Caricamento…</div>';
  try {
    const mod = await r.mod();
    if (id !== renderId) return;
    view.innerHTML = '';
    await mod.render(view, params.map(decodeURIComponent), query);
    if (id === renderId) { window.scrollTo(0, 0); view.focus({ preventScroll: true }); }
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="alert danger"><b>Errore</b><br>${esc(e.message || e)}</div>`;
  }
}
export const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };

// Contesto condiviso (meteo, piante, schede, attività, allerte)
export async function loadContext({ force = false } = {}) {
  const g = state.garden;
  const plants = await gardenPlants();
  const speciesMap = {};
  for (const p of plants) if (p.speciesId && !speciesMap[p.speciesId]) speciesMap[p.speciesId] = await getSpecies(p.speciesId);
  let fc = null, fcError = null;
  try { fc = await getForecast(g, { force }); } catch (e) { fcError = e.message; }
  const tasks = await gardenTasks();
  const alerts = weatherAlerts(fc, plants, speciesMap);
  return { garden: g, plants, speciesMap, fc, fcError, tasks, alerts };
}

async function dailyMaintenance() {
  if (!state.garden) return;
  const last = await kvGet('lastAutoGen:' + state.garden.id);
  if (last !== todayISO()) await generateAutoTasks();
  try { const ctx = await loadContext(); await runNotificationChecks({ alerts: ctx.alerts }); } catch (e) { /* offline */ }
}

async function init() {
  await openDB();
  await loadSettings();
  applyTheme();
  await loadGardens();
  $('#menuBtn').onclick = () => $('#sidebar').classList.toggle('open');
  $('#view').addEventListener('click', () => $('#sidebar').classList.remove('open'));
  $('#gardenSwitch').onchange = async (e) => {
    if (e.target.value === '__new') { go('#/benvenuto/nuovo'); return; }
    await setActiveGarden(e.target.value);
    await dailyMaintenance();
    route();
  };
  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => toast('Connessione ripristinata'));
  window.addEventListener('offline', () => toast('Sei offline: schede e attività restano consultabili'));
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  await dailyMaintenance();
  await route();
  setInterval(dailyMaintenance, 15 * 60 * 1000);
}
init();
