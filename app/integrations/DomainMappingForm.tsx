"use client";

import { useState } from "react";

export function DomainMappingForm({
  gscProperties,
  ga4Properties,
}: {
  gscProperties: { siteUrl: string; permissionLevel: string }[];
  ga4Properties: { propertyId: string; displayName: string }[];
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");
    const form = e.currentTarget;
    const data = {
      domain: (form.elements.namedItem("domain") as HTMLInputElement).value,
      gscProperty: (form.elements.namedItem("gscProperty") as HTMLSelectElement).value || null,
      ga4PropertyId: (form.elements.namedItem("ga4PropertyId") as HTMLSelectElement).value || null,
    };
    try {
      const res = await fetch("/api/integrations/domain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        throw new Error(json.error ?? "Unknown error");
      }
      setStatus("done");
      form.reset();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="domain-form">
      <div className="field-group">
        <label htmlFor="domain">Domain</label>
        <input id="domain" name="domain" type="text" placeholder="example.com" required className="text-input" />
      </div>
      <div className="field-group">
        <label htmlFor="gscProperty">GSC Property</label>
        <select id="gscProperty" name="gscProperty" className="text-input">
          <option value="">— none —</option>
          {gscProperties.map((p) => (
            <option key={p.siteUrl} value={p.siteUrl}>{p.siteUrl}</option>
          ))}
        </select>
      </div>
      <div className="field-group">
        <label htmlFor="ga4PropertyId">GA4 Property</label>
        <select id="ga4PropertyId" name="ga4PropertyId" className="text-input">
          <option value="">— none —</option>
          {ga4Properties.map((p) => (
            <option key={p.propertyId} value={p.propertyId}>{p.displayName} ({p.propertyId})</option>
          ))}
        </select>
      </div>
      <button type="submit" className="primary-button" disabled={status === "loading"}>
        {status === "loading" ? "Lagrer…" : "Save mapping"}
      </button>
      {status === "done" && <p className="sub" style={{ marginTop: "0.5rem" }}>Lagret. Last siden på nytt for å se oppdatert tabell.</p>}
      {status === "error" && <p className="sub" style={{ marginTop: "0.5rem", color: "red" }}>{errorMsg}</p>}
    </form>
  );
}
