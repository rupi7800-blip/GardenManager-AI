// Attività: generazione automatica dalle schede delle specie presenti, attività manuali,
// ricorrenze, completamento con registrazione nello storico, esportazione ICS.
import { db, uid, kvGet, kvSet } from './db.js';
import { state, gardenPlants, getSpecies, addEvent } from './store.js';
import { calendarShift } from './weather.js';
import { TASK_TYPES } from './data/species.js';
import { todayISO, addDays, MONTHS } from './ui.js';

export const PRIORITY = { 1: 'Normale', 2: 'Importante', 3: 'Urgente' };

export async function gardenTasks(gardenId = state.garden?.id) {
  if (!gardenId) return [];
  return (await db.byIndex('tasks', 'gardenId', gardenId)).sort((a, b) => a.date.localeCompare(b.date) || (b.priority || 1) - (a.priority || 1));
}
export async function saveTask(t) {
  if (!t.id) { t.id = uid(); t.created = new Date().toISOString(); t.gardenId = t.gardenId || state.garden.id; t.status = t.status || 'todo'; }
  await db.put('tasks', t);
  return t;
}
export async function deleteTask(t) {
  if (t.autoKey) { const d = await kvGet('dismissedAuto', []); d.push(t.autoKey); await kvSet('dismissedAuto', d.slice(-3000)); }
  await db.del('tasks', t.id);
}

function monthShift(m, sh) { return ((m - 1 + sh + 12) % 12) + 1; }
function lastDay(y, m) { return new Date(y, m, 0).getDate(); }
const pad = (n) => String(n).padStart(2, '0');

// Adatta il testo dell'attività alla filosofia di gestione
export function adaptToMode(ty, text, settings = state.settings) {
  const mode = settings?.mode || 'biologica';
  if (ty !== 'trattamento' && ty !== 'concimazione') return text;
  const custom = settings?.customMode || [];
  if (ty === 'concimazione') {
    if (mode === 'classica' || (mode === 'personalizzata' && custom.includes('concimi minerali'))) return text + ' Puoi usare concimi organo-minerali o minerali a titolo bilanciato, nelle dosi in etichetta.';
    if (mode === 'permacultura') return text + ' Preferisci compost maturo, macerati e pacciamatura che si decompone; nessun concime di sintesi.';
    return text + ' Usa compost, letame maturo o concimi organici ammessi in biologico.';
  }
  switch (mode) {
    case 'biologica': return text + ' Usa solo prodotti ammessi in agricoltura biologica (es. rame nei limiti di legge, zolfo, olio minerale, Bacillus thuringiensis) e rispetta gli insetti utili: niente trattamenti in fioritura.';
    case 'integrata': return 'Solo se il monitoraggio o i bollettini fitosanitari lo giustificano: ' + text + ' Preferisci i mezzi a minor impatto e prodotti autorizzati, rispettando le soglie.';
    case 'permacultura': return 'Valuta prima se serve davvero: ' + text + ' In permacultura si privilegiano varietà resistenti, consociazioni, siepi per gli antagonisti naturali e, solo se indispensabile, prodotti di origine naturale.';
    case 'classica': return text + ' Usa prodotti fitosanitari autorizzati per la specie, secondo etichetta, tempi di carenza e dispositivi di protezione.';
    default: return text + (custom.includes('prodotti fitosanitari autorizzati') ? ' Se necessario usa prodotti autorizzati secondo etichetta.' : ' Privilegia mezzi biologici e preventivi.');
  }
}

// Intervallo di taglio del prato secondo tipo e stagione (giorni)
function lawnInterval(lawn, month) {
  const macro = lawn?.type === 'macro';
  if (lawn?.type === 'fiorito' || lawn?.type === 'tappezzante') return null;
  if (macro) return [6, 7, 8].includes(month) ? 5 : [5, 9].includes(month) ? 7 : 14;
  return [4, 5].includes(month) ? 5 : [3, 6, 9, 10].includes(month) ? 7 : [7, 8].includes(month) ? 10 : 14;
}

// Genera le attività del mese corrente e del successivo per le piante presenti
export async function generateAutoTasks(garden = state.garden) {
  if (!garden) return 0;
  const plants = await gardenPlants(garden.id);
  const existing = new Set((await gardenTasks(garden.id)).filter(t => t.autoKey).map(t => t.autoKey));
  const dismissed = new Set(await kvGet('dismissedAuto', []));
  const shift = calendarShift(garden.climate);
  const today = todayISO();
  const now = new Date();
  const months = [0, 1].map(k => { const d = new Date(now.getFullYear(), now.getMonth() + k, 1); return { y: d.getFullYear(), m: d.getMonth() + 1 }; });
  // raggruppa le piante per specie
  const groups = {};
  for (const p of plants) if (p.speciesId && !p.noAuto) (groups[p.speciesId] = groups[p.speciesId] || []).push(p);
  const created = [];
  for (const [sid, ps] of Object.entries(groups)) {
    const sp = await getSpecies(sid);
    if (!sp?.tasks) continue;
    const names = ps.map(p => p.name);
    const label = ps.length > 1 ? `${sp.it} (${ps.length} schede)` : names[0];
    sp.tasks.forEach((t, i) => {
      for (const { y, m } of months) {
        const active = t.m.some(mm => (t.sh && !t.local ? monthShift(mm, shift) : mm) === m);
        if (!active) continue;
        const start = `${y}-${pad(m)}-01`, end = `${y}-${pad(m)}-${pad(lastDay(y, m))}`;
        if (end < today) continue;
        const base = start < today ? today : start;
        if (t.ty === 'taglio') {
          const lawn = sp.lawn;
          const every = lawnInterval(lawn, m);
          if (!every) continue;
          for (let d = base, k = 0; d <= end; d = addDays(d, every), k++) {
            const key = `${garden.id}|${sid}|${i}|${y}-${m}|${k}`;
            if (existing.has(key) || dismissed.has(key)) continue;
            const h = lawn ? ([7, 8].includes(m) ? lawn.hSummer : lawn.h[0]) : null;
            created.push({ id: uid(), gardenId: garden.id, plantIds: ps.map(p => p.id), plantId: ps[0].id, speciesId: sid, type: 'taglio', title: `Taglio: ${label}`, text: `${t.x}${h ? ` Altezza consigliata: ${h} cm (mai più di un terzo dell'altezza per volta).` : ''}`, date: d, due: addDays(d, every - 1), priority: 1, status: 'todo', source: 'auto', autoKey: key, created: new Date().toISOString() });
          }
          continue;
        }
        const key = `${garden.id}|${sid}|${i}|${y}-${m}`;
        if (existing.has(key) || dismissed.has(key)) continue;
        // distribuisce nel mese: priorità alte all'inizio
        const spread = t.p >= 3 ? 0 : (i * 3) % (t.p === 2 ? 7 : 14);
        let date = addDays(base, spread);
        if (date > end) date = end;
        created.push({ id: uid(), gardenId: garden.id, plantIds: ps.map(p => p.id), plantId: ps[0].id, speciesId: sid, type: t.ty, title: `${TASK_TYPES[t.ty]?.label || t.ty}: ${label}`, text: adaptToMode(t.ty, t.x), date, due: end, priority: t.p || 1, status: 'todo', source: 'auto', autoKey: key, created: new Date().toISOString() });
      }
    });
  }
  if (created.length) await db.putMany('tasks', created);
  await kvSet('lastAutoGen:' + garden.id, today);
  return created.length;
}

function nextDate(date, recur) {
  const d = new Date(date + 'T12:00:00');
  const n = recur.every || 1;
  if (recur.unit === 'day') d.setDate(d.getDate() + n);
  else if (recur.unit === 'week') d.setDate(d.getDate() + 7 * n);
  else if (recur.unit === 'month') d.setMonth(d.getMonth() + n);
  else if (recur.unit === 'year') d.setFullYear(d.getFullYear() + n);
  return todayISO(d);
}

export async function completeTask(t, { notes = '', photoIds = [] } = {}) {
  t.status = 'done'; t.doneAt = new Date().toISOString();
  if (notes) t.notes = notes;
  if (photoIds.length) t.photoIds = [...(t.photoIds || []), ...photoIds];
  await saveTask(t);
  const ids = t.plantIds || (t.plantId ? [t.plantId] : []);
  for (const pid of ids) await addEvent({ plantId: pid, gardenId: t.gardenId, type: t.type, text: `${t.title} — completata.${notes ? ' Note: ' + notes : ''}`, photoIds, taskId: t.id });
  if (!ids.length) await addEvent({ gardenId: t.gardenId, type: t.type, text: `${t.title} — completata.${notes ? ' Note: ' + notes : ''}`, photoIds, taskId: t.id });
  if (t.recur && t.recur.unit) {
    const nd = nextDate(t.date, t.recur);
    if (!t.recur.until || nd <= t.recur.until) {
      await saveTask({ ...t, id: undefined, status: 'todo', doneAt: null, notes: '', photoIds: [], date: nd, due: null, created: undefined, autoKey: undefined });
    }
  }
}
export async function reopenTask(t) { t.status = 'todo'; t.doneAt = null; await saveTask(t); }
export async function postponeTask(t, days) { t.date = addDays(t.date < todayISO() ? todayISO() : t.date, days); if (t.due && t.due < t.date) t.due = t.date; t.postponed = (t.postponed || 0) + 1; await saveTask(t); }
export async function toggleSuspend(t) { t.suspended = !t.suspended; await saveTask(t); }

export function taskBuckets(tasks, today = todayISO()) {
  const open = tasks.filter(t => t.status === 'todo' && !t.suspended);
  return {
    overdue: open.filter(t => (t.due || t.date) < today),
    today: open.filter(t => t.date <= today && (t.due || t.date) >= today),
    upcoming: open.filter(t => t.date > today && t.date <= addDays(today, 14)),
  };
}

// ── Calendari esterni ──
const icsEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => '\\' + m);
const fold = (line) => { const out = []; let s = line; while (s.length > 74) { out.push(s.slice(0, 74)); s = ' ' + s.slice(74); } out.push(s); return out.join('\r\n'); };
const icsDate = (iso) => iso.replace(/-/g, '');
// Promemoria alle 8:00 del giorno (advance = 0) o dei giorni precedenti; relativo alla mezzanotte di DTSTART
const alarmTrigger = (advance) => { const h = advance * 24 - 8; return h <= 0 ? `TRIGGER:PT${-h}H` : `TRIGGER:-PT${h}H`; };

export function taskDescription(t, plantNames = '') {
  return [`Pianta: ${plantNames || '—'}`, `Operazione: ${TASK_TYPES[t.type]?.label || t.type}`, `Data: ${t.date}`, `Priorità: ${PRIORITY[t.priority || 1]}`, `Istruzioni: ${t.text || ''}`].join('\n');
}
export function buildICS(tasks, { gardenName = 'Giardino', advanceDays = 1, plantNameOf = () => '' } = {}) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Garden Manager AI//IT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsEsc('Giardino – ' + gardenName)}`];
  for (const t of tasks) {
    const names = plantNameOf(t);
    lines.push('BEGIN:VEVENT', `UID:${t.id}@garden-manager-ai`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${icsDate(t.date)}`, `DTEND;VALUE=DATE:${icsDate(addDays(t.date, 1))}`,
      `SUMMARY:${icsEsc((t.priority >= 3 ? '❗ ' : '') + t.title)}`, `DESCRIPTION:${icsEsc(taskDescription(t, names))}`, `CATEGORIES:${icsEsc(TASK_TYPES[t.type]?.label || 'Giardino')}`, `PRIORITY:${t.priority >= 3 ? 1 : t.priority === 2 ? 5 : 9}`);
    if (t.recur?.unit) lines.push(`RRULE:FREQ=${{ day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' }[t.recur.unit]};INTERVAL=${t.recur.every || 1}${t.recur.until ? ';UNTIL=' + icsDate(t.recur.until) : ''}`);
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(t.title)}`, alarmTrigger(advanceDays), 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n');
}
export function downloadFile(name, content, type = 'text/calendar') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: type + ';charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export function googleCalendarURL(t, names) {
  const p = new URLSearchParams({ action: 'TEMPLATE', text: t.title, dates: `${icsDate(t.date)}/${icsDate(addDays(t.date, 1))}`, details: taskDescription(t, names) });
  return 'https://calendar.google.com/calendar/render?' + p;
}
export function outlookURL(t, names) {
  const p = new URLSearchParams({ path: '/calendar/action/compose', rru: 'addevent', subject: t.title, startdt: t.date, enddt: addDays(t.date, 1), allday: 'true', body: taskDescription(t, names) });
  return 'https://outlook.live.com/calendar/0/deeplink/compose?' + p;
}
export const monthName = (m) => MONTHS[m - 1];
