import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { matchProvider } from '../lib/matchProvider';
import { useI18n } from '../i18n/LanguageContext';
import CourtTV from '../live/CourtTV';
import TennisTV from '../live/TennisTV';
import MatchChat from '../live/ChatPanel';
import FormStrip from '../live/FormStrip';
import { courtStatsAt, ambientPlay, type PlayType } from '../live/courtSim';
import { tennisFeed, type TPlay } from '../live/tennisSim';
import { supabase } from '../lib/supabase';
import type { LiveState, Match } from '../lib/types';

interface Quarter { q: number; h: number; a: number }

const TPLAY_ICON: Record<TPlay, string> = { ace: '🎾', winner: '🔥', error: '❌', break: '⚡', rally: '↔' };

// Tennis / volleyball point feed below the court (presentational atmosphere).
function TennisPlays({ matchId, setIdx, home, away }: { matchId: string; setIdx: number; home: string; away: string }) {
  const { t } = useI18n();
  const mount = useRef(Date.now());
  const [, force] = useState(0);
  useEffect(() => { const id = setInterval(() => force((n) => n + 1), 1600); return () => clearInterval(id); }, []);
  const elapsed = (Date.now() - mount.current) / 1000;
  const feed = tennisFeed(matchId, setIdx, elapsed).slice(-10).reverse();
  return (
    <>
      <div className="section-head"><h3>{t('live.keymoments')}</h3></div>
      <div className="card cm-feed">
        {feed.length === 0 && <div className="cm-line"><span className="cm-text muted">{t('live.playersout')}</span></div>}
        {feed.map((e) => (
          <div key={e.key} className="cm-line">
            <span className="cm-ico">{TPLAY_ICON[e.type]}</span>
            <span className="cm-text">{t(`tplay.${e.type}`)} · {e.side === 'home' ? home : away}</span>
          </div>
        ))}
      </div>
    </>
  );
}

const PLAY_ICON: Record<PlayType, string> = {
  make2: '🏀', make3: '🎯', miss: '🧱', rebound: '🔁', steal: '🖐', foul: '⚠', block: '🛡', assist: '➡',
};

// Basketball stat strip + play feed below the court. Its own slow clock; makes
// are pulled from the authoritative server score.
function CourtStats({ matchId, home, away, hs, as, minute }: { matchId: string; home: string; away: string; hs: number; as: number; minute: number }) {
  const { t } = useI18n();
  const mount = useRef(Date.now());
  const [, force] = useState(0);
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  useEffect(() => { const id = setInterval(() => force((n) => n + 1), 1600); return () => clearInterval(id); }, []);
  // çeyrek skorları (yalnız tamamlanan çeyrekler; server sızıntı yapmıyor)
  useEffect(() => {
    let alive = true;
    const load = () => supabase.rpc('bball_quarters', { p_match_id: matchId }).then(({ data }) => { if (alive && Array.isArray(data)) setQuarters(data as Quarter[]); });
    load(); const id = setInterval(load, 8000);
    return () => { alive = false; clearInterval(id); };
  }, [matchId]);
  const elapsed = (Date.now() - mount.current) / 1000;
  const s = courtStatsAt(matchId, Math.max(elapsed, minute * 60));   // stats reflect the actual game progress
  const feed = ambientPlay(matchId, elapsed).slice(-10).reverse();
  const rows: [string, [number, number], string][] = [
    ['FG%', s.fgPct, '%'], [t('bb.reb'), s.rebounds, ''], [t('bb.to'), s.turnovers, ''], [t('live.fouls'), s.fouls, ''],
  ];
  const Bar = ({ label, l, r, suf }: { label: string; l: number; r: number; suf: string }) => {
    const tot = l + r; const lp = tot === 0 ? 50 : Math.round((100 * l) / tot);
    return (
      <div className="lst-row">
        <span className="lst-l tnum">{l}{suf}</span>
        <div className="lst-mid"><span className="lst-k">{label}</span>
          <div className="lst-bar"><div className="lst-h" style={{ width: `${lp}%` }} /><div className="lst-a" style={{ width: `${100 - lp}%` }} /></div></div>
        <span className="lst-r tnum">{r}{suf}</span>
      </div>
    );
  };
  return (
    <>
      <div className="card lst">
        <div className="lst-head"><span className="lst-tm">{home}</span><span className="lst-ti">{t('live.stats')}</span><span className="lst-tm">{away}</span></div>
        <div className="lst-row lst-poss"><span className="lst-l tnum">{hs}</span>
          <div className="lst-mid"><span className="lst-k">{t('bb.pts')}</span>
            <div className="lst-bar big"><div className="lst-h" style={{ width: `${hs + as === 0 ? 50 : Math.round((100 * hs) / (hs + as))}%` }} /><div className="lst-a" style={{ width: `${hs + as === 0 ? 50 : Math.round((100 * as) / (hs + as))}%` }} /></div></div>
          <span className="lst-r tnum">{as}</span></div>
        {rows.map(([label, [l, r], suf]) => <Bar key={label} label={label} l={l} r={r} suf={suf} />)}
      </div>
      {quarters.length > 0 && (
        <div className="card bbq">
          <div className="bbq-row bbq-head"><span className="bbq-team" />{quarters.map((q) => <span key={q.q} className="bbq-q">Q{q.q}</span>)}</div>
          <div className="bbq-row"><span className="bbq-team">{home}</span>{quarters.map((q) => <span key={q.q} className="bbq-c tnum">{q.h}</span>)}</div>
          <div className="bbq-row"><span className="bbq-team">{away}</span>{quarters.map((q) => <span key={q.q} className="bbq-c tnum">{q.a}</span>)}</div>
        </div>
      )}
      <div className="section-head"><h3>{t('live.keymoments')}</h3></div>
      <div className="card cm-feed">
        {feed.map((e) => (
          <div key={e.key} className="cm-line">
            <span className="cm-ico">{PLAY_ICON[e.type]}</span>
            <span className="cm-text">{t(`bbplay.${e.type}`)} · {e.side === 'home' ? home : away}</span>
          </div>
        ))}
      </div>
    </>
  );
}

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
    const id = setInterval(poll, 1400);   // basket skoru ince aralikli guncellensin (basketler tek tek gelsin)
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
          period={live?.period ?? null} phase={phase} matchId={matchId!} sport={match.sport} />
      ) : (
        <CourtTV home={match.home_team} away={match.away_team} hs={hs} as={as}
          period={live?.period ?? null} minute={live?.minute ?? 0} phase={phase} matchId={matchId!} />
      )}

      {phase !== 'upcoming' && matchId && match.sport === 'basketball' && (
        <CourtStats matchId={matchId} home={match.home_team} away={match.away_team} hs={hs} as={as} minute={live?.minute ?? 0} />
      )}
      {phase === 'live' && matchId && (match.sport === 'tennis' || match.sport === 'volleyball') && (
        <TennisPlays matchId={matchId} setIdx={hs + as} home={match.home_team} away={match.away_team} />
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

      {matchId && <FormStrip matchId={matchId} home={match.home_team} away={match.away_team} />}

      {matchId && <MatchChat matchId={matchId} />}

      <button className="btn btn-ghost btn-block" style={{ marginTop: 'var(--s3)' }} onClick={() => navigate(-1)}>{t('md.back')}</button>
    </div>
  );
}
