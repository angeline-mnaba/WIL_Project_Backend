import { supabase } from './supabaseClient.js';

const form = document.getElementById('login-form');
const submitButton = document.getElementById('login-submit');
const errorBox = document.getElementById('error-message');

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  errorBox.textContent = '';
  submitButton.disabled = true;
  submitButton.textContent = 'Signing in...';

  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) {
    submitButton.disabled = false;
    submitButton.textContent = 'Log In';

    if (signInError.message.toLowerCase().includes('email not confirmed')) {
      errorBox.textContent = 'Please confirm this account\'s email first.';
    } else {
      errorBox.textContent = 'Invalid email or password.';
    }
    return;
  }

  const { data: staffRow, error: staffError } = await supabase
    .from('staff_users')
    .select('role, full_name')
    .eq('id', signInData.user.id)
    .maybeSingle();

  submitButton.disabled = false;
  submitButton.textContent = 'Log In';

  if (staffError || !staffRow) {
    await supabase.auth.signOut();
    errorBox.textContent = 'This account is not authorized for staff access.';
    return;
  }

  window.location.href = 'dashboard.html';
});
