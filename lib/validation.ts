import { z } from "zod";

import { DEFAULT_COUNTRY, DEFAULT_LOCALE, DEFAULT_MAX_PAGES } from "@/lib/config";

const httpUrlSchema = z
  .string()
  .url()
  .refine((url) => /^https?:\/\//i.test(url), "Kun http/https er støttet");

const commonFields = {
  targetUrl: z
    .string()
    .url()
    .refine((url) => /^https?:\/\//i.test(url), "Kun http/https er støttet"),
  locale: z.string().min(2).default(DEFAULT_LOCALE),
  country: z.string().min(2).max(2).default(DEFAULT_COUNTRY),
};

export const auditRequestSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("domain"),
    ...commonFields,
    competitorUrls: z.array(httpUrlSchema).default([]).transform((urls) => urls.filter(Boolean)),
    maxPages: z.coerce.number().int().min(10).max(500).default(DEFAULT_MAX_PAGES),
  }),
  z.object({
    mode: z.literal("page"),
    ...commonFields,
    competitorUrls: z.array(httpUrlSchema).default([]).transform(() => []),
    maxPages: z.coerce.number().int().default(1).transform(() => 1),
  }),
]);

export type AuditRequestSchema = z.infer<typeof auditRequestSchema>;
