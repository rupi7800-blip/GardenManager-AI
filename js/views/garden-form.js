import { esc, $, options, checks, formData, toast, loading } from '../ui.js';
import { saveGarden, SOILS } from '../store.js';
import { geocode, getClimate } from '../weather.js';
import { generateAutoTasks } from '../tasks.js';

export const FEATURES = ['prato', 'aiuole', 'orto', 'frutteto', 'serra', 'stagno', 'boschetto', 'siepi', 'terrazzo / vasi', 'zona relax', 'compostiera', 'raccolta acqua piovana'];

export function gardenFormHTML(g = {}) {
  return `<form id="gardenForm" class="form-grid" autocomplete="off">
    <div class="field full"><label for="gName">Nome del giardino</label><input id="gName" name="name" type="text" required value="${esc(g.name || '')}" placeholder="Es. Giardino di casa"></div>
    <div class="field full"><label for="gPlace">Comune o località</label>
      <div class="row"><input id="gPlace" name="place" type="text" value="${esc(g.place || '')}" placeholder="Es. Bergamo" style="flex:1;min-width:160px"><button type="button" id="gSearch">Cerca</button><button type="button" id="gGeo" title="Usa la posizione del dispositivo">📍 Posizione</button></div>
      <div id="gResults" class="stack" style="margin-top:8px"></div>
      <div class="hint" id="gCoords">${g.lat ? `Coordinate: ${g.lat.toFixed(4)}, ${g.lon.toFixed(4)}${g.elevation != null ? ` · ${Math.round(g.elevation)} m s.l.m.` : ''}` : 'Servono le coordinate per meteo e clima locali.'}</div>
      <input type="hidden" name="lat" value="${g.lat ?? ''}"><input type="hidden" name="lon" value="${g.lon ?? ''}"><input type="hidden" name="elevation" value="${g.elevation ?? ''}">
    </div>
    <div class="field"><label for="gArea">Superficie (m²)</label><input id="gArea" name="area" type="number" min="1" value="${g.area ?? ''}"></div>
    <div class="field"><label for="gSoil">Tipo di terreno</label><select id="gSoil" name="soil"><option value="">Non so</option>${options(SOILS, g.soil)}</select></div>
    <div class="field"><label for="gPh">pH del terreno (se noto)</label><input id="gPh" name="ph" type="number" step="0.1" min="3" max="10" value="${g.ph ?? ''}"></div>
    <div class="field"><label for="gExp">Esposizione prevalente</label><select id="gExp" name="exposure">${options(['', 'pieno sole', 'sole al mattino', 'sole al pomeriggio', 'mezz\'ombra', 'ombra'], g.exposure)}</select></div>
    <div class="field"><label for="gOrient">Orientamento</label><select id="gOrient" name="orientation">${options(['', 'nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ovest', 'ovest', 'nord-ovest', 'misto'], g.orientation)}</select></div>
    <div class="field"><label for="gSlope">Pendenza</label><select id="gSlope" name="slope">${options(['', 'pianeggiante', 'lieve (< 10%)', 'media (10-30%)', 'forte (> 30%)', 'terrazzamenti'], g.slope)}</select></div>
    <div class="field full"><label for="gShade">Zone in ombra e mezz'ombra</label><input id="gShade" name="shade" type="text" value="${esc(g.shade || '')}" placeholder="Es. lato nord della casa in ombra, sotto il noce mezz'ombra"></div>
    <div class="field"><label for="gWater">Disponibilità idrica</label><select id="gWater" name="water">${options(['', 'acquedotto', 'pozzo', 'raccolta piovana', 'scarsa / limitata', 'abbondante'], g.water)}</select></div>
    <div class="field"><label for="gIrr">Sistema di irrigazione</label><select id="gIrr" name="irrigation">${options(['', 'nessuno (manuale)', 'a goccia', 'a pioggia (irrigatori)', 'misto goccia e pioggia', 'subirrigazione', 'automatico con centralina'], g.irrigation)}</select></div>
    <div class="field full"><label for="gWet">Zone particolarmente umide o asciutte</label><input id="gWet" name="wetDry" type="text" value="${esc(g.wetDry || '')}" placeholder="Es. ristagno in fondo al prato dopo piogge; aiuola sud molto asciutta"></div>
    <div class="field full"><label for="gClimNotes">Note climatiche</label><input id="gClimNotes" name="climateNotes" type="text" value="${esc(g.climateNotes || '')}" placeholder="Es. vento di bora, nebbie invernali, gelate tardive frequenti"></div>
    <div class="field full"><label>Elementi presenti</label>${checks('features', FEATURES, g.features || [])}</div>
  </form>`;
}

export function bindGardenForm(root, g = {}, onSaved) {
  const form = $('#gardenForm', root);
  const res = $('#gResults', root);
  const setCoords = (lat, lon, elev, label) => {
    form.lat.value = lat; form.lon.value = lon; form.elevation.value = elev ?? '';
    if (label) form.place.value = label;
    $('#gCoords', root).textContent = `Coordinate: ${(+lat).toFixed(4)}, ${(+lon).toFixed(4)}${elev != null && elev !== '' ? ` · ${Math.round(elev)} m s.l.m.` : ''}`;
    res.innerHTML = '';
  };
  $('#gSearch', root).onclick = async () => {
    const q = form.place.value.trim();
    if (q.length < 2) return toast('Scrivi il nome del comune');
    res.innerHTML = loading('Ricerca…');
    try {
      const list = await geocode(q);
      res.innerHTML = list.length ? list.map((x, i) => `<button type="button" class="small" data-i="${i}" style="justify-content:flex-start;width:100%">${esc(x.name)} <small>${esc(x.admin)} · ${esc(x.country)}</small></button>`).join('') : '<small>Nessun risultato.</small>';
      res.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { const x = list[b.dataset.i]; setCoords(x.lat, x.lon, x.elevation, `${x.name}${x.admin ? ' (' + x.admin.split(', ').pop() + ')' : ''}`); });
    } catch (e) { res.innerHTML = `<small class="danger">${esc(e.message)}</small>`; }
  };
  form.place.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#gSearch', root).click(); } });
  $('#gGeo', root).onclick = () => {
    if (!navigator.geolocation) return toast('Geolocalizzazione non disponibile');
    navigator.geolocation.getCurrentPosition(p => setCoords(p.coords.latitude, p.coords.longitude, p.coords.altitude, form.place.value || 'Posizione attuale'), () => toast('Posizione non disponibile: cerca il comune'), { timeout: 10000 });
  };
  return async function submit() {
    if (!form.reportValidity()) return null;
    const d = formData(form);
    const out = { ...g, ...d, lat: d.lat === '' ? null : +d.lat, lon: d.lon === '' ? null : +d.lon, elevation: d.elevation === '' ? null : +d.elevation };
    const coordsChanged = out.lat !== g.lat || out.lon !== g.lon;
    if (coordsChanged) out.climate = null;
    const saved = await saveGarden(out);
    if (saved.lat && (!saved.climate || coordsChanged)) {
      toast('Calcolo del clima locale (10 anni di dati)…');
      try { saved.climate = await getClimate(saved); await saveGarden(saved); } catch (e) { toast('Clima non calcolato ora: riproverò più tardi'); }
    }
    await generateAutoTasks(saved);
    onSaved && onSaved(saved);
    return saved;
  };
}
