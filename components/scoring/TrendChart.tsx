"use client";

import { useEffect, useState } from "react";

type ScoreHistoryEntry = {
  auditRunId: string;
  recordedAt: string;
  totalScore: number | null;
  categories: Record<string, number | null>;
  providers: Record<string, number | null>;
};

type TrendsResponse = {
  domain: string;
  days: number;
  dataPoints: number;
  history: ScoreHistoryEntry[];
};

type SeriesConfig = {
  key: string;
  label: string;
  color: string;
  type: "total" | "category" | "provider";
};

const SERIES: SeriesConfig[] = [
  { key: "total", label: "Totalscore", color: "#6366f1", type: "total" },
  { key: "crawlabilityIndexation", label: "Crawlbarhet", color: "#10b981", type: "category" },
  { key: "renderingAiAccessibility", label: "Rendering", color: "#f59e0b", type: "category" },
  { key: "answerFirstContent", label: "Svar-first", color: "#3b82f6", type: "category" },
  { key: "citationAuthorityEntitySignals", label: "Siterbarhet", color: "#ec4899", type: "category" },
  { key: "schemaSemanticSearch", label: "Schema", color: "#8b5cf6", type: "category" },
  { key: "openai", label: "OpenAI", color: "#14b8a6", type: "provider" },
  { key: "google", label: "Google", color: "#f97316", type: "provider" },
];

const WIDTH = 720;
const HEIGHT = 240;
const PAD = { top: 12, right: 16, bottom: 40, left: 40 };

function getValue(entry: ScoreHistoryEntry, series: SeriesConfig): number | null {
  if (series.type === "total") return entry.totalScore;
  if (series.type === "category") return entry.categories[series.key] ?? null;
  return entry.providers[series.key] ?? null;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("nb-NO", { day: "numeric", month: "short" });
}

type Props = {
  domain: string;
  days?: number;
};

export function TrendChart({ domain, days = 90 }: Props) {
  const [data, setData] = useState<TrendsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSeries, setActiveSeries] = useState<Set<string>>(new Set(["total"]));

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/audits/trends?domain=${encodeURIComponent(domain)}&days=${days}`)
      .then((r) => r.json())
      .then((json: TrendsResponse) => {
        setData(json);
        setLoading(false);
      })
      .catch(() => {
        setError("Klarte ikke å laste historikk.");
        setLoading(false);
      });
  }, [domain, days]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-gray-400">
        Laster historikk…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-red-500">
        {error}
      </div>
    );
  }

  if (!data || data.history.length < 2) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-gray-400">
        Ikke nok data ennå. Kjør flere analyser for å se trender.
      </div>
    );
  }

  const history = data.history;
  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;

  // x scale
  const xStep = innerW / (history.length - 1);

  // y scale: always 0–100
  function toX(i: number) {
    return PAD.left + i * xStep;
  }
  function toY(v: number) {
    return PAD.top + innerH - (v / 100) * innerH;
  }

  function buildPath(series: SeriesConfig): string {
    const points = history
      .map((entry, i) => {
        const v = getValue(entry, series);
        if (v === null) return null;
        return `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`;
      })
      .filter(Boolean);

    if (points.length < 2) return "";
    return `M ${points.join(" L ")}`;
  }

  // Y-axis gridlines at 0, 25, 50, 75, 100
  const yTicks = [0, 25, 50, 75, 100];

  // X-axis labels: show ~5 evenly spaced dates
  const xLabelIndices = Array.from({ length: Math.min(5, history.length) }, (_, i) =>
    Math.round((i / 4) * (history.length - 1)),
  );

  function toggleSeries(key: string) {
    setActiveSeries((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  return (
    <div className="space-y-3">
      {/* Legend / toggle */}
      <div className="flex flex-wrap gap-2">
        {SERIES.map((s) => (
          <button
            key={s.key}
            onClick={() => toggleSeries(s.key)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs border transition-opacity ${
              activeSeries.has(s.key) ? "opacity-100 border-transparent" : "opacity-30 border-gray-300"
            }`}
          >
            <span
              className="inline-block w-3 h-0.5 rounded"
              style={{ backgroundColor: s.color, height: "3px" }}
            />
            {s.label}
          </button>
        ))}
      </div>

      {/* SVG Chart */}
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          width="100%"
          style={{ maxWidth: WIDTH, display: "block" }}
          aria-label={`Score-trend for ${domain}`}
        >
          {/* Grid lines */}
          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                x1={PAD.left}
                y1={toY(tick)}
                x2={PAD.left + innerW}
                y2={toY(tick)}
                stroke="#e5e7eb"
                strokeWidth="1"
                strokeDasharray={tick === 0 || tick === 100 ? "none" : "4,3"}
              />
              <text
                x={PAD.left - 6}
                y={toY(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize="10"
                fill="#9ca3af"
              >
                {tick}
              </text>
            </g>
          ))}

          {/* X-axis labels */}
          {xLabelIndices.map((idx) => (
            <text
              key={idx}
              x={toX(idx)}
              y={HEIGHT - 8}
              textAnchor="middle"
              fontSize="10"
              fill="#9ca3af"
            >
              {formatDate(history[idx]!.recordedAt)}
            </text>
          ))}

          {/* Series paths */}
          {SERIES.filter((s) => activeSeries.has(s.key)).map((series) => {
            const path = buildPath(series);
            if (!path) return null;
            return (
              <path
                key={series.key}
                d={path}
                fill="none"
                stroke={series.color}
                strokeWidth={series.type === "total" ? 2.5 : 1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}

          {/* Data point dots for total score */}
          {activeSeries.has("total") &&
            history.map((entry, i) => {
              const v = entry.totalScore;
              if (v === null) return null;
              return (
                <circle
                  key={i}
                  cx={toX(i)}
                  cy={toY(v)}
                  r="3"
                  fill="#6366f1"
                  stroke="white"
                  strokeWidth="1.5"
                >
                  <title>
                    {formatDate(entry.recordedAt)}: {Math.round(v)}
                  </title>
                </circle>
              );
            })}
        </svg>
      </div>

      <p className="text-xs text-gray-400">
        {data.dataPoints} analyser siste {days} dager · {data.domain}
      </p>
    </div>
  );
}
