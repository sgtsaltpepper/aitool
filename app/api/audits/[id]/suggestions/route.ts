import { NextResponse } from "next/server";

import { getAuditReport } from "@/lib/db";
import { humanPath } from "@/lib/utils";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const report = getAuditReport(id);

  if (!report) {
    return NextResponse.json({ error: "Fant ikke rapporten" }, { status: 404 });
  }

  const markdown = buildSuggestionsMarkdown(report);
  const hostname = new URL(report.request.targetUrl).hostname.replace(/^www\./, "");
  const filename = `forslag-${hostname}-${report.runId}.md`;

  return new NextResponse(markdown, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

function buildSuggestionsMarkdown(report: NonNullable<ReturnType<typeof getAuditReport>>) {
  if (report.request.mode === "page" && report.pageReport) {
    return buildPageAuditMarkdown(report);
  }

  const lines: string[] = [
    `# Forslag til forbedringer for ${report.request.targetUrl}`,
    "",
    `Generert: ${new Date(report.generatedAt).toLocaleString("nb-NO")}`,
    `Samlet score: ${report.totalScore}`,
    "",
    "Denne eksporten viser konkrete sideforslag, implementation packs og forventet effekt for struktur, innhold, metadata og JSON-LD.",
    "",
  ];

  if (report.implementationPacks.length) {
    lines.push("## Implementation Packs");
    lines.push("");

    for (const pack of report.implementationPacks) {
      lines.push(`### ${pack.pageTitle}`);
      lines.push("");
      lines.push(`- URL: ${pack.url}`);
      lines.push(
        `- Predicted impact: ${pack.predictedImpact.totalScoreBefore} -> ${pack.predictedImpact.totalScoreAfter} (delta ${pack.predictedImpact.totalScoreDelta >= 0 ? "+" : ""}${pack.predictedImpact.totalScoreDelta})`,
      );
      lines.push("");
      lines.push("#### Before / after");
      lines.push("");
      lines.push(`- H1: ${pack.currentSnapshot.h1 || "Ingen"} -> ${pack.proposedSnapshot.h1}`);
      lines.push(`- Metatittel: ${pack.currentSnapshot.metaTitle || "Ingen"} -> ${pack.proposedSnapshot.metaTitle}`);
      lines.push(
        `- Metabeskrivelse: ${pack.currentSnapshot.metaDescription || "Ingen"} -> ${pack.proposedSnapshot.metaDescription}`,
      );
      lines.push("");
      lines.push("#### Evidence");
      lines.push("");
      pack.evidence.forEach((item) => lines.push(`- ${item}`));
      lines.push("");
      lines.push("#### Patch blocks");
      lines.push("");
      pack.patchBlocks.forEach((block) => {
        lines.push(`##### ${block.label}`);
        lines.push("");
        lines.push("```md");
        lines.push(block.content);
        lines.push("```");
        lines.push("");
      });
    }
  }

  for (const suggestion of report.pageSuggestions) {
    lines.push(`## ${suggestion.pageTitle}`);
    lines.push("");
    lines.push(`- URL: ${suggestion.url}`);
    lines.push(`- Side: ${humanPath(suggestion.url)}`);
    lines.push(`- Intensjon: ${suggestion.intent}`);
    lines.push(`- Foreslått schema: ${suggestion.proposed.schemaType}`);
    lines.push("");

    lines.push("### Hvorfor denne siden bør forbedres");
    lines.push("");
    for (const rationale of suggestion.rationale) {
      lines.push(`- ${rationale}`);
    }
    lines.push("");

    lines.push("### Foreslått struktur");
    lines.push("");
    suggestion.proposed.structure.forEach((item, index) => {
      lines.push(`${index + 1}. ${item}`);
    });
    lines.push("");

    lines.push("### Foreslått innholdsåpning");
    lines.push("");
    lines.push(suggestion.proposed.contentLead);
    lines.push("");

    if (suggestion.proposed.contentNotes.length) {
      lines.push("### Innhold som bør styrkes");
      lines.push("");
      for (const note of suggestion.proposed.contentNotes) {
        lines.push(`- ${note}`);
      }
      lines.push("");
    }

    lines.push("### Metadata");
    lines.push("");
    lines.push(`- Nåværende metatittel: ${suggestion.current.metaTitle || "Ingen"}`);
    lines.push(`- Foreslått metatittel: ${suggestion.proposed.metaTitle}`);
    lines.push(`- Nåværende metabeskrivelse: ${suggestion.current.metaDescription || "Ingen"}`);
    lines.push(`- Foreslått metabeskrivelse: ${suggestion.proposed.metaDescription}`);
    if (suggestion.metadataAgent) {
      lines.push(`- Metadata-agent: ${suggestion.metadataAgent.name}${suggestion.metadataAgent.mode === "openai" ? suggestion.metadataAgent.model ? ` via ${suggestion.metadataAgent.model}` : " via AI" : " med lokal fallback"}`);
    }
    lines.push("");

    if (suggestion.searchInsights) {
      lines.push("### Søkeinnsikt bak metadataforslaget");
      lines.push("");
      if (suggestion.searchInsights.audience) {
        lines.push(`- Publikum: ${suggestion.searchInsights.audience}`);
      }
      if (suggestion.searchInsights.topQueries.length) {
        lines.push(`- Viktige søk: ${suggestion.searchInsights.topQueries.map((item) => item.query).join(", ")}`);
      }
      if (suggestion.searchInsights.contentHighlights.length) {
        lines.push(`- Gjenkjent innhold på siden: ${suggestion.searchInsights.contentHighlights.join(", ")}`);
      }
      if (suggestion.searchInsights.contentGaps.length) {
        suggestion.searchInsights.contentGaps.forEach((gap) => lines.push(`- ${gap}`));
      }
      lines.push("");
    }

    lines.push("### Foreslått JSON-LD");
    lines.push("");
    lines.push("```json");
    lines.push(suggestion.proposed.jsonLd);
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}

function buildPageAuditMarkdown(report: NonNullable<ReturnType<typeof getAuditReport>>) {
  const pageReport = report.pageReport!;
  const lines: string[] = [
    `# Sideanalyse for ${report.request.targetUrl}`,
    "",
    `Generert: ${new Date(report.generatedAt).toLocaleString("nb-NO")}`,
    `Samlet score: ${report.totalScore}`,
    "",
    "Denne eksporten viser før/etter-forslag for akkurat denne siden.",
    "",
    "## Implementation Pack",
    "",
  ];

  if (report.implementationPacks[0]) {
    const pack = report.implementationPacks[0];
    lines.push(`- Predicted impact: ${pack.predictedImpact.totalScoreBefore} -> ${pack.predictedImpact.totalScoreAfter}`);
    lines.push("");
    lines.push("### Evidence");
    lines.push("");
    pack.evidence.forEach((item) => lines.push(`- ${item}`));
    lines.push("");
    lines.push("### Patch blocks");
    lines.push("");
    pack.patchBlocks.forEach((block) => {
      lines.push(`#### ${block.label}`);
      lines.push("");
      lines.push("```md");
      lines.push(block.content);
      lines.push("```");
      lines.push("");
    });
  }

  lines.push(
    "## Nå-situasjonen",
    "",
    `- URL: ${pageReport.current.url}`,
    `- H1: ${pageReport.current.h1 || "Ingen tydelig H1 funnet"}`,
    `- Metatittel: ${pageReport.current.metaTitle || "Ingen"}`,
    `- Metabeskrivelse: ${pageReport.current.metaDescription || "Ingen"}`,
    `- Rendering: ${pageReport.current.renderingModel}`,
    `- Svarscore: ${pageReport.current.answerScore}/100`,
    "",
    `Ingress/åpning: ${pageReport.current.opening || "Ingen tydelig åpning funnet."}`,
    "",
    "## Hva bør endres først",
    "",
    ...pageReport.priorityActions.map((action) => `- ${action}`),
    "",
    "## Anbefalt ny sidestruktur",
    "",
    ...pageReport.proposed.structure.map((item, index) => `${index + 1}. ${item}`),
    "",
    "## Bedre innhold",
    "",
    `- Foreslått H1: ${pageReport.proposed.h1}`,
    `- Foreslått åpning: ${pageReport.proposed.opening}`,
    `- Foreslått CTA: ${pageReport.proposed.cta}`,
    "",
    "### Seksjoner",
    "",
  );

  for (const section of pageReport.proposed.sections) {
    lines.push(`#### ${section.title}`);
    lines.push("");
    lines.push(`Formål: ${section.purpose}`);
    lines.push("");
    lines.push(section.suggestedContent);
    lines.push("");
  }

  lines.push("### FAQ");
  lines.push("");
  for (const faq of pageReport.proposed.faq) {
    lines.push(`- ${faq.question}`);
    lines.push(`  Svar: ${faq.answer}`);
  }

  lines.push("");
  lines.push("## Bedre metadata");
  lines.push("");
  lines.push(`- Nåværende metatittel: ${pageReport.current.metaTitle || "Ingen"}`);
  lines.push(`- Foreslått metatittel: ${pageReport.proposed.metaTitle}`);
  lines.push(`- Nåværende metabeskrivelse: ${pageReport.current.metaDescription || "Ingen"}`);
  lines.push(`- Foreslått metabeskrivelse: ${pageReport.proposed.metaDescription}`);
  if (pageReport.metadataAgent) {
    lines.push(`- Metadata-agent: ${pageReport.metadataAgent.name}${pageReport.metadataAgent.mode === "openai" ? pageReport.metadataAgent.model ? ` via ${pageReport.metadataAgent.model}` : " via AI" : " med lokal fallback"}`);
  }
  lines.push("");
  if (pageReport.searchInsights) {
    lines.push("## Søkeinnsikt bak metadataforslaget");
    lines.push("");
    if (pageReport.searchInsights.audience) {
      lines.push(`- Publikum: ${pageReport.searchInsights.audience}`);
    }
    if (pageReport.searchInsights.topQueries.length) {
      lines.push(`- Viktige søk: ${pageReport.searchInsights.topQueries.map((item) => item.query).join(", ")}`);
    }
    if (pageReport.searchInsights.contentHighlights.length) {
      lines.push(`- Gjenkjent innhold på siden: ${pageReport.searchInsights.contentHighlights.join(", ")}`);
    }
    if (pageReport.searchInsights.contentGaps.length) {
      pageReport.searchInsights.contentGaps.forEach((gap) => lines.push(`- ${gap}`));
    }
    lines.push("");
  }
  lines.push("## Foreslått JSON-LD");
  lines.push("");
  lines.push(`- Schema-type: ${pageReport.proposed.schemaType}`);
  lines.push("");
  lines.push("```json");
  lines.push(pageReport.proposed.jsonLd);
  lines.push("```");
  lines.push("");

  return lines.join("\n");
}
