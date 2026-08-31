import { createClient } from "@supabase/supabase-js";

let browserClient;

export function isSupabaseConfigured() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return Boolean(url && key && !key.startsWith("PASTE_"));
}

export function getSupabase() {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase env vars are missing.");
  }
  if (!browserClient) {
    browserClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        realtime: { params: { eventsPerSecond: 10 } }
      }
    );
  }
  return browserClient;
}
