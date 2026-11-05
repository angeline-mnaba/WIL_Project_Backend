import { supabase } from './supabaseClient.js';

const logoutButton = document.getElementById('logout-button');

logoutButton.addEventListener('click', async () => {
  logoutButton.disabled = true;
  await supabase.auth.signOut();
  window.location.href = 'login.html';
});
