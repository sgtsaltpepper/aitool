import { z } from "zod";

import { DEFAULT_COUNTRY, DEFAULT_LOCALE, DEFAULT_MAX_PAGES } from "@/lib/config";

export const auditRequestSchema = z.object({
  targetUrl: z.string().url(),
  locale: z.string().min(2).default(DEFAULT_LOCALE),
  country: z.string().min(2).max(2).default(DEFAULT_COUNTRY),
  competitorUrls: z
    .array(z.string().url())
    .default([])
    .transform((urls) => urls.filter(Boolean)),
  maxPages: z.coerce.number().int().min(10).max(150).default(DEFAULT_MAX_PAGES),
});

export type AuditRequestSchema = z.infer<typeof auditRequestSchema>;
