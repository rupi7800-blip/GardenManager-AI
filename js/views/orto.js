import { db, uid } from '../db.js';
import { state, allSpecies, getSpecies, savePlant, gardenPlants } from '../store.js';
import { esc, $, $$, modal, toast, options, todayISO, addDays, fmtDate, monthsBar, loading, confirmDialog } from '../ui.js';
import { saveTask, generateAutoTasks } from '../tasks.js';
import { calendarShift } from '../weather.js';
import { callJSON, hasAI } from '../ai.js';

const ESIG = { alta: 'Molto esigenti (solanacee, cucurbitacee, cavoli)', media: 'Mediamente esigenti (radici, foglie)', bassa: 'Poco esigenti / miglioratrici (leguminose, insalate)' };
const SEASONS = [['primavera-estate', 'Primavera-estate'], ['autunno-inverno', 'Autunno-inverno']];

export async function render(view) {
  const gid = state.garden.id;
  const crops = (await allSpecies()).filter(s => s.orto).sort((a, b) => a.it.localeCompare(b.it, 'it'));
  const byId = Object.fromEntries(crops.map(c => [c.id, c]));
  const shift = calendarShift(state.garden.climate);
  const sh = (ms = []) => ms.map(m => ((m - 1 + shift + 12) % 12) + 1);
  const year = new Date().getFullYear();
  let beds = (await db.byIndex('beds', 'gardenId', gid)).sort((a, b) => a.name.localeCompare(b.name, 'it'));

  view.innerHTML = `
  <div class="row between" style="margin-bottom:12px"><small class="muted">Organizza l'orto per aiuole: rotazioni e consociazioni vengono controllate automaticamente.</small>
    <div class="row">${hasAI() ? '<button id="aiPlan">✨ Piano rotazioni con AI</button>' : ''}<button class="primary" id="bedNew">+ Aiuola</button></div></div>
  <div id="beds"></div><div id="aiOut"></div>
  <div class="card" style="margin-top:16px"><h2>📅 Calendario di semine, trapianti e raccolti</h2>
    <small>${shift ? `Adattato al tuo clima (${shift > 0 ? 'stagione più tardiva' : 'stagione anticipata'} di circa un mese). ` : ''}Verde: semina (semenzaio/diretta) · blu: trapianto · arancio: raccolta.</small>
    <div class="table-wrap" style="margin-top:10px"><table><thead><tr><th>Coltura</th><th>Semenzaio</th><th>Semina diretta</th><th>Trapianto</th><th>Raccolta</th><th>Distanze</th></tr></thead><tbody>
      ${crops.map(c => `<tr><td><a href="#/specie/${encodeURIComponent(c.id)}">${c.emoji || ''} ${esc(c.it)}</a><br><small>${esc(c.fam)}</small></td><td style="min-width:120px">${monthsBar(sh(c.orto.sowIn))}</td><td style="min-width:120px">${monthsBar(sh(c.orto.sowOut))}</td><td style="min-width:120px">${monthsBar(sh(c.orto.trans), 'on3')}</td><td style="min-width:120px">${monthsBar(sh(c.orto.harv), 'on2')}</td><td><small>${esc(c.orto.spacing || '')}</small></td></tr>`).join('')}
    </tbody></table></div></div>
  <div class="card" style="margin-top:16px"><h2>🤝 Consociazioni</h2><div class="table-wrap"><table><thead><tr><th>Coltura</th><th>Buone vicine</th><th>Da evitare</th></tr></thead><tbody>
    ${crops.map(c => `<tr><td>${esc(c.it)}</td><td>${(c.orto.good || []).map(id => byId[id]?.it).filter(Boolean).join(', ') || '—'}</td><td>${[...(c.orto.bad || []), ...crops.filter(o => (o.orto.bad || []).includes(c.id)).map(o => o.id)].filter((v, i, a) => a.indexOf(v) === i).map(id => byId[id]?.it).filter(Boolean).join(', ') || '—'}</td></tr>`).join('')}
  </tbody></table></div><small>Consociazioni tradizionali dell'orticoltura; le incompatibilità più solide riguardano piante della stessa famiglia (malattie comuni, es. pomodoro e patata) e alliacee vicino ai legumi.</small></div>`;

  const famOf = (sid) => byId[sid]?.fam || byId[sid]?.orto?.family || '';
  const companionIssues = (list) => {
    const out = [];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = byId[list[i].speciesId], b = byId[list[j].speciesId];
      if (!a || !b || a.id === b.id) continue;
      if ((a.orto.bad || []).includes(b.id) || (b.orto.bad || []).includes(a.id)) out.push({ bad: true, text: `${a.it} e ${b.it} sono sconsigliati insieme.` });
      else if ((a.orto.good || []).includes(b.id) || (b.orto.good || []).includes(a.id)) out.push({ bad: false, text: `${a.it} e ${b.it}: buona consociazione.` });
    }
    return out;
  };
  const rotationCheck = (bed, sid, yr) => {
    const fam = famOf(sid);
    const prev = (bed.plantings || []).filter(p => p.year < yr && p.year >= yr - 3 && famOf(p.speciesId) === fam);
    const last = (bed.plantings || []).filter(p => p.year === yr - 1).map(p => byId[p.speciesId]?.orto?.esig);
    const msgs = [];
    if (prev.length) msgs.push({ bad: true, text: `Rotazione: nella stessa aiuola ${fam} già coltivate nel ${[...new Set(prev.map(p => p.year))].join(', ')}. Attendi almeno 3 anni per ridurre malattie e stanchezza del terreno.` });
    if (byId[sid]?.orto?.esig === 'alta' && last.includes('alta')) msgs.push({ bad: true, text: 'Dopo una coltura molto esigente è meglio una leguminosa o una coltura poco esigente.' });
    if (byId[sid]?.orto?.esig === 'bassa' && last.includes('alta')) msgs.push({ bad: false, text: 'Ottima scelta: coltura poco esigente o miglioratrice dopo una esigente.' });
    return msgs;
  };
  const suggestNext = (bed) => {
    const recentFams = new Set((bed.plantings || []).filter(p => p.year >= year - 2).map(p => famOf(p.speciesId)));
    const lastEsig = (bed.plantings || []).filter(p => p.year === year - 1 || p.year === year).map(p => byId[p.speciesId]?.orto?.esig);
    const cand = crops.filter(c => !recentFams.has(c.fam));
    const pref = lastEsig.includes('alta') ? cand.filter(c => c.orto.esig !== 'alta') : cand.filter(c => c.orto.esig === 'alta');
    return (pref.length ? pref : cand).slice(0, 5);
  };

  const draw = () => {
    $('#beds', view).innerHTML = beds.length ? `<div class="grid g2">${beds.map(b => {
      const cur = (b.plantings || []).filter(p => p.year === year && p.status !== 'raccolta');
      const issues = companionIssues(cur);
      const sugg = suggestNext(b);
      return `<div class="card"><div class="card-head"><h2>🟫 ${esc(b.name)} <small>${b.length && b.width ? `${b.length} × ${b.width} m` : ''}</small></h2><div class="row"><button class="small" data-edit="${b.id}">Modifica</button><button class="small primary" data-plant="${b.id}">+ Coltura</button></div></div>
        ${cur.length ? `<ul class="list">${cur.map(p => `<li><div class="grow"><b>${byId[p.speciesId]?.emoji || ''} ${esc(byId[p.speciesId]?.it || '?')}</b>${p.qty ? ` ×${p.qty}` : ''} <small>${esc(p.season)} · ${esc(p.status)}</small><br><small>${p.start ? `inizio ${fmtDate(p.start)}` : ''}${p.harvest ? ` · raccolta da ${fmtDate(p.harvest)}` : ''}</small></div><div class="row" style="gap:4px"><button class="small" data-st="${b.id}|${p.id}">${p.status === 'pianificata' ? 'Avvia' : 'Raccolta finita'}</button><button class="small ghost" data-rm="${b.id}|${p.id}" aria-label="Rimuovi">✕</button></div></li>`).join('')}</ul>` : '<div class="empty">Nessuna coltura quest\'anno.</div>'}
        ${issues.map(i => `<div class="alert ${i.bad ? 'warn' : 'ok'}" style="margin:8px 0 0">${i.bad ? '⚠️' : '✓'} ${esc(i.text)}</div>`).join('')}
        <details style="margin-top:10px"><summary><small>Storico e rotazione consigliata</small></summary>
          <p><small>${[...new Set((b.plantings || []).map(p => p.year))].sort().reverse().map(y => `<b>${y}</b>: ${(b.plantings || []).filter(p => p.year === y).map(p => byId[p.speciesId]?.it).join(', ')}`).join(' · ') || 'Nessuno storico.'}</small></p>
          <p><small><b>Prossime colture adatte:</b> ${sugg.map(c => c.it).join(', ') || '—'}</small></p></details></div>`;
    }).join('')}</div>` : '<div class="empty">Crea la prima aiuola dell\'orto per registrare colture, rotazioni e consociazioni.</div>';
    $$('[data-edit]', view).forEach(x => x.onclick = () => bedDialog(beds.find(b => b.id === x.dataset.edit)));
    $$('[data-plant]', view).forEach(x => x.onclick = () => plantingDialog(beds.find(b => b.id === x.dataset.plant)));
    $$('[data-st]', view).forEach(x => x.onclick = async () => { const [bid, pid] = x.dataset.st.split('|'); const b = beds.find(y => y.id === bid); const p = b.plantings.find(y => y.id === pid); p.status = p.status === 'pianificata' ? 'in corso' : 'raccolta'; await db.put('beds', b); draw(); });
    $$('[data-rm]', view).forEach(x => x.onclick = async () => { if (!await confirmDialog('Rimuovere questa coltura dall\'aiuola?')) return; const [bid, pid] = x.dataset.rm.split('|'); const b = beds.find(y => y.id === bid); b.plantings = b.plantings.filter(y => y.id !== pid); await db.put('beds', b); draw(); });
  };

  const bedDialog = (b = null) => {
    const m = modal({ title: b ? 'Modifica aiuola' : 'Nuova aiuola', body: `<div class="form-grid">
      <div class="field full"><label for="bName">Nome</label><input id="bName" type="text" value="${esc(b?.name || `Aiuola ${beds.length + 1}`)}"></div>
      <div class="field"><label for="bL">Lunghezza (m)</label><input id="bL" type="number" step="0.1" value="${b?.length ?? ''}"></div>
      <div class="field"><label for="bW">Larghezza (m)</label><input id="bW" type="number" step="0.1" value="${b?.width ?? ''}"></div>
      <div class="field full"><label for="bN">Note</label><input id="bN" type="text" value="${esc(b?.notes || '')}" placeholder="Esposizione, tipo di terreno, rialzata…"></div></div>`,
      foot: `${b ? '<button class="danger" data-del>Elimina</button><span class="spacer"></span>' : ''}<button data-close>Annulla</button><button class="primary" data-save>Salva</button>` });
    $('[data-save]', m.el).onclick = async () => {
      const nb = { ...(b || { id: uid(), gardenId: gid, plantings: [] }), name: $('#bName', m.el).value.trim() || 'Aiuola', length: +$('#bL', m.el).value || null, width: +$('#bW', m.el).value || null, notes: $('#bN', m.el).value.trim() };
      await db.put('beds', nb); beds = (await db.byIndex('beds', 'gardenId', gid)).sort((a, c) => a.name.localeCompare(c.name, 'it')); m.close(); draw();
    };
    const del = $('[data-del]', m.el);
    if (del) del.onclick = async () => { await db.del('beds', b.id); beds = beds.filter(x => x.id !== b.id); m.close(); draw(); };
  };

  const plantingDialog = (bed) => {
    const m = modal({ title: `Nuova coltura in ${bed.name}`, body: `<div class="form-grid">
      <div class="field full"><label for="pCrop">Coltura</label><select id="pCrop">${options(crops.map(c => [c.id, `${c.it} (${c.fam})`]), '')}</select></div>
      <div class="field"><label for="pYear">Anno</label><input id="pYear" type="number" value="${year}"></div>
      <div class="field"><label for="pSeason">Stagione</label><select id="pSeason">${options(SEASONS, new Date().getMonth() >= 6 ? 'autunno-inverno' : 'primavera-estate')}</select></div>
      <div class="field"><label for="pHow">Modalità</label><select id="pHow">${options([['trapianto', 'Trapianto di piantine'], ['semina', 'Semina diretta']], 'trapianto')}</select></div>
      <div class="field"><label for="pStart">Data di semina/trapianto</label><input id="pStart" type="date" value="${todayISO()}"></div>
      <div class="field"><label for="pQty">Numero di piante (facoltativo)</label><input id="pQty" type="number" min="1"></div>
      <div class="field"><label>&nbsp;</label><label style="font-weight:400;display:flex;gap:8px;align-items:center"><input type="checkbox" id="pTasks" checked> Crea attività in calendario</label></div>
      <div class="full" id="pChecks"></div></div>`,
      foot: '<button data-close>Annulla</button><button class="primary" data-save>Aggiungi</button>' });
    const showChecks = () => {
      const sid = $('#pCrop', m.el).value, y = +$('#pYear', m.el).value;
      const c = byId[sid];
      const rot = rotationCheck(bed, sid, y);
      const comp = companionIssues([...(bed.plantings || []).filter(p => p.year === y && p.status !== 'raccolta'), { speciesId: sid }]).filter(i => i.text.includes(c.it));
      const mo = new Date($('#pStart', m.el).value + 'T12:00').getMonth() + 1;
      const okMonth = [...sh(c.orto.trans), ...sh(c.orto.sowOut)].includes(mo);
      $('#pChecks', m.el).innerHTML = [...rot, ...comp].map(i => `<div class="alert ${i.bad ? 'warn' : 'ok'}" style="margin:6px 0">${i.bad ? '⚠️' : '✓'} ${esc(i.text)}</div>`).join('') +
        (!okMonth ? `<div class="alert warn" style="margin:6px 0">⚠️ Periodo insolito per ${esc(c.it)} a dimora nel tuo clima: mesi consigliati ${[...new Set([...sh(c.orto.trans), ...sh(c.orto.sowOut)])].join(', ') || '—'}.</div>` : '') +
        `<small>Distanze: ${esc(c.orto.spacing)} · dalla semina/trapianto alla raccolta circa ${c.orto.days} giorni.</small>`;
    };
    ['#pCrop', '#pYear', '#pStart'].forEach(s => $(s, m.el).onchange = showChecks); showChecks();
    $('[data-save]', m.el).onclick = async () => {
      const sid = $('#pCrop', m.el).value, c = byId[sid];
      const start = $('#pStart', m.el).value, how = $('#pHow', m.el).value;
      const days = how === 'trapianto' ? Math.round(c.orto.days * 0.75) : c.orto.days;
      const p = { id: uid(), speciesId: sid, year: +$('#pYear', m.el).value, season: $('#pSeason', m.el).value, how, start, harvest: addDays(start, days), qty: +$('#pQty', m.el).value || null, status: start > todayISO() ? 'pianificata' : 'in corso' };
      bed.plantings = [...(bed.plantings || []), p];
      await db.put('beds', bed);
      // registra la coltura anche tra le piante del giardino (una scheda per coltura e aiuola)
      const plants = await gardenPlants();
      let plant = plants.find(x => x.speciesId === sid && x.position === bed.name);
      if (!plant && p.year >= year) plant = await savePlant({ name: `${c.it} – ${bed.name}`, speciesId: sid, qty: p.qty || 1, position: bed.name, planted: start, health: 'buona', exposure: 'pieno sole', origin: 'orto' });
      if (plant && $('#pTasks', m.el).checked) {
        if (start >= todayISO()) await saveTask({ type: how === 'trapianto' ? 'trapianto' : 'semina', title: `${how === 'trapianto' ? 'Trapianto' : 'Semina'}: ${c.it} in ${bed.name}`, text: `${c.orto.spacing ? 'Distanze ' + c.orto.spacing + '. ' : ''}${c.care?.trap || ''}`, date: start, priority: 2, plantId: plant.id, plantIds: [plant.id], source: 'orto' });
        await saveTask({ type: 'raccolta', title: `Inizio raccolta: ${c.it} (${bed.name})`, text: c.tasks?.find(t => t.ty === 'raccolta')?.x || 'Controlla la maturazione.', date: p.harvest, priority: 1, plantId: plant.id, plantIds: [plant.id], source: 'orto' });
      }
      await generateAutoTasks();
      m.close(); toast('Coltura aggiunta'); draw();
    };
  };

  $('#bedNew', view).onclick = () => bedDialog();
  const ai = $('#aiPlan', view);
  if (ai) ai.onclick = async () => {
    const out = $('#aiOut', view);
    out.innerHTML = loading('Analisi di rotazioni e consociazioni…');
    const desc = beds.map(b => `${b.name} (${b.length || '?'}×${b.width || '?'} m${b.notes ? ', ' + b.notes : ''}): ${(b.plantings || []).map(p => `${p.year} ${p.season} ${byId[p.speciesId]?.it} (${famOf(p.speciesId)})`).join('; ') || 'vuota'}`).join('\n');
    try {
      const r = await callJSON({ content: `Aiuole dell'orto e colture registrate:\n${desc || 'nessuna aiuola'}\nAnno corrente ${year}. Verifica incompatibilità, rischi di ristoppio e proponi il piano di rotazione per le prossime due stagioni per ogni aiuola, con consociazioni e sovesci, coerente con la filosofia di gestione.`,
        schema: { type: 'object', additionalProperties: false, required: ['analisi', 'incompatibilita', 'piano'], properties: { analisi: { type: 'string' }, incompatibilita: { type: 'array', items: { type: 'string' } }, piano: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['aiuola', 'stagione', 'colture', 'consociazioni', 'motivo'], properties: { aiuola: { type: 'string' }, stagione: { type: 'string' }, colture: { type: 'string' }, consociazioni: { type: 'string' }, motivo: { type: 'string' } } } } } },
        maxTokens: 8000 });
      out.innerHTML = `<div class="card" style="margin-top:14px"><h2>✨ Piano rotazioni <span class="badge-ai">AI</span></h2><p>${esc(r.analisi)}</p>${r.incompatibilita.length ? `<div class="alert warn">${r.incompatibilita.map(esc).join('<br>')}</div>` : ''}
        <div class="table-wrap"><table><thead><tr><th>Aiuola</th><th>Stagione</th><th>Colture</th><th>Consociazioni</th><th>Perché</th></tr></thead><tbody>${r.piano.map(x => `<tr><td>${esc(x.aiuola)}</td><td>${esc(x.stagione)}</td><td>${esc(x.colture)}</td><td>${esc(x.consociazioni)}</td><td><small>${esc(x.motivo)}</small></td></tr>`).join('')}</tbody></table></div></div>`;
    } catch (e) { out.innerHTML = `<div class="alert danger">${esc(e.message)}</div>`; }
  };
  draw();
}
