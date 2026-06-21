import { describe, expect, it } from "vitest";

import { generateFallbackAidarSuggestions } from "@/lib/aidar";
import { buildPolicyDescriptions } from "@/lib/aidar-policy";
import { generatePerformanceInsights } from "@/lib/performance-insights";
import type { PagePerformanceMetrics, PageSearchInsights } from "@/lib/types";

describe("Aidar fallback", () => {
  it("lager deterministiske performance-alarmer fra råtall", () => {
    const insights = generatePerformanceInsights({
      impressions: 15400,
      clicks: 620,
      ctr: 620 / 15400,
      position: 7.2,
      sessions: 2370,
      conversions: 0,
      conversionRate: 0,
      bounceRate: 0.52,
    });

    expect(insights).toContainEqual(expect.stringContaining("ALARM_CRO_KRITISK"));
    expect(insights).toContainEqual(expect.stringContaining("MULIGHET_TOPP_3"));
  });

  it("bruker synlig norsk ordlyd fremfor sluggete søkefraser", () => {
    const searchInsights: PageSearchInsights = {
      audience: "brukere som vil forstå temaet",
      audienceQualifier: "forklart enkelt",
      primaryQuery: "hva er forskjellen mellom en toastmaster og konferansier?",
      contentHighlights: ["Hva er en toastmaster?", "Hva er en konferansier?"],
      contentGaps: ["Legg til en FAQ-seksjon som svarer på spørsmålene brukerne faktisk søker etter."],
      topQueries: [
        {
          query: "hva er en toastmaster",
          impressions: 35,
          clicks: 4,
          ctr: 0.11,
          position: 12.9,
          inContent: true,
          matchedTerms: ["toastmaster"],
          missingTerms: [],
        },
      ],
      metrics: null,
    };

    const suggestions = generateFallbackAidarSuggestions({
      domain: "denis.no",
      brand: "Denis",
      keyword: "Hva er forskjellen mellom en toastmaster og konferansier?",
      intent: "informational",
      page: {
        url: "https://denis.no/about",
        title: "Hva er forskjellen mellom en toastmaster og konferansier? | Denis",
        metaDescription: "",
        h1: "Hva er forskjellen mellom en toastmaster og konferansier?",
        headings: ["Hva er en toastmaster?", "Hva er en konferansier?"],
        firstParagraph: "Her forklarer vi forskjellen mellom rollene og når du bør velge hva.",
        bodyText: "Her forklarer vi forskjellen mellom rollene og når du bør velge hva.",
        hasContactLink: true,
      },
      queries: [
        {
          query: "hva er en toastmaster",
          impressions: 35,
          clicks: 4,
          ctr: 0.11,
          position: 12.9,
        },
      ],
      searchInsights,
      metrics: null,
    });

    expect(suggestions.titles[0]).toContain("toastmaster");
    expect(suggestions.metaDescriptions[0]).not.toContain("relevante brukere");
    expect(suggestions.metaDescriptions[0]).not.toContain("få et raskt overblikk");
  });

  it("lager mer konkrete transaksjonelle beskrivelser", () => {
    const metrics: PagePerformanceMetrics = {
      impressions: 1200,
      clicks: 20,
      ctr: 0.016,
      position: 7.2,
      sessions: 240,
      conversions: 1,
      conversionRate: 1 / 240,
      bounceRate: 0.61,
    };

    const suggestions = generateFallbackAidarSuggestions({
      domain: "denis.no",
      brand: "Denis",
      keyword: "Hypnoseshow",
      intent: "transactional",
      page: {
        url: "https://denis.no/hypnoseshow",
        title: "Hypnoseshow for firmafest | Denis",
        metaDescription: "",
        h1: "Hypnoseshow for firmafest og event",
        headings: ["Show til firmafest", "Booking og praktisk info"],
        firstParagraph: "Bestill hypnoseshow til firmafest, kickoff og event.",
        bodyText: "Bestill hypnoseshow til firmafest, kickoff og event. Her finner du booking og praktisk informasjon.",
        hasContactLink: true,
      },
      queries: [
        {
          query: "hypnoseshow",
          impressions: 206,
          clicks: 9,
          ctr: 0.04,
          position: 11.5,
        },
      ],
      searchInsights: {
        audience: "brukere som vurderer å ta kontakt",
        audienceQualifier: "med priser og neste steg",
        primaryQuery: "hypnoseshow",
        contentHighlights: ["booking"],
        contentGaps: [],
        topQueries: [],
        metrics,
      },
      metrics,
    });

    expect(suggestions.titles[0]).toMatch(/firmafest|event|booking/i);
    expect(suggestions.metaDescriptions[0]).toMatch(/kontakt|booking|bestill/i);
  });

  it("velger ett beste fallback-forslag for title og description", () => {
    const suggestions = generateFallbackAidarSuggestions({
      domain: "denis.no",
      brand: "Denis",
      keyword: "Hypnoseshow",
      intent: "transactional",
      page: {
        url: "https://denis.no/hypnoseshow",
        title: "Hypnoseshow for firmafest | Denis",
        metaDescription: "",
        h1: "Hypnoseshow for firmafest og event",
        headings: ["Show til firmafest", "Booking og praktisk info"],
        firstParagraph: "Bestill hypnoseshow til firmafest, kickoff og event.",
        bodyText: "Bestill hypnoseshow til firmafest, kickoff og event. Her finner du booking og praktisk informasjon.",
        hasContactLink: true,
      },
      queries: [
        {
          query: "hypnoseshow",
          impressions: 206,
          clicks: 9,
          ctr: 0.04,
          position: 11.5,
        },
      ],
      searchInsights: {
        audience: "brukere som vurderer å ta kontakt",
        audienceQualifier: "med priser og neste steg",
        primaryQuery: "hypnoseshow",
        contentHighlights: ["booking"],
        contentGaps: [],
        topQueries: [],
        metrics: null,
      },
      metrics: null,
    });

    expect(suggestions.titles).toHaveLength(1);
    expect(suggestions.metaDescriptions).toHaveLength(1);
    expect(suggestions.titleOptions).toHaveLength(1);
    expect(suggestions.metaDescriptionOptions).toHaveLength(1);
  });

  it("unngår selvrefererende tema som 'Denne siden'", () => {
    const suggestions = generateFallbackAidarSuggestions({
      domain: "chambre.no",
      brand: "Chambre",
      keyword: "Denne siden",
      intent: "informational",
      page: {
        url: "https://chambre.no/chambre-separee",
        title: "Chambre séparée i Oslo | Chambre",
        metaDescription: "",
        h1: "Chambre séparée i Oslo",
        headings: ["Hva er en chambre séparée?", "Når passer et privat selskapsrom?"],
        firstParagraph: "En chambre séparée gir et avskjermet rom for selskaper og møter.",
        bodyText: "En chambre séparée gir et avskjermet rom for selskaper og møter. Her forklarer vi når det passer og hva du bør vite.",
        hasContactLink: true,
      },
      queries: [
        {
          query: "chambre separee",
          impressions: 30,
          clicks: 4,
          ctr: 0.13,
          position: 14,
        },
      ],
      searchInsights: {
        audience: "brukere som vil forstå temaet",
        audienceQualifier: "forklart enkelt",
        primaryQuery: "chambre séparée",
        contentHighlights: ["privat selskapsrom"],
        contentGaps: [],
        topQueries: [],
        metrics: null,
      },
      metrics: null,
    });

    expect(suggestions.titles.join(" ")).not.toMatch(/denne siden/i);
    expect(suggestions.metaDescriptions.join(" ")).not.toMatch(/denne siden/i);
    expect(suggestions.titles[0]).toMatch(/chambre/i);
  });

  it("slår sammen nesten like anbefalinger med små skrivevarianter", () => {
    const suggestions = generateFallbackAidarSuggestions({
      domain: "chambre.no",
      brand: "Chambre",
      keyword: "Chambre séparée",
      intent: "informational",
      page: {
        url: "https://chambre.no/chambre-separee",
        title: "Chambre séparée | Chambre",
        metaDescription: "",
        h1: "Chambre séparée",
        headings: ["Privat rom til selskap"],
        firstParagraph: "Her forklarer vi hva en chambre séparée er.",
        bodyText: "Her forklarer vi hva en chambre séparée er.",
        hasContactLink: true,
      },
      queries: [
        {
          query: "chambre separee",
          impressions: 30,
          clicks: 4,
          ctr: 0.13,
          position: 14,
        },
      ],
      searchInsights: {
        audience: "brukere som vil forstå temaet",
        audienceQualifier: "forklart enkelt",
        primaryQuery: "chambre séparée",
        contentHighlights: [],
        contentGaps: [
          "Legg inn en egen seksjon som svarer tydelig på «chambre separee», siden dette søket får visninger uten å være godt nok dekket i innholdet.",
          "Legg inn en egen seksjon som svarer tydelig på «chambre separée», siden dette søket får visninger uten å være godt nok dekket i innholdet.",
          "Legg inn en egen seksjon som svarer tydelig på «chambre séparée», siden dette søket får visninger uten å være godt nok dekket i innholdet.",
        ],
        topQueries: [],
        metrics: null,
      },
      metrics: null,
    });

    expect(
      suggestions.contentRecommendations.filter((item) => item.includes("Legg inn en egen seksjon")),
    ).toHaveLength(1);
  });

  it("unngår selvrefererende språk og bevarer norske særbokstaver i metadata", () => {
    const suggestions = generateFallbackAidarSuggestions({
      domain: "chambre.no",
      brand: "Chambre",
      keyword: "Hvor mye vin og øl bør man beregne til et selskap?",
      intent: "transactional",
      page: {
        url: "https://chambre.no/hvor-mye-vin-og-ol-bor-man-beregne",
        title: "Hvor mye vin og øl bør man beregne til et selskap? | Chambre",
        metaDescription: "",
        h1: "Hvor mye vin og øl bør man beregne til et selskap?",
        headings: ["Beregn drikke til selskap", "Vin, øl og alkoholfritt per gjest"],
        firstParagraph: "Få oversikt over hvor mye vin og øl du bør beregne til selskap, middag og arrangement.",
        bodyText: "Her finner du råd om hvor mye vin og øl du bør beregne til selskap, middag og arrangement, og hva som påvirker mengden per gjest.",
        hasContactLink: true,
      },
      queries: [
        {
          query: "hvor mye vin og ol bor man beregne til et selskap",
          impressions: 120,
          clicks: 8,
          ctr: 0.066,
          position: 10.2,
        },
      ],
      searchInsights: {
        audience: "brukere som planlegger selskap",
        audienceQualifier: "med tydelige råd",
        primaryQuery: "hvor mye vin og ol bor man beregne til et selskap",
        contentHighlights: ["vin, øl og alkoholfritt per gjest", "beregn drikke til selskap"],
        contentGaps: [],
        topQueries: [],
        metrics: null,
      },
      metrics: null,
    });

    expect(suggestions.titles.join(" ")).toContain("øl");
    expect(suggestions.titles.join(" ")).toContain("bør");
    expect(suggestions.metaDescriptions.join(" ")).toContain("øl");
    expect(suggestions.metaDescriptions.join(" ")).toContain("bør");
    expect(suggestions.metaDescriptions.join(" ")).not.toMatch(/på godt norsk|forklarer|her forklarer vi|forklart enkelt/i);
    expect(suggestions.metaDescriptions.join(" ")).not.toMatch(/\bol\b|\bbor\b/i);
  });

  it("bruker vurderingsspråk for commercial investigation", () => {
    const suggestions = generateFallbackAidarSuggestions({
      domain: "chambre.no",
      brand: "Chambre",
      keyword: "Chambre séparée i Oslo",
      intent: "commercial investigation",
      page: {
        url: "https://chambre.no/chambre-separee-oslo",
        title: "Chambre séparée i Oslo | Chambre",
        metaDescription: "",
        h1: "Chambre séparée i Oslo",
        headings: ["Privat rom til middag og selskap", "Priser og kapasitet"],
        firstParagraph: "Vurder chambre séparée i Oslo for middag, selskap og møter med eget rom.",
        bodyText: "Her finner du priser, kapasitet, hva som er inkludert og hvem løsningen passer for.",
        hasContactLink: true,
      },
      queries: [
        {
          query: "chambre separee oslo pris",
          impressions: 220,
          clicks: 14,
          ctr: 0.063,
          position: 8.4,
        },
      ],
      searchInsights: {
        audience: "brukere som sammenligner alternativer",
        audienceQualifier: "før de velger",
        primaryQuery: "chambre separee oslo pris",
        contentHighlights: ["priser", "kapasitet"],
        contentGaps: [],
        topQueries: [],
        metrics: null,
      },
      metrics: null,
    });

    expect(suggestions.titles.join(" ")).toMatch(/vurdering|sammenlign|priser/i);
    expect(suggestions.metaDescriptions.join(" ")).toMatch(/vurder|sammenlign|passer best/i);
    expect(suggestions.contentRecommendations.join(" ")).toMatch(/pris|inkludert|passer for/i);
  });

  it("bruker navigasjonsspråk for navigational intent", () => {
    const suggestions = generateFallbackAidarSuggestions({
      domain: "chambre.no",
      brand: "Chambre",
      keyword: "Chambre kontakt",
      intent: "navigational",
      page: {
        url: "https://chambre.no/kontakt",
        title: "Kontakt | Chambre",
        metaDescription: "",
        h1: "Kontakt Chambre",
        headings: ["Adresse og åpningstider", "Bestill bord eller selskapsrom"],
        firstParagraph: "Finn kontaktinformasjon, åpningstider og veibeskrivelse til Chambre.",
        bodyText: "Her finner du adresse, åpningstider, telefon og informasjon om bestilling.",
        hasContactLink: true,
      },
      queries: [
        {
          query: "chambre kontakt",
          impressions: 90,
          clicks: 30,
          ctr: 0.33,
          position: 2.1,
        },
      ],
      searchInsights: {
        audience: "brukere som vil finne riktig side raskt",
        audienceQualifier: "med kontaktinfo",
        primaryQuery: "chambre kontakt",
        contentHighlights: ["kontaktinfo", "åpningstider"],
        contentGaps: [],
        topQueries: [],
        metrics: null,
      },
      metrics: null,
    });

    expect(suggestions.titles[0]).toMatch(/Chambre/i);
    expect(suggestions.metaDescriptions.join(" ")).toMatch(/finn|raskt|kontakt/i);
    expect(suggestions.contentRecommendations.join(" ")).toMatch(/kontaktinfo|adresse|åpningstider/i);
  });

  it("avslutter ikke midt i tittel eller metabeskrivelse når tegngrensen nås", () => {
    const suggestions = generateFallbackAidarSuggestions({
      domain: "chambre.no",
      brand: "Chambre",
      keyword: "Hvor mye vin og øl bør man beregne til et selskap?",
      intent: "informational",
      page: {
        url: "https://chambre.no/drikke-til-selskap",
        title: "Hvor mye vin og øl bør man beregne til et selskap? | Chambre",
        metaDescription: "",
        h1: "Hvor mye vin og øl bør man beregne til et selskap?",
        headings: ["Beregn drikke til selskap", "Vin, øl og alkoholfritt per gjest"],
        firstParagraph: "Få oversikt over hvor mye vin og øl du bør beregne til selskap, middag og arrangement.",
        bodyText: "Få oversikt over hvor mye vin og øl du bør beregne til selskap, middag og arrangement. Se hva som påvirker mengden per gjest, og hva som skiller små og store selskaper.",
        hasContactLink: true,
      },
      queries: [
        {
          query: "hvor mye vin og ol bor man beregne til et selskap",
          impressions: 340,
          clicks: 16,
          ctr: 0.047,
          position: 8.9,
        },
      ],
      searchInsights: {
        audience: "brukere som planlegger selskap",
        audienceQualifier: "med tydelige råd",
        primaryQuery: "hvor mye vin og ol bor man beregne til et selskap",
        contentHighlights: ["vin, øl og alkoholfritt per gjest", "beregn drikke til selskap"],
        contentGaps: [],
        topQueries: [],
        metrics: null,
      },
      metrics: null,
    });

    for (const title of suggestions.titles) {
      expect(title.length).toBeLessThanOrEqual(60);
      expect(title).not.toMatch(/[–-]\s*$|[–-]\s*dette$/i);
      expect(title).not.toMatch(/\b(det|dette|og|for|med|til|som)$/i);
    }

    for (const description of suggestions.metaDescriptions) {
      expect(description.length).toBeLessThanOrEqual(155);
      expect(description).toMatch(/[.!?]$/);
      expect(description).not.toMatch(/\b(skiller|vurdere|som|og|for|med|til)$/i);
    }
  });

  it("skriver om for lange forslag til kortere varianter før trimming", () => {
    const suggestions = generateFallbackAidarSuggestions({
      domain: "chambre.no",
      brand: "Chambre",
      keyword: "Hvor mye vin og øl bør man beregne til et selskap?",
      intent: "commercial investigation",
      page: {
        url: "https://chambre.no/drikke-til-selskap",
        title: "Hvor mye vin og øl bør man beregne til et selskap? | Chambre",
        metaDescription: "",
        h1: "Hvor mye vin og øl bør man beregne til et selskap?",
        headings: ["Vin, øl og alkoholfritt per gjest", "Priser og pakker til selskap"],
        firstParagraph: "Vurder hvor mye vin og øl du bør beregne til selskap, og hva som påvirker pris, mengde og valg av drikkepakke.",
        bodyText: "Vurder hvor mye vin og øl du bør beregne til selskap, og hva som påvirker pris, mengde og valg av drikkepakke. Se også priser, pakker og hva som er inkludert.",
        hasContactLink: true,
      },
      queries: [
        {
          query: "hvor mye vin og ol bor man beregne til et selskap",
          impressions: 410,
          clicks: 19,
          ctr: 0.046,
          position: 8.1,
        },
      ],
      searchInsights: {
        audience: "brukere som sammenligner alternativer",
        audienceQualifier: "før de velger",
        primaryQuery: "hvor mye vin og ol bor man beregne til et selskap",
        contentHighlights: ["vin, øl og alkoholfritt per gjest", "priser og pakker"],
        contentGaps: [],
        topQueries: [],
        metrics: null,
      },
      metrics: null,
    });

    expect(suggestions.titles[0].length).toBeLessThanOrEqual(60);
    expect(suggestions.titles[0]).not.toMatch(/dette bør du vite|dette bør du vurdere/i);
    expect(suggestions.metaDescriptions[0].length).toBeLessThanOrEqual(155);
    expect(suggestions.metaDescriptions[0]).not.toMatch(/det viktigste du trenger før du velger eller tar kontakt.*$/i);
    expect(suggestions.metaDescriptions[0]).toMatch(/[.!?]$/);
  });

  it("prioriterer de mest konkrete forslagene foran generiske varianter", () => {
    const suggestions = generateFallbackAidarSuggestions({
      domain: "denis.no",
      brand: "Denis",
      keyword: "Hypnoseshow",
      intent: "transactional",
      page: {
        url: "https://denis.no/hypnoseshow",
        title: "Hypnoseshow for firmafest | Denis",
        metaDescription: "",
        h1: "Hypnoseshow for firmafest og event",
        headings: ["Booking", "Priser og praktisk info"],
        firstParagraph: "Bestill hypnoseshow til firmafest og event.",
        bodyText: "Bestill hypnoseshow til firmafest og event. Se priser, booking og hva som er inkludert.",
        hasContactLink: true,
      },
      queries: [
        {
          query: "hypnoseshow",
          impressions: 260,
          clicks: 20,
          ctr: 0.076,
          position: 7.8,
        },
      ],
      searchInsights: {
        audience: "brukere som vurderer å ta kontakt",
        audienceQualifier: "med priser og neste steg",
        primaryQuery: "hypnoseshow",
        contentHighlights: ["booking", "priser"],
        contentGaps: [],
        topQueries: [],
        metrics: null,
      },
      metrics: null,
    });

    expect(suggestions.titles[0]).toMatch(/booking|firmafest|event/i);
    expect(suggestions.metaDescriptions[0]).toMatch(/tilbud|booking|pris|inkludert/i);
    expect(suggestions.titles.join(" ")).not.toMatch(/på godt norsk|denne siden/i);
  });

  it("unngår generiske informasjonsmaler for korte emner som S4 Oslo", () => {
    const suggestions = generateFallbackAidarSuggestions({
      domain: "s4nightclub.no",
      brand: "S4",
      keyword: "s4 oslo",
      intent: "informational",
      page: {
        url: "https://s4nightclub.no/",
        title: "S4 Nightclub Oslo | S4",
        metaDescription: "",
        h1: "S4 Nightclub Oslo",
        headings: ["Åpningstider", "Bordbooking", "Events og gjesteliste"],
        firstParagraph: "Se åpningstider, booking og kommende events hos S4 Nightclub i Oslo.",
        bodyText: "Se åpningstider, booking, events og gjesteliste hos S4 Nightclub i Oslo. Finn praktisk info før du besøker klubben.",
        hasContactLink: true,
      },
      queries: [
        {
          query: "s4 oslo",
          impressions: 180,
          clicks: 12,
          ctr: 0.067,
          position: 9.1,
        },
      ],
      searchInsights: {
        audience: "brukere som vil forstå temaet",
        audienceQualifier: "forklart enkelt",
        primaryQuery: "s4 oslo",
        contentHighlights: ["åpningstider", "bordbooking", "events og gjesteliste"],
        contentGaps: [],
        topQueries: [],
        metrics: null,
      },
      metrics: null,
    });

    expect(suggestions.titles.join(" ")).not.toMatch(/det du bør vite|dette bør du vite|for deg som vil forstå temaet/i);
    expect(suggestions.metaDescriptions.join(" ")).not.toMatch(/lær mer om|hva som er viktig å vite før du velger|hva som påvirker valget|hva som skiller alternativene/i);
    expect(suggestions.titles.join(" ")).toMatch(/åpningstider|booking|events|gjesteliste/i);
    expect(new Set(suggestions.titles).size).toBe(suggestions.titles.length);
    expect(new Set(suggestions.metaDescriptions).size).toBe(suggestions.metaDescriptions.length);
  });

  it("dedupliserer nesten like forslag for Lost and Found-lignende sider", () => {
    const suggestions = generateFallbackAidarSuggestions({
      domain: "s4nightclub.no",
      brand: "S4",
      keyword: "Lost found",
      intent: "informational",
      page: {
        url: "https://s4nightclub.no/lost-found",
        title: "Lost and Found | S4",
        metaDescription: "",
        h1: "Lost and Found",
        headings: ["Glemte eiendeler", "Kontakt oss", "Henting og åpningstider"],
        firstParagraph: "Finn informasjon om glemte eiendeler, kontakt og når du kan hente ting hos S4.",
        bodyText: "Finn informasjon om glemte eiendeler, kontakt, henting og åpningstider hos S4. Se hvordan du melder inn det du har mistet.",
        hasContactLink: true,
      },
      queries: [
        {
          query: "lost found s4",
          impressions: 75,
          clicks: 10,
          ctr: 0.13,
          position: 5.4,
        },
      ],
      searchInsights: {
        audience: "brukere som vil forstå temaet",
        audienceQualifier: "forklart enkelt",
        primaryQuery: "lost found s4",
        contentHighlights: ["glemte eiendeler", "kontakt oss", "henting og åpningstider"],
        contentGaps: [],
        topQueries: [],
        metrics: null,
      },
      metrics: null,
    });

    expect(suggestions.titles.join(" ")).toMatch(/glemte eiendeler|kontakt|åpningstider|henting/i);
    expect(suggestions.titles.join(" ")).not.toMatch(/det du bør vite|dette bør du vite/i);
    expect(suggestions.metaDescriptions.join(" ")).not.toMatch(/det viktigste du bør vite før du tar et valg|hva som påvirker valget/i);
    expect(new Set(suggestions.titles).size).toBe(suggestions.titles.length);
    expect(new Set(suggestions.metaDescriptions).size).toBe(suggestions.metaDescriptions.length);
  });

  it("følger nattklubbregler for merkevaresøk", () => {
    const suggestions = generateFallbackAidarSuggestions({
      domain: "s4nightclub.no",
      brand: "S4",
      keyword: "S4 Oslo",
      intent: "informational",
      page: {
        url: "https://s4nightclub.no/",
        title: "S4 Nightclub Oslo | S4",
        metaDescription: "",
        h1: "S4 Nightclub Oslo",
        headings: ["Bordbooking", "Gjesteliste"],
        firstParagraph: "Book bord og finn gjesteliste hos S4 Nightclub i Oslo.",
        bodyText: "Book bord og finn gjesteliste hos S4 Nightclub i Oslo. Kontakt oss for booking. Aldersgrense og kleskode er ikke omtalt her.",
        hasContactLink: true,
      },
      queries: [
        {
          query: "s4 oslo",
          impressions: 220,
          clicks: 18,
          ctr: 0.081,
          position: 6.7,
        },
      ],
      searchInsights: {
        audience: "brukere som vil forstå temaet",
        audienceQualifier: "forklart enkelt",
        primaryQuery: "s4 oslo",
        contentHighlights: ["bordbooking", "gjesteliste"],
        contentGaps: [],
        topQueries: [],
        metrics: null,
      },
      metrics: null,
    });

    expect(suggestions.titles.join(" ")).toMatch(/åpningstider|booking|meny|gjesteliste/i);
    expect(suggestions.titles.join(" ")).not.toMatch(/forstå temaet|det du bør vite|guide|lær mer/i);
    expect(suggestions.metaDescriptions.join(" ")).toMatch(/åpningstider|booking|meny|gjesteliste|praktisk info/i);
    expect(suggestions.contentRecommendations.join(" ")).toMatch(/åpningstider|meny|aldersgrense|kleskode/i);
    expect(suggestions.contentRecommendations.join(" ")).not.toMatch(/forskjellen|hovedpoenget|prisnivå|hva som er inkludert/i);
  });

  it("skriver ferdige restaurant-snippets, ikke redaksjonelle instrukser", () => {
    const descriptions = buildPolicyDescriptions({
      domain: "herregaardskroen.no",
      brand: "Herregårdskroen",
      keyword: "Herregårdskroen",
      intent: "navigational",
      page: {
        url: "https://herregaardskroen.no/",
        title: "Herregårdskroen",
        metaDescription: "",
        h1: "Herregårdskroen",
        headings: ["Meny", "Bordreservasjon", "Åpningstider"],
        firstParagraph: "Se meny og bestill bord hos Herregårdskroen.",
        bodyText: "Se meny, åpningstider og bestill bord hos Herregårdskroen.",
        hasContactLink: true,
      },
      queries: [{ query: "herregårdskroen", impressions: 200, clicks: 40, ctr: 0.2, position: 1.8 }],
      searchInsights: {
        audience: "gjester som vil planlegge besoket",
        audienceQualifier: null,
        primaryQuery: "herregårdskroen",
        contentHighlights: ["Meny", "Bordreservasjon", "Åpningstider"],
        contentGaps: [],
        topQueries: [],
        metrics: null,
      },
      metrics: null,
    }, "Herregårdskroen");

    expect(descriptions?.[0]).toMatch(/meny|apningstider|bordreservasjon/i);
    expect(descriptions?.join(" ")).not.toMatch(/samlet hoyt pa siden|slik at gjestene finner|synlig for brukeren/i);
  });

  it("bruker home-mal for nattklubbforside", () => {
    const suggestions = generateFallbackAidarSuggestions({
      domain: "s4nightclub.no",
      brand: "S4",
      keyword: "S4 Rooftop",
      intent: "navigational",
      page: {
        url: "https://s4nightclub.no/",
        title: "S4 Rooftop & Nightclub Oslo | S4",
        metaDescription: "",
        h1: "S4 Rooftop & Nightclub Oslo",
        headings: ["Rooftop", "Nightclub", "Bordbooking"],
        firstParagraph: "Opplev rooftop, nattklubb og bordbooking hos S4 i Oslo.",
        bodyText: "Opplev rooftop, nattklubb og bordbooking hos S4 i Oslo. Bestill bord og se åpningstider før kvelden starter.",
        hasContactLink: true,
      },
      queries: [
        {
          query: "s4 rooftop",
          impressions: 140,
          clicks: 18,
          ctr: 0.129,
          position: 5.2,
        },
      ],
      searchInsights: {
        audience: "brukere som vil finne riktig side raskt",
        audienceQualifier: "med kontaktinfo",
        primaryQuery: "s4 rooftop",
        contentHighlights: ["rooftop", "bordbooking"],
        contentGaps: [],
        topQueries: [],
        metrics: null,
      },
      metrics: null,
    });

    expect(suggestions.titles[0]).toMatch(/S4.*Rooftop.*Oslo/i);
    expect(suggestions.titles.join(" ")).toMatch(/råeste takterrasse|bestill bord|åpningstider/i);
  });

  it("behandler generiske utelivssøk som discovery, ikke handling", () => {
    const suggestions = generateFallbackAidarSuggestions({
      domain: "s4nightclub.no",
      brand: "S4",
      keyword: "nattklubb oslo",
      intent: "commercial investigation",
      page: {
        url: "https://s4nightclub.no/nightclub-oslo/",
        title: "Nightclub Oslo | S4",
        metaDescription: "",
        h1: "Nightclub Oslo",
        headings: ["DJ-konsepter", "Bildegalleri", "Anmeldelser"],
        firstParagraph: "Se stemningen, DJ-konseptene og bildegalleriet fra kvelder hos S4 i Oslo.",
        bodyText: "Se stemningen, DJ-konseptene, bildegalleriet og anmeldelser fra kvelder hos S4 i Oslo.",
        hasContactLink: true,
      },
      queries: [
        {
          query: "nattklubb oslo",
          impressions: 320,
          clicks: 14,
          ctr: 0.044,
          position: 8.2,
        },
      ],
      searchInsights: {
        audience: "brukere som sammenligner alternativer",
        audienceQualifier: "før de velger",
        primaryQuery: "nattklubb oslo",
        contentHighlights: ["DJ-konsepter", "Bildegalleri", "Anmeldelser"],
        contentGaps: [],
        topQueries: [],
        metrics: null,
      },
      metrics: null,
    });

    expect(suggestions.titles.join(" ")).toMatch(/atmosfære|DJ|anmeldelser|bildegalleri/i);
    expect(suggestions.metaDescriptions.join(" ")).toMatch(/atmosfære|bildegalleri|DJ-konsepter|anmeldelser|stemning/i);
    expect(suggestions.metaDescriptions.join(" ")).not.toMatch(/åpningstider.*booking|bestill bord.*åpningstider/i);
  });
});
