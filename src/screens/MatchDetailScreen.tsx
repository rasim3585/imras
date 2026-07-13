import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { matchProvider } from '../lib/matchProvider';
import { formatKickoff, bballClock } from '../lib/format';
import MarketSection from '../components/MarketSection';
import MatchStatsPanel from '../components/MatchStatsPanel';
import MatchChat from '../live/ChatPanel';
import TeamCrest from '../components/TeamCrest';
import { logEvent } from '../lib/behaviorLog';
import { useI18n } from '../i18n/LanguageContext';
import type { LiveState, Match } from '../lib/types';

// First-half markets are bettable pre-match ONLY (mirror of MarketSection's gate).
const HT_MARKETS = new Set(['ht_result', 'ht_over_under_0_5']);

// Market grouping. Each market_type lands in one tab; unmapped falls back to the
// first group so a new market never disappears silently. Football and basketball
// have their own tab sets.
type MarketGroup = { key: string; tkey: string; types: string[] };
const GROUPS: MarketGroup[] = [
  { key: 'result', tkey: 'grp.result', types: ['match_result', 'double_chance', 'ht_result'] },
  { key: 'ou', tkey: 'grp.ou', types: ['over_under_1_5', 'over_under_2_5', 'over_under_3_5', 'ht_over_under_0_5'] },
  { key: 'goals', tkey: 'grp.goals', types: ['both_teams_score', 'odd_even'] },
];
const BB_GROUPS: MarketGroup[] = [
  { key: 'result', tkey: 'grp.winner', types: ['bb_moneyline'] },
  { key: 'handicap', tkey: 'grp.handicap', types: ['bb_handicap'] },
  { key: 'totals', tkey: 'grp.totals', types: ['bb_total', 'bb_total_home', 'bb_total_away'] },
];
const TN_GROUPS: MarketGroup[] = [
  { key: 'result', tkey: 'grp.winner', types: ['tn_moneyline', 'tn_gameshcap'] },
  { key: 'sets', tkey: 'grp.sets', types: ['tn_setbet', 'tn_totalsets', 'tn_firstset'] },
  { key: 'totals', tkey: 'grp.games', types: ['tn_total'] },
];
const VB_GROUPS: MarketGroup[] = [
  { key: 'result', tkey: 'grp.winner', types: ['vb_moneyline', 'vb_sethcap'] },
  { key: 'sets', tkey: 'grp.sets', types: ['vb_setbet', 'vb_totalsets', 'vb_firstset'] },
  { key: 'points', tkey: 'grp.points', types: ['vb_totalpts'] },
];
const groupOf = (groups: MarketGroup[], mt: string): string =>
  groups.find((g) => g.types.includes(mt))?.key ?? groups[0].key;

export default function MatchDetailScreen() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [match, setMatch] = useState<Match | null>(null);
  const [live, setLive] = useState<LiveState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<string>('all');

  useEffect(() => {
    if (!matchId) return;
    let alive = true;
    // Bahis-öncesi ilgi sinyali: hangi maçı incelediğin (oynamadan da). Moat.
    logEvent('match', 'detail_viewed', { match_id: matchId });
    matchProvider.getMatch(matchId)
      .then((m) => { if (alive) setMatch(m); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : t('md.err.load')); });
    const poll = async () => {
      try { const [s] = await matchProvider.getLiveStates([matchId]); if (alive && s) setLive(s); }
      catch { /* transient */ }
    };
    void poll();
    const id = setInterval(poll, 2500);
    return () => { alive = false; clearInterval(id); };
  }, [matchId]);

  if (error) return <div className="app-shell" style={{ paddingTop: 'var(--s6)' }}><div className="banner banner-error">{error}</div><button className="btn btn-block" onClick={() => navigate(-1)}>{t('md.back')}</button></div>;
  if (!match) return <div className="settle"><div className="spinner" /></div>;

  const isLive = live?.phase === 'live';
  const isFinished = live?.phase === 'finished';

  // Markets currently offerable: hide first-half markets once the match is no
  // longer upcoming (they'd render as empty "Closed" boxes otherwise).
  const markets = [...match.markets]
    .sort((a, b) => a.sort_order - b.sort_order)
    .filter((m) => !HT_MARKETS.has(m.market_type) || live?.phase === 'upcoming');

  const groups = match.sport === 'tennis' ? TN_GROUPS : match.sport === 'basketball' ? BB_GROUPS
    : match.sport === 'volleyball' ? VB_GROUPS : GROUPS;
  const groupsWith = groups.filter((g) => markets.some((m) => groupOf(groups, m.market_type) === g.key));
  const shownGroups = tab === 'all' ? groupsWith : groupsWith.filter((g) => g.key === tab);

  return (
    <div className="app-shell app-shell-flush">
      <button className="detail-back" onClick={() => navigate(-1)}>&lsaquo; {t('md.bulletin')}</button>

      <div className="scoreboard card">
        <div className="sb-top">
          {isLive
            ? <><span className="live-badge">LIVE</span><span className="minute-red tnum">{match.sport === 'basketball' ? bballClock(live!.minute, live!.period) : (match.sport === 'tennis' || match.sport === 'volleyball') ? (live!.period ?? 'LIVE') : `${live!.minute}'`}</span></>
            : isFinished
              ? <span className="tag">{t('md.fulltime')}</span>
              : <span className="soon-timer tnum">{formatKickoff(match.starts_at)}</span>}
          <span className="tag" style={{ marginLeft: 'auto' }}>{match.sport === 'football' ? t('feed.sport.football') : match.sport}</span>
        </div>
        <div className="sb-teams">
          <div className="sb-team">
            <TeamCrest name={match.home_team} size={34} className="sb-badge" />
            <span className="sb-name">{match.home_team}</span>
          </div>
          <span className="sb-score tnum">{live && live.phase !== 'upcoming' ? `${live.home_score} - ${live.away_score}` : 'vs'}</span>
          <div className="sb-team">
            <TeamCrest name={match.away_team} size={34} className="sb-badge" />
            <span className="sb-name">{match.away_team}</span>
          </div>
        </div>
        {match.sport === 'football' && (isLive || isFinished) && (
          <Link className="btn btn-ghost btn-sm btn-block" style={{ marginTop: 'var(--s3)' }} to={`/live/${match.id}`}>{t('md.watchlive')}</Link>
        )}
        {(match.sport === 'basketball' || match.sport === 'tennis' || match.sport === 'volleyball') && (isLive || isFinished) && (
          <Link className="btn btn-ghost btn-sm btn-block" style={{ marginTop: 'var(--s3)' }} to={`/court/${match.id}`}>{t('md.watchlive')}</Link>
        )}
      </div>

      {(() => {
        // Kazanma olasılığı barı (sonuç marketinin ima ettiği ev/deplasman payı).
        const rm = markets.find((mk) => mk.market_type === 'match_result' || mk.market_type.endsWith('moneyline'));
        const oddByLabel = (l: string) => rm?.options.find((o) => o.label === l)?.odds ?? null;
        const hO = oddByLabel('1'); const aO = oddByLabel('2');
        const ph = hO ? 1 / hO : 0; const pa = aO ? 1 / aO : 0;
        if (ph <= 0 && pa <= 0) return null;
        const homePct = Math.round((100 * ph) / (ph + pa));
        return (
          <div className="winprob">
            <div className="winprob-head"><span className="k">{t('live.winprob')}</span></div>
            <div className="winprob-bar">
              <div className="winprob-h" style={{ width: `${homePct}%` }} />
              <div className="winprob-a" style={{ width: `${100 - homePct}%` }} />
            </div>
            <div className="winprob-labels">
              <span className="winprob-lh"><b>{homePct}%</b> {match.home_team}</span>
              <span className="winprob-la">{match.away_team} <b>{100 - homePct}%</b></span>
            </div>
          </div>
        );
      })()}

      <MatchStatsPanel matchId={match.id} />

      {groupsWith.length > 1 && (
        <div className="bet-tabs">
          <button className={`bet-tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>{t('md.all')}</button>
          {groupsWith.map((g) => (
            <button key={g.key} className={`bet-tab ${tab === g.key ? 'active' : ''}`} onClick={() => setTab(g.key)}>{t(g.tkey)}</button>
          ))}
        </div>
      )}

      <div className="detail-markets">
        {shownGroups.flatMap((g) => {
          const list = markets.filter((m) => groupOf(groups, m.market_type) === g.key);
          const els = [];
          if (tab === 'all') els.push(<div key={`cat-${g.key}`} className="mkt-cat">{t(g.tkey)}</div>);
          for (const m of list) {
            els.push(
              <div key={m.id} className="mkt-group">
                <div className="mkt-title">{m.name}{isLive && !HT_MARKETS.has(m.market_type) ? ' · live' : ''}</div>
                <MarketSection match={match} market={m} live={live ?? undefined} showTitle={false} />
              </div>,
            );
          }
          return els;
        })}
      </div>

      <MatchChat matchId={match.id} />
    </div>
  );
}
