"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type AuditFormProps = {
  defaultLocale: string;
  defaultCountry: string;
  defaultMaxPages: number;
};

export function AuditForm({ defaultLocale, defaultCountry, defaultMaxPages }: AuditFormProps) {
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
          targetUrl,
          locale,
          country,
          maxPages,
          competitorUrls: competitorUrls.filter(Boolean),
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
        <span>Måldomene</span>
        <input
          placeholder="https://example.no"
          value={targetUrl}
          onChange={(event) => setTargetUrl(event.target.value)}
          required
        />
      </label>

      <div className="grid-3">
        <label>
          <span>Locale</span>
          <input value={locale} onChange={(event) => setLocale(event.target.value)} required />
        </label>
        <label>
          <span>Land</span>
          <input value={country} maxLength={2} onChange={(event) => setCountry(event.target.value.toUpperCase())} required />
        </label>
        <label>
          <span>Maks sider</span>
          <input
            type="number"
            min="10"
            max="150"
            value={maxPages}
            onChange={(event) => setMaxPages(event.target.value)}
            required
          />
        </label>
      </div>

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
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => removeCompetitor(index)}
                >
                  Fjern
                </button>
              ) : null}
            </div>
          </label>
        ))}
      </div>

      <div className="button-row">
        <button type="button" className="secondary-button" onClick={addCompetitor}>
          Legg til konkurrent
        </button>
        <button type="submit" className="primary-button" disabled={isPending}>
          {isPending ? "Starter analyse..." : "Start audit"}
        </button>
      </div>
      <p className="helper-text">
        Verktøyet crawler offentlige sider, sammenligner rå HTML mot rendret innhold og gir anbefalinger for AI-boter og SEO.
      </p>
      {error ? <p className="error-text">{error}</p> : null}
    </form>
  );
}
