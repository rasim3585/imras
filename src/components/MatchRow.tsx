import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BulletinMatch, BulletinMarket, BulletinOption } from '../lib/types';
import { formatKickoff, formatOdds, bballClock } from '../lib/format';
import TeamCrest from './TeamCrest';
import { playerName } from '../lib/playerNames';
import { useCart } from '../coupon/CartContext';
import { EFootballIcon, EBasketballIcon, ETennisIcon, EVolleyballIcon } from './icons';

const LIVE = new Set(['inprogress', 'live', 'penalties']);

// One compact bulletin line for a real OR virtual match. Real: real teams, no
// fake players, league/derby chips. Virtual: fake players, "SIM". Closed markets
// are simply absent from `markets` (server-decided) -> the cell shows "-".
// `hideLeague` drops the inline league chip when a grouping header already names
// the league (the bulletin's country>league sections) -- avoids the duplicate.
export default function MatchRow({ m, hideLeague }: { m: BulletinMatch; hideLeague?: boolean }) {
  const { isPicked, select } = useCart();
  const [open, setOpen] = useState(false);
  const isLive = LIVE.has(m.status);
  const isVirtual = m.kind === 'virtual';
  const isBB = m.sport === 'basketball';
  const isTN = m.sport === 'tennis';
  const isVB = m.sport === 'volleyball';

  const mkt = (t: string): BulletinMarket | undefined => m.markets.find((k) => k.market_type === t);
  const optOf = (market: BulletinMarket | undefined, key: string): BulletinOption | undefined => market?.options.find((o) => o.outcome_key === key);
  const oddsOf = (market: BulletinMarket | undefined, key: string): number | null => optOf(market, key)?.odds ?? null;

  const pick = (market: BulletinMarket | undefined, key: string) => {
    const o = optOf(market, key); if (!o || !market) return;
    select({
      kind: m.kind, match_id: m.id, option_id: o.option_id, market_type: market.market_type, outcome_key: o.outcome_key,
      home_team: m.home_team, away_team: m.away_team, market_name: market.name, option_label: o.label, odds: o.odds,
    });
  };

  // Compact main-row cells differ by sport. Football: 1/X/2 + O/U 2.5 + BTTS.
  // Basketball: Match Winner 1/2 + Handicap + Total. Both fill the same 6 slots.
  const cellCfg: { market: BulletinMarket | undefined; k: string; sec?: boolean }[] = isVB
    ? [
        { market: mkt('vb_moneyline'), k: 'ml_home' }, { market: mkt('vb_moneyline'), k: 'ml_away' },
        { market: mkt('vb_totalsets'), k: 'ts_over', sec: true }, { market: mkt('vb_totalsets'), k: 'ts_under', sec: true },
        { market: mkt('vb_sethcap'), k: 'sh_home', sec: true }, { market: mkt('vb_sethcap'), k: 'sh_away', sec: true },
      ]
    : isTN
    ? [
        { market: mkt('tn_moneyline'), k: 'ml_home' }, { market: mkt('tn_moneyline'), k: 'ml_away' },
        { market: mkt('tn_total'), k: 'tot_over', sec: true }, { market: mkt('tn_total'), k: 'tot_under', sec: true },
        { market: mkt('tn_firstset'), k: 'fs_home', sec: true }, { market: mkt('tn_firstset'), k: 'fs_away', sec: true },
      ]
    : isBB
    ? [
        { market: mkt('bb_moneyline'), k: 'ml_home' }, { market: mkt('bb_moneyline'), k: 'ml_away' },
        { market: mkt('bb_handicap'), k: 'hcap_home', sec: true }, { market: mkt('bb_handicap'), k: 'hcap_away', sec: true },
        { market: mkt('bb_total'), k: 'tot_over', sec: true }, { market: mkt('bb_total'), k: 'tot_under', sec: true },
      ]
    : [
        { market: mkt('match_result'), k: 'home' }, { market: mkt('match_result'), k: 'draw' }, { market: mkt('match_result'), k: 'away' },
        { market: mkt('over_under_2_5'), k: 'ou25_under', sec: true }, { market: mkt('over_under_2_5'), k: 'ou25_over', sec: true },
        { market: mkt('both_teams_score'), k: 'btts_yes', sec: true },
      ];

  const primaryMkt = isVB ? mkt('vb_moneyline') : isTN ? mkt('tn_moneyline') : isBB ? mkt('bb_moneyline') : mkt('match_result');
  const primaryOdds = primaryMkt ? primaryMkt.options.map((o) => o.odds).filter((x) => x > 0) : [];
  const favMr = primaryOdds.length ? Math.min(...primaryOdds) : Infinity;

  // odds-move arrows: on a live change show ▲/▼ for ~5s
  const shownCells: [BulletinMarket | undefined, string][] = cellCfg.map((c) => [c.market, c.k]);
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
      <button type="button" disabled={!o} className={`ll-odd ${sec ? 'll-sec' : ''} ${on ? 'sel' : ''} ${market === primaryMkt && odds === favMr ? 'fav' : ''} ${arr ? `chg-${arr}` : ''}`} onClick={() => pick(market, k)}>
        {o ? formatOdds(odds ?? 0) : '–'}
        {arr && <span className={`ll-arrow ${arr}`}>{arr === 'up' ? '▲' : '▼'}</span>}
      </button>
    );
  };

  const moreCount = Math.max(0, m.markets.length - 1);
  const infoInner = (
    <>
      <span className={`ll-time tnum ${isLive ? 'live' : ''}`}>
        {isLive ? (isBB ? bballClock(m.minute, m.period) : (isTN || isVB) ? (m.period ?? 'LIVE') : `${m.minute ?? 0}'`) : formatKickoff(m.starts_at)}
      </span>
      <span className="ll-teamline">
        <span className="ll-tags">
          {isVirtual
            ? (isBB
                ? <span className="ll-sim" title="Simulated basketball · e-Basketball"><EBasketballIcon size={20} /></span>
                : isTN
                ? <span className="ll-sim" title="Simulated tennis · e-Tennis"><ETennisIcon size={20} /></span>
                : isVB
                ? <span className="ll-sim" title="Simulated volleyball · e-Volleyball"><EVolleyballIcon size={20} /></span>
                : <span className="ll-sim" title="Simulated match · E-Football 2×4 min"><EFootballIcon size={20} /></span>)
            : <span className="ll-real">REAL</span>}
          {!hideLeague && m.league && <span className="ll-lg">{m.league}</span>}
          {m.is_derby && <span className="ll-derby">DERBY</span>}
        </span>
        <TeamCrest name={m.home_team} size={16} className="ll-badge" />
        <span className="ll-name">{m.home_team}{isVirtual && <i className="ll-pl"> ({playerName(m.id + 'h')})</i>}</span>
        {isLive ? <span className="ll-scorepill tnum">{m.home_score ?? 0}-{m.away_score ?? 0}</span> : <span className="ll-sep">·</span>}
        <TeamCrest name={m.away_team} size={16} className="ll-badge" />
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

        {cellCfg.map((c, i) => <Cell key={i} market={c.market} k={c.k} sec={c.sec} />)}
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
