import { state, gardenPlants, getSpecies, healthChip, CATEGORIES, HEALTH, deleteGarden, saveGarden } from '../store.js';
import { esc, $, $$, modal, toast, options, hydratePhotos, MONTHS_SHORT, MONTHS, confirmDialog, loading } from '../ui.js';
import { getClimate } from '../weather.js';
import { gardenFormHTML, bindGardenForm } from './garden-form.js';
import { openPlantForm } from './plant-form.js';
import { route, go } from '../app.js';

export async function render(view, params, query) {
  const g = state.garden;
  const plants = await gardenPlants(g.id, { includeArchived: true });
  const sp = {};
  for (const p of plants) sp[p.speciesId] = sp[p.speciesId] || await getSpecies(p.speciesId);
  const filt = { q: '', cat: query?.get('cat') || '', health: '', archived: false };

  view.innerHTML = `
  <div class="grid g2">
    <div class="card"><div class="card-head"><h2>🏡 ${esc(g.name)}</h2><button class="small" id="editG">Modifica</button></div>
      <div class="sheet"><dl>
        <dt>Località</dt><dd>${esc(g.place || '—')}${g.lat ? ` <small>(${g.lat.toFixed(3)}, ${g.lon.toFixed(3)}${g.elevation != null ? ', ' + Math.round(g.elevation) + ' m' : ''})</small>` : ''}</dd>
        <dt>Superficie</dt><dd>${g.area ? g.area + ' m²' : '—'}</dd>
        <dt>Terreno</dt><dd>${esc(g.soil || '—')}${g.ph ? ', pH ' + g.ph : ''}</dd>
        <dt>Esposizione</dt><dd>${esc([g.exposure, g.orientation && 'verso ' + g.orientation].filter(Boolean).join(', ') || '—')}</dd>
        <dt>Ombra</dt><dd>${esc(g.shade || '—')}</dd><dt>Pendenza</dt><dd>${esc(g.slope || '—')}</dd>
        <dt>Acqua</dt><dd>${esc([g.water, g.irrigation].filter(Boolean).join(' · ') || '—')}</dd>
        <dt>Zone umide/secche</dt><dd>${esc(g.wetDry || '—')}</dd>
        <dt>Elementi</dt><dd>${(g.features || []).map(f => `<span class="chip">${esc(f)}</span>`).join(' ') || '—'}</dd>
      </dl></div>
    </div>
    <div class="card" id="climCard">${climateHTML(g)}</div>
  </div>
  <div class="card-head" style="margin-top:20px"><h2 style="margin:0">🌿 Le mie piante</h2>
    <div class="row"><a class="btn" href="#/piante">📚 Dall'archivio</a><a class="btn" href="#/riconosci">📷 Da foto</a><button class="primary" id="addManual">➕ Inserimento manuale</button></div></div>
  <div class="row" style="margin-bottom:12px">
    <input type="search" id="fQ" placeholder="Cerca per nome, varietà, posizione…" style="flex:1;min-width:180px">
    <select id="fCat" aria-label="Categoria"><option value="">Tutte le categorie</option>${options(Object.entries(CATEGORIES).map(([k, v]) => [k, v.label]), filt.cat)}</select>
    <select id="fHealth" aria-label="Salute"><option value="">Ogni stato</option>${options(HEALTH, '')}</select>
    <label style="font-weight:400;display:flex;gap:6px;align-items:center;margin:0"><input type="checkbox" id="fArch"> Archiviate</label>
  </div>
  <div id="plantGrid"></div>
  <hr><div class="row"><button class="danger small" id="delG">Elimina questo giardino</button><button class="small" id="newG">+ Nuovo giardino</button></div>`;

  const grid = $('#plantGrid', view);
  const draw = async () => {
    const q = filt.q.toLowerCase();
    const list = plants.filter(p => !!p.archived === filt.archived && (!filt.cat || sp[p.speciesId]?.cat === filt.cat || (filt.cat === 'vaso' && p.inPot)) && (!filt.health || p.health === filt.health) &&
      (!q || [p.name, p.variety, p.position, sp[p.speciesId]?.sci, sp[p.speciesId]?.it].some(x => (x || '').toLowerCase().includes(q))));
    grid.innerHTML = list.length ? `<div class="grid auto">${list.map(p => { const s = sp[p.speciesId]; return `<a class="card pcard" href="#/pianta/${p.id}">
      <div class="thumb">${p.photoId ? `<img data-photo="${p.photoId}" alt="">` : (s?.emoji || '🌿')}</div>
      <div class="body"><div class="title"><b>${esc(p.name)}</b>${p.qty > 1 ? ` <small>×${p.qty}</small>` : ''}</div>
      <div class="sci">${esc(s?.sci || '')}${p.variety ? ' «' + esc(p.variety) + '»' : ''}</div>
      <div class="row" style="gap:6px;margin-top:6px">${healthChip(p.health)}${p.position ? `<span class="chip">${esc(p.position.slice(0, 24))}</span>` : ''}</div></div></a>`; }).join('')}</div>`
      : `<div class="empty">${plants.length ? 'Nessuna pianta con questi filtri.' : 'Non hai ancora inserito piante. Aggiungile dall\'archivio, con il riconoscimento fotografico o manualmente.'}</div>`;
    hydratePhotos(grid);
  };
  $('#fQ', view).oninput = e => { filt.q = e.target.value; draw(); };
  $('#fCat', view).onchange = e => { filt.cat = e.target.value; draw(); };
  $('#fHealth', view).onchange = e => { filt.health = e.target.value; draw(); };
  $('#fArch', view).onchange = e => { filt.archived = e.target.checked; draw(); };
  draw();

  $('#addManual', view).onclick = () => openPlantForm({ onSaved: (p) => go('#/pianta/' + p.id) });
  $('#editG', view).onclick = () => {
    const m = modal({ title: 'Modifica giardino', wide: true, body: gardenFormHTML(g), foot: '<button data-close>Annulla</button><button class="primary" data-save>Salva</button>' });
    const submit = bindGardenForm(m.el, g);
    $('[data-save]', m.el).onclick = async (e) => { e.target.disabled = true; const r = await submit(); if (r) { m.close(); toast('Giardino aggiornato'); route(); } else e.target.disabled = false; };
  };
  $('#delG', view).onclick = async () => {
    if (!await confirmDialog(`Eliminare definitivamente "${g.name}" con tutte le piante, attività e storico?`, 'Elimina', true)) return;
    await deleteGarden(g.id); toast('Giardino eliminato'); go(state.garden ? '#/dashboard' : '#/benvenuto');
  };
  $('#newG', view).onclick = () => go('#/benvenuto/nuovo');
  const cc = $('#calcClim', view);
  if (cc) cc.onclick = async () => {
    $('#climCard', view).innerHTML = loading('Calcolo del clima su 10 anni di dati…');
    try { g.climate = await getClimate(g); await saveGarden(g); } catch (e) { toast(e.message); }
    $('#climCard', view).innerHTML = climateHTML(g);
  };
}

function climateHTML(g) {
  const c = g.climate;
  if (!g.lat) return '<h2>🌡️ Clima locale</h2><div class="empty">Imposta la località per calcolare il clima.</div>';
  if (!c) return '<h2>🌡️ Clima locale</h2><p>Il clima non è ancora stato calcolato.</p><button class="primary" id="calcClim">Calcola il clima locale</button>';
  const maxRain = Math.max(...c.monthly.map(m => m.rain), 1);
  return `<h2>🌡️ Clima locale</h2>
    <div class="kpis">
      <div class="kpi"><b>${esc(c.zone)}</b><small>zona USDA</small></div>
      <div class="kpi"><b>${c.absMinAvg}°</b><small>minima invernale media</small></div>
      <div class="kpi"><b>${c.absMaxAvg}°</b><small>massima estiva media</small></div>
      <div class="kpi"><b>${c.annualRain}</b><small>mm di pioggia/anno</small></div>
    </div>
    <p style="margin-top:10px"><b>${esc(c.type)}</b>. Gelate tipiche: ultima ${c.lastFrost ? fmtMD(c.lastFrost) : 'rara'}, prima ${c.firstFrost ? fmtMD(c.firstFrost) : 'rara'}. Mesi siccitosi: ${c.dryMonths.map(m => MONTHS[m - 1]).join(', ') || 'nessuno'}.</p>
    <div class="table-wrap"><table><thead><tr><th></th>${MONTHS_SHORT.map(m => `<th>${m}</th>`).join('')}</tr></thead><tbody>
      <tr><th>Max</th>${c.monthly.map(m => `<td>${Math.round(m.tmax)}</td>`).join('')}</tr>
      <tr><th>Min</th>${c.monthly.map(m => `<td>${Math.round(m.tmin)}</td>`).join('')}</tr>
      <tr><th>Pioggia</th>${c.monthly.map(m => `<td><div title="${m.rain} mm" style="height:${Math.max(2, Math.round(m.rain / maxRain * 34))}px;background:var(--sage);border-radius:3px;width:10px"></div>${m.rain}</td>`).join('')}</tr>
      <tr><th>Gelo</th>${c.monthly.map(m => `<td>${m.frostDays ? Math.round(m.frostDays) : ''}</td>`).join('')}</tr>
    </tbody></table></div><small>Medie ${c.years} anni (ERA5, Open-Meteo). "Gelo" = giorni con minima ≤ 0 °C.</small>`;
}
const fmtMD = (md) => { const [m, d] = md.split('-'); return `${+d} ${MONTHS[+m - 1]}`; };
