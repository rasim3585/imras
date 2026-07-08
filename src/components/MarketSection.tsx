import type { Match, Market, LiveState } from '../lib/types';
import { formatOdds, impliedProb } from '../lib/format';
import { useCart } from '../coupon/CartContext';

const HT_MARKETS = new Set(['ht_result', 'ht_over_under_0_5']);

// One market's option row. Used by both the bulletin card and the match detail.
// The favourite (lowest odds) and the selected option are highlighted green.
export default function MarketSection({
  match, market, live, showTitle = true,
}: { match: Match; market: Market; live?: LiveState; showTitle?: boolean }) {
  const { isSelected, select } = useCart();
  const isLive = live?.phase === 'live';
  if (isLive && HT_MARKETS.has(market.market_type)) return null; // first-half = pre-match only

  const liveOdds = isLive && !HT_MARKETS.has(market.market_type) ? live!.live_odds : null;
  const oddsFor = (key: string) =>
    (liveOdds?.[key] ?? market.options.find((o) => o.outcome_key === key)?.odds ?? 0);
  const allOdds = market.options.map((o) => oddsFor(o.outcome_key));
  const favOdds = Math.min(...allOdds);

  return (
    <div className="market-section">
      {showTitle && <div className="market-name tag">{market.name}{liveOdds ? ' · live' : ''}</div>}
      <div className="market" style={{ gridTemplateColumns: `repeat(${market.options.length}, 1fr)` }} role="group" aria-label={market.name}>
        {market.options.map((o) => {
          const odds = oddsFor(o.outcome_key);
          const picked = isSelected(o.id);
          const fav = !picked && odds === favOdds;
          return (
            <button
              key={o.id}
              type="button"
              className={`outcome ${picked ? 'sel' : ''} ${fav ? 'fav' : ''}`}
              aria-pressed={picked}
              onClick={() => select({
                option_id: o.id, match_id: match.id, home_team: match.home_team, away_team: match.away_team,
                market_name: market.name, option_label: o.label, odds,
              })}
            >
              <span className="outcome-name">{o.label}</span>
              <span className="outcome-odds">{formatOdds(odds)}</span>
              <span className="outcome-prob">{impliedProb(odds, allOdds)}%</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
