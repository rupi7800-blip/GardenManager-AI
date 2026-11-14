// Archivio botanico: specie curate + specie dell'utente + ricerca illimitata su GBIF
import { allSpecies, searchSpeciesLocal, CATEGORIES, saveSpecies, findSpeciesByName } from '../store.js';
import { esc, $, $$, loading, toast, options } from '../ui.js';
import { gbifSearch } from '../botany.js';
import { openPlantForm } from './plant-form.js';
import { go } from '../app.js';

export async function render(view, params, query) {
  const list = await allSpecies();
  const f = { q: query?.get('q') || '', cat: query?.get('cat') || '', sub: '' };
  view.innerHTML = `
  <div class="row" style="margin-bottom:12px">
    <input type="search" id="sq" placeholder="Nome comune, botanico o famiglia (es. fico, Ficus carica, Rosaceae)" value="${esc(f.q)}" style="flex:1;min-width:200px">
    <button id="newSp">➕ Nuova specie</button>
  </div>
  <div class="tabs" id="catTabs"><button data-cat="" class="${!f.cat ? 'on' : ''}">Tutte</button>${Object.entries(CATEGORIES).map(([k, v]) => `<button data-cat="${k}" class="${f.cat === k ? 'on' : ''}">${v.emoji} ${v.label}</button>`).join('')}</div>
  <div id="subTabs" class="tabs"></div>
  <div id="res"></div>
  <div class="card" style="margin-top:16px"><div class="card-head"><h2>🌍 Ricerca nel database mondiale (GBIF)</h2><small>oltre 350.000 specie vegetali accettate</small></div>
    <p class="muted">Non trovi una pianta nell'archivio? Cercala nel backbone tassonomico GBIF e aggiungila al tuo archivio: potrai generare la scheda botanica completa con l'AI.</p>
    <div class="row"><input type="search" id="gq" placeholder="Nome scientifico o comune" style="flex:1;min-width:180px"><button id="gBtn" class="primary">Cerca su GBIF</button></div>
    <div id="gRes" style="margin-top:10px"></div></div>`;

  const res = $('#res', view);
  const draw = () => {
    const subs = f.cat ? CATEGORIES[f.cat].subs : [];
    $('#subTabs', view).innerHTML = subs.length ? `<button data-sub="" class="small ${!f.sub ? 'on' : ''}">Tutte</button>` + subs.map(s => `<button class="small ${f.sub === s ? 'on' : ''}" data-sub="${esc(s)}">${esc(s)}</button>`).join('') : '';
    $$('[data-sub]', view).forEach(b => b.onclick = () => { f.sub = b.dataset.sub; draw(); });
    let items = searchSpeciesLocal(list, f.q, f.cat);
    if (f.sub) items = items.filter(s => (s.subs || []).includes(f.sub));
    res.innerHTML = items.length ? `<div class="grid auto">${items.map(s => `<div class="card pcard" data-sp="${esc(s.id)}">
        <div class="thumb">${s.emoji || CATEGORIES[s.cat]?.emoji || '🌿'}</div>
        <div class="body"><b>${esc(s.it)}</b><div class="sci">${esc(s.sci)}</div><small>${esc(s.fam || '')}</small>
          <div class="row" style="gap:6px;margin-top:6px">${(s.subs || []).slice(0, 2).map(x => `<span class="chip">${esc(x)}</span>`).join('')}${s.source !== 'curated' ? '<span class="chip sage">mia</span>' : ''}${s.aiSheet ? '<span class="badge-ai">AI</span>' : ''}</div>
          <div class="row" style="margin-top:8px"><button class="small primary" data-add="${esc(s.id)}">+ Al giardino</button></div></div></div>`).join('')}</div>`
      : `<div class="empty">Nessuna specie trovata in archivio${f.q ? ` per «${esc(f.q)}»` : ''}. Prova la ricerca GBIF qui sotto o crea una nuova specie.</div>`;
    $$('[data-sp]', res).forEach(c => c.onclick = (e) => { if (!e.target.closest('[data-add]')) go('#/specie/' + encodeURIComponent(c.dataset.sp)); });
    $$('[data-add]', res).forEach(b => b.onclick = () => openPlantForm({ speciesId: b.dataset.add, origin: 'archivio', onSaved: p => go('#/pianta/' + p.id) }));
  };
  $('#sq', view).oninput = (e) => { f.q = e.target.value; draw(); if (f.q.length > 2) $('#gq', view).value = f.q; };
  $$('[data-cat]', view).forEach(b => b.onclick = () => { f.cat = b.dataset.cat; f.sub = ''; $$('[data-cat]', view).forEach(x => x.classList.toggle('on', x === b)); draw(); });
  draw();

  $('#newSp', view).onclick = () => openPlantForm({ origin: 'manuale', onSaved: p => go('#/pianta/' + p.id) });

  const gsearch = async () => {
    const q = $('#gq', view).value.trim();
    if (q.length < 3) return toast('Scrivi almeno 3 lettere');
    const out = $('#gRes', view);
    out.innerHTML = loading('Ricerca su GBIF…');
    try {
      const r = await gbifSearch(q);
      out.innerHTML = r.length ? `<ul class="list">${r.map((x, i) => `<li><div class="grow"><i class="sci">${esc(x.sci)}</i>${x.vernacular ? ` — ${esc(x.vernacular)}` : ''}<br><small>${esc(x.family || '')} · <a href="https://www.gbif.org/species/${x.key}" target="_blank" rel="noopener">GBIF ${x.key}</a></small></div><button class="small" data-g="${i}">Aggiungi all'archivio</button></li>`).join('')}</ul>` : '<div class="empty">Nessuna specie trovata.</div>';
      $$('[data-g]', out).forEach(b => b.onclick = async () => {
        const x = r[+b.dataset.g];
        const exist = await findSpeciesByName(x.canonical);
        if (exist) { toast('Specie già in archivio'); go('#/specie/' + encodeURIComponent(exist.id)); return; }
        const s = await saveSpecies({ id: 'g-' + x.key, it: x.vernacular || x.canonical, sci: x.sci, fam: x.family, cat: guessCat(x.family), subs: [], tasks: [], problems: [], care: {}, gbifKey: x.key, source: 'gbif' });
        toast('Aggiunta all\'archivio: completa la scheda con l\'AI');
        go('#/specie/' + encodeURIComponent(s.id));
      });
    } catch (e) { out.innerHTML = `<div class="alert danger">${esc(e.message)}. Serve una connessione a Internet.</div>`; }
  };
  $('#gBtn', view).onclick = gsearch;
  $('#gq', view).addEventListener('keydown', e => { if (e.key === 'Enter') gsearch(); });
}
function guessCat(fam = '') {
  if (/Poaceae/.test(fam)) return 'prato';
  if (/Cactaceae|Crassulaceae|Aizoaceae/.test(fam)) return 'vaso';
  if (/Brassicaceae|Cucurbitaceae|Solanaceae|Apiaceae|Amaranthaceae/.test(fam)) return 'orto';
  if (/Fagaceae|Pinaceae|Betulaceae|Sapindaceae|Juglandaceae|Malvaceae|Ulmaceae|Salicaceae|Cupressaceae/.test(fam)) return 'alberi';
  return 'arbusti';
}
