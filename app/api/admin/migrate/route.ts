import { NextRequest, NextResponse } from "next/server";
import { importSheetExport } from "@/lib/migration/import-sheet-export";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const configuredSecret = process.env.MIGRATION_SECRET;
    if (!configuredSecret) {
      return NextResponse.json(
        { ok: false, error: "MIGRATION_SECRET is not configured." },
        { status: 503 }
      );
    }

    const body = await request.json();
    if (body?.secret !== configuredSecret) {
      return NextResponse.json(
        { ok: false, error: "Invalid migration secret." },
        { status: 401 }
      );
    }

    const report = await importSheetExport(body.export);
    return NextResponse.json({ ok: true, report });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Migration failed.",
      },
      { status: 500 }
    );
  }
}
