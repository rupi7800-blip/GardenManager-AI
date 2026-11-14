import { db } from '../db.js';
import { getSpecies, plantEvents, addEvent, savePlant, deletePlant, duplicatePlant, healthChip, HEALTH, state } from '../store.js';
import { esc, $, $$, modal, toast, fmtDate, options, photoInputHTML, bindPhotoInput, savePhoto, hydratePhotos, confirmDialog, photoURL } from '../ui.js';
import { gardenTasks, generateAutoTasks } from '../tasks.js';
import { TASK_TYPES } from '../data/species.js';
import { openPlantForm } from './plant-form.js';
import { taskItemHTML, bindTaskList, editTask } from './task-ui.js';
import { speciesSheetHTML, bindSheet } from './species-detail.js';
import { route, go } from '../app.js';

const EVENT_TYPES = { osservazione: '👁️ Osservazione', crescita: '📏 Crescita', fioritura: '🌸 Fioritura', fruttificazione: '🍎 Fruttificazione', potatura: '✂️ Potatura', concimazione: '🧪 Concimazione', trattamento: '🛡️ Trattamento', problema: '⚠️ Problema', trapianto: '🪴 Trapianto', rinvaso: '🪴 Rinvaso', irrigazione: '💧 Irrigazione', raccolta: '🧺 Raccolta', foto: '📷 Foto', salute: '❤️ Salute', diagnosi: '🩺 Diagnosi', inserimento: '🌱 Inserimento' };

export async function render(view, params) {
  const p = await db.get('plants', params[0]);
  if (!p) { view.innerHTML = '<div class="empty">Pianta non trovata.</div>'; return; }
  const s = await getSpecies(p.speciesId);
  const tab = sessionStorage.getItem('plantTab') || 'scheda';
  view.innerHTML = `
  <div class="card"><div class="grid g2" style="align-items:start">
    <div class="pcard" style="border-radius:12px;cursor:default"><div class="thumb" style="border-radius:12px">${p.photoId ? `<img data-photo="${p.photoId}" alt="">` : (s?.emoji || '🌿')}</div></div>
    <div><h2 style="font-size:1.35rem;margin-bottom:2px">${esc(p.name)}${p.qty > 1 ? ` <small>×${p.qty}</small>` : ''}</h2>
      <div class="sci">${esc(s?.sci || '')}${p.variety ? ' «' + esc(p.variety) + '»' : ''} · <a href="#/specie/${encodeURIComponent(p.speciesId)}">scheda botanica</a></div>
      <div class="row" style="margin:10px 0">${healthChip(p.health)}${p.archived ? '<span class="chip">archiviata</span>' : ''}${p.inPot ? '<span class="chip">in vaso</span>' : ''}</div>
      <div class="sheet"><dl>
        <dt>Posizione</dt><dd>${esc(p.position || '—')}</dd><dt>Impianto</dt><dd>${p.planted ? fmtDate(p.planted) : '—'}${p.age ? ' · età ' + esc(p.age) : ''}</dd>
        <dt>Dimensioni</dt><dd>${p.height ? 'h ' + p.height + ' m' : '—'}${p.width ? ' × l ' + p.width + ' m' : ''}</dd>
        <dt>Esposizione</dt><dd>${esc(p.exposure || '—')}</dd><dt>Terreno</dt><dd>${esc(p.soil || '—')}</dd><dt>Inserita</dt><dd>${fmtDate(p.created)} <small>(${esc(p.origin || 'manuale')})</small></dd>
        ${p.notes ? `<dt>Note</dt><dd>${esc(p.notes)}</dd>` : ''}</dl></div>
      <div class="row" style="margin-top:12px">
        <button class="primary" id="evAdd">+ Registra</button><button id="pEdit">Modifica</button><a class="btn" href="#/diagnosi?plant=${p.id}">🩺 Diagnosi</a>
        <button id="pDup">Duplica</button><button id="pArch">${p.archived ? 'Ripristina' : 'Archivia'}</button><button class="danger" id="pDel">Elimina</button>
      </div>
      <div class="row" style="margin-top:8px"><small>Salute rapida:</small>${HEALTH.map(([k, l]) => `<button class="small ${p.health === k ? 'primary' : ''}" data-h="${k}">${l}</button>`).join('')}</div>
    </div></div></div>
  <div class="tabs" style="margin-top:16px">${[['scheda', 'Scheda botanica'], ['storico', 'Storico'], ['foto', 'Foto e confronto'], ['attivita', 'Attività']].map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
  <div id="tabBody"></div>`;
  hydratePhotos(view);

  const body = $('#tabBody', view);
  const showTab = async (k) => {
    sessionStorage.setItem('plantTab', k);
    $$('[data-tab]', view).forEach(b => b.classList.toggle('on', b.dataset.tab === k));
    if (k === 'scheda') { body.innerHTML = s ? speciesSheetHTML(s, { actions: false }) : '<div class="empty">Specie non trovata.</div>'; }
    if (k === 'storico') {
      const ev = await plantEvents(p.id);
      body.innerHTML = `<div class="card">${ev.length ? `<div class="timeline">${ev.map(e => `<div class="ev"><small>${fmtDate(e.date)}</small> · <b>${EVENT_TYPES[e.type] || TASK_TYPES[e.type]?.label || esc(e.type)}</b><div>${esc(e.text || '')}</div>${(e.photoIds || []).map(id => `<img data-photo="${id}" alt="">`).join('')}</div>`).join('')}</div>` : '<div class="empty">Nessun evento registrato.</div>'}</div>`;
      hydratePhotos(body);
    }
    if (k === 'foto') {
      const photos = (await db.byIndex('photos', 'plantId', p.id)).sort((a, b) => a.date.localeCompare(b.date));
      if (p.photoId && !photos.find(x => x.id === p.photoId)) { const ph = await db.get('photos', p.photoId); if (ph) photos.unshift(ph); }
      body.innerHTML = `<div class="card"><div class="card-head"><h2>Archivio fotografico</h2><button id="phAdd" class="primary">+ Foto</button></div>
        ${photos.length ? `<div class="img-grid">${photos.map(x => `<figure><img data-photo="${x.id}" alt=""><figcaption>${fmtDate(x.date)}${x.id === p.photoId ? ' · copertina' : ''} <button class="small ghost" data-cover="${x.id}">copertina</button></figcaption></figure>`).join('')}</div>` : '<div class="empty">Nessuna foto. Scatta foto periodiche per seguire crescita e salute.</div>'}
        ${photos.length >= 2 ? `<h3 class="section-title">Confronta due date</h3><div class="row"><select id="cmpA">${photos.map((x, i) => `<option value="${x.id}" ${i === 0 ? 'selected' : ''}>${fmtDate(x.date)}</option>`).join('')}</select><span>↔</span><select id="cmpB">${photos.map((x, i) => `<option value="${x.id}" ${i === photos.length - 1 ? 'selected' : ''}>${fmtDate(x.date)}</option>`).join('')}</select></div>
          <div class="compare" style="margin-top:10px"><img id="cmpImgB" alt=""><img id="cmpImgA" class="top" alt=""></div><input type="range" id="cmpR" min="0" max="100" value="50" aria-label="Scorri per confrontare" style="width:100%">` : ''}</div>`;
      hydratePhotos(body);
      $('#phAdd', body).onclick = () => addPhoto(p);
      $$('[data-cover]', body).forEach(b => b.onclick = async () => { p.photoId = b.dataset.cover; await savePlant(p); toast('Copertina aggiornata'); route(); });
      if (photos.length >= 2) {
        const upd = async () => { $('#cmpImgA', body).src = await photoURL($('#cmpA', body).value); $('#cmpImgB', body).src = await photoURL($('#cmpB', body).value); };
        $('#cmpA', body).onchange = upd; $('#cmpB', body).onchange = upd; upd();
        $('#cmpR', body).oninput = (e) => { $('#cmpImgA', body).style.clipPath = `inset(0 ${100 - e.target.value}% 0 0)`; };
      }
    }
    if (k === 'attivita') {
      const tasks = (await gardenTasks()).filter(t => t.plantId === p.id || (t.plantIds || []).includes(p.id));
      const open = tasks.filter(t => t.status === 'todo'), done = tasks.filter(t => t.status === 'done').reverse();
      body.innerHTML = `<div class="card"><div class="card-head"><h2>Attività</h2><button id="tNew" class="primary">+ Nuova attività</button></div>
        ${open.length ? `<ul class="list" id="tOpen">${open.map(t => taskItemHTML(t)).join('')}</ul>` : '<div class="empty">Nessuna attività aperta.</div>'}
        ${done.length ? `<h3 class="section-title">Completate</h3><ul class="list" id="tDone">${done.slice(0, 20).map(t => taskItemHTML(t)).join('')}</ul>` : ''}</div>`;
      const names = { [p.id]: p.name };
      ['#tOpen', '#tDone'].forEach(sel => { const el = $(sel, body); if (el) bindTaskList(el, tasks, () => showTab('attivita'), names); });
      $('#tNew', body).onclick = () => editTask({}, () => showTab('attivita'), { plantId: p.id, plantIds: [p.id] });
    }
  };
  $$('[data-tab]', view).forEach(b => b.onclick = () => showTab(b.dataset.tab));
  showTab(tab);

  $('#pEdit', view).onclick = () => openPlantForm({ plant: p, onSaved: () => route() });
  $('#pDup', view).onclick = async () => { const c = await duplicatePlant(p); await generateAutoTasks(); toast('Pianta duplicata'); go('#/pianta/' + c.id); };
  $('#pArch', view).onclick = async () => { p.archived = !p.archived; await savePlant(p); await addEvent({ plantId: p.id, type: 'osservazione', text: p.archived ? 'Pianta archiviata.' : 'Pianta ripristinata.' }); toast(p.archived ? 'Pianta archiviata' : 'Pianta ripristinata'); route(); };
  $('#pDel', view).onclick = async () => { if (await confirmDialog(`Eliminare "${p.name}" con storico, foto e attività?`, 'Elimina', true)) { await deletePlant(p.id); toast('Pianta eliminata'); go('#/giardino'); } };
  $$('[data-h]', view).forEach(b => b.onclick = async () => { p.health = b.dataset.h; await savePlant(p); toast('Stato aggiornato'); route(); });
  $('#evAdd', view).onclick = () => addEventDialog(p);
}

function addEventDialog(p) {
  const m = modal({
    title: 'Registra nello storico',
    body: `<div class="form-grid"><div class="field"><label for="evType">Tipo</label><select id="evType">${options(Object.entries(EVENT_TYPES).filter(([k]) => !['inserimento', 'salute', 'diagnosi'].includes(k)), 'osservazione')}</select></div>
      <div class="field"><label for="evDate">Data</label><input type="date" id="evDate" value="${new Date().toISOString().slice(0, 10)}"></div>
      <div class="field"><label for="evH">Nuova altezza (m)</label><input type="number" step="0.05" id="evH" value="${p.height ?? ''}"></div>
      <div class="field"><label for="evW">Nuova larghezza (m)</label><input type="number" step="0.05" id="evW" value="${p.width ?? ''}"></div>
      <div class="field full"><label for="evText">Descrizione</label><textarea id="evText" placeholder="Es. prima fioritura, 20 frutti, potati i succhioni"></textarea></div>
      <div class="field full"><label>Foto</label>${photoInputHTML('evPh')}</div></div>`,
    foot: '<button data-close>Annulla</button><button class="primary" data-save>Registra</button>',
  });
  const ph = bindPhotoInput(m.el, 'evPh');
  $('[data-save]', m.el).onclick = async () => {
    const date = $('#evDate', m.el).value;
    const ids = [];
    for (const b of ph.blobs) ids.push(await savePhoto(b, { plantId: p.id, gardenId: p.gardenId, date: new Date(date + 'T12:00').toISOString(), kind: 'storico' }));
    const h = $('#evH', m.el).value, w = $('#evW', m.el).value;
    let extra = '';
    if (h && +h !== p.height) { extra += ` Altezza: ${p.height ?? '?'} → ${h} m.`; p.height = +h; }
    if (w && +w !== p.width) { extra += ` Larghezza: ${p.width ?? '?'} → ${w} m.`; p.width = +w; }
    if (extra || (ids.length && !p.photoId)) { if (!p.photoId && ids[0]) p.photoId = ids[0]; await savePlant(p); }
    await addEvent({ plantId: p.id, gardenId: p.gardenId, type: $('#evType', m.el).value, text: ($('#evText', m.el).value.trim() + extra).trim(), photoIds: ids, date: new Date(date + 'T12:00').toISOString() });
    m.close(); toast('Registrato nello storico'); route();
  };
}
function addPhoto(p) {
  const m = modal({ title: 'Aggiungi foto', body: photoInputHTML('apPh'), foot: '<button data-close>Annulla</button><button class="primary" data-save>Salva</button>' });
  const ph = bindPhotoInput(m.el, 'apPh');
  $('[data-save]', m.el).onclick = async () => {
    if (!ph.blobs.length) return toast('Scegli almeno una foto');
    const ids = [];
    for (const b of ph.blobs) ids.push(await savePhoto(b, { plantId: p.id, gardenId: p.gardenId, kind: 'storico' }));
    if (!p.photoId) { p.photoId = ids[0]; await savePlant(p); }
    await addEvent({ plantId: p.id, type: 'foto', text: `${ids.length} foto aggiunte.`, photoIds: ids });
    m.close(); toast('Foto salvate'); route();
  };
}
