# Garden Manager AI

Assistente personale per giardino, orto, frutteto e prato. Web app PWA installabile su Android, iOS e desktop,
che funziona offline per schede e attività. L'architettura e i costi sono descritti in [ARCHITETTURA.md](ARCHITETTURA.md).

## Avvio

Sono file statici, senza passaggi di build:

```bash
python3 -m http.server 8765    # poi apri http://localhost:8765
```

Per la pubblicazione basta un hosting statico con HTTPS (GitHub Pages, Netlify, Cloudflare Pages).
HTTPS serve per il service worker, le notifiche, la fotocamera e la geolocalizzazione.

## Configurazione

1. Al primo accesso crei il giardino (località, terreno, esposizione…). Il clima locale viene calcolato da 10 anni di dati ERA5.
2. In **Impostazioni** inserisci la chiave API Claude (console.anthropic.com) per riconoscimento, diagnosi, schede AI, progettazione e consulente.
   La chiave resta nel dispositivo e non entra nei backup.
3. Scegli la filosofia di gestione (biologica, integrata, classica, permacultura, personalizzata) e le notifiche.

## Cosa funziona senza chiave AI

Archivio botanico curato (76 specie con calendari e problemi specifici), ricerca illimitata su GBIF, immagini con licenza,
meteo, clima, irrigazione, calendario automatico, notifiche, consiglio del giorno (da regole), orto con rotazioni e consociazioni,
prato, planimetria con verifiche, esportazione ICS, backup.

## Test

```bash
python3 -m http.server 8765 &
node tests/e2e.js              # Playwright; i servizi esterni sono simulati in tests/mocks.js
```

## Struttura

- `js/data/species.js` archivio curato · `js/store.js` dati · `js/tasks.js` attività e ICS · `js/irrigation.js` bilancio idrico
- `js/weather.js` meteo e clima · `js/ai.js` Claude · `js/botany.js` GBIF, iNaturalist, Commons · `js/tips.js` consiglio del giorno
- `js/views/*` schermate · `sw.js` offline e notifiche in background · `vendor/anthropic-sdk.js` SDK ufficiale (caricato solo quando serve)
