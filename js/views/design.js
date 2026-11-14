// Garden design: planimetria interattiva (SVG in metri), verifiche botaniche, ipotesi
// progettuali multiple e confronto, analisi AI di foto e zone.
import { db, uid } from '../db.js';
import { state, allSpecies, gardenPlants, getSpecies, CATEGORIES } from '../store.js';
import { esc, $, $$, modal, toast, options, loading, photoInputHTML, bindPhotoInput, blobToBase64, confirmDialog, checks } from '../ui.js';
import { callJSON, SCHEMA_DESIGN, imageBlock, hasAI } from '../ai.js';
import { downloadFile } from '../tasks.js';

const ZONES = { aiuola: ['Aiuola', '#c9b48a'], prato: ['Prato', '#9cc48f'], orto: ['Orto', '#b9925f'], relax: ['Zona relax', '#d8cfc0'], acqua: ['Acqua', '#8fb8d0'], edificio: ['Edificio', '#9a9a9a'], pavimentato: ['Pavimentato', '#c8c3b8'], bosco: ['Boschetto', '#6f9a6a'] };
const DECO = { panchina: '🪑', fontana: '⛲', lampione: '💡', pergola: '🏛️', compost: '♻️', casetta: '🏠', nido: '🐦', arnia: '🐝', cisterna: '🛢️', gioco: '🛝' };
const CAT_COLOR = { alberi: '#3f7d4a', frutto: '#b5562f', arbusti: '#6c9a5a', fiori: '#c25d8a', vaso: '#8a6fb0', orto: '#c79a3a', prato: '#8fbf7f' };
const POLLINATOR_FAM = ['Lamiaceae', 'Asteraceae', 'Rosaceae', 'Fabaceae', 'Boraginaceae', 'Apiaceae', 'Malvaceae', 'Lythraceae', 'Scrophulariaceae', 'Viburnaceae', 'Ericaceae', 'Brassicaceae'];

const maxNum = (s) => { const n = String(s || '').replace(',', '.').match(/\d+(\.\d+)?/g); return n ? Math.max(...n.map(Number)) : null; };
export const matureDiameter = (sp) => { if (!sp) return 1; if (sp.cat === 'prato') return 0.5; const w = maxNum(sp.size?.w); const h = maxNum(sp.size?.h); return Math.max(0.3, Math.min(20, w || (h ? h * 0.6 : 1))); };

export async function render(host) {
  // contenitore proprio: i listener non si accumulano sul #view condiviso tra le pagine
  const view = document.createElement('div');
  host.appendChild(view);
  const gid = state.garden.id;
  const species = await allSpecies();
  const spMap = Object.fromEntries(species.map(s => [s.id, s]));
  let designs = (await db.byIndex('designs', 'gardenId', gid)).sort((a, b) => a.created.localeCompare(b.created));
  let cur = designs.find(d => d.id === sessionStorage.getItem('designId')) || designs[0] || null;
  const ui = { tool: 'select', sel: null, zoneType: 'aiuola', deco: 'panchina', speciesId: '', pathPts: null };

  const shell = () => {
    view.innerHTML = `
    <div class="row between" style="margin-bottom:12px">
      <div class="row"><select id="dSel" aria-label="Ipotesi progettuale">${designs.map(d => `<option value="${d.id}" ${d.id === cur?.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('') || '<option>Nessun progetto</option>'}</select>
        <button id="dNew" class="primary">+ Nuova ipotesi</button>${cur ? '<button id="dDup">Duplica</button><button id="dRen">Rinomina</button><button id="dDel" class="danger">Elimina</button>' : ''}</div>
      <div class="row">${designs.length >= 2 ? '<button id="dCmp">⚖️ Confronta ipotesi</button>' : ''}${cur ? '<button id="dExp">⬇️ SVG</button>' : ''}</div>
    </div>
    ${cur ? `<div class="designer"><div>
        <div class="toolbar" id="tools">
          ${[['select', '👆 Seleziona'], ['zone', '▭ Zona'], ['path', '〰️ Percorso'], ['plant', '🌳 Pianta'], ['deco', '⭐ Elemento']].map(([k, l]) => `<button data-tool="${k}" class="small ${ui.tool === k ? 'on' : ''}">${l}</button>`).join('')}
          <button class="small" id="importPlants" title="Inserisce le piante del giardino non ancora posizionate">⤵ Piante del giardino</button>
        </div>
        <div id="toolOpts" class="row" style="margin-bottom:8px;min-height:42px"></div>
        <div class="canvas-wrap"><svg id="plan" xmlns="http://www.w3.org/2000/svg"></svg></div>
        <small class="muted">Dimensioni ${cur.w} × ${cur.h} m · griglia 1 m. Trascina per spostare; usa il pannello per modificare.</small>
      </div>
      <div class="stack"><div class="card" id="props"></div><div class="card" id="checksBox"></div><div class="card"><h3>Legenda</h3><ul class="list legend" id="legend"></ul></div></div></div>
      <div class="card" style="margin-top:14px" id="aiBox"></div>`
    : '<div class="empty">Crea una prima ipotesi progettuale: imposta le dimensioni del giardino e disegna zone, percorsi e piante.</div>'}`;
    $('#dNew', view).onclick = newDesign;
    if (!cur) return;
    $('#dSel', view).onchange = (e) => { cur = designs.find(d => d.id === e.target.value); sessionStorage.setItem('designId', cur.id); ui.sel = null; shell(); };
    $('#dDup', view).onclick = async () => { const c = JSON.parse(JSON.stringify(cur)); c.id = uid(); c.name = cur.name + ' (variante)'; c.created = new Date().toISOString(); await db.put('designs', c); designs.push(c); cur = c; sessionStorage.setItem('designId', c.id); shell(); };
    $('#dRen', view).onclick = () => { const n = prompt('Nome dell\'ipotesi', cur.name); if (n) { cur.name = n.trim(); save(); shell(); } };
    $('#dDel', view).onclick = async () => { if (!await confirmDialog(`Eliminare "${cur.name}"?`, 'Elimina', true)) return; await db.del('designs', cur.id); designs = designs.filter(d => d.id !== cur.id); cur = designs[0] || null; shell(); };
    const cmp = $('#dCmp', view); if (cmp) cmp.onclick = compare;
    $('#dExp', view).onclick = () => downloadFile(`${cur.name}.svg`, svgMarkup(cur, null, true), 'image/svg+xml');
    $$('[data-tool]', view).forEach(b => b.onclick = () => { ui.tool = b.dataset.tool; ui.pathPts = null; $$('[data-tool]', view).forEach(x => x.classList.toggle('on', x === b)); toolOpts(); });
    $('#importPlants', view).onclick = importPlants;
    toolOpts(); redraw(); aiBox();
  };

  const save = async () => { cur.updated = new Date().toISOString(); await db.put('designs', cur); };
  const newDesign = () => {
    const m = modal({ title: 'Nuova ipotesi progettuale', body: `<div class="form-grid"><div class="field full"><label for="nN">Nome</label><input id="nN" type="text" value="Ipotesi ${designs.length + 1}"></div>
      <div class="field"><label for="nW">Larghezza (m)</label><input id="nW" type="number" min="3" max="300" value="${Math.round(Math.sqrt(state.garden.area || 200) * 1.3) || 20}"></div>
      <div class="field"><label for="nH">Profondità (m)</label><input id="nH" type="number" min="3" max="300" value="${Math.round((state.garden.area || 200) / (Math.sqrt(state.garden.area || 200) * 1.3)) || 12}"></div>
      <div class="field"><label for="nNorth">Il nord è…</label><select id="nNorth">${options([['top', 'in alto'], ['bottom', 'in basso'], ['left', 'a sinistra'], ['right', 'a destra']], 'top')}</select></div></div>`,
      foot: '<button data-close>Annulla</button><button class="primary" data-ok>Crea</button>' });
    $('[data-ok]', m.el).onclick = async () => {
      const d = { id: uid(), gardenId: gid, name: $('#nN', m.el).value.trim() || 'Ipotesi', w: Math.max(3, +$('#nW', m.el).value || 20), h: Math.max(3, +$('#nH', m.el).value || 12), north: $('#nNorth', m.el).value, items: [], created: new Date().toISOString() };
      await db.put('designs', d); designs.push(d); cur = d; sessionStorage.setItem('designId', d.id); m.close(); shell();
    };
  };

  const toolOpts = () => {
    const box = $('#toolOpts', view);
    if (ui.tool === 'zone') box.innerHTML = `<label style="margin:0">Tipo</label><select id="zt">${options(Object.entries(ZONES).map(([k, v]) => [k, v[0]]), ui.zoneType)}</select><small>Trascina sulla planimetria per disegnare.</small>`;
    else if (ui.tool === 'deco') box.innerHTML = `<label style="margin:0">Elemento</label><select id="dt">${options(Object.entries(DECO).map(([k, v]) => [k, v + ' ' + k]), ui.deco)}</select><small>Tocca per posizionare.</small>`;
    else if (ui.tool === 'plant') box.innerHTML = `<input type="search" id="spq" placeholder="Cerca specie…" style="max-width:160px"><select id="sps" style="max-width:240px">${options(species.filter(s => s.cat !== 'prato').sort((a, b) => a.it.localeCompare(b.it, 'it')).map(s => [s.id, `${s.it} (Ø ${matureDiameter(s)} m)`]), ui.speciesId)}</select><small>Tocca per piantare: il cerchio è la chioma a maturità.</small>`;
    else if (ui.tool === 'path') box.innerHTML = `<small>Tocca per aggiungere punti.</small><button class="small" id="pathEnd">Termina percorso</button>`;
    else box.innerHTML = '<small>Seleziona un elemento per modificarlo o trascinarlo.</small>';
    const zt = $('#zt', box); if (zt) zt.onchange = e => ui.zoneType = e.target.value;
    const dt = $('#dt', box); if (dt) dt.onchange = e => ui.deco = e.target.value;
    const sps = $('#sps', box); if (sps) { ui.speciesId = sps.value; sps.onchange = e => ui.speciesId = e.target.value; }
    const spq = $('#spq', box); if (spq) spq.oninput = () => { const q = spq.value.toLowerCase(); [...sps.options].forEach(o => o.hidden = q && !o.text.toLowerCase().includes(q)); const first = [...sps.options].find(o => !o.hidden); if (first) { sps.value = first.value; ui.speciesId = first.value; } };
    const pe = $('#pathEnd', box); if (pe) pe.onclick = finishPath;
  };
  const finishPath = async () => { if (ui.pathPts && ui.pathPts.length >= 2) { const it = { id: uid(), kind: 'path', points: ui.pathPts, width: 1, label: 'Percorso' }; cur.items.push(it); ui.sel = it.id; await save(); } ui.pathPts = null; redraw(); };

  const importPlants = async () => {
    const plants = await gardenPlants();
    const placed = new Set(cur.items.filter(i => i.plantId).map(i => i.plantId));
    let x = 1, y = 1, n = 0;
    for (const p of plants) {
      if (placed.has(p.id)) continue;
      const s = spMap[p.speciesId] || await getSpecies(p.speciesId);
      if (!s || s.cat === 'prato') continue;
      const d = p.width || matureDiameter(s);
      cur.items.push({ id: uid(), kind: 'plant', plantId: p.id, speciesId: s.id, label: p.name, x: Math.min(cur.w - 0.5, x + d / 2), y: Math.min(cur.h - 0.5, y + d / 2), d, existing: true });
      x += d + 0.5; if (x > cur.w - 2) { x = 1; y += 3; } n++;
    }
    await save(); redraw(); toast(n ? `${n} piante inserite: spostale nella posizione reale` : 'Tutte le piante sono già nella planimetria');
  };

  // ── Disegno SVG ──
  const redraw = () => {
    const svg = $('#plan', view);
    if (!svg) return;
    svg.setAttribute('viewBox', `-0.5 -0.5 ${cur.w + 1} ${cur.h + 1}`);
    svg.innerHTML = svgMarkup(cur, ui.sel, false, ui.pathPts);
    props(); legend(); checksPanel();
  };
  function svgMarkup(d, sel, standalone = false, pathPts = null) {
    const grid = [];
    for (let i = 0; i <= d.w; i++) grid.push(`<line x1="${i}" y1="0" x2="${i}" y2="${d.h}" stroke="currentColor" stroke-opacity="${i % 5 ? 0.08 : 0.18}" stroke-width="0.03"/>`);
    for (let j = 0; j <= d.h; j++) grid.push(`<line x1="0" y1="${j}" x2="${d.w}" y2="${j}" stroke="currentColor" stroke-opacity="${j % 5 ? 0.08 : 0.18}" stroke-width="0.03"/>`);
    const fs = Math.max(0.35, Math.min(d.w, d.h) / 40);
    const it = d.items.map(i => {
      const isSel = i.id === sel;
      const stroke = isSel ? 'stroke="#d97706" stroke-width="0.12"' : '';
      if (i.kind === 'zone') { const [n, c] = ZONES[i.zoneType] || ['', '#ccc']; return `<g data-id="${i.id}"><rect x="${i.x}" y="${i.y}" width="${i.w}" height="${i.h}" fill="${c}" fill-opacity="0.55" rx="0.15" ${stroke || 'stroke="#6b6250" stroke-width="0.04"'}/>${i.sun ? `<text x="${i.x + 0.2}" y="${i.y + fs + 0.1}" font-size="${fs * 0.9}">${i.sun === 'sole' ? '☀️' : i.sun === 'ombra' ? '🌑' : '⛅'}</text>` : ''}<text x="${i.x + i.w / 2}" y="${i.y + i.h / 2}" font-size="${fs}" text-anchor="middle" fill="#2c2a22" opacity="0.8">${esc(i.label || n)}</text>${isSel ? `<rect data-handle="${i.id}" x="${i.x + i.w - 0.35}" y="${i.y + i.h - 0.35}" width="0.7" height="0.7" fill="#d97706" style="cursor:nwse-resize"/>` : ''}</g>`; }
      if (i.kind === 'path') return `<g data-id="${i.id}"><polyline points="${i.points.map(p => p.join(',')).join(' ')}" fill="none" stroke="${isSel ? '#d97706' : '#cdb991'}" stroke-width="${i.width || 1}" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/><polyline points="${i.points.map(p => p.join(',')).join(' ')}" fill="none" stroke="#8a7550" stroke-width="0.04" stroke-dasharray="0.2 0.2"/></g>`;
      if (i.kind === 'plant') { const s = spMap[i.speciesId]; const col = CAT_COLOR[s?.cat] || '#6c9a5a'; return `<g data-id="${i.id}"><circle cx="${i.x}" cy="${i.y}" r="${i.d / 2}" fill="${col}" fill-opacity="${i.existing ? 0.5 : 0.32}" stroke="${isSel ? '#d97706' : col}" stroke-width="${isSel ? 0.12 : 0.05}" ${i.existing ? '' : 'stroke-dasharray="0.25 0.15"'}/><circle cx="${i.x}" cy="${i.y}" r="0.12" fill="${col}"/><text x="${i.x}" y="${i.y + Math.min(i.d / 2, 1) + fs}" font-size="${fs * 0.85}" text-anchor="middle" fill="currentColor">${esc((i.label || s?.it || '').slice(0, 18))}</text></g>`; }
      if (i.kind === 'deco') return `<g data-id="${i.id}"><text x="${i.x}" y="${i.y}" font-size="${fs * 2}" text-anchor="middle" dominant-baseline="middle">${DECO[i.deco] || '⭐'}</text>${isSel ? `<circle cx="${i.x}" cy="${i.y}" r="${fs * 1.2}" fill="none" stroke="#d97706" stroke-width="0.1"/>` : ''}</g>`;
      return '';
    }).join('');
    const pend = pathPts ? `<polyline points="${pathPts.map(p => p.join(',')).join(' ')}" fill="none" stroke="#d97706" stroke-width="0.15" stroke-dasharray="0.3 0.2"/>${pathPts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="0.15" fill="#d97706"/>`).join('')}` : '';
    const arrow = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] }[d.north || 'top'];
    const nx = d.w - 1, ny = 1.2;
    const north = `<g opacity="0.8"><line x1="${nx}" y1="${ny}" x2="${nx + arrow[0] * 0.8}" y2="${ny + arrow[1] * 0.8}" stroke="currentColor" stroke-width="0.08"/><text x="${nx + arrow[0] * 1.2}" y="${ny + arrow[1] * 1.2 + 0.15}" font-size="${fs}" text-anchor="middle" fill="currentColor">N</text></g>`;
    const inner = `<rect x="0" y="0" width="${d.w}" height="${d.h}" fill="#eef3e6" fill-opacity="0.35" stroke="currentColor" stroke-width="0.06"/>${grid.join('')}${it}${pend}${north}`;
    return standalone ? `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="-0.5 -0.5 ${d.w + 1} ${d.h + 1}" width="${(d.w + 1) * 40}" height="${(d.h + 1) * 40}" style="color:#2c3a2a;font-family:sans-serif">${inner}</svg>` : inner;
  }

  // ── Interazione ──
  let drag = null;
  const pt = (e) => { const svg = $('#plan', view); const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; const r = p.matrixTransform(svg.getScreenCTM().inverse()); return [Math.round(Math.max(0, Math.min(cur.w, r.x)) * 10) / 10, Math.round(Math.max(0, Math.min(cur.h, r.y)) * 10) / 10]; };
  view.addEventListener('pointerdown', (e) => {
    const svg = e.target.closest('#plan'); if (!svg) return;
    const [x, y] = pt(e);
    const handle = e.target.closest('[data-handle]');
    const g = e.target.closest('[data-id]');
    if (ui.tool === 'select') {
      if (handle) { drag = { mode: 'resize', id: handle.dataset.handle }; }
      else if (g) { ui.sel = g.dataset.id; const it = cur.items.find(i => i.id === ui.sel); drag = { mode: 'move', id: ui.sel, sx: x, sy: y, orig: JSON.parse(JSON.stringify(it)) }; redraw(); }
      else { ui.sel = null; redraw(); }
    } else if (ui.tool === 'zone') { const it = { id: uid(), kind: 'zone', zoneType: ui.zoneType, x, y, w: 0.1, h: 0.1, sun: '' }; cur.items.push(it); ui.sel = it.id; drag = { mode: 'create', id: it.id, sx: x, sy: y }; }
    else if (ui.tool === 'plant') { const s = spMap[ui.speciesId]; if (!s) return toast('Scegli una specie'); const it = { id: uid(), kind: 'plant', speciesId: s.id, label: s.it, x, y, d: matureDiameter(s), existing: false }; cur.items.push(it); ui.sel = it.id; save(); redraw(); }
    else if (ui.tool === 'deco') { const it = { id: uid(), kind: 'deco', deco: ui.deco, x, y, label: ui.deco }; cur.items.push(it); ui.sel = it.id; save(); redraw(); }
    else if (ui.tool === 'path') { ui.pathPts = [...(ui.pathPts || []), [x, y]]; redraw(); }
    if (drag) { svg.setPointerCapture(e.pointerId); e.preventDefault(); }
  });
  view.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const [x, y] = pt(e);
    const it = cur.items.find(i => i.id === drag.id); if (!it) return;
    if (drag.mode === 'create') { it.x = Math.min(x, drag.sx); it.y = Math.min(y, drag.sy); it.w = Math.max(0.2, Math.abs(x - drag.sx)); it.h = Math.max(0.2, Math.abs(y - drag.sy)); }
    else if (drag.mode === 'resize') { it.w = Math.max(0.3, Math.round((x - it.x) * 10) / 10); it.h = Math.max(0.3, Math.round((y - it.y) * 10) / 10); }
    else { const dx = x - drag.sx, dy = y - drag.sy; if (it.kind === 'path') it.points = drag.orig.points.map(p => [Math.round((p[0] + dx) * 10) / 10, Math.round((p[1] + dy) * 10) / 10]); else { it.x = Math.round((drag.orig.x + dx) * 10) / 10; it.y = Math.round((drag.orig.y + dy) * 10) / 10; } }
    $('#plan', view).innerHTML = svgMarkup(cur, ui.sel, false, ui.pathPts);
  });
  view.addEventListener('pointerup', async () => { if (!drag) return; const d = drag; drag = null; if (d.mode === 'create') { const it = cur.items.find(i => i.id === d.id); if (it.w < 0.5 || it.h < 0.5) { it.w = Math.max(it.w, 2); it.h = Math.max(it.h, 2); } ui.tool = 'select'; $$('[data-tool]', view).forEach(x => x.classList.toggle('on', x.dataset.tool === 'select')); toolOpts(); } await save(); redraw(); });
  view.addEventListener('dblclick', (e) => { if (ui.tool === 'path' && e.target.closest('#plan')) finishPath(); });

  // ── Pannelli ──
  const props = () => {
    const box = $('#props', view); const it = cur.items.find(i => i.id === ui.sel);
    if (!it) { box.innerHTML = `<h3>Proprietà</h3><small>Nessun elemento selezionato. Elementi: ${cur.items.length}.</small>`; return; }
    const s = spMap[it.speciesId];
    box.innerHTML = `<h3>${it.kind === 'zone' ? 'Zona' : it.kind === 'plant' ? 'Pianta' : it.kind === 'path' ? 'Percorso' : 'Elemento'}</h3>
      <div class="field"><label for="pLabel">Etichetta</label><input id="pLabel" type="text" value="${esc(it.label || '')}"></div>
      ${it.kind === 'zone' ? `<div class="field"><label for="pZt">Tipo</label><select id="pZt">${options(Object.entries(ZONES).map(([k, v]) => [k, v[0]]), it.zoneType)}</select></div>
        <div class="field"><label for="pSun">Esposizione della zona</label><select id="pSun">${options([['', 'non indicata'], ['sole', 'sole pieno'], ['mezzombra', 'mezz\'ombra'], ['ombra', 'ombra']], it.sun || '')}</select></div>
        <div class="row"><div class="field"><label for="pW">L (m)</label><input id="pW" type="number" step="0.1" value="${it.w}" style="width:80px"></div><div class="field"><label for="pH">P (m)</label><input id="pH" type="number" step="0.1" value="${it.h}" style="width:80px"></div></div><small>Superficie ${(it.w * it.h).toFixed(1)} m²</small>` : ''}
      ${it.kind === 'plant' ? `<p><small><i>${esc(s?.sci || '')}</i><br>Maturità: ${esc(s?.size?.h || '?')} × ${esc(s?.size?.w || '?')} · acqua ${esc(s?.water || '?')} · ${esc(s?.sun || '')}</small></p>
        <div class="field"><label for="pD">Diametro chioma a maturità (m)</label><input id="pD" type="number" step="0.1" min="0.2" value="${it.d}"></div>
        <label style="font-weight:400;display:flex;gap:8px;align-items:center"><input type="checkbox" id="pEx" ${it.existing ? 'checked' : ''}> Pianta già presente</label>` : ''}
      ${it.kind === 'path' ? `<div class="field"><label for="pPw">Larghezza (m)</label><input id="pPw" type="number" step="0.1" min="0.3" value="${it.width || 1}"></div><small>Lunghezza ${pathLen(it).toFixed(1)} m</small>` : ''}
      <div class="row" style="margin-top:8px"><button class="small danger" id="pDel">Elimina</button><button class="small" id="pCopy">Duplica</button></div>`;
    const bind = (sel, fn) => { const el = $(sel, box); if (el) el.onchange = async () => { fn(el); await save(); redraw(); }; };
    bind('#pLabel', el => it.label = el.value); bind('#pZt', el => it.zoneType = el.value); bind('#pSun', el => it.sun = el.value);
    bind('#pW', el => it.w = Math.max(0.3, +el.value)); bind('#pH', el => it.h = Math.max(0.3, +el.value)); bind('#pD', el => it.d = Math.max(0.2, +el.value));
    bind('#pEx', el => it.existing = el.checked); bind('#pPw', el => it.width = Math.max(0.3, +el.value));
    $('#pDel', box).onclick = async () => { cur.items = cur.items.filter(i => i.id !== it.id); ui.sel = null; await save(); redraw(); };
    $('#pCopy', box).onclick = async () => { const c = JSON.parse(JSON.stringify(it)); c.id = uid(); if (c.points) c.points = c.points.map(p => [p[0] + 1, p[1] + 1]); else { c.x += 1; c.y += 1; } cur.items.push(c); ui.sel = c.id; await save(); redraw(); };
  };
  const legend = () => {
    const counts = {};
    for (const i of cur.items.filter(i => i.kind === 'plant')) counts[i.speciesId] = (counts[i.speciesId] || 0) + 1;
    const zones = [...new Set(cur.items.filter(i => i.kind === 'zone').map(i => i.zoneType))];
    $('#legend', view).innerHTML = Object.entries(counts).map(([id, n]) => `<li><i style="background:${CAT_COLOR[spMap[id]?.cat] || '#6c9a5a'}"></i>${esc(spMap[id]?.it || id)} ×${n} <small class="sci">${esc(spMap[id]?.sci?.split(' ').slice(0, 2).join(' ') || '')}</small></li>`).join('') +
      zones.map(z => `<li><i style="background:${ZONES[z][1]};border-radius:3px"></i>${ZONES[z][0]}</li>`).join('') || '<li><small>Vuota</small></li>';
  };
  const checksPanel = () => {
    const r = analyze(cur, spMap);
    $('#checksBox', view).innerHTML = `<h3>Verifiche botaniche</h3>
      ${r.warnings.length ? r.warnings.slice(0, 12).map(w => `<div class="alert warn" style="padding:6px 10px;margin-bottom:6px"><small>${esc(w)}</small></div>`).join('') : '<div class="alert ok" style="padding:6px 10px"><small>Nessun conflitto rilevato tra distanze, esposizione e fabbisogni idrici.</small></div>'}
      <div class="kpis" style="margin-top:8px;grid-template-columns:repeat(2,minmax(0,1fr))"><div class="kpi"><b>${r.speciesCount}</b><small>specie</small></div><div class="kpi"><b>${r.families}</b><small>famiglie</small></div><div class="kpi"><b>${r.pollinator}%</b><small>utili impollinatori</small></div><div class="kpi"><b>${r.native}%</b><small>autoctone</small></div></div>
      <p style="margin-top:8px"><small>Biodiversità: <b>${r.bioScore}/100</b> · manutenzione stimata: <b>${r.maintenance}</b> · acqua: ${r.water}</small></p>`;
  };

  // ── Confronto ──
  const compare = () => {
    const m = modal({ title: 'Confronta ipotesi', wide: true, body: `<div class="row" style="margin-bottom:10px"><select id="cA">${options(designs.map(d => [d.id, d.name]), designs[0].id)}</select><span>↔</span><select id="cB">${options(designs.map(d => [d.id, d.name]), designs[1].id)}</select></div><div id="cOut"></div>` });
    const draw = () => {
      const A = designs.find(d => d.id === $('#cA', m.el).value), B = designs.find(d => d.id === $('#cB', m.el).value);
      const ra = analyze(A, spMap), rb = analyze(B, spMap);
      const row = (l, a, b) => `<tr><th>${l}</th><td>${a}</td><td>${b}</td></tr>`;
      $('#cOut', m.el).innerHTML = `<div class="grid g2">${[A, B].map(d => `<div><b>${esc(d.name)}</b><div class="canvas-wrap"><svg viewBox="-0.5 -0.5 ${d.w + 1} ${d.h + 1}" style="color:var(--text)">${svgMarkup(d, null)}</svg></div></div>`).join('')}</div>
        <table style="margin-top:12px"><thead><tr><th></th><th>${esc(A.name)}</th><th>${esc(B.name)}</th></tr></thead><tbody>
        ${row('Piante', ra.plants, rb.plants)}${row('Specie', ra.speciesCount, rb.speciesCount)}${row('Famiglie', ra.families, rb.families)}${row('Utili agli impollinatori', ra.pollinator + '%', rb.pollinator + '%')}${row('Autoctone', ra.native + '%', rb.native + '%')}
        ${row('Punteggio biodiversità', ra.bioScore, rb.bioScore)}${row('Manutenzione', ra.maintenance, rb.maintenance)}${row('Fabbisogno idrico', ra.water, rb.water)}${row('Prato (m²)', ra.lawn, rb.lawn)}${row('Conflitti', ra.warnings.length, rb.warnings.length)}</tbody></table>`;
    };
    $('#cA', m.el).onchange = draw; $('#cB', m.el).onchange = draw; draw();
  };

  // ── Analisi AI ──
  const aiBox = () => {
    const box = $('#aiBox', view);
    const a = cur.ai;
    box.innerHTML = `<div class="card-head"><h2>✨ Analisi e proposte AI</h2>${a ? `<small>${new Date(a.date).toLocaleDateString('it-IT')}</small>` : ''}</div>
      ${hasAI() ? `<div class="form-grid"><div class="field full"><label>Obiettivi</label>${checks('goal', ['bassa manutenzione', 'impollinatori e biodiversità', 'ombra e frescura', 'siepe e privacy', 'colori e fioriture scalari', 'orto e frutti', 'risparmio idrico', 'zona relax', 'adatto a bambini e animali'], cur.goals || ['bassa manutenzione', 'impollinatori e biodiversità'])}</div>
        <div class="field full"><label for="aiNote">Note su zone e desideri</label><textarea id="aiNote" placeholder="Es. angolo nord-est in ombra sotto il noce, vorrei un percorso fino all'orto">${esc(cur.note || '')}</textarea></div>
        <div class="field full"><label>Foto del giardino (facoltative)</label>${photoInputHTML('aiPh')}</div></div><button class="primary" id="aiGo">Analizza e proponi</button>` : '<p class="muted">Inserisci la chiave API in Impostazioni per l\'analisi AI di foto, esposizione e piante esistenti.</p>'}
      <div id="aiRes" style="margin-top:12px">${a ? aiHTML(a.r) : ''}</div>`;
    if (!hasAI()) return;
    const ph = bindPhotoInput(box, 'aiPh', { max: 3 });
    $('#aiGo', box).onclick = async () => {
      cur.goals = $$('[name=goal]:checked', box).map(x => x.value); cur.note = $('#aiNote', box).value.trim(); await save();
      const res = $('#aiRes', box); res.innerHTML = loading('Analisi del sito e progettazione…');
      const plan = cur.items.map(i => i.kind === 'zone' ? `zona ${ZONES[i.zoneType]?.[0]} "${i.label || ''}" ${i.w}×${i.h} m a (${i.x},${i.y})${i.sun ? ', ' + i.sun : ''}` : i.kind === 'plant' ? `${i.existing ? 'pianta esistente' : 'pianta proposta'} ${spMap[i.speciesId]?.it} (Ø ${i.d} m) a (${i.x},${i.y})` : i.kind === 'path' ? `percorso lungo ${pathLen(i).toFixed(1)} m` : `elemento ${i.deco} a (${i.x},${i.y})`).join('; ');
      try {
        const imgs = await Promise.all(ph.blobs.map(async b => imageBlock(await blobToBase64(b))));
        const r = await callJSON({ system: 'Sei un garden designer e agronomo. Valuta sempre compatibilità botanica, dimensioni a maturità, sviluppo radicale, distanze di impianto (anche dai confini: art. 892 del Codice civile), esposizione, fabbisogno idrico e competizione tra piante. Preferisci specie adatte al clima locale, non invasive, utili alla biodiversità.',
          content: [...imgs, { type: 'text', text: `Planimetria "${cur.name}" ${cur.w}×${cur.h} m, nord ${({ top: 'in alto', bottom: 'in basso', left: 'a sinistra', right: 'a destra' })[cur.north || 'top']}. Coordinate in metri dall'angolo in alto a sinistra. Elementi: ${plan || 'nessuno'}.\nObiettivi: ${cur.goals.join(', ') || 'non indicati'}. Note: ${cur.note || '—'}.` }], schema: SCHEMA_DESIGN, maxTokens: 12000, effort: 'medium' });
        cur.ai = { date: new Date().toISOString(), r }; await save();
        res.innerHTML = aiHTML(r);
      } catch (e) { res.innerHTML = `<div class="alert danger">${esc(e.message)}</div>`; }
    };
  };
  const aiHTML = (r) => `<p>${esc(r.analisi)}</p>${r.proposte.map(p => `<div class="card" style="box-shadow:none;margin-top:10px"><b>${esc(p.titolo)}</b> <span class="chip">manutenzione ${esc(p.manutenzione)}</span><br><small>${esc(p.zona)}</small><p>${esc(p.descrizione)}</p>
      <div class="table-wrap"><table><thead><tr><th>Pianta</th><th>N.</th><th>Distanza</th><th>Maturità</th><th>Ruolo</th><th>Compatibilità</th></tr></thead><tbody>${p.piante.map(x => `<tr><td>${esc(x.nome)}<br><i class="sci"><small>${esc(x.nome_scientifico)}</small></i></td><td>${x.quantita}</td><td>${x.distanza_impianto_m} m</td><td><small>${esc(x.dimensione_maturita)}</small></td><td><small>${esc(x.motivo)}</small></td><td><small>${esc(x.compatibilita)} · acqua ${esc(x.fabbisogno_idrico)}</small></td></tr>`).join('')}</tbody></table></div></div>`).join('')}
    <p style="margin-top:10px"><b>Abbinamenti cromatici:</b> ${esc(r.abbinamenti_cromatici)}</p><p><b>Biodiversità:</b> ${esc(r.biodiversita)}</p>${r.avvertenze.length ? `<div class="alert warn">${r.avvertenze.map(esc).join('<br>')}</div>` : ''}`;

  shell();
}

const pathLen = (p) => p.points.reduce((a, pt, i) => i ? a + Math.hypot(pt[0] - p.points[i - 1][0], pt[1] - p.points[i - 1][1]) : 0, 0);

// Verifiche: sovrapposizione delle chiome a maturità, esposizione, acqua, distanze da edifici
export function analyze(d, spMap) {
  const plants = d.items.filter(i => i.kind === 'plant');
  const zones = d.items.filter(i => i.kind === 'zone');
  const warnings = [];
  const zoneOf = (p) => zones.filter(z => p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h);
  for (let i = 0; i < plants.length; i++) for (let j = i + 1; j < plants.length; j++) {
    const a = plants[i], b = plants[j];
    const dist = Math.hypot(a.x - b.x, a.y - b.y), need = (a.d + b.d) / 2;
    const sa = spMap[a.speciesId], sb = spMap[b.speciesId];
    const hedge = (s) => (s?.subs || []).includes('Siepi');
    if (dist < need * (hedge(sa) && hedge(sb) ? 0.4 : 0.75)) warnings.push(`${a.label || sa?.it} e ${b.label || sb?.it} sono a ${dist.toFixed(1)} m: a maturità le chiome (Ø ${a.d} e ${b.d} m) si sovrapporranno. Distanza consigliata ≥ ${(need * 0.85).toFixed(1)} m.`);
  }
  for (const p of plants) {
    const s = spMap[p.speciesId]; if (!s) continue;
    const zs = zoneOf(p);
    const sunNeed = (s.sun || '').toLowerCase();
    for (const z of zs) {
      if (z.sun === 'ombra' && sunNeed.startsWith('pieno sole')) warnings.push(`${p.label || s.it} richiede pieno sole ma è in una zona d'ombra.`);
      if (z.sun === 'sole' && /^(mezz'ombra|ombra|luce)/.test(sunNeed)) warnings.push(`${p.label || s.it} preferisce ${s.sun.toLowerCase()} ma è in una zona in pieno sole.`);
      if (z.zoneType === 'edificio' || z.zoneType === 'acqua' || z.zoneType === 'pavimentato') warnings.push(`${p.label || s.it} è posizionata su una zona "${ZONES[z.zoneType][0]}".`);
    }
    if (p.x - p.d / 2 < 0 || p.y - p.d / 2 < 0 || p.x + p.d / 2 > d.w || p.y + p.d / 2 > d.h) warnings.push(`La chioma di ${p.label || s.it} a maturità supera il confine: verifica le distanze legali (art. 892 c.c.: 3 m per alberi d'alto fusto, 1,5 m per non d'alto fusto, 0,5 m per arbusti e siepi, salvo regolamenti locali).`);
    if (['alberi', 'frutto'].includes(s.cat) && p.d >= 5) for (const z of zones.filter(z => z.zoneType === 'edificio')) {
      const dx = Math.max(z.x - p.x, 0, p.x - (z.x + z.w)), dy = Math.max(z.y - p.y, 0, p.y - (z.y + z.h));
      if (Math.hypot(dx, dy) < Math.max(3, p.d / 2)) warnings.push(`${p.label || s.it} è a ${Math.hypot(dx, dy).toFixed(1)} m da un edificio: rischio per radici e fondazioni, chioma a ridosso del muro.`);
    }
  }
  for (const z of zones.filter(z => ['aiuola', 'orto'].includes(z.zoneType))) {
    const ws = [...new Set(plants.filter(p => zoneOf(p).includes(z)).map(p => spMap[p.speciesId]?.water).filter(Boolean))];
    if (ws.includes('bassa') && (ws.includes('alta') || ws.includes('media-alta'))) warnings.push(`Nella zona "${z.label || ZONES[z.zoneType][0]}" convivono piante con fabbisogno idrico basso e alto: raggruppale per esigenza (idrozone).`);
  }
  const sp = [...new Set(plants.map(p => p.speciesId))].map(id => spMap[id]).filter(Boolean);
  const fams = new Set(sp.map(s => s.fam).filter(Boolean));
  const pollinator = sp.length ? Math.round(sp.filter(s => POLLINATOR_FAM.includes(s.fam)).length / sp.length * 100) : 0;
  const native = sp.length ? Math.round(sp.filter(s => (s.subs || []).includes('Autoctoni') || /autocton|Italia|Mediterrane|Europa/i.test(s.origin || '')).length / sp.length * 100) : 0;
  const lawn = zones.filter(z => z.zoneType === 'prato').reduce((a, z) => a + z.w * z.h, 0);
  const area = d.w * d.h;
  const bioScore = Math.min(100, Math.round(Math.min(sp.length, 15) * 2.5 + Math.min(fams.size, 10) * 2 + pollinator * 0.2 + native * 0.15 + (d.items.some(i => ['nido', 'arnia', 'compost'].includes(i.deco)) ? 5 : 0) + (zones.some(z => ['bosco', 'acqua'].includes(z.zoneType)) ? 5 : 0) - Math.max(0, lawn / area - 0.5) * 20));
  const maintPts = plants.reduce((a, p) => a + ({ fiori: 2, orto: 3, vaso: 2, frutto: 2 }[spMap[p.speciesId]?.cat] || 1), 0) / Math.max(1, area / 20) + lawn / Math.max(1, area) * 3;
  const maintenance = maintPts < 2 ? 'bassa' : maintPts < 5 ? 'media' : 'alta';
  const wcount = { bassa: 0, media: 0, alta: 0 };
  for (const p of plants) { const w = spMap[p.speciesId]?.water || 'media'; wcount[w.includes('alta') ? 'alta' : w.includes('bassa') ? 'bassa' : 'media']++; }
  const water = plants.length ? `${Math.round(wcount.bassa / plants.length * 100)}% bassa · ${Math.round(wcount.alta / plants.length * 100)}% alta` : '—';
  return { warnings: [...new Set(warnings)], plants: plants.length, speciesCount: sp.length, families: fams.size, pollinator, native, bioScore: Math.max(0, bioScore), maintenance, water, lawn: Math.round(lawn) };
}
