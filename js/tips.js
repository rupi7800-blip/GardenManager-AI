// "Il consiglio del giorno": un consiglio concreto al giorno sulle piante presenti.
// Con la chiave AI viene elaborato dal servizio AI scelto; senza, da regole basate su schede, meteo e attività.
import { kvGet, kvSet } from './db.js';
import { state } from './store.js';
import { callJSON, SCHEMA_TIP, hasAI } from './ai.js';
import { todayISO, MONTHS } from './ui.js';
import { taskBuckets } from './tasks.js';

function ruleCandidates({ fc, plants, speciesMap, tasks, alerts }) {
  const m = new Date().getMonth() + 1;
  const c = [];
  for (const a of alerts) c.push({ key: 'alert:' + a.key, score: 50, consiglio: `${a.title}. ${a.text}`, motivo: 'Previsioni meteo dei prossimi giorni.', pianta: '' });
  const b = taskBuckets(tasks);
  if (b.overdue.length) {
    const t = b.overdue.sort((x, y) => (y.priority || 1) - (x.priority || 1))[0];
    c.push({ key: 'overdue:' + t.id, score: 70 + (t.priority || 1) * 5, consiglio: `Recupera un intervento arretrato: ${t.title}. ${t.text}`, motivo: `Era previsto per il ${t.date}.`, pianta: '' });
  }
  const rain3 = fc ? fc.past.slice(-3).reduce((a, d) => a + (d.rain || 0), 0) : 0;
  const seen = new Set();
  for (const p of plants) {
    const s = speciesMap[p.speciesId];
    if (!s || seen.has(s.id)) continue;
    seen.add(s.id);
    for (const pr of s.problems || []) {
      if (!(pr.r || []).includes(m)) continue;
      const fungal = /fung|oomicete|batter/i.test(pr.k || '');
      const score = 40 + (fungal && rain3 > 10 ? 25 : 0) + (p.health === 'da-seguire' || p.health === 'sofferente' ? 15 : 0);
      c.push({ key: `prob:${s.id}:${pr.n}`, score, consiglio: `Controlla ${p.name}: ${pr.n.toLowerCase()} — ${pr.s}`, motivo: `${MONTHS[m - 1]} è un periodo a rischio${fungal && rain3 > 10 ? ` e negli ultimi 3 giorni sono caduti ${rain3.toFixed(0)} mm di pioggia` : ''}. Prevenzione: ${pr.pv}`, pianta: p.name });
    }
    for (const t of s.tasks || []) {
      if (!t.m.includes(m) || t.ty === 'taglio') continue;
      c.push({ key: `task:${s.id}:${t.x.slice(0, 30)}`, score: 30 + (t.p || 1) * 8, consiglio: `${p.name}: ${t.x}`, motivo: `Operazione tipica di ${MONTHS[m - 1]} per ${s.it.toLowerCase()}.`, pianta: p.name });
    }
  }
  if (fc?.today && fc.today.tmax >= 30) c.push({ key: 'hot:' + todayISO(), score: 60, consiglio: 'Irriga all\'alba e controlla l\'umidità del terreno prima di bagnare: con questo caldo l\'acqua serale favorisce funghi e l\'acqua di giorno evapora.', motivo: `Massima prevista ${fc.today.tmax.toFixed(0)} °C.`, pianta: '' });
  if ([6, 7, 8].includes(m)) c.push({ key: 'mulch-summer', score: 25, consiglio: 'Verifica lo spessore della pacciamatura sotto arbusti e alberi da frutto (8-10 cm, staccata dal colletto): riduce l\'evaporazione fino a un terzo.', motivo: 'Estate: periodo di massima evapotraspirazione.', pianta: '' });
  if ([10, 11].includes(m)) c.push({ key: 'leaves-autumn', score: 25, consiglio: 'Raccogli le foglie cadute delle piante che hanno avuto malattie (ticchiolatura, ruggine, bolla) e non metterle nel compost; le altre sono ottime per pacciamare.', motivo: 'Autunno: molti funghi svernano nelle foglie a terra.', pianta: '' });
  if (!plants.length) c.push({ key: 'no-plants', score: 10, consiglio: 'Aggiungi le tue piante dall\'archivio o con il riconoscimento fotografico: i consigli diventeranno specifici per il tuo giardino.', motivo: 'Nessuna pianta registrata.', pianta: '' });
  return c;
}

export async function getDailyTip(ctx, { force = false } = {}) {
  const g = state.garden;
  if (!g) return null;
  const key = `tip:${g.id}:${todayISO()}`;
  if (!force) { const t = await kvGet(key); if (t) return t; }
  const hist = await kvGet('tipHistory:' + g.id, []);
  const recentKeys = new Set(hist.slice(-25).map(h => h.key));
  const candidates = ruleCandidates(ctx).filter(c => !recentKeys.has(c.key)).sort((a, b) => b.score - a.score);
  let tip = null;
  if (hasAI() && navigator.onLine) {
    try {
      const wx = ctx.fc ? `Meteo: oggi ${ctx.fc.today?.tmin}/${ctx.fc.today?.tmax} °C; pioggia ultimi 7 giorni ${ctx.fc.past.reduce((a, d) => a + d.rain, 0).toFixed(0)} mm; prossimi giorni: ${ctx.fc.next.slice(1, 5).map(d => `${d.date} ${d.tmin}/${d.tmax} °C ${d.rain} mm`).join('; ')}.` : 'Meteo non disponibile.';
      const b = taskBuckets(ctx.tasks);
      const prompt = `${wx}
Attività arretrate: ${b.overdue.map(t => t.title).slice(0, 8).join('; ') || 'nessuna'}.
Attività dei prossimi giorni: ${[...b.today, ...b.upcoming].map(t => t.title).slice(0, 10).join('; ') || 'nessuna'}.
Allerte: ${ctx.alerts.map(a => a.title).join('; ') || 'nessuna'}.
Consigli già dati di recente (NON ripeterli né riformularli): ${hist.slice(-14).map(h => h.consiglio).join(' | ') || 'nessuno'}.
Spunti calcolati dalle schede (usali solo se pertinenti): ${candidates.slice(0, 6).map(c => c.consiglio).join(' | ')}.
Scrivi IL CONSIGLIO DEL GIORNO: una sola azione concreta, breve e applicabile oggi, riferita alle piante effettivamente presenti, adatta alla stagione, al meteo e alla filosofia di gestione. Niente interventi fuori stagione.`;
      const j = await callJSON({ content: prompt, schema: SCHEMA_TIP, maxTokens: 2000, effort: 'low', withContext: true });
      tip = { ...j, key: 'ai:' + todayISO(), source: 'ai' };
    } catch (e) { tip = null; }
  }
  if (!tip) {
    const c = candidates[0] || ruleCandidates(ctx).sort((a, b) => b.score - a.score)[0];
    if (!c) return null;
    tip = { ...c, source: 'regole' };
  }
  tip.date = todayISO();
  await kvSet(key, tip);
  hist.push({ key: tip.key, consiglio: tip.consiglio, date: tip.date });
  await kvSet('tipHistory:' + g.id, hist.slice(-60));
  return tip;
}
