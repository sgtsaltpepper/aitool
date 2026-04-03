# AI SEO Audit

Internt Next.js-verktøy for å analysere om et nettsted er optimalisert for både klassisk søk og AI-drevne assistenter som ChatGPT, Gemini, Copilot og Perplexity.

## Hva verktøyet gjør

- Crawler offentlige sider på samme domene
- Leser `robots.txt`, `sitemap.xml`, metadata, canonicals, schema og internlenker
- Sammenligner rå HTML med rendret DOM via Playwright for å avdekke CSR vs SSR
- Beregner kategoriscorer, providerprofiler, topic clusters og konkurransegap
- Analyserer E-E-A-T-signaler (Experience, Expertise, Authoritativeness, Trust)
- Lagrer score-historikk i SQLite for trendanalyse over tid

## Kjør lokalt

```bash
npm install
npm run dev
```

Åpne deretter [http://localhost:3000](http://localhost:3000).

## Kjør med Docker

```bash
docker compose up
```

Appen er tilgjengelig på [http://localhost:3000](http://localhost:3000). Data lagres i et lokalt volum under `.data/`.

For debugging med inspector:

```bash
docker compose -f compose.debug.yaml up
```

## API

| Metode | Endepunkt | Beskrivelse |
|--------|-----------|-------------|
| `POST` | `/api/audits` | Start ny analyse |
| `GET` | `/api/audits/:id` | Hent status og fremdrift |
| `GET` | `/api/audits/:id/report` | Hent fullstendig rapport |
| `GET` | `/api/audits/:id/suggestions` | Eksporter anbefalinger som Markdown |
| `GET` | `/api/audits/trends?domain=&days=` | Historiske scorer for et domene |
| `GET` | `/api/queue/worker` | Gjenopprett ventende jobber (cron-trigger) |

Eksempel på `POST /api/audits`:

```json
{
  "targetUrl": "https://example.no",
  "locale": "nb-NO",
  "country": "NO",
  "competitorUrls": ["https://konkurrent.no"],
  "maxPages": 100
}
```

Sett miljøvariabelen `WORKER_SECRET` for å beskytte `/api/queue/worker` med en Bearer-token.

## Viktige mapper

- `app/`: UI og API-ruter
- `components/scoring/`: TrendChart og score-komponenter
- `lib/crawler/`: HTTP-crawler og strategisk render-budsjett
- `lib/engines/`: Answer quality, E-E-A-T og fremtidige analysemotorer
- `lib/`: Analyzer, jobbkjører, database og typer
- `tests/`: Tester for scorings- og anbefalingslogikk

## Merknad

Prosjektet bruker Node sin innebygde `node:sqlite`. I Node 25 er denne fortsatt merket som eksperimentell, så bygg og kjøring kan vise `ExperimentalWarning` i terminalen selv om appen fungerer.
