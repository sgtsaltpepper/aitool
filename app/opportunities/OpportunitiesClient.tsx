"use client";

import { useState, useCallback } from "react";
import type { Opportunity, DomainIntegration, OpportunitySnapshot } from "@/lib/types";

const PRIORITY_COLORS: Record<string, string> = {
  critical: "#dc2626",
  high: "#ea580c",
  medium: "#d97706",
  low: "#6b7280",
};

const TYPE_LABELS: Record<string, string> = {
  "high-impressions-low-ctr": "High Impressions / Low CTR",
  "near-page-one": "Nær topp 3",
  "traffic-down": "Taper synlighet",
  "indexing-blocker": "Indexeringsblokkering",
  "high-traffic-low-conversion": "Høy trafikk / lav konvertering",
  "query-gap": "Søkegap",
};

type Suggestions = {
  titles: string[];
  metaDescriptions: string[];
  titleOptions?: { text: string; score: number; reasons: string[] }[];
  metaDescriptionOptions?: { text: string; score: number; reasons: string[] }[];
  topQueries: { query: string; impressions: number; clicks: number; position: number }[];
  intent?: string;
  slugLabel?: string;
  audience?: string | null;
  performanceConclusions?: string[];
  contentHighlights?: string[];
  contentGaps?: string[];
  agent?: {
    name: string;
    mode: "openai" | "fallback";
    model: string | null;
    notes: string[];
  };
} | null;

function resolveOpportunityUrl(domain: string, pageUrl: string): { href: string; label: string } {
  const raw = pageUrl?.trim() || "/";

  try {
    const absolute = new URL(raw);
    const label = absolute.pathname === "/" ? absolute.hostname : `${absolute.hostname}${absolute.pathname}`;
    return { href: absolute.toString(), label };
  } catch {
    const pathname = raw.startsWith("/") ? raw : `/${raw}`;
    return {
      href: `https://${domain}${pathname}`,
      label: pathname === "/" ? domain : `${domain}${pathname}`,
    };
  }
}

function OpportunityCard({
  opp,
  domain,
  onStatusChange,
}: {
  opp: Opportunity;
  domain: string;
  onStatusChange: (id: number, status: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<Suggestions>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const resolvedUrl = resolveOpportunityUrl(domain, opp.pageUrl);

  async function loadSuggestions() {
    if (suggestions) {
      setSuggestionsError(null);
      setShowSuggestions(!showSuggestions);
      return;
    }

    setLoadingSuggestions(true);
    try {
      const res = await fetch(
        `/api/opportunities/suggestions?pageUrl=${encodeURIComponent(opp.pageUrl)}&domain=${encodeURIComponent(domain)}&targetUrl=${encodeURIComponent(opp.targetUrl)}`,
      );
      if (!res.ok) {
        throw new Error("Kunne ikke hente konkrete forslag akkurat nå.");
      }
      type SuggestionsResponse = {
        suggestions: {
          titles: string[];
          metaDescriptions: string[];
          titleOptions?: { text: string; score: number; reasons: string[] }[];
          metaDescriptionOptions?: { text: string; score: number; reasons: string[] }[];
        };
        topQueries: NonNullable<Suggestions>["topQueries"];
        audience?: string | null;
        performanceConclusions?: string[];
        contentHighlights?: string[];
        contentGaps?: string[];
        agent?: NonNullable<Suggestions>["agent"];
      };
      const data = await res.json() as SuggestionsResponse & { intent?: string; slugLabel?: string };
      setSuggestionsError(null);
      setSuggestions({
        ...data.suggestions,
        topQueries: data.topQueries,
        intent: data.intent,
        slugLabel: data.slugLabel,
        audience: data.audience,
        performanceConclusions: data.performanceConclusions ?? [],
        contentHighlights: data.contentHighlights ?? [],
        contentGaps: data.contentGaps ?? [],
        agent: data.agent,
      });
      setShowSuggestions(true);
    } catch {
      setSuggestionsError("Kunne ikke hente konkrete forslag akkurat nå. Prøv igjen.");
      setShowSuggestions(false);
      setSuggestions(null);
    }
    setLoadingSuggestions(false);
  }

  async function updateStatus(newStatus: string) {
    setStatusLoading(true);
    await fetch(`/api/opportunities/${opp.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    onStatusChange(opp.id, newStatus);
    setStatusLoading(false);
  }

  const hasConcreteSuggestions =
    opp.type === "high-impressions-low-ctr" ||
    opp.type === "near-page-one" ||
    opp.type === "high-traffic-low-conversion" ||
    opp.type === "query-gap" ||
    opp.type === "traffic-down";

  return (
    <div className="opportunity-card" style={{ opacity: statusLoading ? 0.5 : 1 }}>
      <div className="card-header">
        <span
          className="priority-badge"
          style={{ background: PRIORITY_COLORS[opp.priority], color: "#fff", padding: "2px 8px", borderRadius: "4px", fontSize: "0.75rem", fontWeight: 600 }}
        >
          {opp.priority}
        </span>
        <h3 className="card-title" style={{ margin: 0 }}>{opp.title}</h3>
      </div>
      <p className="card-url" style={{ fontSize: "0.85rem", opacity: 0.7, margin: "0.25rem 0 0.75rem" }}>
        <a href={resolvedUrl.href} target="_blank" rel="noopener noreferrer">{resolvedUrl.label}</a>
      </p>

      {opp.query && (
        <p style={{ fontSize: "0.85rem", marginBottom: "0.5rem" }}>
          <strong>Søk:</strong> {opp.query}
        </p>
      )}

      <div className="card-body" style={{ display: "grid", gap: "0.75rem", marginBottom: "0.75rem" }}>
        <div>
          <strong style={{ fontSize: "0.85rem" }}>Anbefalt tiltak</strong>
          <p style={{ margin: "0.25rem 0 0", fontSize: "0.9rem" }}>{opp.recommendedAction}</p>
        </div>
        <div>
          <strong style={{ fontSize: "0.85rem" }}>Forventet effekt</strong>
          <p style={{ margin: "0.25rem 0 0", fontSize: "0.9rem" }}>{opp.expectedImpact}</p>
        </div>
      </div>

      {hasConcreteSuggestions && (
        <div style={{ marginBottom: "0.75rem" }}>
          <button
            onClick={loadSuggestions}
            disabled={loadingSuggestions}
            style={{
              fontSize: "0.8rem", padding: "0.3rem 0.75rem", cursor: "pointer",
              background: "transparent", border: "1px solid currentColor",
              borderRadius: "6px", opacity: loadingSuggestions ? 0.5 : 1,
            }}
          >
            {loadingSuggestions ? "Henter…" : showSuggestions ? "Skjul konkrete forslag" : "Vis konkrete forslag"}
          </button>

          {suggestionsError && (
            <p style={{ margin: "0.5rem 0 0", fontSize: "0.8rem", color: "#b91c1c" }}>
              {suggestionsError}
            </p>
          )}

          {showSuggestions && suggestions && (
            <div style={{ marginTop: "0.75rem", background: "rgba(0,0,0,0.04)", borderRadius: "8px", padding: "1rem" }}>
              {suggestions.intent && suggestions.intent !== "generic" && (
                <p style={{ fontSize: "0.78rem", marginBottom: "0.5rem", opacity: 0.6 }}>
                  Sidetype oppdaget: <strong>{suggestions.intent}</strong>
                  {suggestions.slugLabel ? ` – «${suggestions.slugLabel}»` : ""}
                </p>
              )}
              {suggestions.topQueries.length > 0 && (
                <div style={{ marginBottom: "0.75rem" }}>
                  <strong style={{ fontSize: "0.8rem" }}>Topp søk for denne siden</strong>
                  <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1.25rem", fontSize: "0.8rem" }}>
                    {suggestions.topQueries.map((q) => (
                      <li key={q.query}>{q.query} — {q.impressions} vis, pos {q.position.toFixed(1)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {(suggestions.audience || suggestions.contentGaps?.length) && (
                <div style={{ marginBottom: "0.75rem" }}>
                  <strong style={{ fontSize: "0.8rem" }}>Konkrete grep for denne siden</strong>
                  <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1.25rem", fontSize: "0.8rem" }}>
                    {suggestions.audience ? <li>Målgruppe: {suggestions.audience}</li> : null}
                    {suggestions.contentGaps?.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
              )}
              {suggestions.performanceConclusions?.length ? (
                <div style={{ marginBottom: "0.75rem" }}>
                  <strong style={{ fontSize: "0.8rem" }}>Det systemet reagerte på</strong>
                  <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1.25rem", fontSize: "0.8rem" }}>
                    {suggestions.performanceConclusions.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
              ) : null}
              {suggestions.agent && (
                <p style={{ fontSize: "0.78rem", marginBottom: "0.75rem", opacity: 0.7 }}>
                  Generert av <strong>{suggestions.agent.name}</strong>
                  {suggestions.agent.mode === "openai"
                    ? suggestions.agent.model
                      ? ` via AI-modellen ${suggestions.agent.model}`
                      : " via AI"
                    : " med lokal fallback"}
                </p>
              )}
              {suggestions.titles.length > 0 && (
                <div style={{ marginBottom: "0.75rem" }}>
                  <strong style={{ fontSize: "0.8rem" }}>Forslag til title tag fra Aidar</strong>
                  {(suggestions.titleOptions?.length ? suggestions.titleOptions : suggestions.titles.map((text) => ({ text, score: 0, reasons: [] }))).map((option, i) => (
                    <div key={i} style={{ marginTop: "0.35rem", background: "#fff", borderRadius: "4px", padding: "0.4rem 0.6rem", fontSize: "0.85rem", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
                      <div style={{ minWidth: 0 }}>
                        <span>{option.text}</span>
                        {(option.score > 0 || option.reasons.length > 0) && (
                          <div style={{ marginTop: "0.2rem", fontSize: "0.74rem", opacity: 0.7 }}>
                            {option.score > 0 ? `Kvalitetsscore: ${option.score}` : null}
                            {option.score > 0 && option.reasons.length > 0 ? " · " : null}
                            {option.reasons.length > 0 ? option.reasons.join(" · ") : null}
                          </div>
                        )}
                      </div>
                      <button onClick={() => navigator.clipboard.writeText(option.text)} style={{ fontSize: "0.7rem", padding: "0.15rem 0.5rem", background: "transparent", border: "1px solid #ccc", borderRadius: "4px", cursor: "pointer", flexShrink: 0 }}>Kopier</button>
                    </div>
                  ))}
                </div>
              )}
              {suggestions.metaDescriptions.length > 0 && (
                <div>
                  <strong style={{ fontSize: "0.8rem" }}>Forslag til meta description fra Aidar</strong>
                  {(suggestions.metaDescriptionOptions?.length ? suggestions.metaDescriptionOptions : suggestions.metaDescriptions.map((text) => ({ text, score: 0, reasons: [] }))).map((option, i) => (
                    <div key={i} style={{ marginTop: "0.35rem", background: "#fff", borderRadius: "4px", padding: "0.4rem 0.6rem", fontSize: "0.85rem", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
                      <div style={{ minWidth: 0 }}>
                        <span>{option.text}</span>
                        {(option.score > 0 || option.reasons.length > 0) && (
                          <div style={{ marginTop: "0.2rem", fontSize: "0.74rem", opacity: 0.7 }}>
                            {option.score > 0 ? `Kvalitetsscore: ${option.score}` : null}
                            {option.score > 0 && option.reasons.length > 0 ? " · " : null}
                            {option.reasons.length > 0 ? option.reasons.join(" · ") : null}
                          </div>
                        )}
                      </div>
                      <button onClick={() => navigator.clipboard.writeText(option.text)} style={{ fontSize: "0.7rem", padding: "0.15rem 0.5rem", background: "transparent", border: "1px solid #ccc", borderRadius: "4px", cursor: "pointer", flexShrink: 0 }}>Kopier</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button onClick={() => updateStatus("done")} disabled={statusLoading} className="secondary-button small">
          ✓ Ferdig
        </button>
        <button onClick={() => updateStatus("dismissed")} disabled={statusLoading} className="secondary-button small">
          Avvis
        </button>
      </div>
    </div>
  );
}

function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of arr) {
    const k = key(item);
    (result[k] ??= []).push(item);
  }
  return result;
}

function exportTodo(opportunities: Opportunity[], domain: string): void {
  const lines: string[] = [
    `# SEO Todo-liste${domain ? ` – ${domain}` : ""}`,
    `Generert: ${new Date().toLocaleString("nb-NO")}`,
    "",
  ];

  const byType = groupBy(opportunities, (o) => o.type);

  for (const [type, items] of Object.entries(byType)) {
    lines.push(`## ${TYPE_LABELS[type] ?? type}`);
    lines.push("");
    for (const opp of items) {
      const resolvedUrl = resolveOpportunityUrl(domain || opp.domain, opp.pageUrl);
      lines.push(`- [ ] **${opp.title}**`);
      lines.push(`  - Side: ${resolvedUrl.label}`);
      lines.push(`  - Tiltak: ${opp.recommendedAction}`);
      lines.push(`  - Effekt: ${opp.expectedImpact}`);
      if (opp.query) lines.push(`  - Søk: ${opp.query}`);
      lines.push("");
    }
  }

  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `seo-todo${domain ? `-${domain.replace(/[^a-z0-9]/gi, "-")}` : ""}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

export function OpportunitiesClient({
  initialOpportunities,
  domains,
  initialDomainFilter = "",
  snapshots,
}: {
  initialOpportunities: Opportunity[];
  domains: DomainIntegration[];
  initialDomainFilter?: string;
  snapshots: OpportunitySnapshot[];
}) {
  const [opportunities, setOpportunities] = useState(initialOpportunities);
  const [domainFilter, setDomainFilter] = useState(initialDomainFilter);
  const [statusFilter, setStatusFilter] = useState("open");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchOpportunities = useCallback(
    async (domain: string, status: string, priority: string) => {
      setLoading(true);
      const params = new URLSearchParams();
      if (domain) params.set("domain", domain);
      if (status) params.set("status", status);
      if (priority) params.set("priority", priority);
      params.set("limit", "200");
      const res = await fetch(`/api/opportunities?${params}`);
      const data = await res.json() as { opportunities: Opportunity[] };
      setOpportunities(data.opportunities ?? []);
      setLoading(false);
    },
    [],
  );

  function handleDomain(v: string) {
    setDomainFilter(v);
    void fetchOpportunities(v, statusFilter, priorityFilter);
  }
  function handleStatus(v: string) {
    setStatusFilter(v);
    void fetchOpportunities(domainFilter, v, priorityFilter);
  }
  function handlePriority(v: string) {
    setPriorityFilter(v);
    void fetchOpportunities(domainFilter, statusFilter, v);
  }

  function handleStatusChange(id: number, newStatus: string) {
    if (statusFilter === "open" && newStatus !== "open") {
      setOpportunities((prev) => prev.filter((o) => o.id !== id));
    }
  }

  const byType = groupBy(opportunities, (o) => o.type);
  const activeDomain = domainFilter || "alle domener";

  return (
    <div className="opportunities-page">
      <div className="section-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h1>Opportunity Feed</h1>
          <p style={{ opacity: loading ? 0.4 : 1 }}>
            {opportunities.length} {statusFilter === "open" ? "åpne" : statusFilter === "done" ? "ferdige" : "avviste"} muligheter
            {domainFilter ? ` for ${domainFilter}` : ""}.
          </p>
        </div>
        <div className="button-row" style={{ flexWrap: "wrap" }}>
          {opportunities.length > 0 && (
            <button
              onClick={() => exportTodo(opportunities, domainFilter)}
              className="secondary-button"
              style={{ alignSelf: "flex-start", marginTop: "0.25rem" }}
            >
              ↓ Eksporter todo-liste
            </button>
          )}
        </div>
      </div>

      <div className="filter-bar" style={{ display: "grid", gap: "0.75rem", marginBottom: "1.5rem" }}>
        <div className="filter-group">
          <label>Domene</label>
          <select
            className="text-input"
            value={domainFilter}
            onChange={(e) => handleDomain(e.target.value)}
          >
            <option value="">Alle domener</option>
            {domains.map((d) => (
              <option key={d.domain} value={d.domain}>{d.domain}</option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label>Status</label>
          <select
            className="text-input"
            value={statusFilter}
            onChange={(e) => handleStatus(e.target.value)}
          >
            <option value="open">Åpen</option>
            <option value="done">Ferdig</option>
            <option value="dismissed">Avvist</option>
          </select>
        </div>
        <div className="filter-group">
          <label>Prioritet</label>
          <select
            className="text-input"
            value={priorityFilter}
            onChange={(e) => handlePriority(e.target.value)}
          >
            <option value="">Alle prioriteter</option>
            <option value="critical">Kritisk</option>
            <option value="high">Høy</option>
            <option value="medium">Medium</option>
            <option value="low">Lav</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "2rem", opacity: 0.5 }}>Laster…</div>
      ) : opportunities.length === 0 ? (
        <div className="empty-state">
          <h3>Ingen muligheter funnet</h3>
          <p>
            {domains.length === 0
              ? "Koble til Google Search Console først."
              : statusFilter === "open"
              ? "Kjør en datasynk for å generere muligheter."
              : `Ingen ${statusFilter === "done" ? "ferdige" : "avviste"} muligheter for ${activeDomain}.`}
          </p>
        </div>
      ) : (
        <>
          <div className="opportunity-list">
            {Object.entries(byType).map(([type, items]) => (
              <section key={type} className="opportunity-group" style={{ marginBottom: "2rem" }}>
                <h2 style={{ marginBottom: "1rem" }}>
                  {TYPE_LABELS[type] ?? type}{" "}
                  <span style={{ fontSize: "0.9rem", fontWeight: 400, opacity: 0.6 }}>({items.length})</span>
                </h2>
                {items.map((opp) => (
                  <OpportunityCard
                    key={opp.id}
                    opp={opp}
                    domain={domainFilter || opp.domain}
                    onStatusChange={handleStatusChange}
                  />
                ))}
              </section>
            ))}
          </div>

          {snapshots.length > 0 ? (
            <section className="history-panel" style={{ marginTop: "2rem" }}>
              <div className="section-header">
                <h2>Opportunity-historikk</h2>
                <p>Feeden over viser bare nyeste snapshot per domene. Her ser du tidligere kjøringer separat.</p>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Domene</th>
                      <th>Kjørt</th>
                      <th>Muligheter</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshots.map((snapshot, index) => {
                      const isLatestForDomain =
                        snapshots.find((item) => item.domain === snapshot.domain)?.id === snapshot.id;

                      return (
                        <tr key={`${snapshot.domain}-${snapshot.id}-${index}`}>
                          <td>{snapshot.domain}</td>
                          <td>{new Date(snapshot.generatedAt).toLocaleString("nb-NO")}</td>
                          <td>{snapshot.opportunityCount}</td>
                          <td>{isLatestForDomain ? "Aktiv i feed" : "Historisk snapshot"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
