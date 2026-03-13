import { createHash } from "node:crypto";

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeUrl(input: string): string {
  const url = new URL(input);
  url.hash = "";
  if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
    url.port = "";
  }

  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
}

export function sameHost(a: string, b: string): boolean {
  return new URL(a).hostname === new URL(b).hostname;
}

export function extractTextTokens(value: string): string[] {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);
}

export function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function safeNumber(value: number, digits = 1): number {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

export function average(values: number[]): number {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

export function percent(part: number, total: number): number {
  if (!total) {
    return 0;
  }

  return (part / total) * 100;
}

export function hashId(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 12);
}

export function formatDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

export function daysSince(value: string | null): number | null {
  const formatted = formatDate(value);
  if (!formatted) {
    return null;
  }

  const diff = Date.now() - new Date(formatted).getTime();
  return Math.max(0, diff / (1000 * 60 * 60 * 24));
}

export function summarizeList(items: string[], max = 3): string {
  if (!items.length) {
    return "";
  }

  if (items.length <= max) {
    return items.join(", ");
  }

  return `${items.slice(0, max).join(", ")} +${items.length - max}`;
}

export function humanPath(url: string): string {
  const parsed = new URL(url);
  return parsed.pathname === "/" ? parsed.hostname : `${parsed.hostname}${parsed.pathname}`;
}
