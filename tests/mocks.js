// Mock dei servizi esterni per i test end-to-end (la sandbox non raggiunge le API reali)
const iso = (d) => d.toISOString().slice(0, 10);
function forecast() {
  const days = [];
  const t0 = new Date(); t0.setDate(t0.getDate() - 7);
  for (let i = 0; i < 14; i++) { const d = new Date(t0); d.setDate(d.getDate() + i); days.push(iso(d)); }
  const n = days.length;
  return {
    current: { time: iso(new Date()) + 'T10:00', temperature_2m: 11.4, relative_humidity_2m: 78, precipitation: 0, weather_code: 2, wind_speed_10m: 8, wind_gusts_10m: 20 },
    daily: {
      time: days,
      weather_code: days.map((_, i) => [61, 3, 2, 1, 0, 80, 63, 2, 1, 3, 61, 0, 0, 1][i]),
      temperature_2m_max: days.map((_, i) => 13 + (i % 4)), temperature_2m_min: days.map((_, i) => i === 9 ? -2.5 : 4 + (i % 3)),
      precipitation_sum: days.map((_, i) => [6, 0, 0, 0, 0, 12, 4, 0, 0, 0, 3, 0, 0, 0][i]), precipitation_probability_max: days.map((_, i) => [80, 10, 5, 0, 0, 70, 60, 10, 5, 20, 60, 0, 0, 5][i]),
      et0_fao_evapotranspiration: days.map(() => 1.4), wind_speed_10m_max: days.map(() => 12), wind_gusts_10m_max: days.map(() => 30), relative_humidity_2m_mean: days.map(() => 75),
    },
  };
}
function archive() {
  const time = [], tmax = [], tmin = [], pr = [];
  const d = new Date('2015-01-01');
  while (d.getFullYear() < 2025) {
    const doy = (d - new Date(d.getFullYear(), 0, 0)) / 86400000;
    const s = Math.sin((doy - 105) / 365 * 2 * Math.PI);
    time.push(iso(d)); tmax.push(+(15 + 13 * s).toFixed(1)); tmin.push(+(6 + 10 * s - (doy % 37 === 0 ? 5 : 0)).toFixed(1)); pr.push(doy % 4 === 0 ? 9 : 0);
    d.setDate(d.getDate() + 1);
  }
  return { daily: { time, temperature_2m_max: tmax, temperature_2m_min: tmin, precipitation_sum: pr } };
}
const IDENT = { sufficiente: true, nota_qualita: 'Foglia e frutto ben visibili.', candidati: [
  { nome_comune: 'Corbezzolo', nome_scientifico: 'Arbutus unedo L.', famiglia: 'Ericaceae', varieta_probabile: '', affidabilita: 88, caratteri_osservati: ['foglie coriacee seghettate', 'frutti sferici rossi verrucosi'], caratteri_distintivi: 'Frutti globosi rossi con superficie granulosa, fiori a orciolo bianchi in autunno.', categoria: 'arbusti' },
  { nome_comune: 'Alloro', nome_scientifico: 'Laurus nobilis L.', famiglia: 'Lauraceae', varieta_probabile: '', affidabilita: 9, caratteri_osservati: ['foglie coriacee'], caratteri_distintivi: 'Foglie aromatiche a margine intero.', categoria: 'arbusti' }],
  specie_simili: [{ nome: 'Arbutus andrachne', differenze: 'Corteccia rossastra liscia, foglie a margine intero.' }], verifiche: ['Osserva il margine fogliare', 'Annusa una foglia stropicciata'] };
const DIAG = { certezza: 'ipotesi', sintomi_osservati: ['pustole arancioni sul rovescio'], problema_principale: { nome: 'Ruggine del fico', tipo: 'fungino', agente: 'Cerotelium fici', affidabilita: 72, motivazione: 'Pustole tipiche e periodo di fine estate.' },
  alternative: [{ nome: 'Stress idrico', affidabilita: 15, come_distinguerla: 'Foglie secche senza pustole.' }], verifiche: ['Osserva il rovescio con una lente'], intervento: ['Raccogli le foglie cadute'], prevenzione: ['Non bagnare la chioma'], urgenza: 'media', organismo_da_quarantena: false };
const TIP = { consiglio: 'Controlla la pacciamatura sotto il fico prima del gelo previsto.', motivo: 'Minime sotto zero tra due giorni.', pianta: 'Fico', categoria: 'protezione' };
const SHEET = { nome_comune: 'Corbezzolo', nome_scientifico: 'Arbutus unedo L.', sinonimi: [], famiglia: 'Ericaceae', origine: 'Mediterraneo', ciclo: 'Arbusto sempreverde', longevita: '100 anni', altezza_maturita: '3-8 m', larghezza_maturita: '2-4 m', velocita_crescita: 'lenta',
  categoria: 'arbusti', sottocategorie: ['Sempreverdi', 'Bacche e piccoli frutti'], esposizione: 'Sole o mezz\'ombra', ore_sole: '4-8', temperature_ideali: '10-28 °C', temperatura_minima_c: -12, resistenza_caldo: 'ottima', umidita: 'bassa', terreno: 'subacido, drenato', ph_min: 5, ph_max: 7, drenaggio: 'ottimo',
  fabbisogno_idrico: 'bassa', irrigazione: 'Solo in attecchimento.', concimazione: 'Organica in primavera.', potatura: 'Leggera dopo la raccolta.', rinvaso_trapianto: 'Autunno.', moltiplicazione: 'Seme, talea.', pacciamatura: 'Organica.', pulizia: '—',
  stagioni: { primavera: 'Concimazione.', estate: 'Irrigazioni di soccorso.', autunno: 'Raccolta e fioritura.', inverno: 'Riposo.' },
  calendario: [{ mesi: [10, 11, 12], tipo: 'raccolta', istruzione: 'Raccogli i frutti rossi maturi.', priorita: 1 }, { mesi: [3], tipo: 'concimazione', istruzione: 'Compost alla base.', priorita: 1 }],
  problemi: [{ nome: 'Antracnosi', tipo: 'fungino', sintomi: 'Macchie fogliari scure.', cause: 'Umidità.', prevenzione: 'Arieggiare.', diagnosi_differenziale: 'Scottature.', intervento_biologico: 'Rame.', intervento_convenzionale: 'Prodotti autorizzati.', mesi_rischio: [4, 5, 10] }],
  propagazione: ['Seme stratificato'], note_tossicita_invasivita: '', fonti: ['POWO', 'Acta Plantarum'] };
const DESIGN = { analisi: 'Sito soleggiato con zona d\'ombra a nord.', proposte: [{ titolo: 'Bordura per impollinatori', descrizione: 'Lavanda e salvie lungo il percorso.', zona: 'lato sud', piante: [{ nome: 'Lavanda', nome_scientifico: 'Lavandula angustifolia', quantita: 7, distanza_impianto_m: 0.6, dimensione_maturita: '0,6 × 0,7 m', motivo: 'fioritura estiva', fabbisogno_idrico: 'basso', compatibilita: 'pieno sole, drenaggio' }], manutenzione: 'bassa' }], abbinamenti_cromatici: 'Viola e argento.', biodiversita: 'Aggiungi un nido.', avvertenze: ['Rispetta le distanze dal confine'] };
const ORTO = { analisi: 'Rotazione corretta.', incompatibilita: [], piano: [{ aiuola: 'Aiuola 1', stagione: 'autunno-inverno', colture: 'fave', consociazioni: 'cipolla no', motivo: 'leguminosa dopo solanacea' }] };

function sse(text) {
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  let out = ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } });
  out += ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
  for (const part of text.match(/.{1,20}/gs)) out += ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: part } });
  out += ev('content_block_stop', { index: 0 });
  out += ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } });
  out += ev('message_stop', {});
  return out;
}

async function install(context, log) {
  await context.route(/geocoding-api\.open-meteo\.com/, r => r.fulfill({ json: { results: [{ name: 'Bergamo', admin1: 'Lombardia', admin2: 'Bergamo', country: 'Italia', latitude: 45.695, longitude: 9.67, elevation: 249 }] } }));
  await context.route(/archive-api\.open-meteo\.com/, r => r.fulfill({ json: archive() }));
  await context.route(/api\.open-meteo\.com\/v1\/forecast/, r => r.fulfill({ json: forecast() }));
  await context.route(/api\.gbif\.org\/v1\/species\/search/, r => r.fulfill({ json: { results: [{ key: 3021394, scientificName: 'Arbutus unedo L.', canonicalName: 'Arbutus unedo', family: 'Ericaceae', vernacularNames: [{ language: 'ita', vernacularName: 'Corbezzolo' }] }] } }));
  await context.route(/api\.gbif\.org\/v1\/species\/match/, r => r.fulfill({ json: { usageKey: 3021394, scientificName: 'Arbutus unedo L.', canonicalName: 'Arbutus unedo', family: 'Ericaceae', status: 'ACCEPTED', matchType: 'EXACT', confidence: 99 } }));
  await context.route(/api\.inaturalist\.org\/v1\/taxa\/\d+/, r => r.fulfill({ json: { results: [{ id: 54772, name: 'Arbutus unedo', preferred_common_name: 'corbezzolo', taxon_photos: [{ photo: { id: 1, medium_url: 'http://localhost:8765/icons/icon-192.png', license_code: 'cc-by', attribution: '(c) Mario Rossi, CC BY' } }, { photo: { id: 2, medium_url: 'http://localhost:8765/icons/icon-192.png', license_code: null, attribution: 'all rights reserved' } }] }] } }));
  await context.route(/api\.inaturalist\.org\/v1\/taxa\?/, r => r.fulfill({ json: { results: [{ id: 54772, name: 'Arbutus unedo' }] } }));
  await context.route(/commons\.wikimedia\.org/, r => r.fulfill({ json: { query: { pages: { 1: { imageinfo: [{ thumburl: 'http://localhost:8765/icons/icon-512.png', url: 'x', descriptionurl: 'https://commons.wikimedia.org/wiki/File:x.jpg', extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: '<a>Anna</a>' } } }] } } } } }));

  // Google Gemini (servizio principale nei test): la diagnosi restituisce 429 per verificare la rotazione
  const pick = (keys) => keys.includes('candidati') ? IDENT : keys.includes('certezza') ? DIAG : keys.includes('consiglio') ? TIP : keys.includes('calendario') ? SHEET : keys.includes('proposte') ? DESIGN : keys.includes('piano') ? ORTO : keys.includes('ok') ? { ok: true, pianta: 'Fico' } : keys.includes('id') ? { id: 'prato-festuca', affidabilita: 70, motivo: 'foglie larghe' } : {};
  await context.route(/generativelanguage\.googleapis\.com/, async r => {
    const req = r.request(), url = req.url();
    if (req.method() === 'GET') return r.fulfill({ json: { models: [{ name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-flash-lite-latest', supportedGenerationMethods: ['generateContent'] }] } });
    const body = JSON.parse(req.postData() || '{}');
    log.push({ provider: 'gemini', url, headers: req.headers(), body });
    if (url.includes(':streamGenerateContent')) {
      const chunks = ['**Fatti**: il fico perde ', 'le foglie in autunno.\n- Consiglio: raccogli le foglie con ruggine.'];
      const out = chunks.map((t, i) => `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: t }] }, ...(i === chunks.length - 1 ? { finishReason: 'STOP', groundingMetadata: body.tools ? { groundingChunks: [{ web: { uri: 'https://www.crea.gov.it/', title: 'CREA' } }] } : undefined } : {}) }] })}\r\n\r\n`).join('');
      return r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: out });
    }
    const keys = Object.keys(body.generationConfig?.responseJsonSchema?.properties || {});
    if (keys.includes('certezza')) return r.fulfill({ status: 429, json: { error: { code: 429, message: 'Resource exhausted', status: 'RESOURCE_EXHAUSTED' } } });
    return r.fulfill({ json: { candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(pick(keys)) }] }, finishReason: 'STOP' }] } });
  });
  // Groq (riserva, formato compatibile OpenAI): il JSON è descritto nel prompt di sistema
  await context.route(/api\.groq\.com/, async r => {
    const req = r.request();
    if (req.method() === 'GET') return r.fulfill({ json: { data: [{ id: 'llama-3.3-70b-versatile' }] } });
    const body = JSON.parse(req.postData() || '{}');
    log.push({ provider: 'groq', url: req.url(), headers: req.headers(), body });
    const sys = body.messages[0].content;
    const m = sys.match(/JSON Schema[^\n]*\n(\{.*\})/s);
    const keys = m ? Object.keys(JSON.parse(m[1]).properties) : [];
    // risposta volutamente incompleta e con testo intorno: deve essere ripulita e completata
    const j = keys.includes('certezza') ? { ...DIAG, alternative: undefined } : pick(keys);
    return r.fulfill({ json: { choices: [{ message: { role: 'assistant', content: 'Ecco il risultato:\n```json\n' + JSON.stringify(j) + '\n```' } }] } });
  });
  await context.route(/api\.anthropic\.com/, async r => {
    const req = r.request();
    const body = JSON.parse(req.postData() || '{}');
    log.push({ url: req.url(), headers: req.headers(), body });
    if (body.stream) return r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse('**Fatti**: il fico perde le foglie in autunno.\n- Consiglio: raccogli le foglie con ruggine.') });
    const props = body.output_config?.format?.schema?.properties || {};
    const j = props.candidati ? IDENT : props.certezza ? DIAG : props.consiglio ? TIP : props.calendario ? SHEET : props.proposte ? DESIGN : props.piano ? ORTO : props.id ? { id: 'prato-festuca', affidabilita: 70, motivo: 'foglie larghe' } : {};
    return r.fulfill({ json: { id: 'msg_x', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify(j) }], stop_reason: 'end_turn', stop_details: null, usage: { input_tokens: 100, output_tokens: 50 } } });
  });
}
module.exports = { install };
