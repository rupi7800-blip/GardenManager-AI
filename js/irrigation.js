// Consigli di irrigazione con bilancio idrico semplificato (metodo FAO-56):
// evapotraspirazione di riferimento (ET0) × coefficiente colturale, meno pioggia efficace,
// confrontato con l'acqua facilmente disponibile nel terreno per la profondità delle radici.
// Non programma irrigazioni a calendario: valuta la situazione reale di ogni gruppo.
import { db, kvGet } from './db.js';
import { todayISO, diffDays } from './ui.js';

export const GROUPS = {
  vaso: { label: 'Piante in vaso', emoji: '🪴', depth: 0.2 },
  orto: { label: 'Orto', emoji: '🥕', depth: 0.3, p: 0.4 },
  prato: { label: 'Prato', emoji: '🟩', depth: 0.15, p: 0.45 },
  perenni: { label: 'Fiori e perenni', emoji: '🌸', depth: 0.3, p: 0.5 },
  arbusti: { label: 'Arbusti e siepi', emoji: '🌿', depth: 0.5, p: 0.55 },
  alberi: { label: 'Alberi', emoji: '🌳', depth: 1.0, p: 0.6 },
};
// Acqua disponibile (mm per metro di terreno)
const AWC = { sabbioso: 70, sassoso: 60, franco: 150, limoso: 180, argilloso: 170, calcareo: 120, acido: 140, torboso: 200 };
export function soilAWC(soil = '') {
  const k = Object.keys(AWC).find(x => soil.toLowerCase().includes(x));
  return AWC[k] || 140;
}
const expoFactor = (e = '') => e.includes('ombra') ? (e.startsWith('ombra') ? 0.6 : 0.8) : 1;

export async function lastIrrigation(gardenId, group) {
  const ev = (await db.byIndex('events', 'gardenId', gardenId)).filter(e => e.type === 'irrigazione' && (!e.group || e.group === group));
  return ev.sort((a, b) => b.date.localeCompare(a.date))[0]?.date?.slice(0, 10) || null;
}

export async function irrigationAdvice(garden, fc, plants, speciesMap) {
  if (!fc) return [];
  const groups = {};
  for (const p of plants) {
    const s = speciesMap[p.speciesId];
    let g = p.inPot ? 'vaso' : (s?.wg || 'perenni');
    if (s?.indoor && p.inPot) continue; // piante da interno: non dipendono dal meteo
    (groups[g] = groups[g] || []).push({ p, s });
  }
  const awc = soilAWC(garden.soil);
  const today = todayISO();
  const days = [...fc.past, fc.today].filter(Boolean);
  const readings = await kvGet('soilMoisture:' + garden.id, {});
  const out = [];
  for (const [g, list] of Object.entries(groups)) {
    const meta = GROUPS[g] || GROUPS.perenni;
    const kc = list.reduce((a, x) => a + (x.s?.kc || 0.7), 0) / list.length;
    const ef = list.reduce((a, x) => a + expoFactor(x.p.exposure || ''), 0) / list.length;
    const young = g === 'alberi' && list.some(x => /^[0-3]\b|giovan|nuov/i.test(String(x.p.age || '')));
    const depth = young ? 0.5 : meta.depth;
    const raw = Math.round(awc * depth * (meta.p || 0.5));
    const last = await lastIrrigation(garden.id, g);
    // bilancio giornaliero dal giorno successivo all'ultima irrigazione (o da 7 giorni fa, partendo da metà riserva)
    let deficit = last && diffDays(today, last) <= 7 ? 0 : raw * 0.5;
    const startFrom = last && diffDays(today, last) <= 7 ? last : null;
    for (const d of days) {
      if (startFrom && d.date <= startFrom) continue;
      const etc = (d.et0 || 0) * kc * ef * (g === 'vaso' ? 1.2 : 1);
      const eff = g === 'vaso' ? Math.max(0, d.rain - 1) * 0.5 : Math.max(0, d.rain - 2) * 0.8;
      deficit = Math.max(0, deficit + etc - eff);
    }
    const next2 = fc.next.slice(1, 3);
    const rainSoon = next2.reduce((a, d) => a + Math.max(0, (d.rain || 0) - 2) * 0.8 * ((d.pop ?? 70) / 100), 0);
    const hotSoon = next2.some(d => d.tmax >= 30);
    const avgEt = days.slice(-5).reduce((a, d) => a + (d.et0 || 0), 0) / Math.max(1, days.slice(-5).length);
    const reading = readings[g] && readings[g].date === today ? readings[g].value : null;
    let status, text, liters = null;
    const threshold = g === 'vaso' ? 6 : raw;
    if (reading != null) {
      if (reading < 30) { status = 'irrigare'; text = `Umidità del suolo misurata ${reading}%: sotto la soglia, irriga.`; liters = Math.round(Math.max(deficit, threshold * 0.6)); }
      else if (reading > 60) { status = 'ok'; text = `Umidità del suolo misurata ${reading}%: non serve irrigare.`; }
      else { status = 'attesa'; text = `Umidità del suolo misurata ${reading}%: controlla di nuovo domani.`; }
    } else if (avgEt < 1 && g !== 'vaso') { status = 'ok'; text = 'Evapotraspirazione molto bassa: in questa stagione non serve irrigare, salvo piante appena messe a dimora.'; }
    else if (deficit >= threshold) {
      if (rainSoon >= deficit * 0.7) { status = 'attesa'; text = `Terreno in deficit (${deficit.toFixed(0)} mm) ma sono previsti circa ${rainSoon.toFixed(0)} mm di pioggia utile nelle prossime 48 ore: aspetta.`; }
      else { status = 'irrigare'; liters = Math.round(deficit); text = g === 'vaso' ? 'Il substrato è probabilmente asciutto: verifica con un dito (3-4 cm) e irriga fino a far uscire l\'acqua dai fori.' : `Deficit idrico stimato ${deficit.toFixed(0)} mm: irriga con circa ${liters} L/m², al mattino presto e al piede.`; }
    } else if (deficit >= threshold * 0.65 && hotSoon && rainSoon < 3) {
      status = 'presto'; liters = Math.round(deficit); text = `Riserva in calo (${deficit.toFixed(0)} di ${threshold} mm) e caldo in arrivo: programma un'irrigazione entro domani.`;
    } else { status = 'ok'; text = `Riserva sufficiente (deficit ${deficit.toFixed(0)} mm su ${threshold} mm disponibili).`; }
    out.push({ group: g, label: meta.label, emoji: meta.emoji, status, text, liters, deficit: +deficit.toFixed(1), raw: threshold, last, count: list.length, kc: +kc.toFixed(2), names: list.map(x => x.p.name) });
  }
  const order = { irrigare: 0, presto: 1, attesa: 2, ok: 3 };
  return out.sort((a, b) => order[a.status] - order[b.status]);
}
export const statusChip = (s) => ({ irrigare: '<span class="chip danger">Irrigare</span>', presto: '<span class="chip warn">Entro domani</span>', attesa: '<span class="chip sage">Attendere</span>', ok: '<span class="chip ok">Non serve</span>' }[s]);
