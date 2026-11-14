// Motore AI multi-servizio. Servizi selezionabili in Impostazioni (Gemini, Groq, Mistral,
// OpenRouter, Cerebras, Hugging Face, DeepSeek, Pollinations, Ollama, OpenAI, Claude, altro).
// Le chiavi restano nel dispositivo. Se un servizio gratuito esaurisce la quota o non risponde,
// la richiesta passa automaticamente al servizio successivo configurato.
import { state, gardenPlants, getSpecies, modeLabel, interventionFor } from './store.js';
import { db } from './db.js';
import { MONTHS } from './ui.js';
import { PROVIDERS, PROVIDER_ORDER } from './ai-providers.js';

export { PROVIDERS };
export class AIError extends Error { constructor(msg, code, provider) { super(msg); this.code = code; this.provider = provider; } }

// ── Configurazione ──
export function aiConfig(settings = state.settings) {
  const ai = settings?.ai || {};
  const providers = {};
  for (const id of PROVIDER_ORDER) providers[id] = { enabled: false, key: '', model: '', visionModel: '', base: '', ...(ai.providers?.[id] || {}) };
  // compatibilità con la versione precedente (solo Claude)
  if (settings?.apiKey && !providers.anthropic.key) { providers.anthropic.key = settings.apiKey; providers.anthropic.enabled = true; }
  return { primary: ai.primary || 'gemini', fallback: ai.fallback !== false, providers };
}
const usable = (id, cfg) => { const p = PROVIDERS[id], c = cfg.providers[id]; return c.enabled && (!p.needsKey || c.key) && (id !== 'custom' || c.base); };
export function hasAI(settings = state.settings) { const cfg = aiConfig(settings); return PROVIDER_ORDER.some(id => usable(id, cfg)); }
export function activeProviders({ vision = false } = {}, settings = state.settings) {
  const cfg = aiConfig(settings);
  const order = [cfg.primary, ...PROVIDER_ORDER.filter(x => x !== cfg.primary)];
  const list = order.filter(id => usable(id, cfg) && (!vision || PROVIDERS[id].vision));
  return cfg.fallback ? list : list.slice(0, 1);
}
export function providerLabel(id) { return PROVIDERS[id]?.label || id; }
function modelFor(id, vision, cfg) {
  const p = PROVIDERS[id], c = cfg.providers[id];
  if (vision) return c.visionModel || p.visionModel || c.model || p.model;
  return c.model || p.model;
}
function baseFor(id, cfg) { return (cfg.providers[id].base || PROVIDERS[id].base).replace(/\/+$/, ''); }

// Formato neutro per le immagini: convertito per ogni servizio
export function imageBlock(b64, media = 'image/jpeg') { return { type: 'image', media, data: b64 }; }
const toParts = (content) => typeof content === 'string' ? [{ type: 'text', text: content }] : content;
const hasImages = (content) => Array.isArray(content) && content.some(c => c.type === 'image');

// ── Errori ──
function httpError(status, body, id) {
  const label = providerLabel(id);
  const msg = (body && (body.error?.message || body.message || (typeof body.error === 'string' ? body.error : ''))) || '';
  if (status === 401 || status === 403) return new AIError(`${label}: chiave non valida o senza accesso a questo modello.`, 'auth', id);
  if (status === 429) return new AIError(`${label}: limite gratuito raggiunto per ora. Riprova più tardi o aggiungi un altro servizio come riserva.`, 'rate', id);
  if (status === 404) return new AIError(`${label}: modello non trovato. Aggiorna l'elenco dei modelli in Impostazioni.`, 'model', id);
  if (status >= 500) return new AIError(`${label}: servizio momentaneamente non disponibile (${status}).`, 'server', id);
  return new AIError(`${label}: richiesta non accettata (${status}) ${msg.slice(0, 200)}`, 'bad', id);
}
async function doFetch(url, opts, id, timeoutMs = 90000) {
  if (!navigator.onLine) throw new AIError('Sei offline: le funzioni AI richiedono una connessione.', 'offline', id);
  let r;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try { r = await fetch(url, { ...opts, signal: ctrl.signal }); }
  catch (e) {
    if (e.name === 'AbortError') throw new AIError(`${providerLabel(id)}: nessuna risposta entro ${Math.round(timeoutMs / 1000)} secondi.`, 'conn', id);
    throw new AIError(`${providerLabel(id)}: servizio non raggiungibile dal browser (rete, blocco o CORS).`, 'conn', id);
  }
  finally { clearTimeout(timer); }
  if (!r.ok) { let b = null; try { b = await r.json(); } catch (e) { /* corpo non JSON */ } throw httpError(r.status, b, id); }
  return r;
}
const RETRYABLE = ['rate', 'server', 'conn', 'model', 'auth', 'refusal', 'parse', 'novision'];

// ── JSON robusto ──
export function parseJSON(text) {
  let t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return JSON.parse(t);
}
// Completa i campi mancanti secondo lo schema, così l'interfaccia non si interrompe
export function coerce(schema, v) {
  if (!schema) return v;
  const t = schema.type;
  if (t === 'object') {
    const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    const out = {};
    for (const [k, s] of Object.entries(schema.properties || {})) out[k] = coerce(s, o[k]);
    return out;
  }
  if (t === 'array') return Array.isArray(v) ? v.map(x => coerce(schema.items, x)) : [];
  if (t === 'number' || t === 'integer') { const n = Number(v); return Number.isFinite(n) ? (t === 'integer' ? Math.round(n) : n) : 0; }
  if (t === 'boolean') return v === true || v === 'true';
  if (schema.enum) return schema.enum.includes(v) ? v : schema.enum[0];
  return v == null ? '' : String(v);
}
function schemaHint(schema) {
  return `Rispondi esclusivamente con un oggetto JSON valido (niente testo fuori dal JSON), conforme a questo JSON Schema; usa tutti i campi richiesti:\n${JSON.stringify(schema)}`;
}

// ── Adattatori ──
async function geminiCall(id, cfg, { system, content, schema, maxTokens, stream, onText, history, webSearch, fast, timeoutMs }) {
  const vision = hasImages(content);
  const model = modelFor(id, vision, cfg);
  const key = cfg.providers[id].key;
  const toG = (parts) => toParts(parts).map(p => p.type === 'image' ? { inlineData: { mimeType: p.media, data: p.data } } : { text: p.text });
  const contents = history ? history.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })) : [{ role: 'user', parts: toG(content) }];
  // i modelli Gemini "ragionano" prima di rispondere e il ragionamento consuma token:
  // in modalità veloce lo disattiviamo, altrimenti lasciamo margine sufficiente
  const body = { systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { maxOutputTokens: fast ? maxTokens : Math.max(maxTokens, 8192), temperature: 0.4 } };
  if (fast) body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
  if (schema) { body.generationConfig.responseMimeType = 'application/json'; body.generationConfig.responseJsonSchema = schema; }
  if (webSearch) body.tools = [{ googleSearch: {} }];
  const base = baseFor(id, cfg);
  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': key };
  if (!stream) {
    // se il modello rifiuta un'opzione, riprova togliendo prima il controllo del ragionamento, poi lo schema
    const fallbacks = [
      () => { if (!body.generationConfig.thinkingConfig) return false; delete body.generationConfig.thinkingConfig; return true; },
      () => { if (!body.generationConfig.responseJsonSchema) return false; delete body.generationConfig.responseJsonSchema; body.systemInstruction.parts[0].text += '\n\n' + schemaHint(schema); return true; },
    ];
    let r;
    for (;;) {
      try { r = await doFetch(`${base}/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers, body: JSON.stringify(body) }, id, timeoutMs); break; }
      catch (e) { if (e.code !== 'bad' || !fallbacks.some(f => f())) throw e; }
    }
    const j = await r.json();
    if (j.promptFeedback?.blockReason) throw new AIError(`${providerLabel(id)}: richiesta bloccata dai filtri del servizio.`, 'refusal', id);
    const c = j.candidates?.[0];
    const text = (c?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
    if (!text) throw new AIError(c?.finishReason === 'MAX_TOKENS' ? `${providerLabel(id)}: risposta interrotta per lunghezza, riprova.` : `${providerLabel(id)}: risposta vuota (${c?.finishReason || 'sconosciuto'}).`, 'refusal', id);
    return { text, sources: geminiSources(c), model };
  }
  const r = await doFetch(`${base}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, { method: 'POST', headers, body: JSON.stringify(body) }, id);
  let text = '', last = null;
  await readSSE(r, (data) => {
    const j = JSON.parse(data); const c = j.candidates?.[0]; if (!c) return;
    last = c;
    const t = (c.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
    if (t) { text += t; onText && onText(t); }
  });
  if (!text) throw new AIError(`${providerLabel(id)}: risposta vuota.`, 'refusal', id);
  return { text, sources: geminiSources(last), model };
}
function geminiSources(c) {
  return (c?.groundingMetadata?.groundingChunks || []).map(g => g.web).filter(Boolean).map(w => ({ url: w.uri, title: w.title })).slice(0, 8);
}

async function openaiCall(id, cfg, { system, content, schema, maxTokens, stream, onText, history, timeoutMs }) {
  const vision = hasImages(content);
  const p = PROVIDERS[id];
  if (vision && !p.vision) throw new AIError(`${p.label} non legge le foto.`, 'novision', id);
  const model = modelFor(id, vision, cfg);
  if (!model) throw new AIError(`${p.label}: indica il modello in Impostazioni.`, 'model', id);
  const key = cfg.providers[id].key;
  const toO = (parts) => toParts(parts).map(x => x.type === 'image' ? { type: 'image_url', image_url: { url: `data:${x.media};base64,${x.data}` } } : { type: 'text', text: x.text });
  const sys = schema ? `${system}\n\n${schemaHint(schema)}` : system;
  const messages = [{ role: 'system', content: sys }, ...(history ? history.map(m => ({ role: m.role, content: m.content })) : [{ role: 'user', content: vision ? toO(content) : toParts(content).map(x => x.text).join('\n') }])];
  const body = { model, messages, max_tokens: maxTokens, temperature: 0.4 };
  if (schema) body.response_format = { type: 'json_object' };
  if (stream) body.stream = true;
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = 'Bearer ' + key;
  if (id === 'openrouter') { headers['HTTP-Referer'] = location.origin; headers['X-Title'] = 'Garden Manager AI'; }
  const url = id === 'pollinations' ? baseFor(id, cfg) : `${baseFor(id, cfg)}/chat/completions`;
  let r;
  try { r = await doFetch(url, { method: 'POST', headers, body: JSON.stringify(body) }, id, timeoutMs); }
  catch (e) {
    if (e.code !== 'bad' || !body.response_format) throw e; // alcuni modelli non supportano la modalità JSON
    delete body.response_format;
    r = await doFetch(url, { method: 'POST', headers, body: JSON.stringify(body) }, id);
  }
  if (!stream) {
    const j = await r.json();
    const text = j.choices?.[0]?.message?.content || '';
    if (!text) throw new AIError(`${p.label}: risposta vuota.`, 'refusal', id);
    return { text: Array.isArray(text) ? text.map(t => t.text || '').join('') : text, sources: [], model };
  }
  let text = '';
  await readSSE(r, (data) => {
    if (data === '[DONE]') return;
    const j = JSON.parse(data);
    const t = j.choices?.[0]?.delta?.content || '';
    if (t) { text += t; onText && onText(t); }
  });
  if (!text) throw new AIError(`${p.label}: risposta vuota.`, 'refusal', id);
  return { text, sources: [], model };
}

async function readSSE(response, onData) {
  const reader = response.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line.startsWith('data:')) { const d = line.slice(5).trim(); if (d) { try { onData(d); } catch (e) { /* frammento non valido */ } } }
    }
  }
}

// Claude (a pagamento): SDK ufficiale caricato solo se scelto
let SDK = null, claude = null, claudeKey = null;
async function anthropicCall(id, cfg, { system, content, schema, maxTokens, stream, onText, history, webSearch, effort }) {
  const key = cfg.providers[id].key;
  if (!SDK) SDK = (await import('../vendor/anthropic-sdk.js')).default;
  if (!claude || claudeKey !== key) { claude = new SDK({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 2, timeout: 120000 }); claudeKey = key; }
  const model = modelFor(id, false, cfg);
  const toA = (parts) => toParts(parts).map(x => x.type === 'image' ? { type: 'image', source: { type: 'base64', media_type: x.media, data: x.data } } : x);
  const params = { model, max_tokens: maxTokens, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], output_config: { effort: effort || 'medium' }, messages: history ? history.map(m => ({ role: m.role, content: m.content })) : [{ role: 'user', content: toA(content) }] };
  if (/^claude-(opus|sonnet)/.test(model)) { params.betas = ['server-side-fallback-2026-07-01']; params.fallbacks = 'default'; }
  if (schema) params.output_config.format = { type: 'json_schema', schema };
  if (webSearch) params.tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 4 }];
  try {
    let msg;
    if (stream) { const s = claude.beta.messages.stream(params); s.on('text', t => onText && onText(t)); msg = await s.finalMessage(); }
    else msg = await claude.beta.messages.create(params);
    if (msg.stop_reason === 'refusal') throw new AIError('Claude non ha elaborato questa richiesta.', 'refusal', id);
    const sources = [];
    for (const b of msg.content) {
      if (b.type === 'text' && b.citations) for (const ci of b.citations) if (ci.url && !sources.find(s => s.url === ci.url)) sources.push({ url: ci.url, title: ci.title });
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const r of b.content) if (r.url && !sources.find(s => s.url === r.url)) sources.push({ url: r.url, title: r.title });
    }
    return { text: msg.content.filter(b => b.type === 'text').map(b => b.text).join(''), sources: sources.slice(0, 8), model };
  } catch (e) {
    if (e instanceof AIError) throw e;
    const st = e.status;
    if (st) throw httpError(st, e.error, id);
    throw new AIError('Claude: ' + (e.message || e), 'conn', id);
  }
}

const ADAPTERS = { gemini: geminiCall, openai: openaiCall, anthropic: anthropicCall };

// Esegue la richiesta sul servizio principale e, se serve, su quelli di riserva
async function run(opts, { onAttempt } = {}) {
  if (!hasAI()) throw new AIError('Configura almeno un servizio AI in Impostazioni (es. Google Gemini, gratuito).', 'nokey');
  const vision = hasImages(opts.content);
  const list = activeProviders({ vision });
  if (!list.length) throw new AIError('Nessuno dei servizi configurati legge le foto: attiva Google Gemini, Groq o Mistral.', 'novision');
  const cfg = aiConfig();
  const errors = [];
  for (const id of list) {
    onAttempt && onAttempt(id);
    try {
      if (PROVIDERS[id].needsKey && !cfg.providers[id].key) throw new AIError('Inserisci prima la chiave API.', 'auth', id);
  const res = await ADAPTERS[PROVIDERS[id].kind](id, cfg, opts);
      if (opts.schema) {
        try { res.json = coerce(opts.schema, parseJSON(res.text)); }
        catch (e) { throw new AIError(`${providerLabel(id)}: risposta non in formato JSON.`, 'parse', id); }
      }
      res.provider = id;
      lastProvider = id;
      return res;
    } catch (e) {
      const err = e instanceof AIError ? e : new AIError(e.message || String(e), 'unknown', id);
      errors.push(err);
      if (opts.stream && opts.started && opts.started()) break; // testo già mostrato: non ricominciare altrove
      if (!RETRYABLE.includes(err.code)) break;
    }
  }
  const e = errors[errors.length - 1];
  if (errors.length > 1) e.message += ` (provati: ${errors.map(x => providerLabel(x.provider)).join(', ')})`;
  throw e;
}
export let lastProvider = null;

export async function callJSON({ system, content, schema, maxTokens = 8000, effort = 'medium', withContext = true }) {
  const ctx = withContext ? await gardenContext() : '';
  const sys = [BASE_SYSTEM, system, ctx ? 'CONTESTO DEL GIARDINO\n' + ctx : ''].filter(Boolean).join('\n\n');
  const r = await run({ system: sys, content, schema, maxTokens: Math.max(maxTokens, 4096), effort, fast: effort === 'low' });
  return r.json;
}
export async function chatStream({ history, onText, webSearch = false }) {
  const ctx = await gardenContext();
  const system = BASE_SYSTEM + '\nRispondi in testo semplice (puoi usare elenchi con trattino e **grassetto**), senza tabelle. Separa in sezioni "Fatti", "Ipotesi" e "Consigli" quando utile. Indica le fonti quando le usi.\n\nCONTESTO DEL GIARDINO\n' + ctx;
  let started = false;
  const r = await run({ system, history, content: '', stream: true, maxTokens: 8000, webSearch: webSearch, onText: (t) => { started = true; onText && onText(t); }, started: () => started });
  return { text: r.text, sources: r.sources || [], provider: r.provider };
}

// Prova di collegamento di un singolo servizio
export async function testProvider(id, settings) {
  const cfg = aiConfig(settings);
  cfg.providers[id].enabled = true;
  const schema = { type: 'object', additionalProperties: false, required: ['ok', 'pianta'], properties: { ok: { type: 'boolean' }, pianta: { type: 'string' } } };
  const t0 = performance.now();
  const res = await ADAPTERS[PROVIDERS[id].kind](id, cfg, { system: 'Test di collegamento. Rispondi in modo brevissimo.', content: 'Rispondi con ok=true e il nome comune italiano di Ficus carica.', schema, maxTokens: 300, fast: true, timeoutMs: 30000, effort: 'low' });
  let parsed;
  try { parsed = coerce(schema, parseJSON(res.text)); } catch (e) { parsed = { ok: true, pianta: res.text.slice(0, 40) }; }
  return { ...parsed, model: res.model, seconds: ((performance.now() - t0) / 1000).toFixed(1) };
}
// Elenco dei modelli disponibili presso il servizio
export async function listModels(id, settings) {
  const cfg = aiConfig(settings);
  const p = PROVIDERS[id], key = cfg.providers[id].key, base = baseFor(id, cfg);
  if (p.needsKey && !key) throw new AIError('Inserisci prima la chiave API.', 'auth', id);
  if (p.kind === 'gemini') {
    const r = await doFetch(`${base}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } }, id, 20000);
    const j = await r.json();
    return (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace('models/', ''))
      .filter(n => /^(gemini|gemma)/.test(n) && !/(embedding|tts|image|audio|live|robotics|computer-use|veo|imagen)/.test(n));
  }
  if (p.kind === 'anthropic') return ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
  if (id === 'pollinations') return ['openai', 'mistral'];
  const r = await doFetch(`${base}/models`, { headers: key ? { Authorization: 'Bearer ' + key } : {} }, id, 20000);
  const j = await r.json();
  const ids = (j.data || j.models || []).map(m => m.id || m.name).filter(Boolean);
  return id === 'openrouter' ? ids.filter(x => x.endsWith(':free')) : ids;
}

const BASE_SYSTEM = `Sei il consulente botanico di "Garden Manager AI": esperto di botanica, orticoltura, frutticoltura, arboricoltura, fitopatologia, entomologia agraria e progettazione del verde, con riferimento al contesto italiano ed europeo.
Regole:
- Rispondi sempre in italiano, in modo concreto, tecnico e applicabile, adattando i consigli al giardino, al clima locale e alla filosofia di gestione dell'utente.
- Non inventare dati. Distingui chiaramente FATTI (dati botanici consolidati), IPOTESI (diagnosi o identificazioni non certe) e CONSIGLI. Se un'informazione non è nota o è incerta, dillo.
- Non dichiarare mai certa un'identificazione o una diagnosi se le informazioni non bastano: indica cosa serve per confermarla.
- Privilegia prevenzione e interventi a basso impatto ambientale. Per i prodotti fitosanitari indica solo categorie o sostanze consentite e rimanda sempre all'etichetta e ai bollettini del Servizio fitosanitario regionale; segnala gli organismi da quarantena (es. Xylella, colpo di fuoco, Popillia japonica) e l'obbligo di segnalazione.
- Quando citi fonti preferisci enti autorevoli: POWO (Kew), World Flora Online, GBIF, università e dipartimenti di agraria e botanica, CREA, Servizi fitosanitari regionali, EPPO.
- Non proporre interventi fuori stagione o non adatti alle specie presenti.`;

// Contesto del giardino per personalizzare le risposte
export async function gardenContext({ withPlants = true, withEvents = true } = {}) {
  const g = state.garden;
  if (!g) return 'Nessun giardino configurato.';
  const c = g.climate;
  const now = new Date();
  const lines = [
    `Data odierna: ${now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} (mese di ${MONTHS[now.getMonth()]}).`,
    `Giardino "${g.name}" a ${g.place || 'località non indicata'}${g.lat ? ` (lat ${g.lat.toFixed(3)}, lon ${g.lon.toFixed(3)}${g.elevation != null ? `, ${Math.round(g.elevation)} m s.l.m.` : ''})` : ''}.`,
    `Superficie ${g.area || '?'} m²; terreno: ${g.soil || 'n.d.'}${g.ph ? `, pH ${g.ph}` : ''}; esposizione: ${g.exposure || 'n.d.'}; zone d'ombra: ${g.shade || 'n.d.'}; pendenza: ${g.slope || 'n.d.'}.`,
    `Acqua: ${g.water || 'n.d.'}; irrigazione: ${g.irrigation || 'nessuna'}; zone umide/secche: ${g.wetDry || 'n.d.'}. Elementi presenti: ${(g.features || []).join(', ') || 'nessuno indicato'}.`,
    c ? `Clima (media ${c.years} anni, ERA5): ${c.type}, zona USDA ${c.zone}, minima assoluta media ${c.absMinAvg} °C, massima assoluta media ${c.absMaxAvg} °C, piogge ${c.annualRain} mm/anno, ultima gelata tipica ${c.lastFrost || '—'}, prima gelata tipica ${c.firstFrost || '—'}, mesi siccitosi: ${c.dryMonths.map(m => MONTHS[m - 1]).join(', ') || 'nessuno'}.` : 'Clima locale non ancora calcolato.',
    `Filosofia di gestione scelta dall'utente: ${modeLabel()}.`,
  ];
  if (withPlants) {
    const plants = await gardenPlants();
    if (plants.length) {
      lines.push('Piante presenti:');
      for (const p of plants.slice(0, 80)) {
        const s = await getSpecies(p.speciesId);
        lines.push(`- ${p.name}${p.variety ? ' «' + p.variety + '»' : ''} (${s?.sci || p.sci || 'specie n.d.'}), n. ${p.qty || 1}, posizione: ${p.position || 'n.d.'}, esposizione: ${p.exposure || 'n.d.'}, salute: ${p.health || 'n.d.'}${p.age ? ', età ' + p.age : ''}${p.height ? ', altezza ' + p.height + ' m' : ''}${p.notes ? ', note: ' + p.notes.slice(0, 160) : ''}`);
      }
    } else lines.push('Nessuna pianta ancora registrata.');
  }
  if (withEvents) {
    const ev = (await db.byIndex('events', 'gardenId', g.id)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 25);
    if (ev.length) {
      lines.push('Interventi e problemi recenti:');
      const plants = Object.fromEntries((await gardenPlants(g.id, { includeArchived: true })).map(p => [p.id, p.name]));
      for (const e of ev) lines.push(`- ${e.date.slice(0, 10)} ${plants[e.plantId] || ''} [${e.type}] ${String(e.text || '').slice(0, 180)}`);
    }
  }
  return lines.join('\n');
}


// ── Schemi JSON ──
const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });
const arr = (items, description) => ({ type: 'array', items, description });
const obj = (properties, description) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false, ...(description ? { description } : {}) });

export const SCHEMA_IDENTIFY = obj({
  sufficiente: { type: 'boolean', description: 'true se le informazioni bastano per una identificazione affidabile' },
  nota_qualita: str('Commento sulla qualità di foto/descrizione e cosa manca'),
  candidati: arr(obj({
    nome_comune: str('Nome comune italiano'), nome_scientifico: str('Nome scientifico accettato con autore se noto'), famiglia: str('Famiglia botanica'),
    varieta_probabile: str('Varietà o cultivar probabile, o stringa vuota se non identificabile'), affidabilita: num('Percentuale 0-100'),
    caratteri_osservati: arr(str('carattere'), 'Caratteri morfologici osservati a supporto (foglie, fiori, frutti, corteccia, portamento)'),
    caratteri_distintivi: str('Come riconoscerla con certezza'), categoria: { type: 'string', enum: ['alberi', 'frutto', 'arbusti', 'fiori', 'vaso', 'orto', 'prato'] },
  }), 'Da 1 a 4 specie, in ordine di probabilità'),
  specie_simili: arr(obj({ nome: str('Specie simile'), differenze: str('Come distinguerla') }), 'Specie da non confondere'),
  verifiche: arr(str('verifica'), 'Cosa osservare o fotografare per confermare'),
});

export const SCHEMA_DIAGNOSIS = obj({
  certezza: { type: 'string', enum: ['diagnosi probabile', 'ipotesi', 'informazioni insufficienti'], description: 'Livello di certezza complessivo' },
  sintomi_osservati: arr(str('sintomo'), 'Sintomi effettivamente visibili o descritti'),
  problema_principale: obj({ nome: str('Problema più probabile'), tipo: str('fungino, batterico, virale, insetto, acaro, carenza, stress idrico, problema radicale, fisiopatia, danno meccanico...'), agente: str('Agente causale con nome scientifico se pertinente, altrimenti stringa vuota'), affidabilita: num('0-100'), motivazione: str('Perché è il più probabile') }),
  alternative: arr(obj({ nome: str('Causa alternativa'), affidabilita: num('0-100'), come_distinguerla: str('Elemento che la distingue') }), 'Diagnosi differenziale'),
  verifiche: arr(str('verifica'), 'Controlli da fare per confermare (es. rovescio delle foglie, colletto, radici, umidità)'),
  intervento: arr(str('azione'), 'Interventi consigliati coerenti con la filosofia di gestione, dal meno al più impattante'),
  prevenzione: arr(str('azione'), 'Prevenzione futura'),
  urgenza: { type: 'string', enum: ['bassa', 'media', 'alta'] },
  organismo_da_quarantena: { type: 'boolean', description: 'true se potrebbe trattarsi di organismo da quarantena da segnalare' },
});

const problemSchema = obj({ nome: str('nome'), tipo: str('fungino, batterico, virale, insetto, carenza, stress idrico, radicale...'), sintomi: str('sintomi'), cause: str('cause e condizioni favorevoli'), prevenzione: str('prevenzione'), diagnosi_differenziale: str('come distinguerlo da problemi simili'), intervento_biologico: str('intervento a basso impatto'), intervento_convenzionale: str('intervento convenzionale con categorie di prodotti autorizzati, rimandando all\'etichetta'), mesi_rischio: arr({ type: 'integer' }, 'mesi 1-12 di maggiore rischio') });
const taskSchema = obj({ mesi: arr({ type: 'integer' }, 'mesi 1-12 riferiti al clima del giardino'), tipo: { type: 'string', enum: ['irrigazione', 'potatura', 'concimazione', 'semina', 'trapianto', 'rinvaso', 'raccolta', 'trattamento', 'controllo', 'pulizia', 'taglio', 'arieggiatura', 'risemina', 'protezione', 'trasporto', 'moltiplicazione'] }, istruzione: str('istruzione operativa breve e specifica'), priorita: { type: 'integer', description: '1 normale, 2 importante, 3 urgente/decisiva' } });
export const SCHEMA_SHEET = obj({
  nome_comune: str(''), nome_scientifico: str('nome accettato con autore'), sinonimi: arr(str(''), ''), famiglia: str(''), origine: str(''), ciclo: str('ciclo vegetativo'), longevita: str(''),
  altezza_maturita: str(''), larghezza_maturita: str(''), velocita_crescita: str(''),
  categoria: { type: 'string', enum: ['alberi', 'frutto', 'arbusti', 'fiori', 'vaso', 'orto', 'prato'] }, sottocategorie: arr(str(''), ''),
  esposizione: str(''), ore_sole: str(''), temperature_ideali: str(''), temperatura_minima_c: num('minima sopportata in °C'), resistenza_caldo: str(''), umidita: str(''), terreno: str(''), ph_min: num(''), ph_max: num(''), drenaggio: str(''),
  fabbisogno_idrico: { type: 'string', enum: ['bassa', 'media', 'alta'] },
  irrigazione: str('frequenza e quantità indicative'), concimazione: str('tipo di fertilizzante e periodo'), potatura: str('periodo e tecnica'), rinvaso_trapianto: str(''), moltiplicazione: str(''), pacciamatura: str(''), pulizia: str(''),
  stagioni: obj({ primavera: str(''), estate: str(''), autunno: str(''), inverno: str('') }),
  calendario: arr(taskSchema, 'operazioni mensili specifiche per la specie'),
  problemi: arr(problemSchema, 'principali problemi fitosanitari della specie (malattie fungine, batteriosi, virus, parassiti, carenze, stress idrico, problemi radicali)'),
  propagazione: arr(str(''), 'tecniche di propagazione adatte (semina, talea, margotta, propaggine, divisione, innesto)'),
  note_tossicita_invasivita: str('tossicità per persone/animali, invasività; stringa vuota se non pertinente'),
  fonti: arr(str(''), 'tipi di fonti autorevoli su cui si basano i dati'),
});

export const SCHEMA_TIP = obj({ consiglio: str('Una sola azione concreta, massimo 2 frasi'), motivo: str('Perché oggi: stagione, meteo, pianta'), pianta: str('Nome della pianta interessata o stringa vuota'), categoria: str('irrigazione, potatura, controllo, semina, ...') });

export const SCHEMA_DESIGN = obj({
  analisi: str('Analisi sintetica del sito: luce, spazi, punti di forza e criticità'),
  proposte: arr(obj({
    titolo: str(''), descrizione: str(''), zona: str('dove'),
    piante: arr(obj({ nome: str('nome comune'), nome_scientifico: str(''), quantita: { type: 'integer' }, distanza_impianto_m: num(''), dimensione_maturita: str('altezza × larghezza'), motivo: str('ruolo estetico/funzionale'), fabbisogno_idrico: str(''), compatibilita: str('note su esposizione, radici, competizione con le piante esistenti') }), ''),
    manutenzione: { type: 'string', enum: ['bassa', 'media', 'alta'] },
  }), 'Da 2 a 4 proposte'),
  abbinamenti_cromatici: str(''), biodiversita: str('come aumentare insetti utili, impollinatori, uccelli'), avvertenze: arr(str(''), 'incompatibilità, distanze da confini e fondazioni, specie invasive da evitare'),
});

// Converte una scheda AI nel formato specie dell'app
export function sheetToSpecies(j, base = {}) {
  return {
    ...base,
    it: j.nome_comune || base.it, sci: j.nome_scientifico || base.sci, fam: j.famiglia || base.fam, cat: j.categoria || base.cat || 'fiori',
    subs: j.sottocategorie?.length ? j.sottocategorie : base.subs || [], aliases: j.sinonimi || [],
    origin: j.origine, cycle: j.ciclo, life: j.longevita, size: { h: j.altezza_maturita, w: j.larghezza_maturita }, growth: j.velocita_crescita,
    sun: j.esposizione, sunH: j.ore_sole, tIdeal: j.temperature_ideali, tMin: j.temperatura_minima_c, heat: j.resistenza_caldo, hum: j.umidita, soil: j.terreno, ph: [j.ph_min, j.ph_max], drain: j.drenaggio,
    water: j.fabbisogno_idrico, wg: base.wg || ({ alberi: 'alberi', frutto: 'alberi', arbusti: 'arbusti', fiori: 'perenni', vaso: 'vaso', orto: 'orto', prato: 'prato' })[j.categoria] || 'perenni',
    kc: base.kc || ({ bassa: 0.45, media: 0.7, alta: 0.95 })[j.fabbisogno_idrico] || 0.7,
    care: { irr: j.irrigazione, conc: j.concimazione, pot: j.potatura, trap: j.rinvaso_trapianto, molt: j.moltiplicazione, pacc: j.pacciamatura, pul: j.pulizia },
    seasons: j.stagioni,
    tasks: (j.calendario || []).map(t => ({ m: t.mesi.filter(m => m >= 1 && m <= 12), ty: t.tipo, x: t.istruzione, p: Math.max(1, Math.min(3, t.priorita || 1)), sh: 0, local: true })),
    problems: (j.problemi || []).map(p => ({ n: p.nome, k: p.tipo, s: p.sintomi, c: p.cause, pv: p.prevenzione, d: p.diagnosi_differenziale, bio: p.intervento_biologico, cla: p.intervento_convenzionale, r: p.mesi_rischio })),
    prop: j.propagazione, warn: j.note_tossicita_invasivita, sourcesText: j.fonti, aiSheet: true, aiDate: new Date().toISOString(),
  };
}

// Testo dei problemi per la gestione corrente, utile alle risposte locali
export function problemSummary(sp) {
  return (sp.problems || []).map(p => `${p.n}: ${interventionFor(p).text}`).join('\n');
}
