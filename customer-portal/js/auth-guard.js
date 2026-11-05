import { supabase } from './supabaseClient.js';

const {
  data: { session },
} = await supabase.auth.getSession();

if (!session) {
  window.location.href = 'login.html';
}

supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT' || !session) {
    window.location.href = 'login.html';
  }
});
