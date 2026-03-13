# AI SEO Audit

Internt Next.js-verktøy for å analysere om et nettsted er optimalisert for både klassisk søk og AI-drevne assistenter som ChatGPT, Gemini, Copilot og Perplexity.

## Hva verktøyet gjør

- Crawler offentlige sider på samme domene
- Leser `robots.txt`, `sitemap.xml`, metadata, canonicals, schema og internlenker
- Sammenligner rå HTML med rendret DOM via Playwright for å avdekke CSR vs SSR
- Beregner kategoriscorer, providerprofiler, topic clusters og konkurransegap
- Lagrer historikk lokalt i SQLite

## Kjør lokalt

```bash
npm install
npm run dev
```

Åpne deretter [http://localhost:3000](http://localhost:3000).

## API

- `POST /api/audits`
- `GET /api/audits/:id`
- `GET /api/audits/:id/report`

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

## Viktige mapper

- `app/`: UI og API-ruter
- `components/`: klientkomponenter og badges
- `lib/`: crawler, analysemotor, jobbkjører, typer og database
- `tests/`: tester for scorings- og anbefalingslogikk

## Merknad

Prosjektet bruker Node sin innebygde `node:sqlite`. I Node 25 er denne fortsatt merket som eksperimentell, så bygg og kjøring kan vise `ExperimentalWarning` i terminalen selv om appen fungerer.
