import { db } from '../db.js';
import { state, gardenPlants, getSpecies, addEvent, savePlant, modeLabel, interventionFor } from '../store.js';
import { esc, $, $$, loading, toast, photoInputHTML, bindPhotoInput, blobToBase64, savePhoto, checks, options, confBar } from '../ui.js';
import { callJSON, SCHEMA_DIAGNOSIS, imageBlock, hasAI } from '../ai.js';
import { saveTask } from '../tasks.js';

const ORGANS = ['foglie', 'rami', 'tronco', 'fiori', 'frutti', 'radici / colletto', 'terreno', 'intera pianta', 'prato'];
const SYMPTOMS = ['foglie ingiallite', 'foglie macchiate', 'foglie accartocciate', 'foglie bucate o rosicchiate', 'crescita rallentata', 'rami secchi', 'marciume', 'insetti visibili', 'muffe o feltri', 'polveri o residui', 'melata appiccicosa / fumaggine', 'mancata fioritura', 'caduta anticipata delle foglie', 'avvizzimento', 'essudati o gomma', 'galle o deformazioni'];

export async function render(view, params, query) {
  const plants = await gardenPlants();
  const pre = query?.get('plant') || '';
  view.innerHTML = `
  ${hasAI() ? '' : '<div class="alert warn">La diagnosi da foto usa l\'AI: inserisci la chiave API in <a href="#/impostazioni">Impostazioni</a>. Intanto puoi consultare la guida ai problemi della specie qui sotto.</div>'}
  <div class="card"><div class="form-grid">
    <div class="field"><label for="dPlant">Pianta</label><select id="dPlant"><option value="">— pianta non in archivio —</option>${options(plants.map(p => [p.id, p.name]), pre)}</select></div>
    <div class="field"><label for="dOrgan">Parte interessata</label><select id="dOrgan">${options(ORGANS, 'foglie')}</select></div>
    <div class="field full"><label>Sintomi osservati</label>${checks('sym', SYMPTOMS)}</div>
    <div class="field full"><label for="dDesc">Descrizione e condizioni</label><textarea id="dDesc" placeholder="Da quando, quanto è diffuso, irrigazioni, trattamenti recenti, meteo, altre piante colpite…"></textarea></div>
    <div class="field full"><label>Foto (sintomo da vicino, rovescio delle foglie, pianta intera)</label>${photoInputHTML('dPh')}</div>
  </div><button class="primary" id="dGo" ${hasAI() ? '' : 'disabled'}>🩺 Analizza</button> <small class="muted">Gestione: ${esc(modeLabel())}</small></div>
  <div id="dOut" style="margin-top:14px"></div>
  <div id="dGuide" style="margin-top:14px"></div>`;
  const ph = bindPhotoInput(view, 'dPh', { max: 4 });
  const guide = async () => {
    const pid = $('#dPlant', view).value;
    const p = plants.find(x => x.id === pid);
    const s = p ? await getSpecies(p.speciesId) : null;
    $('#dGuide', view).innerHTML = s?.problems?.length ? `<div class="card"><h2>📖 Problemi noti di ${esc(s.it)}</h2><small>Dalla scheda botanica: confronta i sintomi.</small>
      ${s.problems.map(pr => `<details style="margin-top:8px"><summary><b>${esc(pr.n)}</b> <small>${esc(pr.k)}</small></summary><p><b>Sintomi:</b> ${esc(pr.s)}</p><p><b>Diagnosi differenziale:</b> ${esc(pr.d || '—')}</p><p><b>${esc(interventionFor(pr).label)}:</b> ${esc(interventionFor(pr).text)}</p></details>`).join('')}</div>` : '';
  };
  $('#dPlant', view).onchange = guide; guide();

  $('#dGo', view).onclick = async () => {
    const pid = $('#dPlant', view).value;
    const p = plants.find(x => x.id === pid);
    const s = p ? await getSpecies(p.speciesId) : null;
    const sym = $$('[name=sym]:checked', view).map(x => x.value);
    const desc = $('#dDesc', view).value.trim();
    if (!ph.blobs.length && !sym.length && desc.length < 10) return toast('Aggiungi foto, sintomi o una descrizione');
    const out = $('#dOut', view);
    out.innerHTML = loading('Analisi dei sintomi e diagnosi differenziale…');
    try {
      const imgs = await Promise.all(ph.blobs.map(async b => imageBlock(await blobToBase64(b))));
      const hist = p ? (await db.byIndex('events', 'plantId', p.id)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10).map(e => `${e.date.slice(0, 10)} ${e.type}: ${e.text}`).join('\n') : '';
      const known = s?.problems?.map(x => `${x.n} (${x.k}): ${x.s}`).join('\n') || '';
      const text = `Pianta: ${p ? `${p.name} — ${s?.it || ''} (${s?.sci || 'specie non determinata'}), posizione ${p.position || 'n.d.'}, esposizione ${p.exposure || 'n.d.'}, in vaso: ${p.inPot ? 'sì' : 'no'}` : 'non specificata'}.
Parte interessata: ${$('#dOrgan', view).value}. Sintomi indicati: ${sym.join(', ') || 'nessuno'}. Descrizione: ${desc || '—'}.
${hist ? 'Storico recente della pianta:\n' + hist : ''}
${known ? 'Problemi documentati per la specie (riferimento, non presumere che sia uno di questi):\n' + known : ''}
Esegui una diagnosi differenziale. Distingui ciò che si vede con certezza dalle ipotesi. Considera anche cause abiotiche (stress idrico, ristagno, gelo, scottature, carenze, danni meccanici, fitotossicità).`;
      const r = await callJSON({ system: 'Sei un fitopatologo. Non dare mai una diagnosi come certa senza elementi sufficienti. Interventi coerenti con la filosofia di gestione dell\'utente, dal meno al più impattante.', content: [...imgs, { type: 'text', text }], schema: SCHEMA_DIAGNOSIS, maxTokens: 8000, effort: 'medium' });
      const pm = r.problema_principale;
      out.innerHTML = `<div class="card">
        <div class="alert ${r.certezza === 'diagnosi probabile' ? 'ok' : 'warn'}"><b>${r.certezza === 'diagnosi probabile' ? 'Diagnosi probabile' : r.certezza === 'ipotesi' ? 'Ipotesi da verificare' : 'Informazioni insufficienti'}</b> — non è una diagnosi certa: conferma con le verifiche indicate.${r.organismo_da_quarantena ? '<br>⚠️ <b>Possibile organismo da quarantena:</b> contatta il Servizio fitosanitario regionale prima di intervenire.' : ''}</div>
        <h2>${esc(pm.nome)}</h2><small>${esc(pm.tipo)}${pm.agente ? ' · <i>' + esc(pm.agente) + '</i>' : ''} · urgenza ${esc(r.urgenza)}</small>
        ${confBar(pm.affidabilita)}<p class="hyp" style="margin-top:8px">${esc(pm.motivazione)}</p>
        <h3>Sintomi osservati</h3><ul>${r.sintomi_osservati.map(x => `<li class="fact">${esc(x)}</li>`).join('')}</ul>
        <h3>Altre possibili cause</h3><ul class="list">${r.alternative.map(a => `<li><div class="grow"><b>${esc(a.nome)}</b> <small>${Math.round(a.affidabilita)}%</small><br><small>${esc(a.come_distinguerla)}</small></div></li>`).join('')}</ul>
        <h3>Verifiche da effettuare</h3><ul>${r.verifiche.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        <h3>Intervento consigliato</h3><ol>${r.intervento.map(x => `<li>${esc(x)}</li>`).join('')}</ol>
        <h3>Prevenzione futura</h3><ul>${r.prevenzione.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        ${p ? `<div class="row" style="margin-top:12px"><button class="primary" id="dSave">Salva nello storico della pianta</button><button id="dTask">Crea attività di verifica tra 7 giorni</button></div>` : ''}</div>`;
      if (p) {
        $('#dSave', out).onclick = async (e) => {
          const ids = [];
          for (const b of ph.blobs) ids.push(await savePhoto(b, { plantId: p.id, gardenId: p.gardenId, kind: 'diagnosi' }));
          await addEvent({ plantId: p.id, type: 'diagnosi', text: `${r.certezza}: ${pm.nome} (${Math.round(pm.affidabilita)}%). Alternative: ${r.alternative.map(a => a.nome).join(', ')}. Intervento: ${r.intervento[0] || ''}`, photoIds: ids });
          if (['buona', 'ottima'].includes(p.health)) { p.health = r.urgenza === 'alta' ? 'sofferente' : 'da-seguire'; await savePlant(p); }
          e.target.disabled = true; toast('Diagnosi salvata nello storico');
        };
        $('#dTask', out).onclick = async (e) => {
          const d = new Date(); d.setDate(d.getDate() + 7);
          await saveTask({ type: 'controllo', title: `Verifica: ${pm.nome} su ${p.name}`, text: r.verifiche.join(' '), date: d.toISOString().slice(0, 10), priority: r.urgenza === 'alta' ? 3 : 2, plantId: p.id, plantIds: [p.id], source: 'diagnosi' });
          e.target.disabled = true; toast('Attività creata');
        };
      }
    } catch (e) { out.innerHTML = `<div class="alert danger">${esc(e.message)}</div>`; }
  };
}
