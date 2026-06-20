import {
  createOpportunitySnapshot,
  getGa4PageData,
  getGscPageData,
  getGscPageQueryData,
  insertOpportunityItem,
} from "@/lib/db";
import type { Opportunity, OpportunityPriority } from "@/lib/types";

type Draft = Omit<Opportunity, "id" | "createdAt">;

function priority(p: number): OpportunityPriority {
  if (p >= 4) return "critical";
  if (p >= 3) return "high";
  if (p >= 2) return "medium";
  return "low";
}

function pathname(url: string): string {
  try { return new URL(url.startsWith("http") ? url : `https://${url}`).pathname; } catch { return url; }
}

export async function generateOpportunities(domain: string): Promise<number> {
  const pageData = getGscPageData(domain, 28);
  const pageQueryData = getGscPageQueryData(domain, 28);
  const ga4Data = getGa4PageData(domain, 28);

  const drafts: Draft[] = [];

  // Aggregate page data across dates
  const pageAgg = new Map<string, { clicks: number; impressions: number; ctrSum: number; posSum: number; count: number }>();
  for (const row of pageData) {
    const e = pageAgg.get(row.page) ?? { clicks: 0, impressions: 0, ctrSum: 0, posSum: 0, count: 0 };
    e.clicks += row.clicks;
    e.impressions += row.impressions;
    e.ctrSum += row.ctr;
    e.posSum += row.position;
    e.count++;
    pageAgg.set(row.page, e);
  }

  const queryAgg = new Map<string, { clicks: number; impressions: number; posSum: number; count: number; page: string }>();
  for (const row of pageQueryData) {
    const key = `${row.page}|||${row.query}`;
    const e = queryAgg.get(key) ?? { clicks: 0, impressions: 0, posSum: 0, count: 0, page: row.page };
    e.clicks += row.clicks;
    e.impressions += row.impressions;
    e.posSum += row.position;
    e.count++;
    queryAgg.set(key, e);
  }

  const ga4Agg = new Map<string, { sessions: number; conversions: number; bounceRate: number; count: number }>();
  for (const row of ga4Data) {
    const e = ga4Agg.get(row.page) ?? { sessions: 0, conversions: 0, bounceRate: 0, count: 0 };
    e.sessions += row.sessions;
    e.conversions += row.conversions;
    e.bounceRate += row.bounceRate;
    e.count++;
    ga4Agg.set(row.page, e);
  }

  const snapshotId = 0;

  // ─── Regel 1: Høye visninger, lav CTR ────────────────────────────────────────
  for (const [page, agg] of pageAgg) {
    const avgCtr = agg.ctrSum / agg.count;
    const avgPos = agg.posSum / agg.count;
    if (agg.impressions >= 500 && avgCtr < 0.03 && avgPos <= 10) {
      const score = agg.impressions >= 5000 ? 4 : agg.impressions >= 2000 ? 3 : 2;
      const extraClicks = Math.round(agg.impressions * 0.02);
      drafts.push({
        snapshotId,
        domain,
        targetUrl: `https://${domain}`,
        pageUrl: page,
        query: null,
        queryCluster: null,
        type: "high-impressions-low-ctr",
        priority: priority(score),
        title: `Høye visninger, lav CTR på ${pathname(page)}`,
        evidence: { impressions: agg.impressions, avgCtr, avgPos },
        recommendedAction: `Siden vises ${agg.impressions.toLocaleString("nb-NO")} ganger/mnd men kun ${(avgCtr * 100).toFixed(1)}% klikker. Skriv om title tag og meta description: bruk det sterkeste søkeordet tidlig i tittelen, legg til et konkret løfte eller nøkkeltall, og avslutt meta med en tydelig CTA som «Bestill bord» eller «Se menyen».`,
        expectedImpact: `En CTR på 5% (fra ${(avgCtr * 100).toFixed(1)}%) vil gi omtrent ${extraClicks} ekstra klikk per måned fra samme visningsnivå.`,
        implementationPackId: null,
        status: "open",
      });
    }
  }

  // ─── Regel 2: Nær side 1 (pos 11–20) ────────────────────────────────────────
  for (const [page, agg] of pageAgg) {
    const avgPos = agg.posSum / agg.count;
    if (avgPos >= 11 && avgPos <= 20 && agg.impressions >= 100) {
      const posLabel = avgPos.toFixed(1);
      drafts.push({
        snapshotId,
        domain,
        targetUrl: `https://${domain}`,
        pageUrl: page,
        query: null,
        queryCluster: null,
        type: "near-page-one",
        priority: priority(avgPos <= 15 ? 3 : 2),
        title: `Rangerer på plass ${posLabel} — ett push til topp 10`,
        evidence: { avgPos, impressions: agg.impressions, clicks: agg.clicks },
        recommendedAction: `Siden er på side 2 (snittposisjon ${posLabel}). Legg til 2–3 interne lenker fra dine sterkeste sider, utvid innholdet med FAQ eller relaterte søkeord, og bygg én eller to eksterne lenker fra relevante nettsteder.`,
        expectedImpact: `En flytt fra posisjon ${Math.round(avgPos)} til topp 10 øker typisk CTR med 3–5x og kan gi ${Math.round(agg.impressions * 0.04)} ekstra klikk/mnd.`,
        implementationPackId: null,
        status: "open",
      });
    }
  }

  // ─── Regel 3: Trafikknedgang (siste 14 dager vs forrige 14) ──────────────────
  const recent14 = new Map<string, number>();
  const prev14 = new Map<string, number>();
  const cutoff = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const cutoff28 = new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10);
  for (const row of pageData) {
    if (row.date >= cutoff) {
      recent14.set(row.page, (recent14.get(row.page) ?? 0) + row.clicks);
    } else if (row.date >= cutoff28) {
      prev14.set(row.page, (prev14.get(row.page) ?? 0) + row.clicks);
    }
  }
  for (const [page, recentClicks] of recent14) {
    const prevClicks = prev14.get(page) ?? 0;
    if (prevClicks >= 50 && recentClicks < prevClicks * 0.7) {
      const dropPct = Math.round((1 - recentClicks / prevClicks) * 100);
      const lost = prevClicks - recentClicks;
      drafts.push({
        snapshotId,
        domain,
        targetUrl: `https://${domain}`,
        pageUrl: page,
        query: null,
        queryCluster: null,
        type: "traffic-down",
        priority: priority(dropPct >= 50 ? 4 : 3),
        title: `Trafikk ned ${dropPct}% siste 14 dager`,
        evidence: { recentClicks, prevClicks, dropPct },
        recommendedAction: `Trafikken har falt fra ${prevClicks} til ${recentClicks} klikk siste 14 dager (−${dropPct}%). Sjekk GSC for manuelle tiltak og indekseringsadvarsler, se om siden nylig er endret eller om det er en algoritmeoppdatering i perioden. Revider innholdet og sørg for at title og meta fremdeles er relevante.`,
        expectedImpact: `Å gjenvinne tapte klikk vil gi tilbake omtrent ${lost} klikk per 2 uker.`,
        implementationPackId: null,
        status: "open",
      });
    }
  }

  // ─── Regel 4: Høy trafikk, lav konvertering (GA4) ────────────────────────────
  for (const [page, ga4] of ga4Agg) {
    const convRate = ga4.sessions > 0 ? ga4.conversions / ga4.sessions : 0;
    if (ga4.sessions >= 200 && convRate < 0.01) {
      const potentialConv = Math.round(ga4.sessions * 0.02);
      drafts.push({
        snapshotId,
        domain,
        targetUrl: `https://${domain}`,
        pageUrl: page,
        query: null,
        queryCluster: null,
        type: "high-traffic-low-conversion",
        priority: priority(ga4.sessions >= 1000 ? 4 : 3),
        title: `${ga4.sessions.toLocaleString("nb-NO")} besøk, men kun ${(convRate * 100).toFixed(2)}% konverterer`,
        evidence: { sessions: ga4.sessions, conversions: ga4.conversions, convRate },
        recommendedAction: `Siden har ${ga4.sessions.toLocaleString("nb-NO")} besøk men svært lav konverteringsrate. Flytt den primære CTA-en høyere opp på siden, legg til tillitssignaler (anmeldelser, bilder, kontaktinfo), og sørg for at sideinnholdet matcher søkeintensjonen til trafikken.`,
        expectedImpact: `En konverteringsrate på 2% ved nåværende trafikknivå vil gi ${potentialConv} konverteringer — mot ${ga4.conversions} i dag.`,
        implementationPackId: null,
        status: "open",
      });
    }
  }

  // ─── Regel 5: Søkegap — søk med visninger men null klikk ─────────────────────
  const queryOnlyAgg = new Map<string, { impressions: number; position: number; page: string }>();
  for (const [key, agg] of queryAgg) {
    const [page, query] = key.split("|||");
    if (agg.clicks === 0 && agg.impressions >= 50) {
      queryOnlyAgg.set(query, {
        impressions: (queryOnlyAgg.get(query)?.impressions ?? 0) + agg.impressions,
        position: agg.posSum / agg.count,
        page,
      });
    }
  }
  for (const [query, data] of queryOnlyAgg) {
    if (data.impressions >= 100) {
      const potentialClicks = Math.round(data.impressions * 0.05);
      drafts.push({
        snapshotId,
        domain,
        targetUrl: `https://${domain}`,
        pageUrl: data.page,
        query,
        queryCluster: null,
        type: "query-gap",
        priority: priority(data.impressions >= 500 ? 3 : 2),
        title: `«${query}» — ${data.impressions.toLocaleString("nb-NO")} visninger, null klikk`,
        evidence: { query, impressions: data.impressions, position: data.position },
        recommendedAction: `Søket «${query}» vises ${data.impressions.toLocaleString("nb-NO")} ganger men ingen klikker. Enten mangler det en side som treffer denne intensjonen, eller så matcher ikke title/meta-teksten det søkerne forventer. Vurder å lage en dedikert side eller å optimere den eksisterende sidens tittel slik at den speiler «${query}» tydelig.`,
        expectedImpact: `5% CTR på ${data.impressions.toLocaleString("nb-NO")} visninger = ${potentialClicks} ekstra klikk per måned.`,
        implementationPackId: null,
        status: "open",
      });
    }
  }

  const topDrafts = drafts.slice(0, 100);
  const snapshotIdFinal = createOpportunitySnapshot(domain, topDrafts.length);
  for (const draft of topDrafts) {
    insertOpportunityItem({ ...draft, snapshotId: snapshotIdFinal });
  }

  return topDrafts.length;
}
