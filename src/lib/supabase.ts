import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

// Auth remains optional for local/sample demonstrations. No secret server key
// can reach this browser bundle.
export const supabase = url && key ? createClient(url, key) : null;

export function isSupabaseConfigured(): boolean {
  return Boolean(supabase);
}
