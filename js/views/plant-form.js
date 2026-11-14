// Modulo di inserimento/modifica di una pianta del giardino
import { esc, $, modal, options, formData, toast, photoInputHTML, bindPhotoInput, savePhoto, todayISO } from '../ui.js';
import { state, allSpecies, savePlant, saveSpecies, addEvent, HEALTH, SOILS, CATEGORIES, getSpecies } from '../store.js';
import { generateAutoTasks } from '../tasks.js';
import { db } from '../db.js';

export async function openPlantForm({ plant = null, speciesId = null, preset = {}, origin = 'manuale', onSaved } = {}) {
  const species = (await allSpecies()).sort((a, b) => a.it.localeCompare(b.it, 'it'));
  const sp = speciesId ? await getSpecies(speciesId) : plant ? await getSpecies(plant.speciesId) : null;
  const p = { qty: 1, health: 'buona', planted: '', exposure: '', soil: state.garden?.soil || '', ...preset, ...(plant || {}) };
  if (!plant && sp) { p.name = p.name || sp.it; p.speciesId = sp.id; p.inPot = p.inPot ?? (sp.cat === 'vaso'); }
  const m = modal({
    title: plant ? 'Modifica pianta' : 'Aggiungi al giardino', wide: true,
    body: `<form id="plantForm" class="form-grid">
      <div class="field full"><label for="pfSpecies">Specie</label>
        <select id="pfSpecies" name="speciesId"><option value="">— Specie non in archivio (inserimento manuale) —</option>${species.map(s => `<option value="${s.id}" ${s.id === p.speciesId ? 'selected' : ''}>${esc(s.it)} — ${esc(s.sci)}</option>`).join('')}</select>
      </div>
      <div class="field full" id="pfNewSp" ${p.speciesId ? 'hidden' : ''}>
        <div class="form-grid" style="background:var(--surface-2);padding:10px;border-radius:10px">
          <div class="field"><label for="pfSpIt">Nome comune della specie</label><input id="pfSpIt" name="spIt" type="text" value="${esc(preset.spIt || '')}"></div>
          <div class="field"><label for="pfSpSci">Nome botanico</label><input id="pfSpSci" name="spSci" type="text" value="${esc(preset.spSci || '')}" placeholder="Es. Camellia japonica"></div>
          <div class="field"><label for="pfSpFam">Famiglia</label><input id="pfSpFam" name="spFam" type="text" value="${esc(preset.spFam || '')}"></div>
          <div class="field"><label for="pfSpCat">Categoria</label><select id="pfSpCat" name="spCat">${options(Object.entries(CATEGORIES).map(([k, v]) => [k, v.label]), preset.spCat || 'arbusti')}</select></div>
          <div class="hint full">La specie viene salvata nel tuo archivio; potrai completare la scheda botanica con l'AI.</div>
        </div>
      </div>
      <div class="field"><label for="pfName">Nome (come la chiami)</label><input id="pfName" name="name" type="text" required value="${esc(p.name || '')}" placeholder="Es. Fico vicino al cancello"></div>
      <div class="field"><label for="pfVar">Varietà / cultivar</label><input id="pfVar" name="variety" type="text" value="${esc(p.variety || '')}" placeholder="Es. Dottato"></div>
      <div class="field"><label for="pfQty">Quantità (esemplari)</label><input id="pfQty" name="qty" type="number" min="1" value="${p.qty || 1}"></div>
      <div class="field"><label for="pfPos">Posizione nel giardino</label><input id="pfPos" name="position" type="text" value="${esc(p.position || '')}" placeholder="Es. aiuola sud, lungo il muro"></div>
      <div class="field"><label for="pfPlanted">Data di impianto</label><input id="pfPlanted" name="planted" type="date" value="${esc(p.planted || '')}"></div>
      <div class="field"><label for="pfAge">Età stimata</label><input id="pfAge" name="age" type="text" value="${esc(p.age || '')}" placeholder="Es. 5 anni"></div>
      <div class="field"><label for="pfH">Altezza (m)</label><input id="pfH" name="height" type="number" step="0.05" min="0" value="${p.height ?? ''}"></div>
      <div class="field"><label for="pfW">Larghezza (m)</label><input id="pfW" name="width" type="number" step="0.05" min="0" value="${p.width ?? ''}"></div>
      <div class="field"><label for="pfExp">Esposizione</label><select id="pfExp" name="exposure">${options(['', 'pieno sole', 'mezz\'ombra', 'ombra', 'interno luminoso', 'interno poco luminoso'], p.exposure)}</select></div>
      <div class="field"><label for="pfSoil">Terreno</label><select id="pfSoil" name="soil"><option value="">—</option>${options([...SOILS, 'terriccio in vaso'], p.soil)}</select></div>
      <div class="field"><label for="pfHealth">Stato di salute</label><select id="pfHealth" name="health">${options(HEALTH, p.health)}</select></div>
      <div class="field"><label>&nbsp;</label><label style="font-weight:400;display:flex;gap:8px;align-items:center"><input type="checkbox" name="inPot" ${p.inPot ? 'checked' : ''}> Coltivata in vaso</label>
        <label style="font-weight:400;display:flex;gap:8px;align-items:center"><input type="checkbox" name="noAuto" ${p.noAuto ? 'checked' : ''}> Non generare attività automatiche</label></div>
      <div class="field full"><label for="pfNotes">Note personali</label><textarea id="pfNotes" name="notes">${esc(p.notes || '')}</textarea></div>
      ${plant ? '' : `<div class="field full"><label>Foto</label>${photoInputHTML('pfPh', { multiple: false, label: 'Carica' })}</div>`}
    </form>`,
    foot: `<button data-close>Annulla</button><button class="primary" data-save>${plant ? 'Salva' : 'Aggiungi al giardino'}</button>`,
  });
  const ph = plant ? null : bindPhotoInput(m.el, 'pfPh', { max: 1 });
  if (preset.photoBlob && ph) { ph.blobs.push(preset.photoBlob); $('#pfPh-prev', m.el).innerHTML = `<img src="${URL.createObjectURL(preset.photoBlob)}">`; }
  const sel = $('#pfSpecies', m.el);
  sel.onchange = () => {
    $('#pfNewSp', m.el).hidden = !!sel.value;
    const s = species.find(x => x.id === sel.value);
    if (s && !$('#pfName', m.el).value) $('#pfName', m.el).value = s.it;
  };
  $('[data-save]', m.el).onclick = async () => {
    const f = $('#plantForm', m.el);
    if (!f.reportValidity()) return;
    const d = formData(f);
    let speciesIdOut = d.speciesId;
    if (!speciesIdOut) {
      if (!d.spIt && !d.spSci) { toast('Indica almeno il nome della specie'); return; }
      const ns = await saveSpecies({ it: d.spIt || d.name, sci: d.spSci || '', fam: d.spFam || '', cat: d.spCat, subs: [], tasks: [], problems: [], care: {}, source: 'manual', ...(preset.speciesExtra || {}) });
      speciesIdOut = ns.id;
    }
    const out = { ...(plant || {}), name: d.name, variety: d.variety, speciesId: speciesIdOut, qty: d.qty || 1, position: d.position, planted: d.planted, age: d.age, height: d.height, width: d.width, exposure: d.exposure, soil: d.soil, health: d.health, inPot: d.inPot, noAuto: d.noAuto, notes: d.notes, origin: plant ? plant.origin : origin };
    if (ph && ph.blobs[0]) out.photoId = await savePhoto(ph.blobs[0], { kind: 'pianta' });
    const saved = await savePlant(out);
    if (ph && ph.blobs[0]) { const rec = await db.get('photos', out.photoId); if (rec) await db.put('photos', { ...rec, plantId: saved.id, gardenId: saved.gardenId }); await addEvent({ plantId: saved.id, type: 'foto', text: 'Foto iniziale.', photoIds: [out.photoId] }); }
    if (!plant || plant.speciesId !== speciesIdOut || plant.noAuto !== d.noAuto) await generateAutoTasks();
    m.close(); toast(plant ? 'Pianta aggiornata' : 'Pianta aggiunta al giardino');
    onSaved && onSaved(saved);
  };
}
