/**
 * E-E-A-T Signal Analyzer
 *
 * Extracts Experience, Expertise, Authoritativeness, and Trust signals
 * from a crawled PageSnapshot. Returns structured signals with evidence
 * strings for UI display.
 *
 * This engine is designed to be called from the analyzer during report
 * generation. It does NOT perform additional HTTP requests.
 */

import type { PageSnapshot } from "@/lib/types";

export type EEATSignals = {
  experience: {
    hasFirstPersonAccounts: boolean; // "jeg testet", "vi erfarte", "in my experience"
    hasSpecificExamples: boolean; // Konkrete case, tall, datoer i brødtekst
    hasMediaContentSignals: boolean; // Bilder med alt-tekst, video-tegn
  };
  expertise: {
    hasAuthorByline: boolean; // Forfatternavn funnet
    hasOutboundCitations: boolean; // Lenker til autoriteter (.gov, .edu, tidsskrift)
    hasSpecialistTerminology: boolean; // Faglig presisjon (domain-agnostisk proxy: lange ord)
    contentDepthScore: number; // 0–100: word count + headings + lists + tables
  };
  authoritativeness: {
    inboundLinkCount: number; // Fra site-crawl
    hasAboutPage: boolean; // Om oss/About Us-lenke funnet
    hasOrganizationSchema: boolean; // Organization/LocalBusiness schema
    hasBreadcrumbSchema: boolean; // BreadcrumbList schema
  };
  trust: {
    hasContactPage: boolean;
    hasPrivacyPolicy: boolean; // Link til personvern/privacy
    hasHttps: boolean;
    hasCanonical: boolean;
    hasPublishedDate: boolean;
    hasModifiedDate: boolean;
  };
  /** Composite 0–100 score weighted across all four dimensions */
  compositeScore: number;
  /** Top evidence strings for UI display (max 5) */
  evidence: string[];
  /** Gaps: what's missing for a strong E-E-A-T signal */
  gaps: string[];
};

// Proxy for specialist terminology: average word length > 7 in a sample
const LONG_WORD_PATTERN = /\b\w{9,}\b/g;

// Citation domains that signal authoritativeness
const AUTHORITY_DOMAINS = [
  ".gov",
  ".edu",
  ".org",
  "wikipedia.org",
  "scholar.google",
  "pubmed",
  "ncbi.nlm.nih.gov",
  "ssb.no",
  "regjeringen.no",
  "lovdata.no",
  "who.int",
  "nature.com",
  "sciencedirect",
];

// First-person experience patterns (Norwegian + English)
const FIRST_PERSON_PATTERN =
  /\b(jeg\s+(testet|prøvde|erfarte|opplevde|brukte|anbefaler)|vi\s+(testet|prøvde|erfarte|brukte|anbefaler|har|opplevde)|i\s+(tested|tried|experienced|used|recommend|found|noticed|learned)|we\s+(tested|tried|found|used|recommend|experienced))\b/i;

// Privacy/policy link text patterns
const PRIVACY_LINK_PATTERN =
  /person(vern|data)|privacy\s*policy|cookie\s*(policy|settings)|gdpr|informasjonskapsler/i;

export function analyzeEEAT(page: PageSnapshot): EEATSignals {
  const evidence: string[] = [];
  const gaps: string[] = [];

  // ── EXPERIENCE ──────────────────────────────────────────────────────────
  const hasFirstPersonAccounts = FIRST_PERSON_PATTERN.test(page.bodyText);
  if (hasFirstPersonAccounts) {
    evidence.push("Siden inneholder førstehåndsberetninger (jeg/vi testet/erfarte).");
  } else {
    gaps.push("Ingen synlig førstehåndserfaring i teksten.");
  }

  const hasSpecificExamples =
    /\b(\d{4}|\d+\s*(kr|%|prosent|timer|uker|måneder))/i.test(page.bodyText) &&
    page.wordCount > 200;
  if (hasSpecificExamples) {
    evidence.push("Siden inneholder konkrete tall og eksempler.");
  }

  const hasMediaContentSignals =
    (page.imageCount > 0 && page.imagesWithoutAlt < page.imageCount) ||
    page.hasTranscriptSignals;
  if (hasMediaContentSignals) {
    evidence.push("Medieelementer med alt-tekst eller transkripsjon funnet.");
  } else if (page.imageCount > 0) {
    gaps.push(`${page.imagesWithoutAlt} bilde(r) mangler alt-tekst.`);
  }

  // ── EXPERTISE ───────────────────────────────────────────────────────────
  const hasAuthorByline = Boolean(page.author);
  if (hasAuthorByline) {
    evidence.push(`Forfatter identifisert: "${page.author}".`);
  } else {
    gaps.push("Ingen forfatter-byline funnet på siden.");
  }

  const hasOutboundCitations = page.externalLinks.some((link) =>
    AUTHORITY_DOMAINS.some((domain) => link.includes(domain)),
  );
  if (hasOutboundCitations) {
    evidence.push("Siden lenker til autoritative kilder (.gov, .edu, .org o.l.).");
  } else {
    gaps.push("Ingen lenker til autoritative eksterne kilder.");
  }

  const longWordMatches = page.bodyText.match(LONG_WORD_PATTERN) ?? [];
  const hasSpecialistTerminology = longWordMatches.length >= 5;
  if (hasSpecialistTerminology) {
    evidence.push("Siden bruker faglig terminologi (lange, presise ord).");
  }

  const contentDepthScore = calculateContentDepth(page);

  // ── AUTHORITATIVENESS ───────────────────────────────────────────────────
  const hasAboutPage = page.hasAboutLink;
  const hasOrganizationSchema = page.schema.types.some((t) =>
    ["Organization", "LocalBusiness", "Corporation", "NGO"].includes(t),
  );
  const hasBreadcrumbSchema = page.schema.types.includes("BreadcrumbList");

  if (hasAboutPage) {
    evidence.push("Siden har lenke til Om oss/About-side.");
  } else {
    gaps.push("Ingen lenke til Om oss-side funnet.");
  }
  if (hasOrganizationSchema) {
    evidence.push("Organization schema funnet — sterk autoritets-signal.");
  } else {
    gaps.push("Mangler Organization/LocalBusiness schema.");
  }

  // ── TRUST ───────────────────────────────────────────────────────────────
  const hasContactPage = page.hasContactLink;
  const hasPrivacyPolicy = page.externalLinks
    .concat(page.internalLinks)
    .some((link) => PRIVACY_LINK_PATTERN.test(link));
  const hasHttps = page.url.startsWith("https://");
  const hasCanonical = Boolean(page.canonicalUrl);
  const hasPublishedDate = Boolean(page.datePublished);
  const hasModifiedDate = Boolean(page.dateModified);

  if (!hasContactPage) gaps.push("Ingen kontakt-lenke funnet.");
  if (!hasPrivacyPolicy) gaps.push("Ingen personvern/privacy policy-lenke funnet.");
  if (!hasModifiedDate) gaps.push("Mangler dato for siste oppdatering (dateModified).");

  // ── COMPOSITE SCORE ─────────────────────────────────────────────────────
  const compositeScore = calculateComposite({
    hasFirstPersonAccounts,
    hasSpecificExamples,
    hasMediaContentSignals,
    hasAuthorByline,
    hasOutboundCitations,
    hasSpecialistTerminology,
    contentDepthScore,
    inboundLinkCount: page.inboundLinks,
    hasAboutPage,
    hasOrganizationSchema,
    hasBreadcrumbSchema,
    hasContactPage,
    hasPrivacyPolicy,
    hasHttps,
    hasCanonical,
    hasPublishedDate,
    hasModifiedDate,
  });

  return {
    experience: {
      hasFirstPersonAccounts,
      hasSpecificExamples,
      hasMediaContentSignals,
    },
    expertise: {
      hasAuthorByline,
      hasOutboundCitations,
      hasSpecialistTerminology,
      contentDepthScore,
    },
    authoritativeness: {
      inboundLinkCount: page.inboundLinks,
      hasAboutPage,
      hasOrganizationSchema,
      hasBreadcrumbSchema,
    },
    trust: {
      hasContactPage,
      hasPrivacyPolicy,
      hasHttps,
      hasCanonical,
      hasPublishedDate,
      hasModifiedDate,
    },
    compositeScore,
    evidence: evidence.slice(0, 5),
    gaps: gaps.slice(0, 5),
  };
}

function calculateContentDepth(page: PageSnapshot): number {
  // Word count contributes up to 40 points (1000 words = full score)
  const wordScore = Math.min(40, (page.wordCount / 1000) * 40);
  // Headings contribute up to 20 points (5+ headings = full score)
  const headingScore = Math.min(20, (page.headings.length / 5) * 20);
  // Structured content (lists + tables) contributes up to 20 points
  const structuredScore = Math.min(20, ((page.listCount + page.tableCount * 2) / 5) * 20);
  // FAQ blocks contribute up to 20 points
  const faqScore = Math.min(20, page.faqCount * 10);
  return Math.round(wordScore + headingScore + structuredScore + faqScore);
}

type CompositeInputs = {
  hasFirstPersonAccounts: boolean;
  hasSpecificExamples: boolean;
  hasMediaContentSignals: boolean;
  hasAuthorByline: boolean;
  hasOutboundCitations: boolean;
  hasSpecialistTerminology: boolean;
  contentDepthScore: number;
  inboundLinkCount: number;
  hasAboutPage: boolean;
  hasOrganizationSchema: boolean;
  hasBreadcrumbSchema: boolean;
  hasContactPage: boolean;
  hasPrivacyPolicy: boolean;
  hasHttps: boolean;
  hasCanonical: boolean;
  hasPublishedDate: boolean;
  hasModifiedDate: boolean;
};

function calculateComposite(s: CompositeInputs): number {
  // Experience (25%)
  const experienceScore =
    (s.hasFirstPersonAccounts ? 40 : 0) +
    (s.hasSpecificExamples ? 35 : 0) +
    (s.hasMediaContentSignals ? 25 : 0);

  // Expertise (30%)
  const expertiseScore =
    (s.hasAuthorByline ? 30 : 0) +
    (s.hasOutboundCitations ? 25 : 0) +
    (s.hasSpecialistTerminology ? 15 : 0) +
    s.contentDepthScore * 0.3;

  // Authoritativeness (25%)
  const authorityScore =
    Math.min(30, s.inboundLinkCount * 3) +
    (s.hasAboutPage ? 25 : 0) +
    (s.hasOrganizationSchema ? 30 : 0) +
    (s.hasBreadcrumbSchema ? 15 : 0);

  // Trust (20%)
  const trustScore =
    (s.hasContactPage ? 20 : 0) +
    (s.hasPrivacyPolicy ? 20 : 0) +
    (s.hasHttps ? 20 : 0) +
    (s.hasCanonical ? 15 : 0) +
    (s.hasPublishedDate ? 10 : 0) +
    (s.hasModifiedDate ? 15 : 0);

  const composite =
    (experienceScore * 0.25) / 1 +
    (Math.min(100, expertiseScore) * 0.3) / 1 +
    (Math.min(100, authorityScore) * 0.25) / 1 +
    (Math.min(100, trustScore) * 0.2) / 1;

  return Math.min(100, Math.round(composite));
}

/**
 * Aggregate E-E-A-T signals across multiple pages (domain-level view).
 */
export function aggregateEEAT(pages: PageSnapshot[]): {
  averageScore: number;
  authorCoverage: number;
  citationCoverage: number;
  trustCoverage: number;
  topGaps: string[];
} {
  if (!pages.length) {
    return { averageScore: 0, authorCoverage: 0, citationCoverage: 0, trustCoverage: 0, topGaps: [] };
  }

  const results = pages.map(analyzeEEAT);
  const avgScore = results.reduce((sum, r) => sum + r.compositeScore, 0) / results.length;
  const authorCoverage = (results.filter((r) => r.expertise.hasAuthorByline).length / results.length) * 100;
  const citationCoverage = (results.filter((r) => r.expertise.hasOutboundCitations).length / results.length) * 100;
  const trustCoverage =
    (results.filter((r) => r.trust.hasHttps && r.trust.hasCanonical && r.trust.hasContactPage).length /
      results.length) *
    100;

  // Collect most common gaps
  const gapCounts = new Map<string, number>();
  for (const r of results) {
    for (const gap of r.gaps) {
      gapCounts.set(gap, (gapCounts.get(gap) ?? 0) + 1);
    }
  }
  const topGaps = [...gapCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([gap]) => gap);

  return {
    averageScore: Math.round(avgScore),
    authorCoverage: Math.round(authorCoverage),
    citationCoverage: Math.round(citationCoverage),
    trustCoverage: Math.round(trustCoverage),
    topGaps,
  };
}
