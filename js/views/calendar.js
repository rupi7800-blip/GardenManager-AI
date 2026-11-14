import { state, gardenPlants } from '../store.js';
import { esc, $, $$, modal, toast, todayISO, addDays, MONTHS, DOW, fmtDate, options } from '../ui.js';
import { gardenTasks, generateAutoTasks, buildICS, downloadFile } from '../tasks.js';
import { TASK_TYPES } from '../data/species.js';
import { taskItemHTML, bindTaskList, editTask } from './task-ui.js';

export async function render(view) {
  const now = new Date();
  const st = { y: now.getFullYear(), m: now.getMonth(), mode: sessionStorage.getItem('calMode') || 'lista', type: '', showDone: false };
  const plants = await gardenPlants(state.garden.id, { includeArchived: true });
  const names = Object.fromEntries(plants.map(p => [p.id, p.name]));
  let tasks = [];

  view.innerHTML = `
  <div class="row between" style="margin-bottom:12px">
    <div class="tabs" style="margin:0"><button data-mode="lista">Elenco</button><button data-mode="mese">Mese</button></div>
    <div class="row"><select id="cType" aria-label="Tipo"><option value="">Tutti i tipi</option>${options(Object.entries(TASK_TYPES).map(([k, v]) => [k, v.label]), '')}</select>
      <label style="font-weight:400;display:flex;gap:6px;align-items:center;margin:0"><input type="checkbox" id="cDone"> Completate</label>
      <button class="primary" id="cNew">+ Attività</button></div>
  </div>
  <div id="calBody"></div>
  <div class="card" style="margin-top:16px"><h2>🔗 Calendari esterni</h2>
    <p class="muted">Esporta le attività in formato iCalendar (.ics) e importale in Google Calendar, Apple Calendario, Outlook o in qualsiasi app compatibile (anche AgendApp, se consente l'importazione di file o calendari ICS). Ogni evento contiene pianta, operazione, data, priorità e istruzioni, con promemoria secondo l'anticipo impostato in Impostazioni. Dal dettaglio di ogni attività puoi aggiungerla singolarmente a Google o Outlook.</p>
    <div class="row"><select id="icsRange">${options([['30', 'Prossimi 30 giorni'], ['90', 'Prossimi 3 mesi'], ['365', 'Prossimi 12 mesi']], '90')}</select><button id="icsGo">⬇️ Esporta .ics</button><button id="regen" class="ghost">↻ Rigenera attività dalle schede</button></div>
  </div>`;

  const body = $('#calBody', view);
  const draw = async () => {
    tasks = await gardenTasks();
    $$('[data-mode]', view).forEach(b => b.classList.toggle('on', b.dataset.mode === st.mode));
    const vis = tasks.filter(t => (!st.type || t.type === st.type) && (st.showDone || t.status !== 'done'));
    if (st.mode === 'mese') drawMonth(vis); else drawList(vis);
  };
  const drawList = (vis) => {
    const today = todayISO();
    const groups = [
      ['In ritardo', vis.filter(t => t.status === 'todo' && (t.due || t.date) < today)],
      ['Oggi', vis.filter(t => !(t.status === 'todo' && (t.due || t.date) < today) && t.date <= today && (t.due || t.date) >= today)],
      ['Questa settimana', vis.filter(t => t.date > today && t.date <= addDays(today, 7))],
      ['Più avanti', vis.filter(t => t.date > addDays(today, 7))],
      ...(st.showDone ? [['Completate', vis.filter(t => t.status === 'done' && (t.due || t.date) < today)]] : []),
    ];
    body.innerHTML = groups.filter(([, l]) => l.length).map(([n, l]) => `<div class="card"><h2>${n} <small>(${l.length})</small></h2><ul class="list">${l.map(t => taskItemHTML(t, (t.plantIds || []).length > 1 ? '' : names[t.plantId] && !t.title.includes(names[t.plantId]) ? names[t.plantId] : '')).join('')}</ul></div>`).join('') || '<div class="empty">Nessuna attività. Aggiungi piante al giardino: le attività si generano automaticamente dalle schede.</div>';
    bindTaskList(body, tasks, draw, names);
  };
  const drawMonth = (vis) => {
    const first = new Date(st.y, st.m, 1);
    const startOffset = (first.getDay() + 6) % 7;
    const start = addDays(todayISO(first), -startOffset);
    const today = todayISO();
    const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
    body.innerHTML = `<div class="card"><div class="card-head"><button id="prevM" class="small">‹</button><h2 style="margin:0">${MONTHS[st.m]} ${st.y}</h2><button id="nextM" class="small">›</button></div>
      <div class="cal">${DOW.map(d => `<div class="dow">${d}</div>`).join('')}${cells.map(d => { const dt = vis.filter(t => t.date === d); return `<div class="day ${+d.slice(5, 7) - 1 !== st.m ? 'out' : ''} ${d === today ? 'today' : ''}" data-day="${d}"><span class="n">${+d.slice(8)}</span>${dt.slice(0, 3).map(t => `<span class="ev ${t.status === 'done' ? 'done' : ''} p${t.priority || 1}">${TASK_TYPES[t.type]?.emoji || ''} ${esc(t.title.split(': ').pop())}</span>`).join('')}${dt.length > 3 ? `<small>+${dt.length - 3}</small>` : ''}</div>`; }).join('')}</div></div>`;
    $('#prevM', body).onclick = () => { st.m--; if (st.m < 0) { st.m = 11; st.y--; } draw(); };
    $('#nextM', body).onclick = () => { st.m++; if (st.m > 11) { st.m = 0; st.y++; } draw(); };
    $$('[data-day]', body).forEach(c => c.onclick = () => {
      const d = c.dataset.day, dt = tasks.filter(t => t.date === d && (st.showDone || t.status !== 'done'));
      const m = modal({ title: fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' }), body: dt.length ? `<ul class="list">${dt.map(t => taskItemHTML(t)).join('')}</ul>` : '<div class="empty">Nessuna attività.</div>', foot: '<button class="primary" data-new>+ Attività in questo giorno</button>' });
      bindTaskList(m.el, tasks, () => { m.close(); draw(); }, names);
      $('[data-new]', m.el).onclick = () => { m.close(); editTask({}, draw, { date: d }); };
    });
  };
  $$('[data-mode]', view).forEach(b => b.onclick = () => { st.mode = b.dataset.mode; sessionStorage.setItem('calMode', st.mode); draw(); });
  $('#cType', view).onchange = (e) => { st.type = e.target.value; draw(); };
  $('#cDone', view).onchange = (e) => { st.showDone = e.target.checked; draw(); };
  $('#cNew', view).onclick = () => editTask({}, draw);
  $('#regen', view).onclick = async () => { const n = await generateAutoTasks(); toast(n ? `${n} nuove attività generate` : 'Calendario già aggiornato'); draw(); };
  $('#icsGo', view).onclick = () => {
    const days = +$('#icsRange', view).value, today = todayISO(), end = addDays(today, days);
    const list = tasks.filter(t => t.status === 'todo' && !t.suspended && (t.due || t.date) >= today && t.date <= end);
    if (!list.length) return toast('Nessuna attività nel periodo');
    downloadFile(`giardino-${today}.ics`, buildICS(list, { gardenName: state.garden.name, advanceDays: state.settings.notify.advanceDays, plantNameOf: t => (t.plantIds || [t.plantId]).map(id => names[id]).filter(Boolean).join(', ') }));
    toast(`${list.length} attività esportate`);
  };
  draw();
}
