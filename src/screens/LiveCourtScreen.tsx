import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { matchProvider } from '../lib/matchProvider';
import { useI18n } from '../i18n/LanguageContext';
import CourtTV from '../live/CourtTV';
import TennisTV from '../live/TennisTV';
import MatchChat from '../live/ChatPanel';
import FormStrip from '../live/FormStrip';
import { courtStats, courtFeed, BB_TOTAL, type PlayType } from '../live/courtSim';
import { tennisFeed, setClockSec, seedSetClock, periodPoints, type TPlay, type CourtSport } from '../live/tennisSim';
import { supabase } from '../lib/supabase';
import type { LiveState, Match } from '../lib/types';

interface Quarter { q: number; h: number; a: number }

const TPLAY_ICON: Record<TPlay, string> = { ace: '🎾', winner: '🔥', error: '❌', rally: '↔' };

// Tennis / volleyball point feed below the court — the SAME rally list and the
// SAME set clock as the ball animation (a feed line lands the moment the ball
// lies dead on that point).
function TennisPlays({ matchId, setIdx, sport, home, away, period }: { matchId: string; setIdx: number; sport: CourtSport; home: string; away: string; period: string | null }) {
  const { t } = useI18n();
  const [, force] = useState(0);
  useEffect(() => { const id = setInterval(() => force((n) => n + 1), 1200); return () => clearInterval(id); }, []);
  // sete ortadan katılım: TennisPlays çoğu kez saati İLK yaratan taraf —
  // TennisTV ile aynı tohumlama (idempotent) burada da şart
  seedSetClock(matchId, setIdx, sport, periodPoints(period));
  const feed = tennisFeed(matchId, setIdx, sport, setClockSec(matchId, setIdx)).slice(-10).reverse();
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

const PLAY_ICON: Record<PlayType, string> = { miss: '🧱', steal: '🖐', foul: '⚠', block: '🛡' };

// Basketball stat strip + play feed below the court — the SAME possession sim
// and the SAME match clock as the ball (courtSim), so a "steal" line lands
// exactly while the ball is held on the steal spot.
function CourtStats({ matchId, home, away, hs, as, dur, getClock }: {
  matchId: string; home: string; away: string; hs: number; as: number; dur: number; getClock: () => number;
}) {
  const { t } = useI18n();
  const [, force] = useState(0);
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  useEffect(() => { const id = setInterval(() => force((n) => n + 1), 1200); return () => clearInterval(id); }, []);
  // çeyrek skorları (yalnız tamamlanan çeyrekler; server sızıntı yapmıyor)
  useEffect(() => {
    let alive = true;
    const load = () => supabase.rpc('bball_quarters', { p_match_id: matchId }).then(({ data }) => { if (alive && Array.isArray(data)) setQuarters(data as Quarter[]); });
    load(); const id = setInterval(load, 8000);
    return () => { alive = false; clearInterval(id); };
  }, [matchId]);
  const clock = getClock();
  const s = courtStats(matchId, clock, dur, hs, as);
  const feed = courtFeed(matchId, clock, dur).slice(-10).reverse();
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
        {feed.length === 0 && <div className="cm-line"><span className="cm-text muted">{t('live.playersout')}</span></div>}
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

// Basketbol/tenis/voleybol 2D canlı izleme ekranı. Maçı + canlı skoru çeker,
// CourtTV/TennisTV'yi besler. Basketbolda futboldaki gibi TEK monoton maç saati
// kurulur (sunucu dakikasına çıpalı, testere-dişsiz) — top, rozet, feed ve
// istatistik hep o saatten okur.
export default function LiveCourtScreen() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [match, setMatch] = useState<Match | null>(null);
  const [live, setLive] = useState<LiveState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // basketbol animasyon saati: bir kez çıpala, yalnız büyük kaymada düzelt
  // (sunucu dakikası tam sayı — her poll'de yeniden çıpalamak testere dişi yapar)
  const bbAnchor = useRef<{ sim: number; at: number; rate: number } | null>(null);
  const getBBClock = useRef(() => {
    const a = bbAnchor.current;
    if (!a) return 0;
    return Math.max(0, Math.min(BB_TOTAL, a.sim + ((Date.now() - a.at) / 1000) * a.rate));
  }).current;

  useEffect(() => {
    if (!matchId) return;
    let alive = true;
    setMatch(null); setLive(null); setError(null); bbAnchor.current = null;
    matchProvider.getMatch(matchId)
      .then((m) => { if (alive) setMatch(m); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : t('md.err.load')); });
    let inFlight = false;   // poll koruması: yavaş DB'de istekler üst üste binmesin
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const [s] = await matchProvider.getLiveStates([matchId]);
        if (!alive || !s) return;
        setLive(s);
        if (s.phase === 'live') {
          const now = Date.now();
          const rate = BB_TOTAL / (s.duration_secs > 0 ? s.duration_secs : 480);
          const serverSim = s.minute * 60;
          const a = bbAnchor.current;
          const cur = a ? a.sim + ((now - a.at) / 1000) * a.rate : -1;
          if (!a || Math.abs(serverSim - cur) > 90) bbAnchor.current = { sim: serverSim, at: now, rate };
        } else if (s.phase === 'upcoming') {
          bbAnchor.current = null;
        }
      } catch { /* transient */ } finally { inFlight = false; }
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
  if (!match || match.id !== matchId) return <div className="settle"><div className="spinner" /><p className="settle-note">{t('live.connecting')}</p></div>;

  // BAYAT STATE KORUMASI: rota değişiminin tek commit'lik penceresinde eski
  // maçın live snapshot'ı yeni matchId ile TV'lere gidip modül-seviyesi saat
  // çıpalarını zehirleyemez (gecikmeli patlayan anchor sızıntısı — denetim B1)
  const lv = live && live.match_id === matchId ? live : null;
  const phase = lv?.phase === 'live' ? 'live' : lv?.phase === 'finished' ? 'finished' : 'upcoming';
  const hs = lv?.home_score ?? 0;
  const as = lv?.away_score ?? 0;
  const dur = lv?.duration_secs ?? 480;

  // kazanma olasılığı — canlıda CANLI oranlardan (statik market satırları
  // canlıda repriselenmiyor; bar oran butonlarıyla çelişiyordu)
  const rm = match.markets.find((mk) => mk.market_type.endsWith('moneyline') || mk.market_type === 'match_result');
  const oddByLabel = (l: string) => rm?.options.find((o) => o.label === l)?.odds ?? null;
  const lo = phase === 'live' ? lv?.live_odds : null;
  const hO = (lo ? (lo.ml_home ?? lo.home) : null) ?? oddByLabel('1');
  const aO = (lo ? (lo.ml_away ?? lo.away) : null) ?? oddByLabel('2');
  const ph = hO ? 1 / hO : 0; const pa = aO ? 1 / aO : 0;
  const homePct = ph + pa > 0 ? Math.round((100 * ph) / (ph + pa)) : 50;

  return (
    <div className="app-shell live-screen">
      <button className="detail-back" onClick={() => navigate(-1)}>&lsaquo; {t('md.bulletin')}</button>

      {match.sport === 'tennis' || match.sport === 'volleyball' ? (
        <TennisTV home={match.home_team} away={match.away_team} hs={hs} as={as}
          period={lv?.period ?? null} phase={phase} matchId={matchId!} sport={match.sport} />
      ) : (
        <CourtTV home={match.home_team} away={match.away_team} hs={hs} as={as}
          period={lv?.period ?? null} minute={lv?.minute ?? 0} phase={phase} matchId={matchId!}
          dur={dur} getClock={getBBClock} />
      )}

      {phase !== 'upcoming' && matchId && match.sport === 'basketball' && (
        <CourtStats matchId={matchId} home={match.home_team} away={match.away_team} hs={hs} as={as}
          dur={dur} getClock={phase === 'finished' ? () => BB_TOTAL : getBBClock} />
      )}
      {phase === 'live' && matchId && (match.sport === 'tennis' || match.sport === 'volleyball') && (
        <TennisPlays matchId={matchId} setIdx={hs + as} sport={match.sport} home={match.home_team} away={match.away_team} period={lv?.period ?? null} />
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
