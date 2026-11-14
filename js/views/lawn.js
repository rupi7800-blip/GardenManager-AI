import { db } from '../db.js';
import { state, allSpecies, getSpecies, gardenPlants, savePlant, saveGarden, addEvent, plantEvents } from '../store.js';
import { esc, $, $$, toast, options, fmtDate, todayISO, diffDays, monthsBar, MONTHS, photoInputHTML, bindPhotoInput, blobToBase64, loading } from '../ui.js';
import { TASK_TYPES } from '../data/species.js';
import { gardenTasks, completeTask, generateAutoTasks } from '../tasks.js';
import { loadContext, route } from '../app.js';
import { callJSON, imageBlock, hasAI } from '../ai.js';

export async function render(view) {
  const g = state.garden;
  const lawnTypes = (await allSpecies()).filter(s => s.cat === 'prato');
  const plants = await gardenPlants();
  let lawnPlant = plants.find(p => lawnTypes.some(l => l.id === p.speciesId));
  const sp = lawnPlant ? await getSpecies(lawnPlant.speciesId) : null;
  const m = new Date().getMonth() + 1;

  if (!sp) {
    view.innerHTML = `<div class="card"><h2>🟩 Configura il prato</h2>
      <div class="form-grid">
        <div class="field full"><label for="lType">Tipologia di prato</label><select id="lType">${options(lawnTypes.map(l => [l.id, l.it]), 'prato-festuca')}</select></div>
        <div class="field"><label for="lArea">Superficie (m²)</label><input id="lArea" type="number" min="1"></div>
        <div class="field"><label for="lExp">Esposizione</label><select id="lExp">${options(['pieno sole', 'mezz\'ombra', 'ombra'], 'pieno sole')}</select></div>
      </div><button class="primary" id="lSave">Salva prato</button></div>
      <div class="card"><h2>Non sai che prato hai?</h2>
        <div class="form-grid">
          <div class="field"><label for="q1">In inverno il prato…</label><select id="q1">${options([['verde', 'resta verde'], ['giallo', 'ingiallisce e si "addormenta"']], 'verde')}</select></div>
          <div class="field"><label for="q2">Le foglie sono…</label><select id="q2">${options([['larghe', 'larghe e ruvide (4-6 mm)'], ['fini', 'fini e morbide'], ['tonde', 'tondeggianti, a "cuore" (non graminacea)']], 'larghe')}</select></div>
          <div class="field"><label for="q3">In estate senza acqua…</label><select id="q3">${options([['resiste', 'resta abbastanza verde'], ['secca', 'ingiallisce in fretta']], 'resiste')}</select></div>
          <div class="field"><label for="q4">Si propaga con stoloni che corrono sul terreno?</label><select id="q4">${options([['no', 'no'], ['si', 'sì']], 'no')}</select></div>
        </div><button id="lGuess">Suggerisci la tipologia</button>${hasAI() ? ` <button id="lPhoto">📷 Riconosci da foto (AI)</button>` : ''}<div id="lGuessOut" style="margin-top:10px"></div></div>`;
    $('#lSave', view).onclick = async () => {
      const id = $('#lType', view).value, l = lawnTypes.find(x => x.id === id);
      await savePlant({ name: l.it, speciesId: id, qty: 1, position: 'prato', area: +$('#lArea', view).value || null, exposure: $('#lExp', view).value, health: 'buona', origin: 'prato' });
      await generateAutoTasks(); toast('Prato configurato: calendario dei tagli generato'); route();
    };
    $('#lGuess', view).onclick = () => {
      const [a, b, c, d] = ['#q1', '#q2', '#q3', '#q4'].map(s => $(s, view).value);
      let id = 'prato-festuca', why = 'foglie larghe, verde d\'inverno e buona resistenza alla siccità sono tipiche della Festuca arundinacea.';
      if (b === 'tonde') { id = 'prato-dichondra'; why = 'foglie tondeggianti: non è una graminacea, probabilmente Dichondra repens.'; }
      else if (a === 'giallo') { id = d === 'si' && b === 'fini' ? 'prato-cynodon' : 'prato-zoysia'; why = 'il riposo invernale con ingiallimento indica una specie macroterma (gramigna Cynodon o Zoysia; la Zoysia ha foglie più rigide e crescita più lenta).'; }
      else if (b === 'fini' && c === 'secca') { id = 'prato-ornamentale'; why = 'foglie fini e scarsa resistenza alla siccità indicano un miscuglio ornamentale (loietto, poa, festuca rossa).'; }
      $('#lType', view).value = id;
      $('#lGuessOut', view).innerHTML = `<div class="alert info">Probabile: <b>${esc(lawnTypes.find(x => x.id === id).it)}</b> — ${esc(why)} Ipotesi da confermare osservando foglie e stoloni.</div>`;
    };
    const lp = $('#lPhoto', view);
    if (lp) lp.onclick = () => {
      const out = $('#lGuessOut', view);
      out.innerHTML = photoInputHTML('lph', { multiple: false }) + '<button class="primary" id="lphGo" style="margin-top:8px">Analizza</button>';
      const ph = bindPhotoInput(out, 'lph', { max: 1 });
      $('#lphGo', out).onclick = async () => {
        if (!ph.blobs.length) return toast('Scatta una foto ravvicinata dell\'erba');
        const res = document.createElement('div'); out.appendChild(res); res.innerHTML = loading();
        try {
          const r = await callJSON({ content: [imageBlock(await blobToBase64(ph.blobs[0])), { type: 'text', text: `Identifica la tipologia di prato tra: ${lawnTypes.map(l => l.id + ' = ' + l.it).join('; ')}. Indica l'id più probabile.` }],
            schema: { type: 'object', additionalProperties: false, required: ['id', 'affidabilita', 'motivo'], properties: { id: { type: 'string', enum: lawnTypes.map(l => l.id) }, affidabilita: { type: 'number' }, motivo: { type: 'string' } } }, maxTokens: 2000, withContext: false });
          $('#lType', view).value = r.id;
          res.innerHTML = `<div class="alert info">Probabile: <b>${esc(lawnTypes.find(x => x.id === r.id).it)}</b> (${Math.round(r.affidabilita)}%) — ${esc(r.motivo)}</div>`;
        } catch (e) { res.innerHTML = `<div class="alert danger">${esc(e.message)}</div>`; }
      };
    };
    return;
  }

  const lawn = sp.lawn || { h: [5, 7], hSummer: 7, type: 'micro' };
  const ctx = await loadContext();
  const fc = ctx.fc;
  const ev = (await plantEvents(lawnPlant.id)).filter(e => e.type === 'taglio');
  const lastCut = ev[0]?.date?.slice(0, 10);
  const hNow = [7, 8].includes(m) ? lawn.hSummer : lawn.h[0];
  const tasks = (await gardenTasks()).filter(t => (t.plantIds || [t.plantId]).includes(lawnPlant.id) && t.status === 'todo').slice(0, 6);
  const advice = [];
  if (fc) {
    const t = fc.today, rainNow = (t?.rain || 0) + (fc.past.at(-1)?.rain || 0);
    if (rainNow > 3) advice.push('Erba bagnata dalla pioggia recente: aspetta che asciughi prima di tagliare (taglio sfilacciato e diffusione di malattie).');
    if (fc.next.slice(0, 3).some(d => d.tmax >= 32)) advice.push(`Caldo in arrivo: alza il taglio a ${lawn.hSummer} cm, lascia l'erba tagliata (mulching), irriga all'alba con turni profondi e non concimare con azoto.`);
    if (fc.next.slice(0, 3).some(d => d.tmin <= 0)) advice.push('Gelate previste: non calpestare il prato brinato e non tagliare.');
  }
  if (lawn.type === 'macro' && [11, 12, 1, 2, 3].includes(m)) advice.push('Prato macrotermo in riposo invernale: il colore paglierino è normale, nessun taglio né concimazione fino alla ripresa.');
  if (lawn.type === 'micro' && [9, 10].includes(m)) advice.push('Settembre-ottobre è il periodo migliore per arieggiare, trasseminare le zone diradate e concimare con potassio.');
  if (lawn.type === 'fiorito') advice.push('Prato fiorito: non concimare e taglia solo 1-2 volte l\'anno, asportando il fieno.');

  view.innerHTML = `
  <div class="grid g2">
    <div class="card"><div class="card-head"><h2>🟩 ${esc(sp.it)}</h2><a class="small btn" href="#/pianta/${lawnPlant.id}">Scheda</a></div>
      <div class="kpis"><div class="kpi"><b>${hNow} cm</b><small>altezza di taglio a ${MONTHS[m - 1]}</small></div>
        <div class="kpi"><b>${lastCut ? diffDays(todayISO(), lastCut) + ' gg' : '—'}</b><small>dall'ultimo taglio</small></div>
        <div class="kpi"><b>${lawnPlant.area || '—'}</b><small>m²</small></div></div>
      <p style="margin-top:10px"><small>${esc(lawn.mixLabel || sp.sci)} · taglio ${lawn.h[0]}–${lawn.h[1]} cm (estate ${lawn.hSummer} cm). Regola del terzo: non togliere mai più di un terzo dell'altezza.</small></p>
      <div class="row"><button class="primary" id="cutNow">✂️ Registra taglio</button><a class="btn" href="#/diagnosi?plant=${lawnPlant.id}">🩺 Diagnosi del prato</a><button id="lReset" class="ghost small">Cambia tipologia</button></div>
    </div>
    <div class="card"><h2>📋 Consigli di stagione</h2>${advice.length ? `<ul>${advice.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : '<p>Nessuna indicazione particolare: segui il calendario dei tagli.</p>'}
      <h3>Irrigazione</h3><p><small>${esc(sp.care?.irr || '')}</small></p></div>
  </div>
  <div class="card" style="margin-top:14px"><h2>📅 Piano annuale</h2>
    <div class="stack">${(sp.tasks || []).map(t => `<div><small>${TASK_TYPES[t.ty]?.emoji || ''} <b>${esc(TASK_TYPES[t.ty]?.label || t.ty)}</b> — ${esc(t.x)}</small>${monthsBar(t.m)}</div>`).join('')}</div>
    <dl class="sheet" style="margin-top:12px"><dt>Concimazione</dt><dd>${esc(sp.care?.conc || '—')}</dd><dt>Taglio</dt><dd>${esc(sp.care?.pot || '—')}</dd><dt>Semina / risemina</dt><dd>${esc(sp.care?.trap || '—')}</dd></dl></div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><h2>Prossime attività</h2>${tasks.length ? `<ul class="list">${tasks.map(t => `<li><div class="grow"><b>${esc(t.title)}</b><br><small>${fmtDate(t.date)} · ${esc(t.text.slice(0, 100))}</small></div></li>`).join('')}</ul>` : '<div class="empty">Nessuna attività aperta.</div>'}</div>
    <div class="card"><h2>Registro tagli</h2>${ev.length ? `<ul class="list">${ev.slice(0, 10).map(e => `<li>${fmtDate(e.date)} <small>${esc(e.text)}</small></li>`).join('')}</ul>` : '<div class="empty">Nessun taglio registrato.</div>'}</div>
  </div>
  <div class="card" style="margin-top:14px"><h2>Problemi frequenti</h2>${(sp.problems || []).map(p => `<details><summary><b>${esc(p.n)}</b> <small>${esc(p.k)}</small></summary><p>${esc(p.s)}</p><p><b>Prevenzione:</b> ${esc(p.pv)}</p><p><b>Intervento:</b> ${esc(p.bio)}</p></details>`).join('') || '<small>—</small>'}
    <p style="margin-top:10px"><small><b>Zone diradate:</b> scarifica leggermente, distribuisci 20-30 g/m² di seme dello stesso miscuglio, copri con 3-5 mm di terriccio e mantieni umido fino all'emergenza. <b>Resistenza alla siccità:</b> irrigazioni profonde e distanziate, taglio più alto in estate, mulching, eventuale trasemina con Festuca arundinacea.</small></p></div>`;

  $('#cutNow', view).onclick = async () => {
    const open = (await gardenTasks()).filter(t => t.type === 'taglio' && t.status === 'todo' && (t.plantIds || [t.plantId]).includes(lawnPlant.id) && t.date <= todayISO()).sort((a, b) => b.date.localeCompare(a.date));
    if (open[0]) await completeTask(open[0], { notes: `Altezza ${hNow} cm` });
    else await addEvent({ plantId: lawnPlant.id, type: 'taglio', text: `Taglio a ${hNow} cm.` });
    toast('Taglio registrato'); route();
  };
  $('#lReset', view).onclick = async () => { lawnPlant.speciesId = null; lawnPlant.archived = true; await savePlant(lawnPlant); route(); };
}
