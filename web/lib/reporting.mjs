export const ym = (date) => String(date).slice(0, 7);
export const metricKey = (r) => JSON.stringify([r.source, r.account_ext_id, r.metric_name]);
export function shiftMonth(month, offset) {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 1 + offset, 1)).toISOString().slice(0, 7);
}
export function daysInMonth(month) {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number, 0)).getUTCDate();
}
export function reportingDate(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function comparisonWindow(month, today = reportingDate()) {
  const previous = shiftMonth(month, -1);
  const current = month === ym(today);
  // Compare only closed calendar days. On the first day there is no MTD comparison.
  const days = current ? Math.min(Number(today.slice(8, 10)) - 1, daysInMonth(previous)) : null;
  return { previous, current, currentDays: current ? days : daysInMonth(month), previousDays: current ? days : daysInMonth(previous) };
}
export const pct = (cur, prev) => cur != null && prev != null && Number(prev) !== 0
  ? (Number(cur) - Number(prev)) / Math.abs(Number(prev)) : null;
export function compareRows(current, previous, window) {
  const before = new Map(previous.map(r => [metricKey(r), r]));
  return current.filter(r => r.metric_name !== 'conversion_action').map(r => {
    const p = before.get(metricKey(r));
    const complete = window.currentDays > 0 && r.value != null && p?.value != null
      && Number(r.day_count) === window.currentDays && Number(p.day_count) === window.previousDays;
    return { ...r, cur_month: r.month_start, cur_value: r.value, cur_days: r.day_count,
      prev_month: p?.month_start ?? null, prev_value: p?.value ?? null, prev_days: p?.day_count ?? null,
      pct_change: complete ? pct(r.value, p.value) : null,
      comparison_note: complete ? (Number(p.value) === 0 ? 'No percentage: prior value is zero' : null) : 'Comparison unavailable: incomplete coverage',
      comparison_complete: complete };
  });
}
export function buildSeries(rows, month, currentMonth) {
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(month, i - 11));
  const byKey = new Map();
  for (const row of rows) {
    if (row.agg !== 'sum' || ym(row.month_start) > month) continue;
    const key = metricKey(row);
    if (!byKey.has(key)) byKey.set(key, new Map());
    const m = ym(row.month_start);
    // Don't chart a partial month as a decline against complete months.
    byKey.get(key).set(m, m === currentMonth || Number(row.day_count) !== daysInMonth(m) ? null : row.value);
  }
  return Object.fromEntries([...byKey].map(([key, values]) => [key, months.map(m => ({ m, v: values.get(m) ?? null }))]));
}
export function compareDerived(definition, detail, mappings = []) {
  function sum(terms, field) {
    if (!terms?.length) return null;
    let total = 0;
    for (const term of terms) {
      const rows = detail.filter(r => r.source === term.source && r.metric_name === term.metric);
      if (!rows.length || rows.some(r => r.agg !== 'sum' || !r.comparison_complete || r[field] == null)) return null;
      const expected = mappings.filter(m => m.active && m.source === term.source);
      if (expected.some(m => !rows.some(r => accountMatches(m.source, m.external_id, r.account_ext_id)))) return null;
      total += rows.reduce((n, r) => n + Number(r[field]), 0);
    }
    return total;
  }
  const num = sum(definition.numerator, 'cur_value'), den = sum(definition.denominator, 'cur_value');
  const prevNum = sum(definition.numerator, 'prev_value'), prevDen = sum(definition.denominator, 'prev_value');
  const complete = [num, den, prevNum, prevDen].every(v => v != null) && den !== 0 && prevDen !== 0;
  return { ...definition, cur_num: complete ? num : definition.num, cur_den: complete ? den : definition.den,
    cur_value: complete ? num / den : definition.value, prev_value: complete ? prevNum / prevDen : null,
    pct_change: complete ? pct(num / den, prevNum / prevDen) : null,
    comparison_note: complete ? (prevNum === 0 ? 'No percentage: prior value is zero' : null) : 'Comparison unavailable: incomplete formula inputs' };
}
// Provider normalization is deliberately narrow: arbitrary URLs/channel IDs are opaque.
export function accountMatches(source, a, b) {
  if (a == null || b == null || String(a) === '' || String(b) === '') return false;
  if (String(a) === String(b)) return true;
  return source === 'google_ads' && /^[\d-]+$/.test(a) && /^[\d-]+$/.test(b)
    && String(a).replace(/-/g, '') !== '' && String(a).replace(/-/g, '') === String(b).replace(/-/g, '');
}
