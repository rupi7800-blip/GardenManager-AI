import { getSpecies, saveSpecies, CATEGORIES, interventionFor, modeLabel, state } from '../store.js';
import { esc, $, loading, toast, monthsBar, MONTHS } from '../ui.js';
import { TASK_TYPES } from '../data/species.js';
import { callJSON, SCHEMA_SHEET, sheetToSpecies, hasAI } from '../ai.js';
import { webImages, sourceLinks, imagesHTML, gbifMatch } from '../botany.js';
import { calendarShift } from '../weather.js';
import { openPlantForm } from './plant-form.js';
import { go, route } from '../app.js';

const SEASONS = [['Primavera', [3, 4, 5]], ['Estate', [6, 7, 8]], ['Autunno', [9, 10, 11]], ['Inverno', [12, 1, 2]]];

export async function render(view, params) {
  const s = await getSpecies(params[0]);
  if (!s) { view.innerHTML = '<div class="empty">Specie non trovata.</div>'; return; }
  view.innerHTML = speciesSheetHTML(s, { actions: true });
  bindSheet(view, s);
}

export function speciesSheetHTML(s, { actions = false } = {}) {
  const incomplete = !s.tasks?.length || !s.care?.irr;
  const shift = calendarShift(state.garden?.climate);
  const tm = (t) => t.sh && !t.local ? t.m.map(m => ((m - 1 + shift + 12) % 12) + 1) : t.m;
  const v = (x) => x == null || x === '' ? '—' : esc(x);
  const seasonText = (months, name) => {
    if (s.seasons?.[name.toLowerCase()]) return esc(s.seasons[name.toLowerCase()]);
    const items = (s.tasks || []).filter(t => tm(t).some(m => months.includes(m)));
    return items.length ? `<ul>${items.map(t => `<li>${TASK_TYPES[t.ty]?.emoji || ''} <b>${esc(TASK_TYPES[t.ty]?.label || t.ty)}</b> (${tm(t).filter(m => months.includes(m)).map(m => MONTHS[m - 1]).join(', ')}): ${esc(t.x)}</li>`).join('')}</ul>` : '<small>Nessuna operazione particolare.</small>';
  };
  return `<div class="card sheet">
    <div class="card-head"><div><h2 style="margin:0">${s.emoji || CATEGORIES[s.cat]?.emoji || '🌿'} ${esc(s.it)} ${s.aiSheet ? '<span class="badge-ai">scheda AI</span>' : ''}</h2><i class="sci">${esc(s.sci)}</i> · ${esc(s.fam || '')}</div>
      ${actions ? `<div class="row"><button class="primary" id="addG">+ Al giardino</button>${hasAI() ? `<button id="aiSheet">${incomplete ? '✨ Genera scheda completa con AI' : '✨ Aggiorna con AI'}</button>` : ''}</div>` : ''}</div>
    ${incomplete ? `<div class="alert info">Scheda essenziale${s.source === 'gbif' ? ' (da GBIF)' : ''}. ${hasAI() ? 'Usa «Genera scheda completa con AI» per ottenere esigenze, calendario, problemi e propagazione specifici della specie.' : 'Inserisci la chiave AI in Impostazioni per generare la scheda completa.'}</div>` : ''}
    ${s.aiSheet ? `<div class="alert warn">Scheda generata dall'AI il ${new Date(s.aiDate).toLocaleDateString('it-IT')}: verifica i dati critici sulle fonti indicate in fondo.</div>` : ''}
    ${s.warn ? `<div class="alert warn">⚠️ ${esc(s.warn)}</div>` : ''}
    <h3>Identificazione</h3><dl>
      <dt>Categoria</dt><dd>${esc(CATEGORIES[s.cat]?.label || s.cat || '—')}${(s.subs || []).length ? ' · ' + esc(s.subs.join(', ')) : ''}</dd>
      <dt>Origine</dt><dd>${v(s.origin)}</dd><dt>Ciclo vegetativo</dt><dd>${v(s.cycle)}</dd><dt>Longevità</dt><dd>${v(s.life)}</dd>
      <dt>Dimensioni a maturità</dt><dd>${s.size ? `altezza ${v(s.size.h)}, larghezza ${v(s.size.w)}` : '—'}</dd><dt>Crescita</dt><dd>${v(s.growth)}</dd></dl>
    <h3>Esigenze ambientali</h3><dl>
      <dt>Esposizione</dt><dd>${v(s.sun)}${s.sunH ? ` (${esc(s.sunH)} ore di sole)` : ''}</dd>
      ${s.tIdeal ? `<dt>Temperature ideali</dt><dd>${esc(s.tIdeal)}</dd>` : ''}
      <dt>Resistenza al freddo</dt><dd>${s.tMin != null ? `fino a circa ${s.tMin} °C` : '—'}${state.garden?.climate && s.tMin != null ? (s.tMin > state.garden.climate.absMinAvg ? ` <span class="chip danger">a rischio nel tuo clima (minime medie ${state.garden.climate.absMinAvg} °C)</span>` : ' <span class="chip ok">adatta al tuo clima</span>') : ''}</dd>
      <dt>Resistenza al caldo</dt><dd>${v(s.heat)}</dd><dt>Umidità</dt><dd>${v(s.hum)}</dd>
      <dt>Terreno</dt><dd>${v(s.soil)}</dd><dt>pH ideale</dt><dd>${s.ph?.[0] != null ? `${s.ph[0]} – ${s.ph[1]}` : '—'}</dd><dt>Drenaggio</dt><dd>${v(s.drain)}</dd>
      <dt>Fabbisogno idrico</dt><dd>${v(s.water)}</dd></dl>
    <h3>Gestione ordinaria</h3><dl>
      <dt>Irrigazione</dt><dd>${v(s.care?.irr)}</dd><dt>Concimazione</dt><dd>${v(s.care?.conc)}</dd><dt>Potatura</dt><dd>${v(s.care?.pot)}</dd>
      <dt>Rinvaso / trapianto</dt><dd>${v(s.care?.trap)}</dd><dt>Moltiplicazione</dt><dd>${v(s.care?.molt)}</dd><dt>Pacciamatura</dt><dd>${v(s.care?.pacc)}</dd><dt>Pulizia</dt><dd>${v(s.care?.pul)}</dd></dl>
    ${(s.tasks || []).length ? `<h3>Calendario delle operazioni</h3>${shift ? `<small>Mesi adattati al clima del tuo giardino (${shift > 0 ? 'primavera tardiva' : 'primavera anticipata'}).</small>` : ''}
      <div class="stack">${s.tasks.map(t => `<div><small>${TASK_TYPES[t.ty]?.emoji || ''} <b>${esc(TASK_TYPES[t.ty]?.label || t.ty)}</b> — ${esc(t.x)}</small>${monthsBar(tm(t), t.p >= 3 ? 'on2' : 'on')}</div>`).join('')}</div>` : ''}
    ${s.orto ? `<h3>Orto</h3><dl><dt>Semenzaio</dt><dd>${monthsBar(s.orto.sowIn, 'on')}</dd><dt>Semina diretta</dt><dd>${monthsBar(s.orto.sowOut, 'on')}</dd><dt>Trapianto</dt><dd>${monthsBar(s.orto.trans, 'on3')}</dd><dt>Raccolta</dt><dd>${monthsBar(s.orto.harv, 'on2')}</dd><dt>Distanze</dt><dd>${esc(s.orto.spacing)}</dd><dt>Esigenza nutritiva</dt><dd>${esc(s.orto.esig)}</dd></dl>` : ''}
    <h3>Gestione stagionale</h3><dl>${SEASONS.map(([n, ms]) => `<dt>${n}</dt><dd>${seasonText(ms, n)}</dd>`).join('')}</dl>
    <h3>Problemi fitosanitari</h3><small>Interventi secondo la tua gestione: <b>${esc(modeLabel())}</b>.</small>
    ${(s.problems || []).length ? s.problems.map(p => { const iv = interventionFor(p); return `<div class="card" style="margin-top:10px;box-shadow:none"><b>${esc(p.n)}</b> <small>— ${esc(p.k || '')}</small>
      <dl style="margin-top:6px"><dt>Sintomi</dt><dd>${v(p.s)}</dd><dt>Cause</dt><dd>${v(p.c)}</dd><dt>Prevenzione</dt><dd>${v(p.pv)}</dd><dt>Diagnosi differenziale</dt><dd>${v(p.d)}</dd><dt>${esc(iv.label)}</dt><dd>${esc(iv.text)}</dd><dt>Maggior rischio</dt><dd>${monthsBar(p.r || [], 'on2')}</dd></dl></div>`; }).join('') : '<p><small>Nessun problema registrato per questa specie.</small></p>'}
    <h3>Propagazione</h3>${(s.prop || []).length ? `<ul>${s.prop.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<small>—</small>'}
    <h3>Fonti e verifica</h3>
    ${s.sourcesText?.length ? `<p><small>Basata su: ${esc(s.sourcesText.join('; '))}</small></p>` : s.source === 'curated' ? '<p><small>Scheda curata sulla base di manualistica agronomica, CREA, servizi fitosanitari regionali e banche dati botaniche.</small></p>' : ''}
    <div class="row">${sourceLinks(s.sci, s.gbifKey).map(([n, u]) => `<a class="btn small" href="${esc(u)}" target="_blank" rel="noopener">${esc(n)} ↗</a>`).join('')}</div>
    ${actions ? `<h3>Immagini dal web</h3><div id="imgs"><button id="loadImgs">Mostra foto con licenza libera (iNaturalist, Wikimedia Commons)</button></div>` : ''}
  </div>`;
}

export function bindSheet(view, s) {
  const add = $('#addG', view);
  if (add) add.onclick = () => openPlantForm({ speciesId: s.id, origin: 'archivio', onSaved: p => go('#/pianta/' + p.id) });
  const li = $('#loadImgs', view);
  if (li) li.onclick = async () => {
    const box = $('#imgs', view);
    box.innerHTML = loading('Ricerca immagini…');
    try {
      const r = await webImages(s.sci);
      box.innerHTML = imagesHTML(r.images, esc) + '<small>Le immagini restano sui siti di origine; tocca per vedere autore e licenza.</small>';
    } catch (e) { box.innerHTML = `<div class="alert danger">${esc(e.message)}</div>`; }
  };
  const ai = $('#aiSheet', view);
  if (ai) ai.onclick = async () => {
    ai.disabled = true; ai.innerHTML = '<span class="spinner"></span> Generazione scheda…';
    try {
      let gb = null;
      try { gb = await gbifMatch(s.sci.split(' ').slice(0, 2).join(' ')); } catch (e) { /* facoltativo */ }
      const j = await callJSON({
        system: 'Compila una scheda botanica tecnica, specifica per la specie richiesta e non generica. I mesi del calendario devono essere adattati al clima del giardino indicato nel contesto. Se un dato non è noto con sicurezza scrivi "non documentato". Nei problemi includi solo quelli realmente documentati per la specie.',
        content: `Scheda botanica completa per: ${s.it} (${s.sci})${s.fam ? ', famiglia ' + s.fam : ''}.${gb ? ` Nome accettato GBIF: ${gb.sci} (stato: ${gb.status}).` : ''}`,
        schema: SCHEMA_SHEET, maxTokens: 16000, effort: 'medium',
      });
      const merged = sheetToSpecies(j, { ...s, gbifKey: s.gbifKey || gb?.key });
      if (s.source === 'curated') { merged.tasks = s.tasks; merged.problems = [...s.problems, ...merged.problems.filter(p => !s.problems.some(q => q.n.toLowerCase() === p.n.toLowerCase()))]; merged.care = { ...merged.care, ...s.care }; merged.aiSheet = false; merged.aiEnriched = true; }
      await saveSpecies(merged);
      toast('Scheda salvata nell\'archivio');
      route();
    } catch (e) { toast(e.message, 5000); ai.disabled = false; ai.textContent = '✨ Riprova'; }
  };
}
