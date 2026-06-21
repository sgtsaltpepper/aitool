/**
 * Answer Quality Engine
 *
 * Replaces the naive scoreDirectAnswerLikelihood() function in crawler.ts.
 * Uses structural and linguistic signals to assess how well a page opening
 * functions as a standalone, direct answer — without relying on character
 * length thresholds alone.
 *
 * Signal breakdown (total max = 100):
 *   hasDirectDefinition       +28  Opening uses "is/er/means/betyr" definitively
 *   quantifiableData          +18  Opening contains numbers, %, years, currency
 *   standaloneValue           +20  Opening can be understood without context (0–1 scale)
 *   questionAnswered          +20  Opening responds to the H1 question intent (0–1 scale)
 *   structuredEarlyInContent  +14  Ordered/unordered list appears in first 500 chars of body
 */

export type AnswerQualityResult = {
  score: number; // 0–100, replaces directAnswerLikelihood
  signals: {
    hasDirectDefinition: boolean;
    hasQuantifiableData: boolean;
    standaloneValue: number; // 0–1
    questionAnswered: number; // 0–1
    structuredEarlyInContent: boolean;
  };
  /** Human-readable summary for UI display */
  summary: string;
};

// Norwegian + English definition verbs
const DEFINITION_PATTERN =
  /\b(er|betyr|defineres som|er en|er et|er å|means|is|refers to|is a|is an|is defined as|stands for)\b/i;

// Quantifiable data: digits with unit, percentages, currency, years 1900–2099
const QUANTIFIABLE_PATTERN =
  /(\d+[\.,]?\d*\s*(%|kr|nok|usd|eur|gbp|\bår\b|\bmonths?\b|\bdays?\b|\bweeks?\b|prosent|percent|million|billion|milliard)|\b(19|20)\d{2}\b|\b\d{2,}\b)/i;

// Question-intent words in Norwegian and English
const QUESTION_WORDS = [
  "hva",
  "hvem",
  "hvordan",
  "hvorfor",
  "når",
  "where",
  "what",
  "who",
  "how",
  "why",
  "when",
  "which",
];

// Filler phrases that appear in boilerplate but carry no standalone answer value
const BOILERPLATE_SIGNALS = [
  /velkommen til/i,
  /les mer om/i,
  /kontakt oss/i,
  /her finner du/i,
  /på denne siden/i,
  /vi tilbyr/i,
  /thank you for visiting/i,
  /this (page|site|website) (is|contains|provides)/i,
  /cookie(s)?( policy)?/i,
  /privacy policy/i,
  /all rights reserved/i,
];

export function scoreAnswerQuality(
  firstParagraph: string,
  h1: string,
  headings: string[],
  bodyText: string,
): AnswerQualityResult {
  const opening = firstParagraph.trim();

  // --- Signal: Direct definition ---
  const hasDirectDefinition = opening.length > 20 && DEFINITION_PATTERN.test(opening);

  // --- Signal: Quantifiable data ---
  const hasQuantifiableData = QUANTIFIABLE_PATTERN.test(opening);

  // --- Signal: Standalone value (0–1) ---
  // An opening has standalone value if:
  // 1. It is long enough to be a real sentence (≥40 chars)
  // 2. Does not start with a pronoun that requires context ("it", "this", "that", "den", "det")
  // 3. Does not contain boilerplate markers
  // 4. Has a verb (simplistic: contains space after 3rd word)
  const standaloneValue = assessStandaloneValue(opening);

  // --- Signal: Question alignment (0–1) ---
  const questionAnswered = assessQuestionAlignment(opening, h1, headings);

  // --- Signal: Structured content early in body ---
  const first500 = bodyText.slice(0, 500);
  const structuredEarlyInContent = /<ol|<ul|\n1\.|^\s*[-*•]\s/i.test(first500) || /\d+\.\s\w/.test(first500);

  // --- Composite score ---
  let score = 0;
  if (hasDirectDefinition) score += 28;
  if (hasQuantifiableData) score += 18;
  score += standaloneValue * 20;
  score += questionAnswered * 20;
  if (structuredEarlyInContent) score += 14;

  const finalScore = Math.min(100, Math.round(score));

  return {
    score: finalScore,
    signals: {
      hasDirectDefinition,
      hasQuantifiableData,
      standaloneValue,
      questionAnswered,
      structuredEarlyInContent,
    },
    summary: buildSummary(finalScore, {
      hasDirectDefinition,
      hasQuantifiableData,
      standaloneValue,
      questionAnswered,
      structuredEarlyInContent,
    }),
  };
}

function assessStandaloneValue(opening: string): number {
  if (opening.length < 40) return 0;

  // Pronoun-dependent openers lose value
  const contextDependentStart = /^(it|this|that|these|those|den|det|dette|disse|de|her|here)\b/i;
  if (contextDependentStart.test(opening)) return 0.2;

  // Boilerplate signals
  const isBoilerplate = BOILERPLATE_SIGNALS.some((pattern) => pattern.test(opening));
  if (isBoilerplate) return 0.1;

  // Good length range (a real answer is usually 60–350 chars)
  const lengthScore = opening.length >= 60 && opening.length <= 350 ? 0.4 : opening.length > 350 ? 0.2 : 0.3;

  // Contains a verb-like structure (simplistic heuristic: 3+ words with a space)
  const wordCount = opening.split(/\s+/).filter((w) => w.length > 2).length;
  const verbScore = wordCount >= 5 ? 0.6 : wordCount >= 3 ? 0.3 : 0;

  return Math.min(1, lengthScore + verbScore);
}

function assessQuestionAlignment(
  opening: string,
  h1: string,
  headings: string[],
): number {
  const h1Lower = h1.toLowerCase();
  const headingTexts = headings.map((h) => h.toLowerCase());

  // Check if H1 or first heading is question-like
  const isQuestion =
    QUESTION_WORDS.some((w) => h1Lower.startsWith(w)) ||
    h1Lower.endsWith("?") ||
    headingTexts[0]?.endsWith("?");

  if (!isQuestion) {
    // No question to answer — neutral (0.5, neither penalized nor rewarded)
    return 0.5;
  }

  // Extract the main noun/subject from H1 (first 3 meaningful words)
  const h1Tokens = h1Lower
    .replace(/[?!.,]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !QUESTION_WORDS.includes(w))
    .slice(0, 3);

  if (!h1Tokens.length) return 0.4;

  const openingLower = opening.toLowerCase();
  const matchCount = h1Tokens.filter((token) => openingLower.includes(token)).length;
  const matchRatio = matchCount / h1Tokens.length;

  // Opening must mention the topic AND have a definition-like structure
  if (matchRatio >= 0.6 && DEFINITION_PATTERN.test(opening)) return 1.0;
  if (matchRatio >= 0.4) return 0.7;
  if (matchRatio >= 0.2) return 0.4;
  return 0.1;
}

function buildSummary(
  score: number,
  signals: AnswerQualityResult["signals"],
): string {
  if (score >= 80) {
    return "Siden åpner med et direkte, konkret svar — høy sannsynlighet for sitering.";
  }
  if (score >= 55) {
    const missing: string[] = [];
    if (!signals.hasDirectDefinition) missing.push("en tydelig definisjon");
    if (!signals.hasQuantifiableData) missing.push("konkrete tall/data");
    if (signals.standaloneValue < 0.5) missing.push("et åpningsavsnitt som kan stå alene");
    return missing.length
      ? `Delvis svar-struktur. Mangler: ${missing.join(", ")}.`
      : "Delvis svar-struktur — kan styrkes.";
  }
  return "Åpningen gir ikke et direkte svar. AI-assistenter vil sannsynligvis velge en annen kilde.";
}
