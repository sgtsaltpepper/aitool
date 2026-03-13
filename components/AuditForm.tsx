"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type AuditFormProps = {
  defaultLocale: string;
  defaultCountry: string;
  defaultMaxPages: number;
  mode?: "domain" | "page";
};

export function AuditForm({
  defaultLocale,
  defaultCountry,
  defaultMaxPages,
  mode = "domain",
}: AuditFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [targetUrl, setTargetUrl] = useState("");
  const [locale, setLocale] = useState(defaultLocale);
  const [country, setCountry] = useState(defaultCountry);
  const [maxPages, setMaxPages] = useState(String(defaultMaxPages));
  const [competitorUrls, setCompetitorUrls] = useState<string[]>([""]);
  const [error, setError] = useState<string | null>(null);

  const updateCompetitor = (index: number, value: string) => {
    setCompetitorUrls((current) => current.map((item, itemIndex) => (itemIndex === index ? value : item)));
  };

  const addCompetitor = () => {
    setCompetitorUrls((current) => [...current, ""]);
  };

  const removeCompetitor = (index: number) => {
    setCompetitorUrls((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const response = await fetch("/api/audits", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          mode,
          targetUrl,
          locale,
          country,
          maxPages,
          competitorUrls: mode === "domain" ? competitorUrls.filter(Boolean) : [],
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Klarte ikke å starte analysen");
        return;
      }

      const payload = (await response.json()) as { id: string };
      router.push(`/audits/${payload.id}`);
      router.refresh();
    });
  };

  return (
    <form className="audit-form" onSubmit={onSubmit}>
      <label>
        <span>{mode === "domain" ? "Måldomene" : "Side-URL"}</span>
        <input
          placeholder={mode === "domain" ? "https://example.no" : "https://example.no/landingsside"}
          value={targetUrl}
          onChange={(event) => setTargetUrl(event.target.value)}
          required
        />
      </label>

      <div className={mode === "domain" ? "grid-3" : "grid-2"}>
        <label>
          <span>Locale</span>
          <input value={locale} onChange={(event) => setLocale(event.target.value)} required />
        </label>
        <label>
          <span>Land</span>
          <input value={country} maxLength={2} onChange={(event) => setCountry(event.target.value.toUpperCase())} required />
        </label>
        {mode === "domain" ? (
          <label>
            <span>Maks sider</span>
            <input
              type="number"
              min="10"
              max="500"
              value={maxPages}
              onChange={(event) => setMaxPages(event.target.value)}
              required
            />
          </label>
        ) : null}
      </div>

      {mode === "domain" ? (
        <div className="grid-2">
          {competitorUrls.map((competitorUrl, index) => (
            <label key={`competitor-${index}`}>
              <span>Konkurrent {index + 1}</span>
              <div className="button-row">
                <input
                  placeholder="https://konkurrent.no"
                  value={competitorUrl}
                  onChange={(event) => updateCompetitor(index, event.target.value)}
                />
                {competitorUrls.length > 1 ? (
                  <button type="button" className="secondary-button" onClick={() => removeCompetitor(index)}>
                    Fjern
                  </button>
                ) : null}
              </div>
            </label>
          ))}
        </div>
      ) : null}

      <div className="button-row">
        {mode === "domain" ? (
          <button type="button" className="secondary-button" onClick={addCompetitor}>
            Legg til konkurrent
          </button>
        ) : null}
        <button type="submit" className="primary-button" disabled={isPending}>
          {isPending ? "Starter analyse..." : mode === "domain" ? "Start domeneanalyse" : "Start sideanalyse"}
        </button>
      </div>
      <p className="helper-text">
        {mode === "domain"
          ? "Verktøyet crawler offentlige sider, sammenligner rå HTML mot rendret innhold og gir anbefalinger for AI-boter og SEO. Standard er 150 sider, men du kan øke til 500 ved behov."
          : "Verktøyet analyserer kun den eksakte URL-en du legger inn, og foreslår bedre struktur, innhold, metadata og JSON-LD for akkurat denne siden."}
      </p>
      {error ? <p className="error-text">{error}</p> : null}
    </form>
  );
}
