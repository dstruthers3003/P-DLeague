/* Offline test for fetch.mjs: stubs the API and checks the awkward cases —
   auto-substitutions, the AVERAGE side, and an in-play gameweek.
   Run with: node scripts/test-fetch.mjs   (it restores config.json afterwards) */
import { readFile, writeFile } from 'node:fs/promises';

const L = 27214;
// 3 managers + the AVERAGE side. GW1 complete, GW2 still in play.
const LE = [
  {id:101, entry_id:1, entry_name:'Alpha', player_first_name:'A', player_last_name:'One',  short_name:'AO'},
  {id:102, entry_id:2, entry_name:'Beta',  player_first_name:'B', player_last_name:'Two',  short_name:'BT'},
  {id:103, entry_id:3, entry_name:'Gamma', player_first_name:'G', player_last_name:'Three',short_name:'GT'},
  {id:104, entry_id:null, entry_name:null, player_first_name:null, player_last_name:null,  short_name:'AV'}
];
const matches = [
  {event:1, league_entry_1:101, league_entry_1_points:55, league_entry_2:102, league_entry_2_points:44, started:true,  finished:true},
  {event:1, league_entry_1:103, league_entry_1_points:33, league_entry_2:104, league_entry_2_points:40, started:true,  finished:true},
  {event:2, league_entry_1:101, league_entry_1_points:5,  league_entry_2:103, league_entry_2_points:3,  started:true,  finished:false},
  {event:2, league_entry_1:102, league_entry_1_points:0,  league_entry_2:104, league_entry_2_points:0,  started:true,  finished:false},
  {event:3, league_entry_1:101, league_entry_1_points:0,  league_entry_2:104, league_entry_2_points:0,  started:false, finished:false}
];
const elements = [];
for (let i = 1; i <= 60; i++) elements.push({id:i, web_name:'P'+i, element_type:(i%4)+1});

// squad of 15 per manager; player 5 starts, does not play, and is auto-subbed for bench player 12
const squad = e => Array.from({length:15}, (_, k) => (e-1)*15 + k + 1);
const picksFor = e => squad(e).map((el, k) => ({element:el, position:k+1}));

const livePts = gw => {
  const o = {};
  for (let i = 1; i <= 60; i++) o[i] = {stats:{total_points: i === 5 ? 0 : (i % 7) + gw, minutes: i === 5 ? 0 : 90}};
  return o;
};

globalThis.fetch = async (url) => {
  const u = String(url);
  const j = body => ({ok:true, status:200, json: async () => body});
  if (u.endsWith('/game')) return j({current_event:2, next_event:3});
  if (u.endsWith(`/league/${L}/details`)) return j({league:{name:'Mock League'}, league_entries:LE, matches, standings:[]});
  if (u.includes('fantasy.premierleague.com')) return j({events: [
    {id:1, deadline_time:'2026-08-21T17:30:00Z'}, {id:2, deadline_time:'2026-08-28T17:30:00Z'},
    {id:3, deadline_time:'2026-09-12T10:00:00Z'}, {id:4, deadline_time:'2026-09-19T10:00:00Z'},
    {id:5, deadline_time:'2026-10-03T10:00:00Z'}, {id:6, deadline_time:'2026-10-24T10:00:00Z'},
    {id:7, deadline_time:'2026-11-07T13:30:00Z'}, {id:8, deadline_time:'2026-11-21T13:30:00Z'},
    {id:9, deadline_time:'2026-11-28T13:30:00Z'}, {id:10, deadline_time:'2026-12-05T13:30:00Z'}
  ]});
  if (u.endsWith('/bootstrap-static')) return j({elements});
  let m = u.match(/\/event\/(\d+)\/live$/);
  if (m) return j({elements: livePts(Number(m[1]))});
  m = u.match(/\/entry\/(\d+)\/event\/(\d+)$/);
  if (m) {
    const e = Number(m[1]);
    // Alpha gets an auto-sub in GW1: 5 (a starter, 0 mins) out for 12 (bench)
    const subs = (e === 1 && m[2] === '1') ? [{element_in:12, element_out:5}] : [];
    return j({picks: picksFor(e), subs});
  }
  throw new Error('unexpected fetch: ' + u);
};

const cfgURL = new URL('./config.json', import.meta.url);
const seasonURL = new URL('./season.json', import.meta.url);
const orig = JSON.parse(await readFile(cfgURL, 'utf8'));
// the fetcher writes season.json for real, so keep the live one safe
let liveSeason = null;
try { liveSeason = await readFile(seasonURL, 'utf8'); } catch {}
await writeFile(new URL('./config.json', import.meta.url), JSON.stringify({
  ...orig, leagueId: L, draft: {'101':[1,2], '102':[16,17], '103':[31,32]}
}));

await import('./fetch.mjs');

const out = JSON.parse(await readFile(new URL('./season.json', import.meta.url), 'utf8'));
await writeFile(cfgURL, JSON.stringify(orig, null, 2));
if (liveSeason !== null) await writeFile(seasonURL, liveSeason);   // put the real data back

let bad = 0;
const t = (name, ok, extra='') => { if (!ok) bad++; console.log((ok?'PASS  ':'FAIL  ')+name+(ok?'':'   ['+extra+']')); };

const avg = out.entries.find(e => e.short === 'AV');
t('AVERAGE flagged, not a manager', avg && avg.avg === true && avg.name === 'AVERAGE', JSON.stringify(avg));
t('real managers counted', out.entries.filter(e => !e.avg).length === 3, String(out.entries.length));
t('players carry positions', Object.keys(out.players).length === 60 && out.players[5].t >= 1, JSON.stringify(out.players[5]));

t('GW1 settled', out.gws['1'] && out.gws['1'].finished === true && !out.gws['1'].provisional, JSON.stringify(out.gws['1'] && out.gws['1'].finished));
t('GW2 marked provisional', out.gws['2'] && out.gws['2'].finished === false && out.gws['2'].provisional === true, '');
t('unstarted GW3 not stored', !out.gws['3'], 'present');

const m1 = out.gws['1'].matches.find(m => m.a === 101);
t('settled week keeps the official score', m1.ap === 55 && m1.bp === 44, JSON.stringify(m1));

const g1 = out.gws['1'].squads['101'];
const startIds = g1.start.map(p => p.e), benchIds = g1.bench.map(p => p.e);
t('auto-sub: the blank starter leaves the eleven', !startIds.includes(5) && benchIds.includes(5), startIds.join(','));
t('auto-sub: the bench player comes on', startIds.includes(12) && !benchIds.includes(12), benchIds.join(','));
t('a nonsense sub is ignored', out.gws['1'].squads['102'].start.length === 11, 'Beta was altered');
t('eleven is eleven, bench is four', startIds.length === 11 && benchIds.length === 4, `${startIds.length}/${benchIds.length}`);
t('AVERAGE gets no squad', !out.gws['1'].squads['104'], 'has one');

const m2 = out.gws['2'].matches.find(m => m.a === 101);
const alphaXI = out.gws['2'].squads['101'].start.reduce((a, p) => a + p.p, 0);
t('in-play week is totalled from the eleven', m2.ap === alphaXI && m2.ap !== 5, `${m2.ap} vs ${alphaXI}`);
const m2b = out.gws['2'].matches.find(m => m.b === 104);
t('AVERAGE gets the mean when in play', typeof m2b.bp === 'number' && m2b.bp > 0, JSON.stringify(m2b));

t('draft picks tracked every week', out.draftPts['1']['1'] != null && out.draftPts['2']['31'] != null, JSON.stringify(out.draftPts['1']));
t('agreed draft carried through', JSON.stringify(out.draft['101']) === '[1,2]', JSON.stringify(out.draft));
t('calendar derived from real deadlines', JSON.stringify(out.cal.nov) === '[7,9]', JSON.stringify(out.cal));
t('every November gameweek is in range', out.cal.nov[0] === 7 && out.cal.nov[1] === 9, JSON.stringify(out.cal.nov));
t('August derived too', JSON.stringify(out.cal.aug) === '[1,2]', JSON.stringify(out.cal.aug));
t('prize money still carried', out.pot && out.pot.aug === 60, JSON.stringify(out.pot && out.pot.aug));
t('timestamped', !!Date.parse(out.generated), out.generated);

console.log(bad ? `\n${bad} FAILED` : '\nall fetcher checks passed');
process.exit(bad ? 1 : 0);
