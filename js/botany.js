// Fonti botaniche online: GBIF (nomenclatura, archivio illimitato), iNaturalist e
// Wikimedia Commons (immagini con licenza e autore). Tutte gratuite e senza chiave.
import { cacheGet, cacheSet } from './db.js';

async function getJSON(url, cacheKey, maxAge = 7 * 86400000) {
  if (cacheKey) { const c = await cacheGet(cacheKey, maxAge); if (c) return c; }
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('Servizio non raggiungibile (' + r.status + ')');
  const j = await r.json();
  if (cacheKey) await cacheSet(cacheKey, j);
  return j;
}

// Ricerca nel backbone GBIF: solo piante (regno Plantae = 6), specie accettate
export async function gbifSearch(q) {
  const url = `https://api.gbif.org/v1/species/search?q=${encodeURIComponent(q)}&highertaxonKey=6&rank=SPECIES&status=ACCEPTED&datasetKey=d7dddbf4-2cf0-4f39-9b2a-bb099caae36c&limit=20`;
  const j = await getJSON(url, 'gbif:' + q.toLowerCase());
  const seen = new Set();
  return (j.results || []).filter(r => r.scientificName && !seen.has(r.canonicalName) && seen.add(r.canonicalName)).map(r => ({
    key: r.key, sci: r.scientificName, canonical: r.canonicalName, family: r.family, genus: r.genus,
    vernacular: (r.vernacularNames || []).filter(v => ['ita', 'it'].includes(v.language)).map(v => v.vernacularName)[0] || (r.vernacularNames || []).find(v => v.language === 'eng')?.vernacularName || '',
  }));
}
export async function gbifVernacularIt(key) {
  const j = await getJSON(`https://api.gbif.org/v1/species/${key}/vernacularNames?limit=50`, 'gbifv:' + key, 30 * 86400000);
  return (j.results || []).filter(v => ['ita', 'it'].includes(v.language)).map(v => v.vernacularName);
}
export async function gbifMatch(name) {
  const j = await getJSON(`https://api.gbif.org/v1/species/match?name=${encodeURIComponent(name)}&kingdom=Plantae`, 'gbifm:' + name.toLowerCase());
  return j && j.matchType !== 'NONE' ? { key: j.usageKey, sci: j.scientificName, canonical: j.canonicalName, family: j.family, status: j.status, confidence: j.confidence } : null;
}

const LIC = { 'cc0': 'CC0', 'cc-by': 'CC BY', 'cc-by-sa': 'CC BY-SA', 'cc-by-nc': 'CC BY-NC', 'cc-by-nc-sa': 'CC BY-NC-SA', 'cc-by-nd': 'CC BY-ND', 'cc-by-nc-nd': 'CC BY-NC-ND' };
// Immagini iNaturalist: solo foto con licenza Creative Commons (mai "tutti i diritti riservati")
export async function inatImages(sciName, limit = 12) {
  const t = await getJSON(`https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(sciName)}&rank=species,hybrid,variety&per_page=1&locale=it`, 'inat:' + sciName.toLowerCase());
  const taxon = t.results?.[0];
  if (!taxon) return { taxon: null, images: [] };
  const full = await getJSON(`https://api.inaturalist.org/v1/taxa/${taxon.id}?locale=it`, 'inatT:' + taxon.id);
  const tx = full.results?.[0] || taxon;
  const images = (tx.taxon_photos || []).map(tp => tp.photo).filter(p => p.license_code && LIC[p.license_code]).slice(0, limit).map(p => ({
    thumb: p.medium_url || p.url, full: p.large_url || p.original_url || p.medium_url, author: p.attribution, license: LIC[p.license_code],
    source: `https://www.inaturalist.org/photos/${p.id}`, provider: 'iNaturalist',
  }));
  return { taxon: { id: tx.id, name: tx.name, common: tx.preferred_common_name, wiki: tx.wikipedia_url, url: `https://www.inaturalist.org/taxa/${tx.id}` }, images };
}
// Immagini Wikimedia Commons con licenza e autore dai metadati
export async function commonsImages(sciName, limit = 10) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${encodeURIComponent(sciName + ' filetype:bitmap')}&gsrnamespace=6&gsrlimit=${limit}&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=400`;
  const j = await getJSON(url, 'commons:' + sciName.toLowerCase());
  const pages = Object.values(j.query?.pages || {});
  const strip = (s) => (s || '').replace(/<[^>]+>/g, '').trim();
  return pages.map(p => {
    const ii = p.imageinfo?.[0]; if (!ii) return null;
    const md = ii.extmetadata || {};
    const lic = strip(md.LicenseShortName?.value);
    if (!lic || /copyright|fair use|all rights/i.test(lic)) return null;
    return { thumb: ii.thumburl, full: ii.url, author: strip(md.Artist?.value) || 'Autore su Commons', license: lic, source: ii.descriptionurl, provider: 'Wikimedia Commons' };
  }).filter(Boolean);
}
export async function webImages(sciName) {
  const canonical = sciName.split(' ').slice(0, 2).join(' ');
  const [a, b] = await Promise.allSettled([inatImages(canonical), commonsImages(canonical)]);
  return {
    taxon: a.status === 'fulfilled' ? a.value.taxon : null,
    images: [...(a.status === 'fulfilled' ? a.value.images : []), ...(b.status === 'fulfilled' ? b.value : [])],
    errors: [a, b].filter(x => x.status === 'rejected').length,
  };
}
// Collegamenti alle banche dati di riferimento per la verifica
export function sourceLinks(sci, gbifKey) {
  const c = encodeURIComponent((sci || '').split(' ').slice(0, 2).join(' '));
  return [
    ['POWO – Kew', `https://powo.science.kew.org/results?q=${c}`],
    ['World Flora Online', `https://www.worldfloraonline.org/search?query=${c}`],
    ['GBIF', gbifKey ? `https://www.gbif.org/species/${gbifKey}` : `https://www.gbif.org/species/search?q=${c}`],
    ['iNaturalist', `https://www.inaturalist.org/taxa/search?q=${c}`],
    ['Acta Plantarum (flora italiana)', `https://www.actaplantarum.org/flora/flora_info.php?search=${c}`],
  ];
}
export function imagesHTML(images, esc) {
  if (!images.length) return '<div class="empty">Nessuna immagine con licenza libera trovata.</div>';
  return `<div class="img-grid">${images.map(i => `<figure><a href="${esc(i.source)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(i.thumb)}" alt=""></a><figcaption>${esc(i.provider)} · ${esc(i.license)} · ${esc(i.author).slice(0, 80)}</figcaption></figure>`).join('')}</div>`;
}
