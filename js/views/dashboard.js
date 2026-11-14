import { state, healthChip, CATEGORIES, modeLabel } from '../store.js';
import { esc, $, fmtDate, toast, loading, DOW, MONTHS } from '../ui.js';
import { wmo } from '../weather.js';
import { taskBuckets } from '../tasks.js';
import { getDailyTip } from '../tips.js';
import { irrigationAdvice, statusChip } from '../irrigation.js';
import { addEvent } from '../store.js';
import { loadContext, route } from '../app.js';
import { taskItemHTML, bindTaskList } from './task-ui.js';

export async function render(view) {
  const ctx = await loadContext();
  const { garden: g, plants, fc, tasks, alerts, speciesMap } = ctx;
  const h = new Date().getHours();
  const greet = h < 6 ? 'Buonanotte' : h < 13 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera';
  const b = taskBuckets(tasks);
  const plantNames = Object.fromEntries(plants.map(p => [p.id, p.name]));
  const attention = plants.filter(p => ['da-seguire', 'sofferente', 'malata'].includes(p.health));
  const cats = {};
  for (const p of plants) { const c = speciesMap[p.speciesId]?.cat || p.cat || 'altro'; cats[c] = (cats[c] || 0) + (p.qty || 1); }
  const todayList = [...b.overdue, ...b.today.filter(t => !b.overdue.includes(t))];

  view.innerHTML = `
  <div class="hero">
    <div><small>${fmtDate(new Date().toISOString().slice(0, 10), { weekday: 'long', day: 'numeric', month: 'long' })}</small>
      <h2>${greet}${state.settings.userName ? ', ' + esc(state.settings.userName) : ''}</h2>
      <div class="muted">${esc(g.name)}${g.place ? ' · ' + esc(g.place) : ''} · gestione ${esc(modeLabel())}</div></div>
    <div class="row"><a class="btn" href="#/riconosci">📷 Riconosci</a><a class="btn primary" href="#/consulente">💬 Chiedi al consulente</a></div>
  </div>
  ${alerts.map(a => `<div class="alert ${a.level === 'info' ? 'info' : a.level}"><b>${a.icon} ${esc(a.title)}</b><br>${esc(a.text)}</div>`).join('')}
  <div class="grid g2">
    <div class="card" id="wxCard">${weatherHTML(ctx)}</div>
    <div class="card tip" id="tipCard"><h2>🌱 Il consiglio del giorno</h2>${loading('Sto preparando il consiglio…')}</div>
  </div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><div class="card-head"><h2>✅ Da fare oggi</h2><a href="#/calendario" class="small btn">Calendario</a></div>
      ${todayList.length ? `<ul class="list" id="todayList">${todayList.slice(0, 8).map(t => taskItemHTML(t, '')).join('')}</ul>${todayList.length > 8 ? `<small>…e altre ${todayList.length - 8}</small>` : ''}` : '<div class="empty">Nessuna attività per oggi. 🌿</div>'}
      ${b.upcoming.length ? `<h3 class="section-title">Prossimi giorni</h3><ul class="list" id="nextList">${b.upcoming.slice(0, 5).map(t => taskItemHTML(t, '')).join('')}</ul>` : ''}
    </div>
    <div class="card" id="irrCard"><h2>💧 Irrigazione</h2>${loading()}</div>
  </div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><h2>👀 Piante da seguire</h2>
      ${attention.length ? `<ul class="list">${attention.map(p => `<li><div class="grow"><a href="#/pianta/${p.id}" class="title">${esc(p.name)}</a><br><small>${esc(p.position || '')}</small></div>${healthChip(p.health)}</li>`).join('')}</ul>` : '<div class="empty">Tutte le piante risultano in buona salute.</div>'}
    </div>
    <div class="card"><h2>🗂️ Il giardino in breve</h2>
      <div class="kpis">
        <div class="kpi"><b>${plants.length}</b><small>schede piante</small></div>
        <div class="kpi"><b>${plants.reduce((a, p) => a + (p.qty || 1), 0)}</b><small>esemplari</small></div>
        <div class="kpi"><b>${b.overdue.length}</b><small>attività in ritardo</small></div>
        ${g.climate ? `<div class="kpi"><b>${esc(g.climate.zone)}</b><small>zona USDA</small></div>` : ''}
      </div>
      <div class="row" style="margin-top:10px;gap:6px">${Object.entries(cats).map(([c, n]) => `<a class="chip sage" href="#/giardino?cat=${c}">${CATEGORIES[c]?.emoji || '🌿'} ${esc(CATEGORIES[c]?.label || c)}: ${n}</a>`).join('') || '<small>Nessuna pianta. <a href="#/piante">Aggiungi dall\'archivio</a></small>'}</div>
    </div>
  </div>
  <h3 class="section-title">Accesso rapido</h3>
  <div class="quick">
    <a href="#/riconosci"><span>📷</span>Riconosci una pianta</a><a href="#/diagnosi"><span>🩺</span>Diagnosi</a>
    <a href="#/piante"><span>➕</span>Aggiungi pianta</a><a href="#/consulente"><span>💬</span>Consulente AI</a>
    <a href="#/orto"><span>🥕</span>Orto</a><a href="#/prato"><span>🟩</span>Prato</a><a href="#/progetta"><span>📐</span>Progettazione</a>
  </div>`;

  const refresh = () => route();
  const tl = $('#todayList', view); if (tl) bindTaskList(tl, tasks, refresh, plantNames);
  const nl = $('#nextList', view); if (nl) bindTaskList(nl, tasks, refresh, plantNames);
  const wxr = $('#wxRefresh', view);
  if (wxr) wxr.onclick = async () => { const c2 = await loadContext({ force: true }); $('#wxCard', view).innerHTML = weatherHTML(c2); };

  // Consiglio del giorno
  const tipCard = $('#tipCard', view);
  const showTip = async (force) => {
    tipCard.innerHTML = `<h2>🌱 Il consiglio del giorno</h2>${loading('Sto preparando il consiglio…')}`;
    const tip = await getDailyTip(ctx, { force });
    tipCard.innerHTML = `<h2>🌱 Il consiglio del giorno ${tip?.source === 'ai' ? '<span class="badge-ai">AI</span>' : ''}</h2>
      ${tip ? `<p class="tip-text">${esc(tip.consiglio)}</p><small>${esc(tip.motivo || '')}</small>` : '<p>Nessun consiglio disponibile.</p>'}
      <div class="row" style="margin-top:10px"><button class="small ghost" id="tipNew">Un altro consiglio</button></div>`;
    $('#tipNew', tipCard).onclick = () => showTip(true);
  };
  showTip(false);

  // Irrigazione
  const irr = await irrigationAdvice(g, fc, plants, speciesMap);
  $('#irrCard', view).innerHTML = `<div class="card-head"><h2>💧 Irrigazione</h2><small>bilancio idrico ET0 − pioggia</small></div>
    ${!fc ? `<div class="empty">${esc(ctx.fcError ? 'Meteo non disponibile: ' + ctx.fcError : 'Imposta la località del giardino per i consigli di irrigazione.')}</div>`
      : irr.length ? `<ul class="list">${irr.map(x => `<li><div class="grow"><div class="title">${x.emoji} ${esc(x.label)} <small>(${x.count})</small></div><small>${esc(x.text)}</small>${x.last ? `<br><small>Ultima irrigazione registrata: ${fmtDate(x.last)}</small>` : ''}</div>
        <div class="stack" style="text-align:right">${statusChip(x.status)}<button class="small" data-irr="${x.group}">Ho irrigato</button></div></li>`).join('')}</ul>`
      : '<div class="empty">Aggiungi piante per ricevere consigli di irrigazione.</div>'}`;
  view.querySelectorAll('[data-irr]').forEach(btn => btn.onclick = async () => {
    const grp = btn.dataset.irr;
    const names = irr.find(x => x.group === grp)?.label;
    await addEvent({ type: 'irrigazione', group: grp, text: `Irrigazione: ${names}.` });
    toast('Irrigazione registrata'); refresh();
  });
}

function weatherHTML({ fc, fcError, garden }) {
  if (!garden.lat) return `<h2>🌦️ Meteo</h2><div class="empty">Imposta la località in <a href="#/giardino">Il mio giardino</a>.</div>`;
  if (!fc) return `<h2>🌦️ Meteo</h2><div class="empty">Meteo non disponibile${fcError ? ': ' + esc(fcError) : ''}.</div>`;
  const c = fc.current, t = fc.today || fc.next[0];
  const [ico, desc] = wmo(c.weather_code);
  const rain7 = fc.past.reduce((a, d) => a + (d.rain || 0), 0);
  return `<div class="card-head"><h2>🌦️ Meteo locale</h2><button class="small ghost" id="wxRefresh" title="Aggiorna">↻</button></div>
    ${fc.stale ? '<div class="alert warn">Dati non aggiornati (offline).</div>' : ''}
    <div class="weather-now"><span style="font-size:2.4rem">${ico}</span><div><div class="temp">${Math.round(c.temperature_2m)}°</div><small>${desc}</small></div>
      <div style="margin-left:auto;text-align:right;font-size:.88rem">min ${Math.round(t.tmin)}° · max ${Math.round(t.tmax)}°<br>💧 ${t.pop ?? '—'}% · ${(t.rain || 0).toFixed(1)} mm<br>💨 ${Math.round(c.wind_speed_10m)} km/h · umidità ${c.relative_humidity_2m}%</div></div>
    <small>Pioggia ultimi 7 giorni: ${rain7.toFixed(0)} mm · ET0 oggi ${(t.et0 || 0).toFixed(1)} mm</small>
    <div class="wx-days">${fc.next.slice(0, 7).map(d => { const dd = new Date(d.date + 'T12:00'); return `<div>${DOW[(dd.getDay() + 6) % 7]}<b>${wmo(d.code)[0]}</b>${Math.round(d.tmax)}°/${Math.round(d.tmin)}°<br><small>${d.rain >= 0.5 ? d.rain.toFixed(0) + ' mm' : '—'}</small></div>`; }).join('')}</div>`;
}
