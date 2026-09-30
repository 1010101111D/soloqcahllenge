const { RIOT_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
const START = Math.floor(new Date(process.env.CHALLENGE_START || '2026-09-29T03:00:00Z') / 1000);
const EVERY = 10 * 60e3;
const ROUTE = { la2: 'americas', la1: 'americas', na1: 'americas', br1: 'americas', euw1: 'europe', eun1: 'europe' };
let last = 0, dbg = {};

const sb = (path, opt = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...opt, headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'content-type': 'application/json', ...opt.headers }
});
const riot = async url => {
  for (let i = 0; i < 2; i++) {
    const r = await fetch(url, { headers: { 'X-Riot-Token': RIOT_KEY } });
    if (r.status === 429) { await new Promise(s => setTimeout(s, (+r.headers.get('retry-after') || 3) * 1000)); continue; }
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  }
  throw new Error('rate limit');
};

async function ingest(players) {
  dbg = { players: players.length, ids: 0, inserted: 0, errs: [] };
  const withId = players.filter(p => p.puuid);
  dbg.withPuuid = withId.length;
  const byPuuid = Object.fromEntries(withId.map(p => [p.puuid, p]));
  const ids = new Set();
  await Promise.all(withId.map(async p => {
    try { (await riot(`https://${ROUTE[p.region]}.api.riotgames.com/lol/match/v5/matches/by-puuid/${p.puuid}/ids?queue=420&startTime=${START}&count=100`)).forEach(i => ids.add(i)); } catch (e) { dbg.errs.push('ids ' + p.riot_id + ': ' + e.message); }
  }));
  dbg.ids = ids.size;
  if (!ids.size) return;
  const rows = await (await sb(`matches?select=match_id&match_id=in.(${[...ids].join(',')})`)).json();
  if (!Array.isArray(rows)) dbg.errs.push('tabla matches: ' + JSON.stringify(rows));
  const have = new Set(Array.isArray(rows) ? rows.map(r => r.match_id) : []);
  for (const id of [...ids].filter(i => !have.has(i)).slice(0, 12)) {
    try {
      const { info } = await riot(`https://${ROUTE[id.split('_')[0].toLowerCase()]}.api.riotgames.com/lol/match/v5/matches/${id}`);
      if (info.gameDuration < 300) continue; // remake
      const data = info.participants.filter(x => byPuuid[x.puuid]).map(x => ({
        r: byPuuid[x.puuid].riot_id, c: x.championName, k: x.kills, d: x.deaths, a: x.assists,
        cs: x.totalMinionsKilled + x.neutralMinionsKilled, pos: x.teamPosition, w: x.win, t: x.teamId
      }));
      const pr = await sb('matches', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates' },
        body: JSON.stringify({ match_id: id, ts: info.gameEndTimestamp || info.gameCreation, dur: info.gameDuration, data }) });
      if (pr.ok) dbg.inserted++; else dbg.errs.push('insert: ' + await pr.text());
    } catch (e) { dbg.errs.push(id + ': ' + e.message); }
  }
}

export default async function handler(req, res) {
  const players = await (await sb('players?select=riot_id,region,puuid,icon,tier,rank,lp')).json();
  if (!Array.isArray(players)) return res.status(500).json({ error: players });
  if (Date.now() - last > EVERY) { last = Date.now(); try { await ingest(players); } catch (e) { (dbg.errs ??= []).push(String(e)); } }
  const [matches, history] = await Promise.all([
    sb('matches?select=match_id,ts,dur,data&order=ts.desc&limit=3000').then(r => r.json()),
    sb('elo_history?select=riot_id,ts,tier,rank,lp&order=ts.asc&limit=10000').then(r => r.json())
  ]);
  dbg.errs ??= [];
  if (!Array.isArray(matches)) dbg.errs.push('select matches: ' + JSON.stringify(matches));
  if (!Array.isArray(history)) dbg.errs.push('select elo_history: ' + JSON.stringify(history));
  let ver; try { ver = (await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json())[0]; } catch {}
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  res.json({ ver, players, matches: Array.isArray(matches) ? matches : [], history: Array.isArray(history) ? history : [], debug: dbg });
}
