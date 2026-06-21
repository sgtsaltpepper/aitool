import type { PagePerformanceMetrics } from "@/lib/types";

export function generatePerformanceInsights(metrics: PagePerformanceMetrics | null): string[] {
  if (!metrics) {
    return [];
  }

  const insights: string[] = [];

  if (metrics.sessions > 100 && metrics.conversions === 0) {
    insights.push(
      "ALARM_CRO_KRITISK: Siden har god trafikk (sessions), men null konverteringer. Meta-beskrivelsen må kvalifisere bedre og ha en tydelig CTA.",
    );
  }

  if (metrics.impressions > 1000 && metrics.ctr < 0.01) {
    insights.push(
      "ALARM_CTR_LAV: Siden har høy synlighet i Google, men svært lav CTR. Tittel og metabeskrivelse må bli mer fristende og konkrete.",
    );
  }

  if (metrics.position > 4 && metrics.position <= 10 && metrics.ctr > 0.03) {
    insights.push(
      "MULIGHET_TOPP_3: Siden ligger på førstesiden og har god CTR. En spissere title med hovedsøkeord tidlig kan løfte siden videre.",
    );
  }

  if (metrics.sessions >= 100 && metrics.conversionRate > 0 && metrics.conversionRate < 0.01) {
    insights.push(
      "ALARM_CRO_SVAK: Siden får trafikk, men konverterer svakt. Metadata og åpningsbudskap bør filtrere bedre mot brukere som faktisk er klare for neste steg.",
    );
  }

  if (metrics.impressions >= 1000 && metrics.position <= 3 && metrics.ctr < 0.03) {
    insights.push(
      "ALARM_SNIPPET_UNDERPRESTERER: Siden rangerer allerede høyt, men klikkraten er lavere enn forventet. Snippetet bør gi et klarere løfte og mer konkret verdi.",
    );
  }

  return insights;
}
