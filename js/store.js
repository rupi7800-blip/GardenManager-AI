// Accesso ai dati di dominio: giardini, specie, piante, storico.
import { db, uid, kvGet, kvSet } from './db.js';
import { SPECIES, SPECIES_BY_ID, CATEGORIES } from './data/species.js';

export const state = { garden: null, gardens: [], settings: null };

export const DEFAULT_SETTINGS = {
  apiKey: '', theme: 'auto', userName: '',
  ai: { primary: 'gemini', fallback: true, providers: {} },
  mode: 'biologica', customMode: ['prevenzione', 'compostaggio', 'pacciamatura', 'monitoraggio'],
  notify: { enabled: false, time: '08:00', advanceDays: 1, types: ['attività', 'meteo', 'potatura', 'concimazione', 'semina', 'raccolta', 'controllo', 'irrigazione'], minPriority: 1, weekly: true },
  webSearch: false,
};

export async function loadSettings() {
  const s = await kvGet('settings', {});
  state.settings = { ...DEFAULT_SETTINGS, ...s, notify: { ...DEFAULT_SETTINGS.notify, ...(s.notify || {}) } };
  return state.settings;
}
export async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await kvSet('settings', state.settings);
  return state.settings;
}

// ── Giardini ──
export async function loadGardens() {
  state.gardens = (await db.all('gardens')).sort((a, b) => a.created.localeCompare(b.created));
  const activeId = await kvGet('activeGarden');
  state.garden = state.gardens.find(g => g.id === activeId) || state.gardens[0] || null;
  return state.gardens;
}
export async function saveGarden(g) {
  if (!g.id) { g.id = uid(); g.created = new Date().toISOString(); }
  g.updated = new Date().toISOString();
  await db.put('gardens', g);
  await loadGardens();
  if (!state.garden || state.garden.id === g.id) await setActiveGarden(g.id);
  return g;
}
export async function setActiveGarden(id) {
  await kvSet('activeGarden', id);
  state.garden = state.gardens.find(g => g.id === id) || null;
}
export async function deleteGarden(id) {
  for (const s of ['plants', 'tasks', 'events', 'designs', 'beds', 'chats']) {
    const rows = await db.byIndex(s, 'gardenId', id);
    for (const r of rows) await db.del(s, r.id);
  }
  await db.del('gardens', id);
  await loadGardens();
  if (state.garden) await setActiveGarden(state.garden.id);
}

// ── Specie (archivio curato + specie aggiunte dall'utente) ──
let customCache = null;
export async function customSpecies() {
  if (!customCache) customCache = await db.all('species');
  return customCache;
}
export async function allSpecies() {
  const custom = await customSpecies();
  const map = new Map(SPECIES.map(s => [s.id, { ...s, source: 'curated' }]));
  for (const c of custom) map.set(c.id, { ...(map.get(c.id) || {}), ...c });
  return [...map.values()];
}
export async function getSpecies(id) {
  if (!id) return null;
  const c = await db.get('species', id);
  const base = SPECIES_BY_ID[id];
  if (!base && !c) return null;
  return { ...(base ? { ...base, source: 'curated' } : {}), ...(c || {}) };
}
export async function saveSpecies(sp) {
  if (!sp.id) sp.id = 'u-' + uid();
  sp.updated = new Date().toISOString();
  await db.put('species', sp);
  customCache = null;
  return sp;
}
export function speciesIdFromName(sci) {
  return (sci || '').toLowerCase().replace(/[×]/g, 'x').split(/\s+/).slice(0, 2).join('-').replace(/[^a-z0-9-]/g, '');
}
// Trova una specie dell'archivio dal nome scientifico (genere + specie)
export async function findSpeciesByName(sci) {
  const key = speciesIdFromName(sci);
  const list = await allSpecies();
  return list.find(s => speciesIdFromName(s.sci) === key) || list.find(s => s.id === key) || null;
}
export function searchSpeciesLocal(list, q, cat) {
  const n = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const qq = n(q);
  return list.filter(s => (!cat || s.cat === cat || (cat === 'vaso' && s.vaso)) &&
    (!qq || n(s.it).includes(qq) || n(s.sci).includes(qq) || n(s.fam).includes(qq) || (s.subs || []).some(x => n(x).includes(qq)) || (s.aliases || []).some(a => n(a).includes(qq))))
    .sort((a, b) => a.it.localeCompare(b.it, 'it'));
}
export { CATEGORIES };

// ── Piante del giardino ──
export async function gardenPlants(gardenId = state.garden?.id, { includeArchived = false } = {}) {
  if (!gardenId) return [];
  const rows = await db.byIndex('plants', 'gardenId', gardenId);
  return rows.filter(p => includeArchived || !p.archived).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'it'));
}
export async function savePlant(p) {
  const isNew = !p.id;
  if (isNew) { p.id = uid(); p.created = new Date().toISOString(); p.gardenId = p.gardenId || state.garden.id; }
  p.updated = new Date().toISOString();
  const prev = isNew ? null : await db.get('plants', p.id);
  await db.put('plants', p);
  if (isNew) await addEvent({ plantId: p.id, type: 'inserimento', text: `Pianta inserita nel giardino${p.origin ? ' (' + p.origin + ')' : ''}.` });
  else if (prev && prev.health !== p.health) await addEvent({ plantId: p.id, type: 'salute', text: `Stato di salute: ${prev.health || '—'} → ${p.health}.` });
  return p;
}
export async function deletePlant(id) {
  for (const s of ['events', 'tasks', 'photos']) for (const r of await db.byIndex(s, 'plantId', id)) await db.del(s, r.id);
  await db.del('plants', id);
}
export async function duplicatePlant(p) {
  const copy = { ...p, id: undefined, name: p.name + ' (copia)', photoId: p.photoId };
  return savePlant(copy);
}

// ── Storico ──
export async function addEvent(e) {
  const ev = { id: uid(), date: new Date().toISOString(), gardenId: e.gardenId || state.garden?.id, ...e };
  await db.put('events', ev);
  return ev;
}
export async function plantEvents(plantId) {
  return (await db.byIndex('events', 'plantId', plantId)).sort((a, b) => b.date.localeCompare(a.date));
}

export const HEALTH = [['ottima', 'Ottima'], ['buona', 'Buona'], ['da-seguire', 'Da seguire'], ['sofferente', 'Sofferente'], ['malata', 'Malata']];
export const healthChip = (h) => {
  const map = { ottima: 'ok', buona: 'ok', 'da-seguire': 'warn', sofferente: 'warn', malata: 'danger' };
  const label = (HEALTH.find(x => x[0] === h) || [h, h || '—'])[1];
  return `<span class="chip ${map[h] || ''}">${label}</span>`;
};
export const SOILS = ['franco (medio impasto)', 'argilloso', 'sabbioso', 'limoso', 'calcareo', 'acido', 'sassoso', 'torboso / organico'];
export const EXPOSURES = ['pieno sole', 'mezz\'ombra', 'ombra', 'variabile'];
export const MODES = {
  biologica: { label: 'Biologica', desc: 'Prevenzione e lotta biologica, tutela degli insetti utili, compostaggio, fertilizzanti organici, niente prodotti di sintesi.' },
  integrata: { label: 'Integrata', desc: 'Monitoraggio e soglie di intervento; prima i metodi agronomici e biologici, poi interventi mirati con prodotti autorizzati.' },
  classica: { label: 'Classica', desc: 'Tecniche tradizionali, concimazione convenzionale, gestione fitosanitaria convenzionale con prodotti autorizzati, manutenzione programmata.' },
  permacultura: { label: 'Permacultura', desc: 'Ecosistema autosufficiente: consociazioni, pacciamatura permanente, suolo non lavorato, raccolta dell\'acqua, biodiversità e piante multifunzionali.' },
  personalizzata: { label: 'Personalizzata', desc: 'Combini le tecniche che preferisci.' },
};
export const CUSTOM_TECHNIQUES = ['prevenzione', 'lotta biologica', 'insetti utili', 'compostaggio', 'fertilizzanti organici', 'concimi minerali', 'monitoraggio e soglie', 'prodotti fitosanitari autorizzati', 'pacciamatura', 'consociazioni', 'no-dig (suolo non lavorato)', 'raccolta acqua piovana', 'potature tradizionali'];

// Testo dell'intervento per un problema secondo la filosofia di gestione
export function interventionFor(problem, settings = state.settings) {
  const mode = settings?.mode || 'biologica';
  const custom = settings?.customMode || [];
  const thr = problem.thr ? ` Soglia indicativa: ${problem.thr}.` : '';
  switch (mode) {
    case 'classica': return { label: 'Intervento (gestione classica)', text: problem.cla || problem.bio };
    case 'integrata': return { label: 'Intervento (gestione integrata)', text: `Monitora prima di intervenire.${thr} Metodi agronomici e biologici: ${problem.bio} Se la soglia è superata: ${problem.cla}` };
    case 'permacultura': return { label: 'Intervento (permacultura)', text: `${problem.pv} ${problem.bio} Rafforza l'equilibrio: siepi miste, fiori per gli insetti utili, suolo coperto.` };
    case 'personalizzata': {
      const chem = custom.includes('prodotti fitosanitari autorizzati');
      return { label: 'Intervento (gestione personalizzata)', text: `${problem.bio}${chem ? ' Se necessario: ' + problem.cla : ''}${custom.includes('monitoraggio e soglie') ? thr : ''}` };
    }
    default: return { label: 'Intervento (gestione biologica)', text: problem.bio };
  }
}
export function modeLabel(settings = state.settings) {
  const m = MODES[settings?.mode] || MODES.biologica;
  return settings?.mode === 'personalizzata' ? `Personalizzata (${(settings.customMode || []).join(', ')})` : m.label;
}
