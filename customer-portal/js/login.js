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

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  submitButton.disabled = false;
  submitButton.textContent = 'Log In';

  if (error) {
  if (error.message.toLowerCase().includes('email not confirmed')) {
    errorBox.textContent = 'Please confirm your email first — check your inbox for the confirmation link.';
  } else {
    errorBox.textContent = 'Invalid email or password.';
  }
  return;
  }

  window.location.href = 'dashboard.html';
});
