import { NextRequest, NextResponse } from "next/server";

function normalizeSearchQuery(value: unknown) {
  const text = String(value || "").toLowerCase().replace(/[?.,!]/g, " ");
  const stopWords = new Set([
    "who", "what", "which", "where", "when", "why", "how",
    "should", "could", "would", "can", "do", "does", "did",
    "i", "me", "my", "we", "our", "the", "a", "an", "to", "for",
    "is", "are", "was", "were", "be", "been", "being",
    "like", "likes", "liked", "love", "loves", "enjoy", "enjoys",
    "invite", "invited", "show", "find", "search", "people", "person",
    "anyone", "someone", "contacts", "contact"
  ]);

  const meaningful = text
    .split(/\s+/)
    .map(word => word.trim())
    .filter(word => word && !stopWords.has(word));

  return meaningful.join(" ") || text.trim();
}

export async function POST(request: NextRequest) {
  try {
    const url = process.env.CRM_APPS_SCRIPT_URL;
    const apiKey = process.env.CRM_API_KEY;
    if (!url || !apiKey) {
      return NextResponse.json({ ok: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const body = await request.json();

    if (body?.action === "search_network" && body?.payload?.query) {
      body.payload.query = normalizeSearchQuery(body.payload.query);
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, api_key: apiKey }),
      redirect: "follow",
      cache: "no-store",
    });

    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = { ok: false, error: text || "Invalid CRM response." };
    }

    return NextResponse.json(data, { status: response.ok ? 200 : response.status });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unexpected server error." },
      { status: 500 }
    );
  }
}
