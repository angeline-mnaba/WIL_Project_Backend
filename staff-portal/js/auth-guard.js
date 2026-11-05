import { supabase } from './supabaseClient.js';

const {
  data: { session },
} = await supabase.auth.getSession();

if (!session) {
  window.location.href = 'login.html';
} else {
  const { data: staffRow, error: staffError } = await supabase
    .from('staff_users')
    .select('role, full_name')
    .eq('id', session.user.id)
    .maybeSingle();

  if (staffError || !staffRow) {
    await supabase.auth.signOut();
    window.location.href = 'login.html';
  } else {
    window.staffProfile = {
      role: staffRow.role,
      fullName: staffRow.full_name,
    };
    window.dispatchEvent(new CustomEvent('staffProfileReady', { detail: window.staffProfile }));
  }
}

supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT' || !session) {
    window.location.href = 'login.html';
  }
});
