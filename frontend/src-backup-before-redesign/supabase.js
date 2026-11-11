import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see frontend/.env.example).");
}

// The anon key is safe to ship to the browser; access is enforced by the backend and Supabase Auth.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
