import { supabase } from './supabaseClient.js';

const form = document.getElementById('set-password-form');
const errorBox = document.getElementById('error-message');

const {
  data: { session },
} = await supabase.auth.getSession();

if (!session) {
  errorBox.textContent = 'This link is invalid or has expired. Please contact staff for a new invite.';
  form.style.display = 'none';
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.textContent = '';

  const password = document.getElementById('password').value;
  const confirmPassword = document.getElementById('confirm-password').value;

  if (password.length < 8) {
    errorBox.textContent = 'Password must be at least 8 characters.';
    return;
  }

  if (password !== confirmPassword) {
    errorBox.textContent = 'Passwords do not match.';
    return;
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    errorBox.textContent = 'Could not set your password. Please try again.';
    return;
  }

  window.location.href = 'dashboard.html';
});
