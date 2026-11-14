import { esc, $, $$, loading, toast, photoInputHTML, bindPhotoInput, blobToBase64, confBar, confLabel } from '../ui.js';
import { callJSON, SCHEMA_IDENTIFY, imageBlock, hasAI } from '../ai.js';
import { webImages, sourceLinks, imagesHTML, gbifMatch } from '../botany.js';
import { findSpeciesByName, saveSpecies, CATEGORIES } from '../store.js';
import { openPlantForm } from './plant-form.js';
import { go } from '../app.js';

export async function render(view) {
  view.innerHTML = `
  ${hasAI() ? '' : '<div class="alert warn">Il riconoscimento da foto e da descrizione usa l\'AI: inserisci la tua chiave API Claude in <a href="#/impostazioni">Impostazioni</a>. Il confronto con le immagini online qui sotto funziona anche senza chiave.</div>'}
  <div class="tabs"><button class="on" data-m="foto">📷 Da fotografia</button><button data-m="desc">✍️ Da descrizione</button><button data-m="web">🔎 Confronto immagini</button></div>
  <div class="card" id="mFoto">
    <p class="muted">Carica fino a 4 foto della stessa pianta: <b>foglia</b> (fronte e retro), <b>fiore</b>, <b>frutto</b>, <b>corteccia</b>, <b>portamento</b>. Più organi = identificazione più affidabile.</p>
    ${photoInputHTML('recPh')}
    <div class="field" style="margin-top:12px"><label for="recNote">Informazioni utili (facoltative)</label><input id="recNote" type="text" placeholder="Es. alta 2 m, cresce in vaso, fiori profumati a maggio"></div>
    <button class="primary" id="recGo" ${hasAI() ? '' : 'disabled'}>Identifica</button>
  </div>
  <div class="card" id="mDesc" hidden>
    <div class="field"><label for="recDesc">Descrivi la pianta</label><textarea id="recDesc" rows="4" placeholder="Es. Albero alto circa 5 metri, foglie ovali, corteccia grigia, frutti piccoli rossi in autunno."></textarea>
      <div class="hint">Indica altezza e portamento, forma e disposizione delle foglie, colore e periodo dei fiori, frutti, corteccia, sempreverde o caducifoglia, dove cresce.</div></div>
    <button class="primary" id="descGo" ${hasAI() ? '' : 'disabled'}>Proponi le specie probabili</button>
  </div>
  <div class="card" id="mWeb" hidden>
    <div class="row"><input type="search" id="webQ" placeholder="Nome scientifico (es. Arbutus unedo)" style="flex:1;min-width:180px"><button class="primary" id="webGo">Cerca immagini</button></div>
    <div id="webRes" style="margin-top:12px"></div>
  </div>
  <div id="recOut" style="margin-top:14px"></div>`;

  $$('[data-m]', view).forEach(b => b.onclick = () => {
    $$('[data-m]', view).forEach(x => x.classList.toggle('on', x === b));
    $('#mFoto', view).hidden = b.dataset.m !== 'foto'; $('#mDesc', view).hidden = b.dataset.m !== 'desc'; $('#mWeb', view).hidden = b.dataset.m !== 'web';
    $('#recOut', view).innerHTML = '';
  });
  const ph = bindPhotoInput(view, 'recPh', { max: 4 });
  const out = $('#recOut', view);

  $('#recGo', view).onclick = async () => {
    if (!ph.blobs.length) return toast('Aggiungi almeno una foto');
    out.innerHTML = loading('Analisi morfologica in corso (foglie, fiori, frutti, corteccia, portamento)…');
    try {
      const imgs = await Promise.all(ph.blobs.map(async b => imageBlock(await blobToBase64(b))));
      const note = $('#recNote', view).value.trim();
      const r = await callJSON({
        system: 'Identifica piante da fotografie. Analizza foglie (forma, margine, nervatura, disposizione), fiori, frutti, corteccia, portamento. Confronta con la flora coltivata e spontanea italiana ed europea. Se le foto non bastano, abbassa l\'affidabilità, imposta sufficiente=false e indica cosa fotografare.',
        content: [...imgs, { type: 'text', text: `Identifica la pianta nelle foto.${note ? ' Informazioni dell\'utente: ' + note : ''}` }],
        schema: SCHEMA_IDENTIFY, maxTokens: 6000, effort: 'medium', withContext: false,
      });
      showResults(out, r, ph.blobs[0], 'riconoscimento fotografico');
    } catch (e) { out.innerHTML = `<div class="alert danger">${esc(e.message)}</div>`; }
  };
  $('#descGo', view).onclick = async () => {
    const d = $('#recDesc', view).value.trim();
    if (d.length < 15) return toast('Descrivi la pianta con qualche dettaglio in più');
    out.innerHTML = loading('Elaborazione della descrizione…');
    try {
      const r = await callJSON({
        system: 'Identifica piante da una descrizione testuale. Proponi le specie più probabili tenendo conto del clima e della località del giardino. Con una descrizione non è quasi mai possibile una certezza: usa affidabilità prudenti e indica quali caratteri osservare per confermare.',
        content: `Descrizione dell'utente: ${d}`, schema: SCHEMA_IDENTIFY, maxTokens: 6000, effort: 'medium', withContext: true,
      });
      showResults(out, r, null, 'riconoscimento da descrizione');
    } catch (e) { out.innerHTML = `<div class="alert danger">${esc(e.message)}</div>`; }
  };
  const webGo = async () => {
    const q = $('#webQ', view).value.trim();
    if (q.length < 3) return;
    const box = $('#webRes', view);
    box.innerHTML = loading('Ricerca immagini con licenza libera…');
    try {
      const match = await gbifMatch(q).catch(() => null);
      const r = await webImages(match?.canonical || q);
      box.innerHTML = `${match ? `<p>Nome accettato (GBIF): <i class="sci">${esc(match.sci)}</i> · ${esc(match.family || '')}</p>` : ''}${imagesHTML(r.images, esc)}<div class="row" style="margin-top:10px">${sourceLinks(match?.canonical || q, match?.key).map(([n, u]) => `<a class="btn small" target="_blank" rel="noopener" href="${esc(u)}">${esc(n)} ↗</a>`).join('')}</div>`;
    } catch (e) { box.innerHTML = `<div class="alert danger">${esc(e.message)}</div>`; }
  };
  $('#webGo', view).onclick = webGo;
  $('#webQ', view).addEventListener('keydown', e => { if (e.key === 'Enter') webGo(); });
}

function showResults(out, r, photoBlob, origin) {
  const c = r.candidati || [];
  out.innerHTML = `
    <div class="alert ${r.sufficiente && (c[0]?.affidabilita || 0) >= 85 ? 'ok' : 'warn'}">
      ${r.sufficiente && (c[0]?.affidabilita || 0) >= 85 ? '<b>Identificazione probabile.</b> Confronta comunque le immagini prima di confermare.' : '<b>Identificazione non certa.</b> Le informazioni non bastano per una conclusione sicura: valuta le alternative e le verifiche suggerite.'}
      ${r.nota_qualita ? `<br><small>${esc(r.nota_qualita)}</small>` : ''}</div>
    ${c.map((x, i) => `<div class="card"><div class="card-head"><div><h2 style="margin:0">${i + 1}. ${esc(x.nome_comune)}</h2><i class="sci">${esc(x.nome_scientifico)}</i> · ${esc(x.famiglia)}${x.varieta_probabile ? ` · varietà probabile: ${esc(x.varieta_probabile)}` : ''}</div>${confLabel(x.affidabilita)}</div>
      ${confBar(x.affidabilita)}
      <p style="margin-top:8px"><b>Caratteri osservati:</b> ${esc((x.caratteri_osservati || []).join('; '))}</p>
      <p><b>Come riconoscerla:</b> ${esc(x.caratteri_distintivi)}</p>
      <div class="row"><button data-img="${i}">🖼️ Confronta immagini</button><button class="primary" data-ok="${i}">✓ Conferma e aggiungi al giardino</button><button data-sheet="${i}">Scheda</button></div>
      <div id="img${i}" style="margin-top:10px"></div></div>`).join('')}
    ${(r.specie_simili || []).length ? `<div class="card"><h2>Specie simili da non confondere</h2><ul class="list">${r.specie_simili.map(s => `<li><div class="grow"><b>${esc(s.nome)}</b><br><small>${esc(s.differenze)}</small></div></li>`).join('')}</ul></div>` : ''}
    ${(r.verifiche || []).length ? `<div class="card"><h2>Per confermare</h2><ul>${r.verifiche.map(v => `<li>${esc(v)}</li>`).join('')}</ul></div>` : ''}`;

  $$('[data-img]', out).forEach(b => b.onclick = async () => {
    const x = c[+b.dataset.img], box = $('#img' + b.dataset.img, out);
    box.innerHTML = loading('Ricerca immagini (iNaturalist, Wikimedia Commons)…');
    try {
      const w = await webImages(x.nome_scientifico);
      box.innerHTML = `${imagesHTML(w.images, esc)}<div class="row" style="margin-top:8px">${sourceLinks(x.nome_scientifico).map(([n, u]) => `<a class="btn small" target="_blank" rel="noopener" href="${esc(u)}">${esc(n)} ↗</a>`).join('')}</div>`;
    } catch (e) { box.innerHTML = `<div class="alert danger">${esc(e.message)}</div>`; }
  });
  const ensureSpecies = async (x) => {
    let sp = await findSpeciesByName(x.nome_scientifico);
    if (!sp) {
      let gb = null; try { gb = await gbifMatch(x.nome_scientifico); } catch (e) { /* offline */ }
      sp = await saveSpecies({ it: x.nome_comune, sci: gb?.sci || x.nome_scientifico, fam: gb?.family || x.famiglia, cat: CATEGORIES[x.categoria] ? x.categoria : 'arbusti', subs: [], tasks: [], problems: [], care: {}, gbifKey: gb?.key, source: 'riconoscimento' });
    }
    return sp;
  };
  $$('[data-ok]', out).forEach(b => b.onclick = async () => {
    const x = c[+b.dataset.ok];
    const sp = await ensureSpecies(x);
    openPlantForm({ speciesId: sp.id, origin, preset: { name: x.nome_comune, variety: x.varieta_probabile || '', photoBlob, notes: `Identificata con ${origin} (affidabilità ${Math.round(x.affidabilita)}%).` }, onSaved: p => go('#/pianta/' + p.id) });
  });
  $$('[data-sheet]', out).forEach(b => b.onclick = async () => { const sp = await ensureSpecies(c[+b.dataset.sheet]); go('#/specie/' + encodeURIComponent(sp.id)); });
}
