import './env';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn(
    '\n⚠️  SUPABASE_URL / SUPABASE_SERVICE_KEY not set.\n' +
    '   Copy .env.example → .env (repo root or backend/) and fill in your Supabase credentials.\n' +
    '   Database queries will fail until env vars are provided.\n'
  );
}

// Server-side admin client with service role key — bypasses RLS
export const supabaseAdmin: SupabaseClient = createClient(supabaseUrl ?? 'http://localhost', supabaseServiceKey ?? 'placeholder', {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Creates a client that uses the user's JWT for RLS-aware queries
export function createUserClient(accessToken: string): SupabaseClient {
  return createClient(supabaseUrl!, process.env.SUPABASE_ANON_KEY || supabaseServiceKey!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

export default supabaseAdmin;
