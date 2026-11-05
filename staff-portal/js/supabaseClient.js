import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const SUPABASE_URL = 'https://ulvfpllbrfwggeluvsum.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_cE7uI3sKyRbr3gJU449pZA_Ll_qwXKY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Dev-only convenience for manual browser-console testing.
window.supabase = supabase;
