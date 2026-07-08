import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Match, LiveState, Market } from '../lib/types';
import { formatKickoff, formatOdds } from '../lib/format';
import { teamColor, teamInitial } from '../lib/teams';
import { useCart } from '../coupon/CartContext';
import MarketSection from './MarketSection';

const HT = new Set(['ht_result', 'ht_over_under_0_5']);

// One compact bulletin line (Nesine layout): teams + quick 1/X/2 + O/U + BTTS
// odds, and a "+N" that expands ALL markets inline (accordion).
export default function MatchRow({ match, live }: { match: Match; live?: LiveState }) {
  const { isSelected, select } = useCart();
  const [open, setOpen] = useState(false);
  const isLive = live?.phase === 'live';

  const byType = (t: string) => match.markets.find((m) => m.market_type === t);
  const mr = byType('match_result'); const ou = byType('over_under_2_5'); const kg = byType('both_teams_score');
  const liveOdds = isLive ? live!.live_odds : null;

  const opt = (m: Market | undefined, key: string) => m?.options.find((o) => o.outcome_key === key);
  const oddsOf = (m: Market | undefined, key: string) =>
    (liveOdds?.[key] ?? opt(m, key)?.odds ?? 0);

  const pick = (m: Market | undefined, key: string) => {
    const o = opt(m, key); if (!o || !m) return;
    select({ option_id: o.id, match_id: match.id, home_team: match.home_team, away_team: match.away_team, market_name: m.name, option_label: o.label, odds: oddsOf(m, key) });
  };

  const mrOdds = mr ? [oddsOf(mr, 'home'), oddsOf(mr, 'draw'), oddsOf(mr, 'away')] : [];
  const favMr = Math.min(...mrOdds.filter((x) => x > 0));

  const Cell = ({ m, k, sec = false }: { m: Market | undefined; k: string; sec?: boolean }) => {
    const o = opt(m, k); const odds = oddsOf(m, k);
    const on = o ? isSelected(o.id) : false;
    const fav = m === mr && odds === favMr;
    return (
      <button type="button" disabled={!o} className={`ll-odd ${sec ? 'll-sec' : ''} ${on ? 'sel' : ''} ${fav ? 'fav' : ''}`} onClick={() => pick(m, k)}>
        {o ? formatOdds(odds) : '–'}
      </button>
    );
  };

  const moreCount = match.markets.filter((m) => !(isLive && HT.has(m.market_type))).length;
  const sortedMarkets = [...match.markets].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <>
      <div className={`ll-row ${isLive ? 'is-live' : ''}`}>
        <Link className="ll-info" to={`/match/${match.id}`}>
          <span className="ll-time tnum">{isLive ? <span className="ll-min">{live!.minute}&apos;</span> : formatKickoff(match.starts_at)}</span>
          <span className="ll-teams">
            <span className="ll-t"><span className="ll-badge" style={{ background: teamColor(match.home_team) }}>{teamInitial(match.home_team)}</span><span className="ll-name">{match.home_team}</span>{isLive && <b className="ll-score tnum">{live!.home_score}</b>}</span>
            <span className="ll-t"><span className="ll-badge" style={{ background: teamColor(match.away_team) }}>{teamInitial(match.away_team)}</span><span className="ll-name">{match.away_team}</span>{isLive && <b className="ll-score tnum">{live!.away_score}</b>}</span>
          </span>
          {isLive && <span className="ll-livebadge">LIVE</span>}
        </Link>

        <div className="ll-odds">
          <Cell m={mr} k="home" /><Cell m={mr} k="draw" /><Cell m={mr} k="away" />
        </div>
        <div className="ll-odds ll-odds-sec">
          <Cell m={ou} k="ou25_under" sec /><Cell m={ou} k="ou25_over" sec /><Cell m={kg} k="btts_yes" sec />
        </div>
        <button type="button" className={`ll-plus ${open ? 'open' : ''}`} onClick={() => setOpen((v) => !v)}>
          {open ? '−' : `+${Math.max(0, moreCount - 1)}`}
        </button>
      </div>

      {open && (
        <div className="ll-expand">
          {sortedMarkets.map((m) => <MarketSection key={m.id} match={match} market={m} live={live} />)}
        </div>
      )}
    </>
  );
}
