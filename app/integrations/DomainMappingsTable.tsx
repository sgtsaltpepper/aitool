"use client";

import { useState } from "react";
import type { DomainIntegration } from "@/lib/types";

export function DomainMappingsTable({
  domains: initial,
  gscProperties,
  ga4Properties,
}: {
  domains: DomainIntegration[];
  gscProperties: { siteUrl: string; permissionLevel: string }[];
  ga4Properties: { propertyId: string; displayName: string }[];
}) {
  const [domains, setDomains] = useState(initial);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editGsc, setEditGsc] = useState("");
  const [editGa4, setEditGa4] = useState("");
  const [loading, setLoading] = useState<number | null>(null);

  function startEdit(d: DomainIntegration) {
    setEditingId(d.id);
    setEditGsc(d.gscProperty ?? "");
    setEditGa4(d.ga4PropertyId ?? "");
  }

  async function saveEdit(d: DomainIntegration) {
    setLoading(d.id);
    const res = await fetch("/api/integrations/domain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        domain: d.domain,
        gscProperty: editGsc || null,
        ga4PropertyId: editGa4 || null,
      }),
    });
    if (res.ok) {
      setDomains((prev) =>
        prev.map((x) =>
          x.id === d.id
            ? { ...x, gscProperty: editGsc || null, ga4PropertyId: editGa4 || null, updatedAt: new Date().toISOString() }
            : x
        )
      );
      setEditingId(null);
    }
    setLoading(null);
  }

  async function deleteDomain(d: DomainIntegration) {
    if (!confirm(`Fjern «${d.domain}»?`)) return;
    setLoading(d.id);
    const res = await fetch("/api/integrations/domain", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: d.id }),
    });
    if (res.ok) {
      setDomains((prev) => prev.filter((x) => x.id !== d.id));
    }
    setLoading(null);
  }

  if (domains.length === 0) return null;

  return (
    <div className="table-wrap" style={{ marginBottom: "1.5rem", overflowX: "auto" }}>
      <table style={{ fontSize: "0.85rem", tableLayout: "auto", width: "100%" }}>
        <thead>
          <tr>
            <th>Domain</th>
            <th>GSC Property</th>
            <th>GA4 Property</th>
            <th style={{ whiteSpace: "nowrap" }}></th>
          </tr>
        </thead>
        <tbody>
          {domains.map((d) =>
            editingId === d.id ? (
              <tr key={d.id}>
                <td>{d.domain}</td>
                <td>
                  <select
                    value={editGsc}
                    onChange={(e) => setEditGsc(e.target.value)}
                    className="text-input"
                    style={{ fontSize: "0.8rem", padding: "0.25rem 0.5rem" }}
                  >
                    <option value="">— none —</option>
                    {gscProperties.map((p) => (
                      <option key={p.siteUrl} value={p.siteUrl}>{p.siteUrl}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={editGa4}
                    onChange={(e) => setEditGa4(e.target.value)}
                    className="text-input"
                    style={{ fontSize: "0.8rem", padding: "0.25rem 0.5rem" }}
                  >
                    <option value="">— none —</option>
                    {ga4Properties.map((p) => (
                      <option key={p.propertyId} value={p.propertyId}>{p.displayName}</option>
                    ))}
                  </select>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button
                    onClick={() => saveEdit(d)}
                    disabled={loading === d.id}
                    className="primary-button"
                    style={{ fontSize: "0.75rem", padding: "0.25rem 0.75rem", marginRight: "0.5rem" }}
                  >
                    {loading === d.id ? "…" : "Lagre"}
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="secondary-button"
                    style={{ fontSize: "0.75rem", padding: "0.25rem 0.75rem" }}
                  >
                    Avbryt
                  </button>
                </td>
              </tr>
            ) : (
              <tr key={d.id}>
                <td>{d.domain}</td>
                <td>{d.gscProperty ?? <span className="muted">—</span>}</td>
                <td>{d.ga4PropertyId ?? <span className="muted">—</span>}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button
                    onClick={() => startEdit(d)}
                    disabled={loading === d.id}
                    className="secondary-button"
                    style={{ fontSize: "0.75rem", padding: "0.25rem 0.75rem", marginRight: "0.5rem" }}
                  >
                    Rediger
                  </button>
                  <button
                    onClick={() => deleteDomain(d)}
                    disabled={loading === d.id}
                    style={{
                      fontSize: "0.75rem", padding: "0.25rem 0.75rem",
                      background: "transparent", border: "1px solid #dc2626",
                      color: "#dc2626", borderRadius: "6px", cursor: "pointer",
                    }}
                  >
                    {loading === d.id ? "…" : "Fjern"}
                  </button>
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </div>
  );
}
