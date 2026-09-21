import test from 'node:test';
import assert from 'node:assert/strict';
import { metricKey, buildSeries, compareRows, compareDerived, comparisonWindow, reportingDate, accountMatches } from '../lib/reporting.mjs';
import { sameAccount } from '../../orchestrator/lib/accounts.mjs';
import { readAll, requireData } from '../lib/readAll.mjs';
const row = (source, value, overrides = {}) => ({ source, account_ext_id: '1', metric_name: 'spend', agg: 'sum', month_start: '2026-08-01', day_count: 31, value, ...overrides });
test('platform and account trends stay separate; future, missing and partial months do not become a decline', () => {
  const rows = [row('meta', 100), row('google_ads', 900), row('meta', 25, { account_ext_id: '2' }), row('meta', 10, { month_start: '2026-09-01', day_count: 4 })];
  const series = buildSeries(rows, '2026-09', '2026-09');
  assert.equal(series[metricKey(rows[0])].at(-2).v, 100);
  assert.equal(series[metricKey(rows[1])].at(-2).v, 900);
  assert.equal(series[metricKey(rows[2])].at(-2).v, 25);
  assert.equal(series[metricKey(rows[0])].at(-1).v, null);
  assert.equal(buildSeries(rows, '2026-08', '2026-09')[metricKey(rows[0])].at(-1).m, '2026-08');
});
test('calendar windows clamp to shorter previous months and exclude today', () => {
  assert.deepEqual(comparisonWindow('2024-03', '2024-03-31'), { previous:'2024-02', current:true, currentDays:29, previousDays:29 });
  assert.equal(comparisonWindow('2026-09', '2026-09-01').currentDays, 0);
  assert.equal(reportingDate(new Date('2026-09-01T02:00:00Z')), '2026-08-31');
});
test('coverage gaps suppress deltas, zero is a value, missing is not zero', () => {
  const window = {currentDays:20, previousDays:20};
  const prev = [row('meta', 50, { day_count:20 })];
  assert.equal(compareRows([row('meta', 100, { day_count:5 })], prev, window)[0].pct_change, null);
  assert.equal(compareRows([row('meta', 0, { day_count:20 })], prev, window)[0].pct_change, -1);
  assert.equal(compareRows([row('meta', null, { day_count:20 })], prev, window)[0].pct_change, null);
  assert.equal(compareRows([row('meta', 100, { day_count:20 })], [row('meta', 0, { day_count:20 })], window)[0].pct_change, null);
});
test('derived formulas compare matching period inputs and reject absent accounts, terms, or denominators', () => {
  const definition = { numerator:[{source:'meta',metric:'spend'}], denominator:[{source:'meta',metric:'leads'}], value:999 };
  const detail = [ { ...row('meta',100), cur_value:100, prev_value:50, comparison_complete:true },
    { ...row('meta',10,{metric_name:'leads'}), cur_value:10, prev_value:10, comparison_complete:true } ];
  assert.equal(compareDerived(definition,detail).pct_change, 1);
  assert.equal(compareDerived(definition,detail).cur_value, 10);
  assert.equal(compareDerived(definition,detail,[{source:'meta',external_id:'2',active:true}]).pct_change,null);
  assert.equal(compareDerived(definition,detail.slice(0,1)).pct_change,null);
  assert.equal(compareDerived(definition,[detail[0],{...detail[1],cur_value:0}]).pct_change,null);
});
for (const match of [sameAccount, accountMatches]) test(`${match.name} normalizes only Google Ads numeric IDs`, () => {
  assert.equal(match('search_console','https://alpha.com/','https://beta.com/'),false);
  assert.equal(match('search_console','https://a1.com/','https://b1.com/'),false);
  assert.equal(match('google_ads','123-456-7890','1234567890'),true);
  assert.equal(match('youtube','abc123','xyz123'),false);
  assert.equal(match('meta',null,null),false);
});
test('pagination follows exact count even when server caps each page below requested size', async () => {
  const source = Array.from({length:1201},(_,id)=>({id}));
  const rows = await readAll(() => ({range: async (start,end) => ({data:source.slice(start,Math.min(end+1,start+100)),count:source.length,error:null})}), 'fixture');
  assert.deepEqual(rows,source);
});
test('query errors, premature empty pages and oversized reports never become empty success', async () => {
  await assert.rejects(requireData(Promise.resolve({error:{message:'offline'},data:null}),'fixture'), /offline/);
  await assert.rejects(readAll(()=>({range:async()=>({data:[],count:1})}),'fixture'),/ended/);
  await assert.rejects(readAll(()=>({range:async()=>({data:[],count:50001})}),'fixture'),/limit/);
});
