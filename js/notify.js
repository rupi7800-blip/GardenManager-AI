// Notifiche locali: un riepilogo giornaliero all'orario scelto, avvisi meteo una sola volta
// per evento, riepilogo settimanale il lunedì. Niente notifiche ripetute.
import { kvGet, kvSet } from './db.js';
import { state } from './store.js';
import { gardenTasks } from './tasks.js';
import { todayISO, addDays } from './ui.js';

export const NOTIFY_TYPES = [['attività', 'Attività quotidiane'], ['potatura', 'Potature'], ['concimazione', 'Concimazioni'], ['semina', 'Semine e trapianti'], ['raccolta', 'Raccolti'], ['controllo', 'Controllo fitosanitario'], ['irrigazione', 'Irrigazione'], ['meteo', 'Meteo avverso (gelo, caldo, temporali)']];
export function categoryOf(type) {
  if (['semina', 'trapianto', 'rinvaso'].includes(type)) return 'semina';
  if (['controllo', 'trattamento'].includes(type)) return 'controllo';
  if (['potatura', 'concimazione', 'raccolta', 'irrigazione'].includes(type)) return type;
  return 'attività';
}

export const notifSupported = () => 'Notification' in window;
export async function requestPermission() {
  if (!notifSupported()) return 'unsupported';
  const r = await Notification.requestPermission();
  if (r === 'granted') await registerPeriodic();
  return r;
}
async function show(title, body, tag) {
  if (!notifSupported() || Notification.permission !== 'granted') return false;
  const opts = { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: './#/calendario' } };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) { await reg.showNotification(title, opts); return true; }
  } catch (e) { /* fallback sotto */ }
  new Notification(title, opts);
  return true;
}
async function registerPeriodic() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg && 'periodicSync' in reg) await reg.periodicSync.register('garden-check', { minInterval: 12 * 3600 * 1000 });
  } catch (e) { /* non supportato o non installata: le notifiche partono all'apertura dell'app */ }
}

export function selectTasksForNotice(tasks, ns, today = todayISO()) {
  const horizon = addDays(today, ns.advanceDays || 0);
  return tasks.filter(t => t.status === 'todo' && !t.suspended && t.date <= horizon && (t.due || t.date) >= today && (t.priority || 1) >= (ns.minPriority || 1) && (ns.types || []).includes(categoryOf(t.type)));
}

export async function runNotificationChecks({ alerts = [] } = {}) {
  const ns = state.settings?.notify;
  if (!ns?.enabled || !state.garden || !notifSupported() || Notification.permission !== 'granted') return;
  const sent = await kvGet('notifSent', {});
  const now = new Date();
  const today = todayISO();
  const hhmm = now.toTimeString().slice(0, 5);
  // Avvisi meteo: una volta per evento
  if (ns.types.includes('meteo')) {
    for (const a of alerts.filter(a => a.level !== 'info')) {
      const k = 'wx:' + a.key;
      if (sent[k]) continue;
      if (await show(`${a.icon} ${a.title}`, a.text, k)) sent[k] = today;
    }
  }
  // Riepilogo giornaliero all'orario scelto
  const dk = `day:${state.garden.id}:${today}`;
  if (!sent[dk] && hhmm >= (ns.time || '08:00')) {
    const list = selectTasksForNotice(await gardenTasks(), ns, today).sort((a, b) => (b.priority || 1) - (a.priority || 1));
    if (list.length) {
      const first = list.slice(0, 3).map(t => `• ${t.priority >= 3 ? '❗ ' : ''}${t.title}`).join('\n');
      await show(`${state.garden.name}: ${list.length} attività`, first + (list.length > 3 ? `\n…e altre ${list.length - 3}` : '') + `\n${list[0].text.slice(0, 120)}`, dk);
    }
    sent[dk] = today;
  }
  // Riepilogo settimanale (lunedì)
  const wk = `week:${state.garden.id}:${today}`;
  if (ns.weekly && now.getDay() === 1 && !sent[wk] && hhmm >= (ns.time || '08:00')) {
    const week = (await gardenTasks()).filter(t => t.status === 'todo' && !t.suspended && t.date >= today && t.date <= addDays(today, 6));
    if (week.length) await show('Settimana in giardino', `${week.length} attività previste: ${[...new Set(week.map(t => t.type))].join(', ')}.`, wk);
    sent[wk] = today;
  }
  // pulizia chiavi vecchie
  const limit = addDays(today, -30);
  for (const k of Object.keys(sent)) if (sent[k] < limit) delete sent[k];
  await kvSet('notifSent', sent);
}
