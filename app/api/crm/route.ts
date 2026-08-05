import { NextRequest, NextResponse } from "next/server";

type CrmBody = {
  action?: string;
  payload?: Record<string, unknown>;
};

type CacheEntry = {
  data: unknown;
  expiresAt: number;
  staleUntil: number;
};

const globalCache = globalThis as typeof globalThis & {
  __networkCrmCache?: Map<string, CacheEntry>;
  __networkCrmInflight?: Map<string, Promise<unknown>>;
};

const responseCache = globalCache.__networkCrmCache ?? new Map<string, CacheEntry>();
const inflight = globalCache.__networkCrmInflight ?? new Map<string, Promise<unknown>>();
globalCache.__networkCrmCache = responseCache;
globalCache.__networkCrmInflight = inflight;

const READ_TTL: Record<string, number> = {
  list_people: 5 * 60_000,
  stats: 5 * 60_000,
  list_lists: 2 * 60_000,
  get_person: 5 * 60_000,
  get_list: 2 * 60_000,
  topic_scores: 5 * 60_000,
  find_duplicates: 2 * 60_000,
  recommend_people: 2 * 60_000,
  list_events: 2 * 60_000,
  diagnostics: 60_000,
};

const MUTATIONS = new Set([
  "capture_note",
  "bulk_capture",
  "quick_add",
  "edit_person",
  "set_affinity",
  "clear_affinity_override",
  "recalculate_intelligence",
  "create_connection",
  "create_list",
  "add_to_list",
  "create_event",
  "add_event_feedback",
]);

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

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stableValue(item)])
    );
  }
  return value;
}

function cacheKey(body: CrmBody) {
  return JSON.stringify(stableValue({ action: body.action, payload: body.payload || {} }));
}

function clearReadCache() {
  responseCache.clear();
}

async function callAppsScript(body: CrmBody, url: string, apiKey: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, api_key: apiKey }),
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
    });

    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = { ok: false, error: text || "Invalid CRM response." };
    }

    if (!response.ok) {
      throw new Error(
        data && typeof data === "object" && "error" in data
          ? String((data as { error?: unknown }).error || "CRM request failed")
          : `CRM request failed (${response.status})`
      );
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function cachedRead(body: CrmBody, url: string, apiKey: string) {
  const action = String(body.action || "");
  const ttl = READ_TTL[action];
  if (!ttl) return callAppsScript(body, url, apiKey);

  const key = cacheKey(body);
  const now = Date.now();
  const existing = responseCache.get(key);

  if (existing && existing.expiresAt > now) return existing.data;

  const currentRequest = inflight.get(key);
  if (currentRequest) return currentRequest;

  const refresh = callAppsScript(body, url, apiKey)
    .then(data => {
      responseCache.set(key, {
        data,
        expiresAt: Date.now() + ttl,
        staleUntil: Date.now() + ttl * 4,
      });
      return data;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, refresh);

  if (existing && existing.staleUntil > now) {
    void refresh.catch(() => undefined);
    return existing.data;
  }

  return refresh;
}

export async function POST(request: NextRequest) {
  try {
    const url = process.env.CRM_APPS_SCRIPT_URL;
    const apiKey = process.env.CRM_API_KEY;
    if (!url || !apiKey) {
      return NextResponse.json({ ok: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const body = await request.json() as CrmBody;

    if (body.action === "search_network" && body.payload?.query) {
      body.payload.query = normalizeSearchQuery(body.payload.query);
    }

    const data = MUTATIONS.has(String(body.action || ""))
      ? await callAppsScript(body, url, apiKey)
      : await cachedRead(body, url, apiKey);

    if (MUTATIONS.has(String(body.action || ""))) clearReadCache();

    return NextResponse.json(data, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "X-CRM-Performance": READ_TTL[String(body.action || "")] ? "cached-read" : "direct",
      },
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return NextResponse.json(
      {
        ok: false,
        error: timedOut
          ? "The CRM backend took too long to respond. Please retry once."
          : error instanceof Error ? error.message : "Unexpected server error.",
      },
      { status: timedOut ? 504 : 500 }
    );
  }
}
