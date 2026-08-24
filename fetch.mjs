#!/usr/bin/env node
/* The Undercard — season fetcher.
   Runs on GitHub Actions, which has ordinary internet access, so it can read
   the Fantasy Draft API in full. Writes season.json for the page to load.
   No dependencies: Node 18+ has fetch built in. */

import { readFile, writeFile } from 'node:fs/promises';

const API = 'https://draft.premierleague.com/api';
const cfg = JSON.parse(await readFile(new URL('./config.json', import.meta.url), 'utf8'));
const LEAGUE = cfg.leagueId;

const log = (...a) => console.log('[undercard]', ...a);

async function api(path, tries = 3) {
  const url = `${API}/${path}`;
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'undercard-league-page' } });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return await r.json();
    } catch (err) {
      if (i === tries) throw new Error(`${path}: ${err.message}`);
      await new Promise(r => setTimeout(r, 800 * i));
    }
  }
}

const [game, details, boot] = await Promise.all([
  api('game'), api(`league/${LEAGUE}/details`), api('bootstrap-static')
]);
log(`league "${details.league.name}", current event ${game.current_event}`);

// Players: full list, with positions — the thing that was impossible before.
const players = {};
for (const e of boot.elements) players[e.id] = { n: e.web_name, t: e.element_type };
log(`${Object.keys(players).length} players`);

// An odd league carries an AVERAGE side: a real opponent, never a prize winner.
const entries = details.league_entries.map(e => {
  const avg = e.entry_id == null || !e.entry_name;
  return {
    id: e.id, entryId: e.entry_id,
    name: avg ? 'AVERAGE' : e.entry_name,
    manager: avg ? '' : `${e.player_first_name || ''} ${e.player_last_name || ''}`.trim(),
    short: e.short_name, ...(avg ? { avg: true } : {})
  };
});
const real = entries.filter(e => !e.avg);
log(`${real.length} managers${entries.length > real.length ? ' (+ AVERAGE)' : ''}`);

// A gameweek only counts once every one of its matches has finished. Before
// that the API's own head-to-head points lag behind the pitch.
const byEvent = new Map();
for (const m of details.matches) {
  if (!m.started) continue;
  if (!byEvent.has(m.event)) byEvent.set(m.event, []);
  byEvent.get(m.event).push(m);
}
const complete = [...byEvent.entries()]
  .filter(([, ms]) => ms.every(m => m.finished))
  .map(([ev]) => ev).sort((a, b) => a - b);
const live = [...byEvent.keys()].filter(ev => !complete.includes(ev)).sort((a, b) => a - b);
log(`complete: ${complete.join(',') || 'none'}${live.length ? ` | in play: ${live.join(',')}` : ''}`);

const gws = {}, draftPts = {};
const keyPicks = [...new Set(Object.values(cfg.draft).flat())];

for (const gw of [...complete, ...live]) {
  const settled = complete.includes(gw);
  const liveData = await api(`event/${gw}/live`).catch(() => ({ elements: {} }));
  const els = liveData.elements || {};
  const pts = id => {
    const el = els[id];
    if (!el) return 0;
    if (el.stats && typeof el.stats.total_points === 'number') return el.stats.total_points;
    return typeof el.total_points === 'number' ? el.total_points : 0;
  };

  draftPts[gw] = {};
  for (const el of keyPicks) draftPts[gw][el] = pts(el);

  const squads = {};
  for (const e of real) {
    let d;
    try { d = await api(`entry/${e.entryId}/event/${gw}`); }
    catch { log(`no squad for ${e.name} in GW${gw}`); continue; }
    const picks = (d.picks || []).slice().sort((a, b) => a.position - b.position);
    let start = picks.filter(p => p.position <= 11).map(p => p.element);
    let bench = picks.filter(p => p.position > 11).map(p => p.element);
    // The subs list is authoritative. A starter who did not play is swapped for
    // a bench player once the gameweek is processed, so the raw eleven is not
    // the scoring eleven. Never infer this.
    for (const s of (d.subs || d.automatic_subs || [])) {
      if (bench.includes(s.element_in) && start.includes(s.element_out)) {
        start = start.map(x => x === s.element_out ? s.element_in : x);
        bench = bench.map(x => x === s.element_in ? s.element_out : x);
      }
    }
    squads[e.id] = {
      start: start.map(id => ({ e: id, p: pts(id) })),
      bench: bench.map(id => ({ e: id, p: pts(id) }))
    };
  }

  const matches = byEvent.get(gw).map(m => ({
    a: m.league_entry_1, ap: m.league_entry_1_points,
    b: m.league_entry_2, bp: m.league_entry_2_points
  }));

  // While a gameweek is in play the API's match points lag, so total the
  // elevens ourselves and mark the week provisional.
  if (!settled) {
    for (const m of matches) {
      const sum = id => squads[id] ? squads[id].start.reduce((t, p) => t + p.p, 0) : null;
      const a = sum(m.a), b = sum(m.b);
      if (a != null) m.ap = a;
      if (b != null) m.bp = b;
    }
    const real2 = matches.flatMap(m => [m.ap, m.bp]).filter(v => typeof v === 'number');
    const mean = real2.length ? Math.round(real2.reduce((x, y) => x + y, 0) / real2.length) : 0;
    for (const m of matches) {
      if (squads[m.a] == null) m.ap = mean;   // AVERAGE has no squad to total
      if (squads[m.b] == null) m.bp = mean;
    }
  }

  gws[gw] = { finished: settled, ...(settled ? {} : { provisional: true }), matches, squads };
  log(`GW${gw} ${settled ? 'settled' : 'in play'}`);
}

const out = {
  v: 2,
  leagueId: LEAGUE,
  leagueName: details.league.name,
  generated: new Date().toISOString(),
  currentEvent: game.current_event,
  nextEvent: game.next_event,
  entries, players, gws, draftPts,
  draft: cfg.draft,
  cal: cfg.cal,
  pot: cfg.pot,
  standings: details.standings,
  fixtures: details.matches.map(m => ({ ev: m.event, a: m.league_entry_1, b: m.league_entry_2 }))
};
await writeFile(new URL('./season.json', import.meta.url), JSON.stringify(out));
log(`wrote season.json (${(JSON.stringify(out).length / 1024).toFixed(0)}kb)`);
