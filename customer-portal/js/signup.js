import { supabase } from './supabaseClient.js';

const form = document.getElementById('signup-form');
const submitButton = document.getElementById('signup-submit');
const errorBox = document.getElementById('error-message');
const confirmationMessage = document.getElementById('confirm-email-message');
const phoneLocalInput = document.getElementById('phone-local');

const COUNTRY_CODES = [
  { name: 'South Africa', code: '+27' },
  { name: 'Zimbabwe', code: '+263' },
  { name: 'Botswana', code: '+267' },
  { name: 'Namibia', code: '+264' },
  { name: 'Zambia', code: '+260' },
  { name: 'Mozambique', code: '+258' },
  { name: 'Lesotho', code: '+266' },
  { name: 'Eswatini', code: '+268' },
  { name: 'Malawi', code: '+265' },
  { name: 'United Kingdom', code: '+44' },
  { name: 'United States / Canada', code: '+1' },
  { name: 'Nigeria', code: '+234' },
  { name: 'Kenya', code: '+254' },
  { name: 'Ghana', code: '+233' },
  { name: 'India', code: '+91' },
  { name: 'China', code: '+86' },
  { name: 'Australia', code: '+61' },
  { name: 'Germany', code: '+49' },
  { name: 'France', code: '+33' },
  { name: 'United Arab Emirates', code: '+971' },
];

const PHONE_DIGITS_PATTERN = /^[0-9]{9}$/;
const PHONE_ERROR = 'Phone number must be exactly 9 digits (without the leading 0).';

function populateCountryCodeSelect() {
  const select = document.getElementById('phone-country-code');
  select.innerHTML = COUNTRY_CODES.map((country) => (
    `<option value="${country.code}">${country.name} (${country.code})</option>`
  )).join('');
  select.value = '+27';
}

function validatePhoneField() {
  const value = phoneLocalInput.value.trim();
  phoneLocalInput.setCustomValidity(
    !value || (PHONE_DIGITS_PATTERN.test(value) && !value.startsWith('0')) ? '' : PHONE_ERROR,
  );
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const fullName = document.getElementById('full-name').value.trim();
  const localNumber = phoneLocalInput.value.trim();
  const phone = localNumber ? `${document.getElementById('phone-country-code').value}${localNumber}` : '';
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const confirmPassword = document.getElementById('confirm-password').value;

  errorBox.textContent = '';

  if (password !== confirmPassword) {
    errorBox.textContent = 'Passwords do not match.';
    return;
  }

  if (localNumber && (!PHONE_DIGITS_PATTERN.test(localNumber) || localNumber.startsWith('0'))) {
    errorBox.textContent = PHONE_ERROR;
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = 'Creating account...';

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        phone,
        signup_type: 'customer',
      },
    },
  });

  submitButton.disabled = false;
  submitButton.textContent = 'Create Account';

  if (error) {
    errorBox.textContent = error.message;
    return;
  }

  if (data.session) {
    window.location.href = 'dashboard.html';
    return;
  }

  form.style.display = 'none';
  confirmationMessage.style.display = 'block';
});

phoneLocalInput.addEventListener('input', validatePhoneField);
populateCountryCodeSelect();
