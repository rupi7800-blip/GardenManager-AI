// Componenti condivisi per elenco e modifica delle attività
import { esc, $, $$, modal, toast, fmtDate, relDay, options, formData, photoInputHTML, bindPhotoInput, savePhoto, todayISO, confirmDialog } from '../ui.js';
import { TASK_TYPES } from '../data/species.js';
import { saveTask, deleteTask, completeTask, reopenTask, postponeTask, toggleSuspend, PRIORITY, googleCalendarURL, outlookURL, buildICS, downloadFile } from '../tasks.js';
import { state, gardenPlants } from '../store.js';

export function taskItemHTML(t, plantName = '') {
  const done = t.status === 'done';
  const late = !done && (t.due || t.date) < todayISO();
  return `<li class="task ${done ? 'done' : ''} prio-${t.priority || 1}" data-task="${t.id}">
    <input type="checkbox" ${done ? 'checked' : ''} aria-label="Completata" data-check>
    <div class="grow" data-open style="cursor:pointer">
      <div class="title">${TASK_TYPES[t.type]?.emoji || '📝'} ${esc(t.title)}</div>
      <small>${esc((t.text || '').slice(0, 140))}${(t.text || '').length > 140 ? '…' : ''}</small>
      <div class="row" style="gap:6px;margin-top:4px">
        <span class="chip ${late ? 'danger' : ''}">${late ? 'in ritardo · ' : ''}${relDay(t.date)}</span>
        ${t.priority >= 3 ? '<span class="chip danger">urgente</span>' : t.priority === 2 ? '<span class="chip warn">importante</span>' : ''}
        ${t.recur?.unit ? '<span class="chip">🔁 ricorrente</span>' : ''}${t.suspended ? '<span class="chip">sospesa</span>' : ''}
        ${t.source === 'auto' ? '<span class="chip sage">dalla scheda</span>' : ''}${plantName ? `<span class="chip">${esc(plantName)}</span>` : ''}
      </div>
    </div></li>`;
}

export function bindTaskList(root, tasks, onChange, plantNames = {}) {
  for (const li of $$('[data-task]', root)) {
    const t = tasks.find(x => x.id === li.dataset.task);
    if (!t) continue;
    $('[data-check]', li).onchange = async (e) => {
      if (e.target.checked) { await completeTask(t); toast('Attività completata e registrata nello storico'); }
      else await reopenTask(t);
      onChange && onChange();
    };
    $('[data-open]', li).onclick = () => openTask(t, onChange, plantNames);
  }
}

export function openTask(t, onChange, plantNames = {}) {
  const names = (t.plantIds || [t.plantId]).map(id => plantNames[id]).filter(Boolean).join(', ');
  const m = modal({
    title: t.title,
    body: `<p>${esc(t.text || '')}</p>
      <div class="row" style="gap:6px;margin-bottom:10px"><span class="chip">${fmtDate(t.date)}</span>${t.due && t.due !== t.date ? `<span class="chip">entro ${fmtDate(t.due)}</span>` : ''}<span class="chip">${PRIORITY[t.priority || 1]}</span>${names ? `<span class="chip">${esc(names)}</span>` : ''}</div>
      ${t.notes ? `<p><b>Note:</b> ${esc(t.notes)}</p>` : ''}
      ${t.status !== 'done' ? `<div class="field"><label for="tNotes">Note dell'intervento</label><textarea id="tNotes" placeholder="Cosa hai fatto, prodotti usati, osservazioni"></textarea></div>
      <div class="field"><label>Foto dell'intervento</label>${photoInputHTML('tPh', { label: 'Aggiungi' })}</div>` : ''}
      <div class="row">
        <button data-post="1">+1 giorno</button><button data-post="3">+3 giorni</button><button data-post="7">+1 settimana</button>
        <button data-susp>${t.suspended ? 'Riattiva' : 'Sospendi'}</button><button data-edit>Modifica</button>
      </div>
      <hr><div class="row"><small>Aggiungi al calendario:</small><a class="btn small" target="_blank" rel="noopener" href="${googleCalendarURL(t, names)}">Google</a><a class="btn small" target="_blank" rel="noopener" href="${outlookURL(t, names)}">Outlook</a><button class="small" data-ics>File .ics (Apple, AgendApp…)</button></div>`,
    foot: `<button class="danger" data-del>Elimina</button><span class="spacer"></span>${t.status === 'done' ? '<button data-reopen>Riapri</button>' : '<button class="primary" data-done>Segna come fatta</button>'}`,
  });
  const ph = t.status !== 'done' ? bindPhotoInput(m.el, 'tPh') : null;
  const after = (msg) => { m.close(); if (msg) toast(msg); onChange && onChange(); };
  $$('[data-post]', m.el).forEach(b => b.onclick = async () => { await postponeTask(t, +b.dataset.post); after('Attività posticipata'); });
  $('[data-susp]', m.el).onclick = async () => { await toggleSuspend(t); after(t.suspended ? 'Attività sospesa' : 'Attività riattivata'); };
  $('[data-edit]', m.el).onclick = () => { m.close(); editTask(t, onChange); };
  $('[data-ics]', m.el).onclick = () => downloadFile(`attivita-${t.date}.ics`, buildICS([t], { gardenName: state.garden.name, advanceDays: state.settings.notify.advanceDays, plantNameOf: () => names }));
  $('[data-del]', m.el).onclick = async () => { if (await confirmDialog('Eliminare questa attività?', 'Elimina', true)) { await deleteTask(t); after('Attività eliminata'); } };
  const done = $('[data-done]', m.el);
  if (done) done.onclick = async () => {
    const ids = [];
    for (const b of ph.blobs) ids.push(await savePhoto(b, { plantId: t.plantId, gardenId: t.gardenId, kind: 'intervento' }));
    await completeTask(t, { notes: $('#tNotes', m.el).value.trim(), photoIds: ids });
    after('Attività completata e registrata nello storico');
  };
  const re = $('[data-reopen]', m.el);
  if (re) re.onclick = async () => { await reopenTask(t); after(); };
}

export async function editTask(t = {}, onChange, preset = {}) {
  const plants = await gardenPlants();
  const v = { type: 'altro', priority: 1, date: todayISO(), ...preset, ...t };
  const m = modal({
    title: t.id ? 'Modifica attività' : 'Nuova attività',
    body: `<form id="taskForm" class="form-grid">
      <div class="field full"><label for="tfTitle">Titolo</label><input id="tfTitle" name="title" type="text" required value="${esc(v.title || '')}" placeholder="Es. Potatura siepe di alloro"></div>
      <div class="field"><label for="tfType">Tipo</label><select id="tfType" name="type">${options(Object.entries(TASK_TYPES).map(([k, x]) => [k, x.label]), v.type)}</select></div>
      <div class="field"><label for="tfPlant">Pianta</label><select id="tfPlant" name="plantId"><option value="">— nessuna / generale —</option>${options(plants.map(p => [p.id, p.name]), v.plantId)}</select></div>
      <div class="field"><label for="tfDate">Data</label><input id="tfDate" name="date" type="date" required value="${v.date}"></div>
      <div class="field"><label for="tfPrio">Priorità</label><select id="tfPrio" name="priority">${options(Object.entries(PRIORITY), v.priority)}</select></div>
      <div class="field"><label for="tfEvery">Ripeti ogni</label><div class="row" style="flex-wrap:nowrap"><input id="tfEvery" name="every" type="number" min="1" value="${v.recur?.every || ''}" placeholder="—" style="width:80px"><select name="unit" aria-label="Unità">${options([['', 'mai'], ['day', 'giorni'], ['week', 'settimane'], ['month', 'mesi'], ['year', 'anni']], v.recur?.unit || '')}</select></div></div>
      <div class="field"><label for="tfUntil">Fino al (facoltativo)</label><input id="tfUntil" name="until" type="date" value="${v.recur?.until || ''}"></div>
      <div class="field full"><label for="tfText">Istruzioni</label><textarea id="tfText" name="text">${esc(v.text || '')}</textarea></div>
    </form>`,
    foot: `<button data-close>Annulla</button><button class="primary" data-save>Salva</button>`,
  });
  $('[data-save]', m.el).onclick = async () => {
    const f = $('#taskForm', m.el);
    if (!f.reportValidity()) return;
    const d = formData(f);
    const out = { ...t, ...preset, title: d.title, type: d.type, plantId: d.plantId || null, plantIds: d.plantId ? [d.plantId] : (t.plantIds && t.plantId === d.plantId ? t.plantIds : []), date: d.date, priority: +d.priority, text: d.text, recur: d.unit ? { every: d.every || 1, unit: d.unit, until: d.until || null } : null, source: t.source || preset.source || 'manuale' };
    if (out.due && out.due < out.date) out.due = out.date;
    await saveTask(out);
    m.close(); toast('Attività salvata'); onChange && onChange();
  };
}
