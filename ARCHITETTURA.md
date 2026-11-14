# Garden Manager AI — Architettura e piano

## 1. Architettura dell'applicazione

Web app **PWA local-first**, senza passaggi di build: HTML + CSS + JavaScript (moduli ES nativi).

```
┌──────────────────────────── Browser / PWA installata ────────────────────────────┐
│  Shell (index.html) ─ router hash ─ viste (js/views/*)                           │
│        │                                                                         │
│  Moduli di dominio: garden · plants · tasks · weather · irrigation · tips ·      │
│                     notify · ics · design · orto · lawn · ai · botany            │
│        │                                                                         │
│  IndexedDB (db.js): giardini, piante, specie, attività, storico, foto (Blob),    │
│                     progetti, aiuole, chat, cache                                │
│  Service Worker (sw.js): cache app shell (offline) + notifiche + periodic sync   │
└──────────┬───────────────┬────────────────┬──────────────────┬───────────────────┘
           │               │                │                  │
     Claude API      Open-Meteo        GBIF / iNaturalist   Wikimedia Commons
  (riconoscimento,  (meteo, ET0,       (nomenclatura,       (immagini con
   diagnosi, schede, geocoding, clima    immagini con         licenza e autore)
   consulente)       storico ERA5)       licenza CC)
```

* **Local-first**: tutti i dati restano sul dispositivo (IndexedDB) e funzionano offline.
  Le funzioni AI, il meteo e le ricerche online richiedono la connessione.
* **AI**: chiamate dirette dal browser all'API Claude con la **chiave dell'utente**
  (memorizzata solo nel dispositivo). SDK ufficiale `@anthropic-ai/sdk` incluso in locale
  (`vendor/`) e caricato **solo al primo uso** di una funzione AI. Output strutturati
  (JSON Schema) per riconoscimento, diagnosi, schede e progettazione.
* **Moduli indipendenti**: ogni sezione è un file in `js/views/`; la logica in `js/`.

## 2. Struttura delle schermate

| Schermata | Contenuto |
|---|---|
| Dashboard | saluto, meteo, allerte gelo/caldo, consiglio del giorno, attività di oggi e prossime, piante da seguire, irrigazione, categorie, accessi rapidi |
| Il mio giardino | dati del giardino, clima locale, piante dell'utente (filtri, stato), schede individuali con storico e confronto foto |
| Piante (archivio) | archivio curato + specie aggiunte + ricerca illimitata su GBIF, filtri per categoria, schede botaniche |
| Riconoscimento | da foto, da descrizione, confronto immagini web con licenza e conferma |
| Calendario | vista mese/lista, attività generate e manuali, ricorrenze, completamento/posticipo/sospensione, esportazione ICS |
| Diagnostica | foto + sintomi → diagnosi differenziale con affidabilità |
| Progettazione | analisi AI di foto e zone, planimetria interattiva, più ipotesi confrontabili |
| Orto | aiuole, colture per stagione, rotazioni, consociazioni, calendario semine |
| Prato | profilo del prato, altezza e frequenza di taglio, calendario interventi |
| Consulente AI | chat con il contesto del giardino, ricerca web facoltativa con fonti |
| Impostazioni | chiave AI e modello, tema, filosofia di gestione, notifiche, backup |

## 3. Database (IndexedDB, versionato)

| Store | Chiave | Campi principali |
|---|---|---|
| `gardens` | id | nome, località, lat/lon, superficie, terreno, esposizione, ombra, pendenza, acqua, irrigazione, zone umide/secche, elementi (serra, orto, frutteto, stagno…), clima calcolato |
| `species` | id | nomi, famiglia, categoria/sottocategoria, esigenze, calendario mensile delle operazioni, problemi, propagazione, scheda AI (cache), fonti |
| `plants` | id | gardenId, speciesId, nome, varietà, quantità, posizione, date, età, dimensioni, esposizione, terreno, salute, note, stato (attiva/archiviata) |
| `tasks` | id | gardenId, plantId?, tipo, titolo, istruzioni, data, priorità, ricorrenza, stato, origine (auto/manuale), note, foto |
| `events` | id | plantId, gardenId, data, tipo (potatura, foto, diagnosi, salute…), testo, foto |
| `photos` | id | Blob JPEG compresso, plantId, data |
| `designs` | id | gardenId, nome, dimensioni, elementi della planimetria, analisi AI |
| `beds` | id | gardenId, nome, dimensioni, colture per anno/stagione |
| `chats` | id | gardenId, messaggi |
| `kv` | chiave | impostazioni, cache meteo/clima/consigli, notifiche inviate |

Il backup esporta tutto (foto comprese) in un file JSON reimportabile.

## 4. Tecnologie

* HTML5, CSS con variabili (tema chiaro/scuro), JavaScript ES2022 a moduli, nessun framework.
* IndexedDB, Service Worker, Web App Manifest, Notification API, Periodic Background Sync (dove supportato).
* SVG per la planimetria; Canvas per comprimere le foto.
* Claude API (modello predefinito `claude-opus-5-5`, selezionabile).

## 5. Integrazioni esterne

| Servizio | Uso | Costo | Chiave |
|---|---|---|---|
| Claude API (Anthropic) | AI | a consumo | sì, dell'utente |
| Open-Meteo Forecast | meteo, ET0, previsioni 7 gg | gratuito (uso non commerciale) | no |
| Open-Meteo Archive (ERA5) | clima locale su 10 anni | gratuito | no |
| Open-Meteo Geocoding | comune → coordinate | gratuito | no |
| GBIF Species API | nomenclatura accettata, ricerca illimitata | gratuito | no |
| iNaturalist API | foto con licenza Creative Commons | gratuito | no |
| Wikimedia Commons API | foto con licenza e autore | gratuito | no |
| Calendari | file ICS (Apple, Outlook, Google, AgendApp se importa ICS), link "aggiungi a Google Calendar / Outlook" | gratuito | no |

**AgendApp**: non risultano API pubbliche documentate. L'integrazione avviene tramite
file iCalendar (.ics) o tramite un calendario già sincronizzato (Google/Apple/Outlook).

POWO/Kew e World Flora Online non offrono API pubbliche utilizzabili dal browser: le schede
riportano i link diretti alle loro pagine per la verifica.

## 6. Costi di gestione stimati

* **Hosting**: gratuito (GitHub Pages, Netlify, Cloudflare Pages: sono file statici).
* **Dati meteo e botanici**: gratuiti.
* **AI** (prezzi Claude Opus 5.5: 4 $/M token in input, 20 $/M in output):
  riconoscimento da foto ≈ 0,02–0,04 $; diagnosi ≈ 0,03–0,05 $; scheda botanica completa
  ≈ 0,08–0,15 $ (generata una volta, poi salvata); consiglio del giorno ≈ 0,01 $ (uno al giorno);
  domanda al consulente ≈ 0,01–0,05 $. Uso tipico di un utente: **1–4 $ al mese**.
  Con Claude Sonnet 5.5 i costi si dimezzano; con Haiku 5.5 scendono di circa 40 volte.
* Risparmio: schede e consigli in cache, foto ridotte a 1280 px, prompt di sistema in cache.

## 7. Piano di sviluppo

* **Fase 1 (fatta)**: giardini, archivio, inserimento manuale, riconoscimento da foto e
  descrizione, schede, calendario, notifiche, consiglio del giorno.
* **Fase 2 (fatta)**: diagnostica AI, meteo, irrigazione, progettazione, prato, orto,
  esportazione verso calendari esterni.
* **Fase 3**: fatte la planimetria interattiva, il confronto foto nel tempo, la gestione di
  più giardini e la verifica di biodiversità nella progettazione. Restano da fare:
  account e sincronizzazione tra dispositivi (backend Supabase: Auth + Postgres + Storage,
  con le stesse tabelle), sensori di umidità (oggi si può inserire la lettura a mano),
  notifiche push da server (oggi: notifiche locali e periodic sync), pianificazione pluriennale.
