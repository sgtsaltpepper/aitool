import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { createAuditChangeEvent, getAuditRun } from "@/lib/db";
import type { AuditChangeTemplate, AuditMode } from "@/lib/types";
import { normalizeUrl } from "@/lib/utils";

export const runtime = "nodejs";

function isAuditMode(value: unknown): value is AuditMode {
  return value === "page" || value === "domain";
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const run = getAuditRun(id);

    if (!run) {
      return NextResponse.json({ error: "Fant ikke audit-kjøringen." }, { status: 404 });
    }

    const body = (await request.json()) as {
      targetUrl?: string;
      mode?: AuditMode;
      appliedAt?: string;
      notes?: string;
      template?: AuditChangeTemplate;
    };

    if (!body.template || typeof body.template !== "object") {
      return NextResponse.json({ error: "Mangler endringsmal." }, { status: 400 });
    }

    if (!isAuditMode(body.mode)) {
      return NextResponse.json({ error: "Ugyldig audit-modus." }, { status: 400 });
    }

    if (!body.appliedAt || Number.isNaN(new Date(body.appliedAt).getTime())) {
      return NextResponse.json({ error: "Ugyldig tidspunkt for endringen." }, { status: 400 });
    }

    const entry = createAuditChangeEvent({
      id: randomUUID(),
      auditRunId: id,
      targetUrl: normalizeUrl(body.targetUrl ?? run.targetUrl),
      mode: body.mode,
      pageUrl: body.template.pageUrl,
      changeType: body.template.changeType,
      changeTitle: body.template.label,
      changeSummary: body.template.summary,
      baseline: body.template.baseline,
      expected: body.template.expected,
      notes: body.notes ?? "",
      appliedAt: new Date(body.appliedAt).toISOString(),
    });

    return NextResponse.json(entry, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Kunne ikke lagre endringen." },
      { status: 400 },
    );
  }
}
