import type { AuditStatus } from "@/lib/types";

const STATUS_LABELS: Record<AuditStatus, string> = {
  queued: "I kø",
  running: "Kjører",
  completed: "Ferdig",
  failed: "Feilet",
};

export function ScorePill({ score }: { score: number }) {
  const level = score >= 80 ? "strong" : score >= 60 ? "warn" : "risk";
  return (
    <span className="score-pill" data-level={level}>
      Score {score}
    </span>
  );
}

export function StatusPill({ status }: { status: AuditStatus }) {
  return (
    <span className="status-pill" data-status={status}>
      {STATUS_LABELS[status]}
    </span>
  );
}
