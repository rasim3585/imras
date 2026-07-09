import type { Match, Market, LiveState } from '../lib/types';
import { formatOdds, impliedProb } from '../lib/format';
import { useCart } from '../coupon/CartContext';

const HT_MARKETS = new Set(['ht_result', 'ht_over_under_0_5']);

// One market's option row. Used by both the bulletin card and the match detail.
// The favourite (lowest odds) and the selected option are highlighted green.
export default function MarketSection({
  match, market, live, showTitle = true,
}: { match: Match; market: Market; live?: LiveState; showTitle?: boolean }) {
  const { isPicked, select } = useCart();
  const isLive = live?.phase === 'live';
  // first-half markets are bettable pre-match ONLY -> show only when we KNOW the
  // match is upcoming (live loaded); hidden while live is loading or once started.
  if (HT_MARKETS.has(market.market_type) && live?.phase !== 'upcoming') return null;

  const liveOdds = isLive && !HT_MARKETS.has(market.market_type) ? live!.live_odds : null;
  // null => the score has CLOSED this outcome (show "Closed", no button)
  const oddsFor = (key: string): number | null => {
    if (liveOdds && key in liveOdds) return liveOdds[key];
    return market.options.find((o) => o.outcome_key === key)?.odds ?? 0;
  };
  const openOdds = market.options.map((o) => oddsFor(o.outcome_key)).filter((x): x is number => x != null && x > 0);
  const favOdds = openOdds.length ? Math.min(...openOdds) : Infinity;

  return (
    <div className="market-section">
      {showTitle && <div className="market-name tag">{market.name}{liveOdds ? ' · live' : ''}</div>}
      <div className="market" style={{ gridTemplateColumns: `repeat(${market.options.length}, 1fr)` }} role="group" aria-label={market.name}>
        {market.options.map((o) => {
          const odds = oddsFor(o.outcome_key);
          if (odds == null) return (
            <div key={o.id} className="outcome outcome-closed">
              <span className="outcome-name">{o.label}</span>
              <span className="outcome-odds">Closed</span>
            </div>
          );
          const picked = isPicked(match.id, market.market_type, o.outcome_key);
          const fav = !picked && odds === favOdds;
          return (
            <button
              key={o.id}
              type="button"
              className={`outcome ${picked ? 'sel' : ''} ${fav ? 'fav' : ''}`}
              aria-pressed={picked}
              onClick={() => select({
                kind: 'virtual', match_id: match.id, option_id: o.id, market_type: market.market_type, outcome_key: o.outcome_key,
                home_team: match.home_team, away_team: match.away_team, market_name: market.name, option_label: o.label, odds,
              })}
            >
              <span className="outcome-name">{o.label}</span>
              <span className="outcome-odds">{formatOdds(odds)}</span>
              <span className="outcome-prob">{impliedProb(odds, openOdds)}%</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
