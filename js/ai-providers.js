// Servizi AI selezionabili. Priorità ai servizi con piano gratuito utilizzabile dal browser.
// I nomi dei modelli sono modificabili e si possono aggiornare dall'elenco del servizio,
// perché i piani gratuiti cambiano spesso.
export const PROVIDERS = {
  gemini: {
    models: ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'],
    label: 'Google Gemini', kind: 'gemini', free: 'gratuito', base: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-flash-latest', visionModel: '', vision: true, webSearch: true, needsKey: true,
    keyUrl: 'https://aistudio.google.com/apikey',
    note: 'Consigliato. Piano gratuito senza carta di credito (modelli Flash e Flash-Lite), legge le foto, ricerca Google con fonti nel consulente. Limiti giornalieri variabili; nel piano gratuito Google può usare i dati per migliorare i servizi.',
  },
  groq: {
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'meta-llama/llama-4-scout-17b-16e-instruct', 'meta-llama/llama-4-maverick-17b-128e-instruct', 'qwen/qwen3-32b', 'openai/gpt-oss-120b'],
    label: 'Groq (Llama, Qwen…)', kind: 'openai', free: 'gratuito', base: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile', visionModel: 'meta-llama/llama-4-scout-17b-16e-instruct', vision: true, needsKey: true,
    keyUrl: 'https://console.groq.com/keys',
    note: 'Piano gratuito senza carta, molto veloce. Limiti per minuto e per giorno variabili per modello; le foto usano un modello visione dedicato.',
  },
  mistral: {
    models: ['mistral-small-latest', 'mistral-medium-latest', 'mistral-large-latest', 'pixtral-12b-latest', 'open-mistral-nemo'],
    label: 'Mistral AI', kind: 'openai', free: 'a pagamento', base: 'https://api.mistral.ai/v1',
    model: 'mistral-small-latest', visionModel: 'mistral-small-latest', vision: true, needsKey: true,
    keyUrl: 'https://console.mistral.ai/api-keys',
    note: 'API a pagamento a consumo (nessun piano gratuito disponibile per i nuovi account). Azienda europea, buona qualità in italiano. I modelli Mistral gratuiti sono a volte disponibili tramite OpenRouter.',
  },
  openrouter: {
    models: ['meta-llama/llama-3.3-70b-instruct:free', 'google/gemma-3-27b-it:free', 'deepseek/deepseek-chat-v3.1:free', 'qwen/qwen-2.5-72b-instruct:free', 'mistralai/mistral-small-3.2-24b-instruct:free'],
    label: 'OpenRouter (modelli :free)', kind: 'openai', free: 'gratuito con limiti', base: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.3-70b-instruct:free', visionModel: 'google/gemma-3-27b-it:free', vision: true, needsKey: true,
    keyUrl: 'https://openrouter.ai/keys',
    note: 'Un\'unica chiave per molti modelli gratuiti (DeepSeek, Llama, Gemma, Qwen…): usa i modelli che finiscono con ":free". Circa 50 richieste al giorno gratuite (1000 dopo una ricarica di 10 $). I modelli gratuiti cambiano spesso.',
  },
  cerebras: {
    models: ['llama-3.3-70b', 'llama3.1-8b', 'qwen-3-32b', 'gpt-oss-120b'],
    label: 'Cerebras', kind: 'openai', free: 'a pagamento', base: 'https://api.cerebras.ai/v1',
    model: 'llama-3.3-70b', visionModel: '', vision: false, needsKey: true,
    keyUrl: 'https://cloud.cerebras.ai/',
    note: 'API a pagamento (credito di prova solo dopo aver inserito un metodo di pagamento); solo testo, niente foto.',
  },
  huggingface: {
    models: ['meta-llama/Llama-3.3-70B-Instruct', 'Qwen/Qwen2.5-72B-Instruct', 'Qwen/Qwen2.5-VL-7B-Instruct'],
    label: 'Hugging Face', kind: 'openai', free: 'piccolo credito mensile', base: 'https://router.huggingface.co/v1',
    model: 'meta-llama/Llama-3.3-70B-Instruct', visionModel: 'Qwen/Qwen2.5-VL-7B-Instruct', vision: true, needsKey: true,
    keyUrl: 'https://huggingface.co/settings/tokens',
    note: 'Credito gratuito mensile ridotto: adatto come riserva.',
  },
  deepseek: {
    models: ['deepseek-chat', 'deepseek-reasoner'],
    label: 'DeepSeek', kind: 'openai', free: 'economico (crediti iniziali)', base: 'https://api.deepseek.com',
    model: 'deepseek-chat', visionModel: '', vision: false, needsKey: true,
    keyUrl: 'https://platform.deepseek.com/api_keys',
    note: 'API molto economica, a volte con crediti iniziali; solo testo. I modelli DeepSeek sono usabili gratis anche tramite OpenRouter.',
  },
  pollinations: {
    models: ['openai', 'mistral'],
    label: 'Pollinations (senza chiave)', kind: 'openai', free: 'gratuito, sperimentale', base: 'https://text.pollinations.ai/openai',
    model: 'openai', visionModel: 'openai', vision: true, needsKey: false, endpoint: '',
    keyUrl: 'https://pollinations.ai/',
    note: 'Funziona senza chiave ma con limiti stretti e affidabilità variabile. Sconsigliato per dati personali: le richieste passano da un servizio comunitario.',
  },
  ollama: {
    models: ['llama3.2-vision', 'llama3.2', 'gemma3', 'qwen2.5'],
    label: 'Ollama (sul tuo computer)', kind: 'openai', free: 'gratuito, locale', base: 'http://localhost:11434/v1',
    model: 'llama3.2-vision', visionModel: 'llama3.2-vision', vision: true, needsKey: false,
    keyUrl: 'https://ollama.com/download',
    note: 'Modelli eseguiti sul tuo computer: gratuiti e privati. Avvia Ollama con OLLAMA_ORIGINS impostato all\'indirizzo dell\'app.',
  },
  openai: {
    models: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o'],
    label: 'OpenAI GPT', kind: 'openai', free: 'a pagamento', base: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini', visionModel: 'gpt-4o-mini', vision: true, needsKey: true,
    keyUrl: 'https://platform.openai.com/api-keys',
    note: 'Nessun piano API gratuito (ChatGPT gratuito non include l\'API).',
  },
  anthropic: {
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    label: 'Anthropic Claude', kind: 'anthropic', free: 'a pagamento', base: 'https://api.anthropic.com',
    model: 'claude-opus-5-5', visionModel: '', vision: true, webSearch: true, needsKey: true,
    keyUrl: 'https://console.anthropic.com/',
    note: 'A pagamento a consumo. Massima qualità per diagnosi e schede.',
  },
  custom: {
    models: [],
    label: 'Altro servizio compatibile OpenAI', kind: 'openai', free: '—', base: '',
    model: '', visionModel: '', vision: true, needsKey: false,
    keyUrl: '',
    note: 'Qualsiasi servizio con API compatibile OpenAI (es. LM Studio, Together, SambaNova, Nvidia NIM): indica indirizzo, chiave e modello.',
  },
};

// Servizi valutati e non inclusi, con il motivo (mostrati in Impostazioni)
export const NOT_INCLUDED = [
  ['Mistral e Cerebras come servizi gratuiti', 'nessun piano gratuito disponibile: restano selezionabili come servizi a pagamento.'],
  ['Perplexity', 'l\'API Sonar non ha un piano gratuito (solo crediti per abbonati Pro).'],
  ['Notion AI', 'non offre un\'API pubblica per generare testo.'],
  ['ChatGPT, Copilot, Gemini app', 'le app gratuite non sono utilizzabili da altre applicazioni: serve l\'API.'],
  ['GitHub Models', 'servizio gratuito segnalato come dismesso nel 2026.'],
];

// prima i servizi gratuiti, poi quelli a pagamento
const paid = (id) => /pagamento|economico/.test(PROVIDERS[id].free);
export const PROVIDER_ORDER = [...Object.keys(PROVIDERS).filter(id => !paid(id) && id !== 'custom'), ...Object.keys(PROVIDERS).filter(id => paid(id)), 'custom'];
