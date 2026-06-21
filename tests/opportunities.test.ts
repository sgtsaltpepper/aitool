import { describe, expect, it } from "vitest";

import { buildPageSearchInsights } from "@/lib/meta-suggestions";
import { isBrandLikeQuery, shouldConsiderHomepageRedirect, urlLanguageMatchesQuery } from "@/lib/opportunities";

describe("opportunity redirect heuristics", () => {
  it("fanger opp merkevaresøk som treffer en generisk sekundærside", () => {
    expect(
      shouldConsiderHomepageRedirect({
        domain: "s4nightclub.no",
        page: "https://s4nightclub.no/experience-oslos-premier-night-club-s4/",
        query: "s4 oslo",
        pageClicks: 3,
        pageImpressions: 180,
      }),
    ).toBe(true);
  });

  it("beholder egne destinasjonssider som booking eller kontakt", () => {
    expect(
      shouldConsiderHomepageRedirect({
        domain: "s4nightclub.no",
        page: "https://s4nightclub.no/booking/",
        query: "s4 oslo",
        pageClicks: 3,
        pageImpressions: 180,
      }),
    ).toBe(false);

    expect(
      shouldConsiderHomepageRedirect({
        domain: "s4nightclub.no",
        page: "https://s4nightclub.no/lost-found/",
        query: "lost found s4",
        pageClicks: 4,
        pageImpressions: 140,
      }),
    ).toBe(false);
  });

  it("gjenkjenner merkevarepregede søk men ikke vanlige emnesøk", () => {
    expect(isBrandLikeQuery("s4 oslo", "s4nightclub.no")).toBe(true);
    expect(isBrandLikeQuery("nightclub s4", "s4nightclub.no")).toBe(true);
    expect(isBrandLikeQuery("utesteder oslo sentrum", "s4nightclub.no")).toBe(false);
  });

  it("fanger opp når URL-språk ikke samsvarer med søkespråk", () => {
    expect(
      urlLanguageMatchesQuery(
        "åpningstider s4 oslo",
        "https://s4nightclub.no/opening-hours/",
      ),
    ).toBe(false);

    expect(
      urlLanguageMatchesQuery(
        "opening hours s4 oslo",
        "https://s4nightclub.no/opening-hours/",
      ),
    ).toBe(true);

    expect(
      urlLanguageMatchesQuery(
        "s4 oslo",
        "https://s4nightclub.no/s4-oslo/",
      ),
    ).toBe(null);
  });

  it("lager konkrete innholdsgrep fra toppsøk når queryene ikke er tydelig dekket", () => {
    const insights = buildPageSearchInsights({
      domain: "S4 Nightclub",
      brand: "S4",
      intent: "informational",
      keyword: "S4",
      page: {
        url: "https://s4nightclub.no/",
        path: "/",
        title: "Nightclub Oslo | S4",
        metaDescription: "",
        h1: "Nightclub Oslo",
        headings: ["Bordbooking", "Gjesteliste"],
        firstParagraph: "Book bord og finn gjesteliste hos S4 Nightclub i Oslo.",
        bodyText: "Book bord og finn gjesteliste hos S4 Nightclub i Oslo.",
        hasContactLink: true,
        answerFirstSignals: {
          conciseOpening: true,
          hasFaq: false,
          hasTable: false,
          hasList: false,
          directAnswerLikelihood: 70,
        },
      },
      queries: [
        { query: "s4", impressions: 3033, clicks: 10, ctr: 0.003, position: 2.0 },
        { query: "s4 oslo", impressions: 1423, clicks: 8, ctr: 0.006, position: 1.0 },
        { query: "s4 rooftop", impressions: 782, clicks: 4, ctr: 0.005, position: 5.7 },
        { query: "night club", impressions: 553, clicks: 5, ctr: 0.009, position: 8.2 },
      ],
      metrics: null,
    });

    expect(insights?.contentGaps.join(" ")).toContain("«s4»");
    expect(insights?.contentGaps.join(" ")).toContain("«s4 oslo»");
    expect(insights?.contentGaps.join(" ")).toContain("«s4 rooftop»");
  });
});
