// Integrazione con Claude (Anthropic). L'SDK ufficiale è incluso in /vendor e caricato solo
// al primo utilizzo. La chiave API resta nel dispositivo dell'utente.
import { state, gardenPlants, getSpecies, modeLabel, interventionFor } from './store.js';
import { db } from './db.js';
import { MONTHS } from './ui.js';

export const MODELS = [
  ['claude-opus-5-5', 'Claude Opus 5.5 — massima qualità (≈ 4/20 $ per M token)'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5 — equilibrio (≈ 2/10 $ per M token)'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5 — economico (≈ 0,10/0,50 $ per M token)'],
];

let SDK = null, client = null, clientKey = null;
async function getClient() {
  const key = state.settings?.apiKey;
  if (!key) throw new AIError('Per usare le funzioni AI inserisci la tua chiave API Claude in Impostazioni.', 'nokey');
  if (!navigator.onLine) throw new AIError('Sei offline: le funzioni AI richiedono una connessione.', 'offline');
  if (!SDK) SDK = (await import('../vendor/anthropic-sdk.js')).default;
  if (!client || clientKey !== key) {
    // La chiamata parte dal browser con la chiave personale dell'utente (app local-first).
    client = new SDK({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 2, timeout: 120000 });
    clientKey = key;
  }
  return client;
}
export const hasAI = () => !!state.settings?.apiKey;

export class AIError extends Error { constructor(msg, code) { super(msg); this.code = code; } }
function mapError(e) {
  if (e instanceof AIError) return e;
  const S = SDK || {};
  if (S.AuthenticationError && e instanceof S.AuthenticationError) return new AIError('Chiave API non valida o revocata. Controllala in Impostazioni.', 'auth');
  if (S.PermissionDeniedError && e instanceof S.PermissionDeniedError) return new AIError('La chiave non ha accesso a questo modello. Prova un altro modello in Impostazioni.', 'perm');
  if (S.RateLimitError && e instanceof S.RateLimitError) return new AIError('Troppe richieste in poco tempo: riprova tra un minuto.', 'rate');
  if (S.APIConnectionError && e instanceof S.APIConnectionError) return new AIError('Connessione al servizio AI non riuscita. Verifica la rete.', 'conn');
  if (S.BadRequestError && e instanceof S.BadRequestError) return new AIError('Richiesta non accettata dal servizio AI: ' + (e.error?.error?.message || e.message), 'bad');
  if (S.APIError && e instanceof S.APIError) return new AIError(`Errore del servizio AI (${e.status || '—'}). Riprova più tardi.`, 'api');
  return new AIError(e.message || String(e), 'unknown');
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

function requestBase(model) {
  const m = model || state.settings?.model || 'claude-opus-5-5';
  const base = { model: m };
  // Fallback lato server in caso di rifiuto (non disponibile per Haiku)
  if (m.startsWith('claude-opus') || m.startsWith('claude-sonnet')) { base.betas = ['server-side-fallback-2026-07-01']; base.fallbacks = 'default'; }
  return base;
}
function textOf(msg) { return msg.content.filter(b => b.type === 'text').map(b => b.text).join(''); }
function checkStop(msg) {
  if (msg.stop_reason === 'refusal') throw new AIError('Il servizio AI non ha elaborato questa richiesta. Riformula la domanda.', 'refusal');
  if (msg.stop_reason === 'max_tokens') throw new AIError('Risposta troppo lunga e interrotta: riprova con una richiesta più mirata.', 'max');
}

// Chiamata con output strutturato (JSON Schema)
export async function callJSON({ system, content, schema, maxTokens = 8000, effort = 'medium', model, withContext = true }) {
  const c = await getClient();
  const ctx = withContext ? await gardenContext() : '';
  const sys = [{ type: 'text', text: BASE_SYSTEM }, ...(system ? [{ type: 'text', text: system }] : []), ...(ctx ? [{ type: 'text', text: 'CONTESTO DEL GIARDINO\n' + ctx }] : [])];
  sys[sys.length - 1].cache_control = { type: 'ephemeral' };
  try {
    const msg = await c.beta.messages.create({
      ...requestBase(model), max_tokens: maxTokens, system: sys,
      output_config: { effort, format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content }],
    });
    checkStop(msg);
    return JSON.parse(textOf(msg));
  } catch (e) { throw mapError(e); }
}

// Chat del consulente in streaming, con ricerca web facoltativa
export async function chatStream({ history, onText, webSearch = false }) {
  const c = await getClient();
  const ctx = await gardenContext();
  const system = [
    { type: 'text', text: BASE_SYSTEM + '\nRispondi in testo semplice (puoi usare elenchi con trattino e **grassetto**), senza tabelle. Separa in sezioni "Fatti", "Ipotesi" e "Consigli" quando utile. Indica le fonti quando le usi.' },
    { type: 'text', text: 'CONTESTO DEL GIARDINO\n' + ctx, cache_control: { type: 'ephemeral' } },
  ];
  const params = { ...requestBase(), max_tokens: 16000, system, output_config: { effort: 'medium' }, messages: history };
  if (webSearch) params.tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 4 }];
  try {
    const stream = c.beta.messages.stream(params);
    stream.on('text', (t) => onText && onText(t));
    const msg = await stream.finalMessage();
    checkStop(msg);
    const sources = [];
    for (const b of msg.content) {
      if (b.type === 'text' && b.citations) for (const ci of b.citations) if (ci.url && !sources.find(s => s.url === ci.url)) sources.push({ url: ci.url, title: ci.title });
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const r of b.content) if (r.url && !sources.find(s => s.url === r.url)) sources.push({ url: r.url, title: r.title });
    }
    return { text: textOf(msg), sources: sources.slice(0, 8), content: msg.content };
  } catch (e) { throw mapError(e); }
}

export function imageBlock(b64, media = 'image/jpeg') { return { type: 'image', source: { type: 'base64', media_type: media, data: b64 } }; }

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
