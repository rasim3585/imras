import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { matchProvider } from '../lib/matchProvider';
import { useI18n } from '../i18n/LanguageContext';
import CourtTV from '../live/CourtTV';
import TennisTV from '../live/TennisTV';
import MatchChat from '../live/ChatPanel';
import type { LiveState, Match } from '../lib/types';

// Basketbol 2D canlı izleme ekranı. Maçı + canlı skoru çeker, CourtTV'yi besler.
// Kazanma olasılığı barı + canlı sohbet de burada (futbol /live ekranıyla tutarlı).
export default function LiveCourtScreen() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [match, setMatch] = useState<Match | null>(null);
  const [live, setLive] = useState<LiveState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!matchId) return;
    let alive = true;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  if (error) return (
    <div className="app-shell" style={{ paddingTop: 'var(--s6)' }}>
      <div className="banner banner-error">{error}</div>
      <button className="btn btn-block" onClick={() => navigate(-1)}>{t('md.back')}</button>
    </div>
  );
  if (!match) return <div className="settle"><div className="spinner" /><p className="settle-note">{t('live.connecting')}</p></div>;

  const phase = live?.phase === 'live' ? 'live' : live?.phase === 'finished' ? 'finished' : 'upcoming';
  const hs = live?.home_score ?? 0;
  const as = live?.away_score ?? 0;

  // kazanma olasılığı (moneyline'dan)
  const rm = match.markets.find((mk) => mk.market_type.endsWith('moneyline') || mk.market_type === 'match_result');
  const oddByLabel = (l: string) => rm?.options.find((o) => o.label === l)?.odds ?? null;
  const hO = oddByLabel('1'); const aO = oddByLabel('2');
  const ph = hO ? 1 / hO : 0; const pa = aO ? 1 / aO : 0;
  const homePct = ph + pa > 0 ? Math.round((100 * ph) / (ph + pa)) : 50;

  return (
    <div className="app-shell live-screen">
      <button className="detail-back" onClick={() => navigate(-1)}>&lsaquo; {t('md.bulletin')}</button>

      {match.sport === 'tennis' || match.sport === 'volleyball' ? (
        <TennisTV home={match.home_team} away={match.away_team} hs={hs} as={as}
          period={live?.period ?? null} phase={phase} />
      ) : (
        <CourtTV home={match.home_team} away={match.away_team} hs={hs} as={as}
          period={live?.period ?? null} minute={live?.minute ?? 0} phase={phase} />
      )}

      {(ph > 0 || pa > 0) && phase !== 'finished' && (
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
      )}

      {matchId && <MatchChat matchId={matchId} />}

      <button className="btn btn-ghost btn-block" style={{ marginTop: 'var(--s3)' }} onClick={() => navigate(-1)}>{t('md.back')}</button>
    </div>
  );
}
