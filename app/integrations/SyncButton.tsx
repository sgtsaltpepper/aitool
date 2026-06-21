"use client";

import { useState } from "react";

export function SyncButton() {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function handleSync() {
    setStatus("loading");
    try {
      const res = await fetch("/api/integrations/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Failed");
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div>
      <button
        type="button"
        className="primary-button"
        onClick={handleSync}
        disabled={status === "loading"}
      >
        {status === "loading" ? "Synkroniserer…" : "Kjør synk"}
      </button>
      {status === "done" && <p className="sub" style={{ marginTop: "0.5rem" }}>Synk er lagt i kø. Sjekk igjen om et par minutter.</p>}
      {status === "error" && <p className="sub" style={{ marginTop: "0.5rem", color: "red" }}>Synk feilet. Sjekk serverloggene.</p>}
    </div>
  );
}
