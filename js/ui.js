import { db, uid } from './db.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
export const MONTHS_SHORT = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
export const DOW = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

export function todayISO(d = new Date()) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}
export function addDays(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return todayISO(d); }
export function diffDays(a, b) { return Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 86400000); }
export function fmtDate(iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  return isNaN(d) ? iso : d.toLocaleDateString('it-IT', opts);
}
export function relDay(iso) {
  const n = diffDays(iso, todayISO());
  if (n === 0) return 'oggi';
  if (n === 1) return 'domani';
  if (n === -1) return 'ieri';
  if (n < 0) return `${-n} giorni fa`;
  if (n < 7) return `tra ${n} giorni`;
  return fmtDate(iso, { day: 'numeric', month: 'short' });
}

export function toast(msg, ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  document.getElementById('toastRoot').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// Modale: restituisce { el, close }. content = stringa HTML.
export function modal({ title, body, foot = '', wide = false, onClose }) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Chiudi">✕</button></div>
    <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  back.addEventListener('click', e => { if (e.target === back || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.getElementById('modalRoot').appendChild(back);
  const first = back.querySelector('input,select,textarea');
  if (first && window.innerWidth > 600) first.focus();
  return { el: back, close };
}
export function confirmDialog(text, okLabel = 'Conferma', danger = false) {
  return new Promise(res => {
    const m = modal({ title: 'Conferma', body: `<p>${esc(text)}</p>`, foot: `<button data-close>Annulla</button><button class="${danger ? 'danger' : 'primary'}" data-ok>${esc(okLabel)}</button>`, onClose: () => res(false) });
    m.el.querySelector('[data-ok]').onclick = () => { res(true); m.el.remove(); };
  });
}

export function loading(text = 'Elaborazione in corso…') { return `<div class="loading"><span class="spinner"></span>${esc(text)}</div>`; }

// Legge i valori di un form come oggetto (checkbox multipli -> array)
export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') {
      if (form.querySelectorAll(`[name="${el.name}"]`).length > 1) { out[el.name] = out[el.name] || []; if (el.checked) out[el.name].push(el.value); }
      else out[el.name] = el.checked;
    } else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else if (el.type === 'number') out[el.name] = el.value === '' ? null : Number(el.value);
    else if (el.type !== 'file') out[el.name] = el.value.trim();
  }
  return out;
}
export const opt = (value, label, sel) => `<option value="${esc(value)}" ${String(sel) === String(value) ? 'selected' : ''}>${esc(label)}</option>`;
export const options = (list, sel) => list.map(o => Array.isArray(o) ? opt(o[0], o[1], sel) : opt(o, o, sel)).join('');
export const checks = (name, list, selected = []) => `<div class="checks">${list.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<label><input type="checkbox" name="${name}" value="${esc(v)}" ${selected.includes(v) ? 'checked' : ''}>${esc(l)}</label>`; }).join('')}</div>`;

// Foto: ridimensiona a max 1280 px e comprime in JPEG (meno spazio e meno token AI)
export async function compressImage(file, max = 1280, quality = 0.82) {
  const bmp = await createImageBitmap(file).catch(async () => {
    const url = URL.createObjectURL(file);
    const img = new Image(); img.src = url; await img.decode(); return img;
  });
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, 'image/jpeg', quality));
}
export async function savePhoto(blob, meta = {}) {
  const p = { id: uid(), blob, date: new Date().toISOString(), ...meta };
  await db.put('photos', p);
  return p.id;
}
const urlCache = new Map();
export async function photoURL(id) {
  if (!id) return null;
  if (urlCache.has(id)) return urlCache.get(id);
  const p = await db.get('photos', id);
  if (!p || !p.blob) return null;
  const u = URL.createObjectURL(p.blob);
  urlCache.set(id, u);
  return u;
}
// Sostituisce gli <img data-photo="id"> con l'URL locale
export async function hydratePhotos(root) {
  for (const img of $$('img[data-photo]', root)) {
    const u = await photoURL(img.dataset.photo);
    if (u) img.src = u; else img.remove();
  }
}
export function blobToBase64(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
}

// Input foto riutilizzabile: restituisce HTML; con bindPhotoInput gestisce anteprime
export function photoInputHTML(id, { multiple = true, label = 'Scatta o carica foto' } = {}) {
  return `<div class="drop">
    <input type="file" id="${id}" accept="image/*" ${multiple ? 'multiple' : ''} hidden>
    <input type="file" id="${id}-cam" accept="image/*" capture="environment" hidden>
    <div class="row" style="justify-content:center">
      <button type="button" class="primary" data-pick="${id}-cam">📷 Scatta</button>
      <button type="button" data-pick="${id}">🖼️ ${esc(label)}</button>
    </div>
    <div class="preview-row" id="${id}-prev" style="margin-top:10px;justify-content:center"></div>
  </div>`;
}
export function bindPhotoInput(root, id, { max = 4 } = {}) {
  const state = { blobs: [] };
  const prev = $(`#${id}-prev`, root);
  const render = () => {
    prev.innerHTML = '';
    state.blobs.forEach((b, i) => {
      const img = document.createElement('img'); img.src = URL.createObjectURL(b); img.title = 'Tocca per rimuovere';
      img.onclick = () => { state.blobs.splice(i, 1); render(); };
      prev.appendChild(img);
    });
  };
  for (const btn of $$('[data-pick]', root)) if (btn.dataset.pick.startsWith(id)) btn.onclick = () => $('#' + btn.dataset.pick, root).click();
  for (const inp of [$('#' + id, root), $(`#${id}-cam`, root)]) {
    inp.onchange = async () => {
      for (const f of inp.files) { if (state.blobs.length >= max) break; state.blobs.push(await compressImage(f)); }
      inp.value = ''; render();
    };
  }
  return state;
}

export function confBar(pct) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  return `<div class="row" style="gap:8px"><div class="conf" style="flex:1"><i style="width:${p}%"></i></div><small>${p}%</small></div>`;
}
export function confLabel(pct) {
  if (pct >= 85) return '<span class="chip ok">affidabilità alta</span>';
  if (pct >= 60) return '<span class="chip warn">affidabilità media</span>';
  return '<span class="chip danger">affidabilità bassa — ipotesi</span>';
}
export function monthsBar(months = [], cls = 'on') {
  return `<div class="months">${MONTHS_SHORT.map((m, i) => `<span class="${months.includes(i + 1) ? cls : ''}">${m[0]}</span>`).join('')}</div>`;
}
// Testo semplice con a capo e **grassetto** — l'input viene prima sanificato
export function richText(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(https?:\/\/[^\s)<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}
