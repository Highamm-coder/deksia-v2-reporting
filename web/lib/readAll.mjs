// Exact counts prevent a server-side row cap from looking like the end of a result.
// Callers must provide a stable, unique ordering for range pagination.
export async function readAll(makeQuery, label, maxRows = 50000) {
  const rows = [];
  for (;;) {
    const { data, error, count } = await makeQuery().range(rows.length, rows.length + 499);
    if (error) throw new Error(`${label}: ${error.message}`);
    if (!Array.isArray(data) || !Number.isInteger(count)) throw new Error(`${label}: incomplete query response`);
    if (count > maxRows) throw new Error(`${label}: result exceeds safe reporting limit; narrow the period`);
    rows.push(...data);
    if (rows.length >= count) return rows;
    if (!data.length) throw new Error(`${label}: result ended before all rows were returned`);
  }
}
export async function requireData(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}
