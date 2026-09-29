const { RIOT_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
const EVERY = 10 * 60e3;
const ROUTE = { la2: 'americas', la1: 'americas', na1: 'americas', br1: 'americas', euw1: 'europe', eun1: 'europe' };
const TIERS = ['IRON','BRONZE','SILVER','GOLD','PLATINUM','EMERALD','DIAMOND','MASTER','GRANDMASTER','CHALLENGER'];
const DIV = { IV: 0, III: 1, II: 2, I: 3 };
const elo = (t, r, lp) => { const i = TIERS.indexOf(t); return i >= 7 ? 2800 + lp : i * 400 + DIV[r] * 100 + lp; };

const sb = (path, opt = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...opt, headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'content-type': 'application/json', ...opt.headers }
});
const riot = async url => {
  for (let i = 0; i < 2; i++) {
    const r = await fetch(url, { headers: { 'X-Riot-Token': RIOT_KEY } });
    if (r.status === 429) { await new Promise(s => setTimeout(s, (+r.headers.get('retry-after') || 3) * 1000)); continue; }
    if (!r.ok) throw new Error(`${r.status} ${url.split('.com')[1].split('/').slice(0, 5).join('/')}`);
    return r.json();
  }
  throw new Error('rate limit');
};

async function refreshOne(p) {
  const u = { updated_at: new Date().toISOString(), err: null };
  try {
    const [n, t] = p.riot_id.split('#');
    u.puuid = p.puuid || (await riot(`https://${ROUTE[p.region]}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(n)}/${encodeURIComponent(t)}`)).puuid;
    const [sm, es] = await Promise.all([
      riot(`https://${p.region}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${u.puuid}`),
      riot(`https://${p.region}.api.riotgames.com/lol/league/v4/entries/by-puuid/${u.puuid}`)
    ]);
    u.icon = sm.profileIconId; u.level = sm.summonerLevel;
    const e = es.find(x => x.queueType === 'RANKED_SOLO_5x5');
    if (e) {
      Object.assign(u, { tier: e.tier, rank: e.rank, lp: e.leaguePoints, wins: e.wins, losses: e.losses });
      if (!p.start_tier) Object.assign(u, { start_tier: e.tier, start_rank: e.rank, start_lp: e.leaguePoints });
    }
  } catch (err) { u.err = err.message; }
  await sb(`players?riot_id=eq.${encodeURIComponent(p.riot_id)}`, { method: 'PATCH', body: JSON.stringify(u) });
  return { ...p, ...u };
}

export default async function handler(req, res) {
  let rows = await (await sb('players?select=*&order=riot_id')).json();
  if (!Array.isArray(rows)) return res.status(500).json({ error: rows });
  const oldest = Math.min(...rows.map(r => +new Date(r.updated_at)));
  if (rows.length && Date.now() - oldest > EVERY) {
    rows = await Promise.all(rows.map(r => Date.now() - +new Date(r.updated_at) > EVERY ? refreshOne(r) : r));
  }
  let ver; try { ver = (await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json())[0]; } catch {}
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  res.json({
    ver, updated: Math.max(0, ...rows.map(r => +new Date(r.updated_at))),
    players: rows.map(r => ({
      riotId: r.riot_id, region: r.region, icon: r.icon, level: r.level, err: r.err,
      now: r.tier && { tier: r.tier, rank: r.rank, lp: r.lp, w: r.wins, l: r.losses },
      start: r.start_tier && { tier: r.start_tier, rank: r.start_rank, lp: r.start_lp },
      gain: r.tier && r.start_tier ? elo(r.tier, r.rank, r.lp) - elo(r.start_tier, r.start_rank, r.start_lp) : null
    }))
  });
}
