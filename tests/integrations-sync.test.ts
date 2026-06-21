import { describe, expect, it } from "vitest";

import { normalizeGa4Date } from "@/lib/integrations/ga4";
import { rowDateKey } from "@/lib/integrations/gsc";

describe("integration sync helpers", () => {
  it("normaliserer GA4-datoer til ISO-format", () => {
    expect(normalizeGa4Date("20260621")).toBe("2026-06-21");
    expect(normalizeGa4Date("2026-06-21")).toBe("2026-06-21");
  });

  it("beholder gyldige GSC-datoer som radnøkkel", () => {
    expect(rowDateKey("2026-06-21")).toBe("2026-06-21");
  });
});
