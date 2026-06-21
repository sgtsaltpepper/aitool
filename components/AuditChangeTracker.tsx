"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { AuditChangeLogEntry, AuditChangeTemplate, AuditMode } from "@/lib/types";

type Props = {
  auditRunId: string;
  targetUrl: string;
  mode: AuditMode;
  templates: AuditChangeTemplate[];
  entries: AuditChangeLogEntry[];
};

function toLocalDateTime(value: string) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

function fieldLabel(field: string) {
  switch (field) {
    case "h1":
      return "H1";
    case "opening":
      return "åpning";
    case "metaTitle":
      return "metatittel";
    case "metaDescription":
      return "metabeskrivelse";
    case "schemaTypes":
      return "schema";
    default:
      return field;
  }
}

export function AuditChangeTracker({ auditRunId, targetUrl, mode, templates, entries }: Props) {
  const router = useRouter();
  const [selectedKey, setSelectedKey] = useState(templates[0]?.key ?? "");
  const [appliedAt, setAppliedAt] = useState(toLocalDateTime(new Date().toISOString()));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.key === selectedKey) ?? templates[0] ?? null,
    [selectedKey, templates],
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTemplate) {
      setError("Velg en endringspakke først.");
      return;
    }

    setError("");

    const response = await fetch(`/api/audits/${auditRunId}/changes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        targetUrl,
        mode,
        template: selectedTemplate,
        appliedAt: new Date(appliedAt).toISOString(),
        notes,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error ?? "Kunne ikke lagre endringen.");
      return;
    }

    setNotes("");
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <section className="report-grid">
      <div className="section-header">
        <h2>Endringslogg og effekt</h2>
        <p>Logg når dere faktisk gjorde en endring, og la senere audits bekrefte om den slo inn på siden.</p>
      </div>
      <div className="recommendations-grid">
        <article className="recommendation">
          <h3>Logg en gjennomført endring</h3>
          {templates.length ? (
            <form onSubmit={handleSubmit} style={{ display: "grid", gap: "0.75rem" }}>
              <label style={{ display: "grid", gap: "0.35rem" }}>
                <span>Endringspakke</span>
                <select value={selectedKey} onChange={(event) => setSelectedKey(event.target.value)}>
                  {templates.map((template) => (
                    <option key={template.key} value={template.key}>
                      {template.label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "grid", gap: "0.35rem" }}>
                <span>Når ble endringen gjort?</span>
                <input type="datetime-local" value={appliedAt} onChange={(event) => setAppliedAt(event.target.value)} required />
              </label>
              <label style={{ display: "grid", gap: "0.35rem" }}>
                <span>Notater</span>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={4}
                  placeholder="F.eks. publisert i CMS, forkortet CTA eller justert schema manuelt."
                />
              </label>
              {selectedTemplate ? (
                <div className="card" style={{ padding: "0.9rem" }}>
                  <strong>{selectedTemplate.summary}</strong>
                  <p style={{ marginTop: "0.4rem" }}>
                    Endrer {selectedTemplate.pageUrl} i feltene{" "}
                    {["h1", "opening", "metaTitle", "metaDescription", "schemaTypes"]
                      .filter((field) => JSON.stringify(selectedTemplate.baseline[field as keyof typeof selectedTemplate.baseline]) !== JSON.stringify(selectedTemplate.expected[field as keyof typeof selectedTemplate.expected]))
                      .map(fieldLabel)
                      .join(", ")}.
                  </p>
                </div>
              ) : null}
              {error ? <p style={{ color: "#b91c1c", margin: 0 }}>{error}</p> : null}
              <button type="submit" className="secondary-button" disabled={isPending || !selectedTemplate}>
                {isPending ? "Lagrer..." : "Logg endring"}
              </button>
            </form>
          ) : (
            <p>Ingen implementation packs eller sideforslag å logge for denne rapporten.</p>
          )}
        </article>
        <article className="recommendation">
          <h3>Hva systemet følger med på</h3>
          <ul className="list">
            <li>
              <strong>Gjort når</strong>
              <p>Hver endring får et eksplisitt tidspunkt, slik at senere audits kan vurderes opp mot riktig publiseringsdato.</p>
            </li>
            <li>
              <strong>Fungerte det?</strong>
              <p>Systemet ser etter om forventet H1, åpning, metadata eller schema faktisk dukker opp i en nyere ferdig audit.</p>
            </li>
            <li>
              <strong>Hva førte det til?</strong>
              <p>Du ser hvilke felt som ble bekreftet, hvilke som fortsatt mangler, og om total score beveget seg etter endringen.</p>
            </li>
          </ul>
        </article>
      </div>
      <div className="issues-grid">
        {entries.length ? (
          entries.map((entry) => (
            <article className="issue-card" key={entry.id}>
              <div className="button-row">
                <h3>{entry.changeTitle}</h3>
                <span className="tag">
                  {entry.evaluation.status === "confirmed"
                    ? "Bekreftet"
                    : entry.evaluation.status === "not-detected"
                      ? "Ikke bekreftet"
                      : "Venter pa ny audit"}
                </span>
              </div>
              <p>{entry.changeSummary}</p>
              <ul className="list">
                <li>
                  <strong>Gjort</strong>
                  <p>{new Date(entry.appliedAt).toLocaleString("nb-NO")}</p>
                </li>
                <li>
                  <strong>Endret</strong>
                  <p>{entry.changedFields.map(fieldLabel).join(", ")}</p>
                </li>
                <li>
                  <strong>Status</strong>
                  <p>{entry.evaluation.summary}</p>
                </li>
                <li>
                  <strong>Treff i senere audit</strong>
                  <p>
                    {entry.evaluation.matchedFields.length
                      ? `Bekreftet: ${entry.evaluation.matchedFields.map(fieldLabel).join(", ")}.`
                      : "Ingen felter bekreftet ennå."}{" "}
                    {entry.evaluation.missingFields.length
                      ? `Mangler fortsatt: ${entry.evaluation.missingFields.map(fieldLabel).join(", ")}.`
                      : ""}
                  </p>
                </li>
                <li>
                  <strong>Scoreeffekt</strong>
                  <p>
                    {entry.evaluation.scoreDelta === null
                      ? "Ingen sammenlignbar senere score ennå."
                      : `${entry.evaluation.scoreDelta >= 0 ? "+" : ""}${entry.evaluation.scoreDelta} poeng mot audit som endringen ble logget fra.`}
                  </p>
                </li>
                {entry.notes ? (
                  <li>
                    <strong>Notat</strong>
                    <p>{entry.notes}</p>
                  </li>
                ) : null}
              </ul>
            </article>
          ))
        ) : (
          <div className="empty-state">
            <h3>Ingen loggede endringer ennå</h3>
            <p>Bruk skjemaet over når en anbefaling faktisk er publisert, så begynner systemet å følge effekten.</p>
          </div>
        )}
      </div>
    </section>
  );
}
