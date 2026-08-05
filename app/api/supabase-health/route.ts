import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

function errorDetails(error: unknown) {
  if (error instanceof Error) {
    return { message: error.message, type: error.name };
  }
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    return {
      message: String(value.message || value.error_description || value.error || "Unknown Supabase error"),
      code: value.code ? String(value.code) : undefined,
      details: value.details ? String(value.details) : undefined,
      hint: value.hint ? String(value.hint) : undefined,
    };
  }
  return { message: String(error || "Unknown Supabase error") };
}

export async function GET() {
  try {
    const db = getSupabaseAdmin();
    const { count, error } = await db
      .from("people")
      .select("id", { count: "exact", head: true });

    if (error) {
      return NextResponse.json(
        { ok: false, backend: "supabase", stage: "people_table_query", error: errorDetails(error) },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.json(
      { ok: true, backend: "supabase", people: count || 0 },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, backend: "supabase", stage: "client_configuration", error: errorDetails(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
