import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Match, LiveState, Market } from '../lib/types';
import { formatKickoff, formatOdds } from '../lib/format';
import { teamColor, teamInitial } from '../lib/teams';
import { playerName } from '../lib/playerNames';
import { useCart } from '../coupon/CartContext';

const HT = new Set(['ht_result', 'ht_over_under_0_5']);

// One compact bulletin line (Nesine layout): "Home (P) · Away (P)" one line +
// a separate score box + aligned 1/X/2/O-U/BTTS cells + a "+N" that expands ALL
// markets inline (compact).
export default function MatchRow({ match, live }: { match: Match; live?: LiveState }) {
  const { isSelected, select } = useCart();
  const [open, setOpen] = useState(false);
  const isLive = live?.phase === 'live';
  const hP = playerName(match.id + 'h');
  const aP = playerName(match.id + 'a');

  const byType = (t: string) => match.markets.find((m) => m.market_type === t);
  const mr = byType('match_result'); const ou = byType('over_under_2_5'); const kg = byType('both_teams_score');
  const liveOdds = isLive ? live!.live_odds : null;
  const opt = (m: Market | undefined, key: string) => m?.options.find((o) => o.outcome_key === key);
  const oddsOf = (m: Market | undefined, key: string) => (liveOdds?.[key] ?? opt(m, key)?.odds ?? 0);
  const pick = (m: Market | undefined, key: string) => {
    const o = opt(m, key); if (!o || !m) return;
    select({ option_id: o.id, match_id: match.id, home_team: match.home_team, away_team: match.away_team, market_name: m.name, option_label: o.label, odds: oddsOf(m, key) });
  };
  const mrOdds = mr ? [oddsOf(mr, 'home'), oddsOf(mr, 'draw'), oddsOf(mr, 'away')] : [];
  const favMr = Math.min(...mrOdds.filter((x) => x > 0));

  // odds-move arrows: on a live change, show ▲/▼ for ~5s (Nesine "breathing" feel)
  const shownCells: [Market | undefined, string][] = [[mr, 'home'], [mr, 'draw'], [mr, 'away'], [ou, 'ou25_under'], [ou, 'ou25_over'], [kg, 'btts_yes']];
  const prev = useRef<Record<string, number>>({});
  const timers = useRef<Record<string, number>>({});
  const [arrows, setArrows] = useState<Record<string, 'up' | 'down'>>({});
  const oddsKey = shownCells.map(([m, k]) => oddsOf(m, k)).join(',');
  useEffect(() => {
    if (!isLive) return;
    for (const [m, k] of shownCells) {
      const cur = oddsOf(m, k); if (!(cur > 0)) continue;
      const p = prev.current[k];
      if (p != null && cur !== p) {
        const dir = cur > p ? 'up' : 'down';
        setArrows((a) => ({ ...a, [k]: dir }));
        if (timers.current[k]) clearTimeout(timers.current[k]);
        timers.current[k] = window.setTimeout(() => setArrows((a) => { const n = { ...a }; delete n[k]; return n; }), 5000);
      }
      prev.current[k] = cur;
    }
  }, [oddsKey, isLive]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { Object.values(timers.current).forEach(clearTimeout); }, []);

  const Cell = ({ m, k, sec = false }: { m: Market | undefined; k: string; sec?: boolean }) => {
    const o = opt(m, k); const odds = oddsOf(m, k); const on = o ? isSelected(o.id) : false; const arr = arrows[k];
    return (
      <button type="button" disabled={!o} className={`ll-odd ${sec ? 'll-sec' : ''} ${on ? 'sel' : ''} ${m === mr && odds === favMr ? 'fav' : ''} ${arr ? `chg-${arr}` : ''}`} onClick={() => pick(m, k)}>
        {o ? formatOdds(odds) : '–'}
        {arr && <span className={`ll-arrow ${arr}`}>{arr === 'up' ? '▲' : '▼'}</span>}
      </button>
    );
  };

  const shownMarkets = [...match.markets].filter((m) => !(isLive && HT.has(m.market_type))).sort((a, b) => a.sort_order - b.sort_order);
  const moreCount = Math.max(0, shownMarkets.length - 1);

  return (
    <>
      <div className={`ll-row ${isLive ? 'is-live' : ''}`}>
        <Link className="ll-info" to={`/match/${match.id}`}>
          <span className={`ll-time tnum ${isLive ? 'live' : (live && live.starts_in != null && live.starts_in <= 90) ? 'soon' : ''}`}>
            {isLive ? `${live!.minute}'`
              : (live && live.starts_in != null)
                ? (live.starts_in < 60 ? `${live.starts_in}s` : `${Math.ceil(live.starts_in / 60)}m`)
                : formatKickoff(match.starts_at)}
          </span>
          <span className="ll-teamline">
            <span className="ll-badge" style={{ background: teamColor(match.home_team) }}>{teamInitial(match.home_team)}</span>
            <span className="ll-name">{match.home_team} <i className="ll-pl">({hP})</i></span>
            {isLive ? <span className="ll-scorepill tnum">{live!.home_score}-{live!.away_score}</span> : <span className="ll-sep">·</span>}
            <span className="ll-badge" style={{ background: teamColor(match.away_team) }}>{teamInitial(match.away_team)}</span>
            <span className="ll-name">{match.away_team} <i className="ll-pl">({aP})</i></span>
          </span>
          {isLive && <span className="ll-livechip"><span className="pulse" />LIVE</span>}
        </Link>

        <Cell m={mr} k="home" /><Cell m={mr} k="draw" /><Cell m={mr} k="away" />
        <Cell m={ou} k="ou25_under" sec /><Cell m={ou} k="ou25_over" sec /><Cell m={kg} k="btts_yes" sec />
        <button type="button" className={`ll-plus ${open ? 'open' : ''}`} onClick={() => setOpen((v) => !v)}>{open ? '−' : `+${moreCount}`}</button>
      </div>

      {open && (
        <div className="ll-expand">
          {shownMarkets.map((m) => {
            const all = m.options.map((o) => oddsOf(m, o.outcome_key));
            const fav = Math.min(...all.filter((x) => x > 0));
            return (
              <div key={m.id} className="llx-mkt">
                <div className="llx-h">{m.name}{isLive && !HT.has(m.market_type) ? <span className="llx-live">live</span> : null}</div>
                <div className="llx-cells" style={{ gridTemplateColumns: `repeat(${m.options.length}, 1fr)` }}>
                  {m.options.map((o) => {
                    const odds = oddsOf(m, o.outcome_key); const on = isSelected(o.id);
                    return (
                      <button key={o.id} type="button" className={`llx-cell ${on ? 'sel' : ''} ${odds === fav ? 'fav' : ''}`}
                        onClick={() => select({ option_id: o.id, match_id: match.id, home_team: match.home_team, away_team: match.away_team, market_name: m.name, option_label: o.label, odds })}>
                        <span className="llx-k">{o.label}</span><span className="llx-v tnum">{formatOdds(odds)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
