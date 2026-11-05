import { supabase } from './supabaseClient.js';
import { escapeHtml } from './line-items.js';

export function normaliseSearchTerm(raw) {
  return String(raw ?? '').trim().replace(/[,()%\\*]/g, '').replace(/\s+/g, ' ').trim();
}

export function searchTermVariants(term) {
  const compact = term.replace(/[\s\-()]/g, '');
  const variants = [term, compact];
  if (/^\d+$/.test(compact) && compact.startsWith('0')) variants.push(compact.slice(1));
  return [...new Set(variants.filter(Boolean))];
}

export function meetsMinLength(term) {
  const compact = term.replace(/[\s\-()+]/g, '');
  return /^\d+$/.test(compact) ? compact.length >= 3 : term.length >= 2;
}

function filterValue(value) {
  return String(value).replace(/[,()%*]/g, '');
}

export async function searchCustomers(rawTerm) {
  const term = normaliseSearchTerm(rawTerm);
  if (!meetsMinLength(term)) return { ok: true, customers: [] };
  const variants = searchTermVariants(term).map(filterValue).filter(Boolean);
  const filters = [`full_name.ilike.%${filterValue(term)}%`, ...variants.map((variant) => `phone.ilike.%${variant}%`)];
  try {
    const { data, error } = await supabase
      .from('customers')
      .select('id, full_name, phone')
      .or(filters.join(','))
      .order('full_name')
      .limit(10);
    if (error) throw error;
    return { ok: true, customers: data ?? [] };
  } catch (error) {
    console.error('Could not search customers.', error);
    return { ok: false, error: error?.message || 'Could not search customers. Please try again.' };
  }
}

export function customerOptionHtml(customer, extraClass = '') {
  const name = escapeHtml(customer.full_name);
  const phone = customer.phone ? `, ${escapeHtml(customer.phone)}` : '';
  return `<button type="button" class="customer-result ${escapeHtml(extraClass)}" data-customer-id="${escapeHtml(customer.id)}">${name}${phone}</button>`;
}
