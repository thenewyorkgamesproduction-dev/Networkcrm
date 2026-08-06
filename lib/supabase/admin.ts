import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

function normalizeSupabaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not a valid URL.");
  }

  if (!parsed.hostname.endsWith(".supabase.co")) {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL must use a project host ending in .supabase.co. Current host: ${parsed.hostname}`
    );
  }

  return parsed.origin;
}

export function getSupabaseAdmin(): SupabaseClient {
  if (client) return client;

  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!rawUrl || !secret) {
    throw new Error(
      "Supabase is not configured for this deployment. Add NEXT_PUBLIC_SUPABASE_URL and either SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY to the Production environment, then redeploy."
    );
  }

  const url = normalizeSupabaseUrl(rawUrl);

  client = createClient(url, secret, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return client;
}
