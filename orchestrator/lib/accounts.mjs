export function sameAccount(source, a, b) {
  if (a == null || b == null || String(a) === '' || String(b) === '') return false;
  if (String(a) === String(b)) return true;
  return source === 'google_ads' && /^[\d-]+$/.test(a) && /^[\d-]+$/.test(b)
    && String(a).replace(/-/g, '') !== '' && String(a).replace(/-/g, '') === String(b).replace(/-/g, '');
}
