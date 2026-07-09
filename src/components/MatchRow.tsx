import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BulletinMatch, BulletinMarket, BulletinOption } from '../lib/types';
import { formatKickoff, formatOdds } from '../lib/format';
import { teamColor, teamInitial } from '../lib/teams';
import { playerName } from '../lib/playerNames';
import { useCart } from '../coupon/CartContext';

const LIVE = new Set(['inprogress', 'live', 'penalties']);

// One compact bulletin line for a real OR virtual match. Real: real teams, no
// fake players, league/derby chips. Virtual: fake players, "SIM". Closed markets
// are simply absent from `markets` (server-decided) -> the cell shows "-".
export default function MatchRow({ m }: { m: BulletinMatch }) {
  const { isPicked, select } = useCart();
  const [open, setOpen] = useState(false);
  const isLive = LIVE.has(m.status);
  const isVirtual = m.kind === 'virtual';

  const mkt = (t: string): BulletinMarket | undefined => m.markets.find((k) => k.market_type === t);
  const mr = mkt('match_result'); const ou = mkt('over_under_2_5'); const kg = mkt('both_teams_score');
  const optOf = (market: BulletinMarket | undefined, key: string): BulletinOption | undefined => market?.options.find((o) => o.outcome_key === key);
  const oddsOf = (market: BulletinMarket | undefined, key: string): number | null => optOf(market, key)?.odds ?? null;

  const pick = (market: BulletinMarket | undefined, key: string) => {
    const o = optOf(market, key); if (!o || !market) return;
    select({
      kind: m.kind, match_id: m.id, option_id: o.option_id, market_type: market.market_type, outcome_key: o.outcome_key,
      home_team: m.home_team, away_team: m.away_team, market_name: market.name, option_label: o.label, odds: o.odds,
    });
  };

  const mrOdds = mr ? [oddsOf(mr, 'home'), oddsOf(mr, 'draw'), oddsOf(mr, 'away')] : [];
  const favMr = Math.min(...mrOdds.filter((x): x is number => x != null && x > 0));

  // odds-move arrows: on a live change show ▲/▼ for ~5s (Nesine "breathing" feel)
  const shownCells: [BulletinMarket | undefined, string][] = [[mr, 'home'], [mr, 'draw'], [mr, 'away'], [ou, 'ou25_under'], [ou, 'ou25_over'], [kg, 'btts_yes']];
  const prev = useRef<Record<string, number>>({});
  const timers = useRef<Record<string, number>>({});
  const [arrows, setArrows] = useState<Record<string, 'up' | 'down'>>({});
  const oddsKey = shownCells.map(([market, k]) => oddsOf(market, k)).join(',');
  useEffect(() => {
    if (!isLive) return;
    for (const [market, k] of shownCells) {
      const cur = oddsOf(market, k); if (cur == null || cur <= 0) continue;
      const p = prev.current[k];
      if (p != null && Math.abs(cur - p) >= 0.02) {
        const dir = cur > p ? 'up' : 'down';
        setArrows((a) => ({ ...a, [k]: dir }));
        if (timers.current[k]) clearTimeout(timers.current[k]);
        timers.current[k] = window.setTimeout(() => setArrows((a) => { const n = { ...a }; delete n[k]; return n; }), 5000);
      }
      prev.current[k] = cur;
    }
  }, [oddsKey, isLive]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { Object.values(timers.current).forEach(clearTimeout); }, []);

  const Cell = ({ market, k, sec = false }: { market: BulletinMarket | undefined; k: string; sec?: boolean }) => {
    const o = optOf(market, k); const odds = oddsOf(market, k); const arr = arrows[k];
    const on = market ? isPicked(m.id, market.market_type, k) : false;
    return (
      <button type="button" disabled={!o} className={`ll-odd ${sec ? 'll-sec' : ''} ${on ? 'sel' : ''} ${market === mr && odds === favMr ? 'fav' : ''} ${arr ? `chg-${arr}` : ''}`} onClick={() => pick(market, k)}>
        {o ? formatOdds(odds ?? 0) : '–'}
        {arr && <span className={`ll-arrow ${arr}`}>{arr === 'up' ? '▲' : '▼'}</span>}
      </button>
    );
  };

  const moreCount = Math.max(0, m.markets.length - 1);
  const infoInner = (
    <>
      <span className={`ll-time tnum ${isLive ? 'live' : ''}`}>
        {isLive ? `${m.minute ?? 0}'` : formatKickoff(m.starts_at)}
      </span>
      <span className="ll-teamline">
        {(m.league || m.is_derby) && (
          <span className="ll-tags">
            {m.league && <span className="ll-lg">{m.league}</span>}
            {m.is_derby && <span className="ll-derby">DERBY</span>}
          </span>
        )}
        <span className="ll-badge" style={{ background: teamColor(m.home_team) }}>{teamInitial(m.home_team)}</span>
        <span className="ll-name">{m.home_team}{isVirtual && <i className="ll-pl"> ({playerName(m.id + 'h')})</i>}</span>
        {isLive ? <span className="ll-scorepill tnum">{m.home_score ?? 0}-{m.away_score ?? 0}</span> : <span className="ll-sep">·</span>}
        <span className="ll-badge" style={{ background: teamColor(m.away_team) }}>{teamInitial(m.away_team)}</span>
        <span className="ll-name">{m.away_team}{isVirtual && <i className="ll-pl"> ({playerName(m.id + 'a')})</i>}</span>
      </span>
      {isLive && <span className="ll-livechip"><span className="pulse" />LIVE</span>}
    </>
  );

  return (
    <>
      <div className={`ll-row ${isLive ? 'is-live' : ''}`}>
        {isVirtual
          ? <Link className="ll-info" to={`/match/${m.id}`}>{infoInner}</Link>
          : <div className="ll-info">{infoInner}</div>}

        <Cell market={mr} k="home" /><Cell market={mr} k="draw" /><Cell market={mr} k="away" />
        <Cell market={ou} k="ou25_under" sec /><Cell market={ou} k="ou25_over" sec /><Cell market={kg} k="btts_yes" sec />
        <button type="button" className={`ll-plus ${open ? 'open' : ''}`} onClick={() => setOpen((v) => !v)}>{open ? '−' : `+${moreCount}`}</button>
      </div>

      {open && (
        <div className="ll-expand">
          {m.markets.map((market) => {
            const openO = market.options.map((o) => o.odds).filter((x) => x > 0);
            const fav = openO.length ? Math.min(...openO) : Infinity;
            return (
              <div key={market.market_type} className="llx-mkt">
                <div className="llx-h">{market.name}</div>
                <div className="llx-cells" style={{ gridTemplateColumns: `repeat(${market.options.length}, 1fr)` }}>
                  {market.options.map((o) => (
                    <button key={o.outcome_key} type="button" className={`llx-cell ${isPicked(m.id, market.market_type, o.outcome_key) ? 'sel' : ''} ${o.odds === fav ? 'fav' : ''}`}
                      onClick={() => pick(market, o.outcome_key)}>
                      <span className="llx-k">{o.label}</span><span className="llx-v tnum">{formatOdds(o.odds)}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
