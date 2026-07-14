import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import MatchRow from '../components/MatchRow';
import { EFootballIcon, EBasketballIcon, ETennisIcon, EVolleyballIcon, BallIcon } from '../components/icons';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/LanguageContext';
import { countryFlag } from '../lib/countryFlag';
import { matchProvider } from '../lib/matchProvider';
import type { BulletinMatch } from '../lib/types';

const LIVE = new Set(['inprogress', 'live', 'penalties']);

type SportKey = 'live' | 'all' | 'football' | 'efootball' | 'basketball' | 'tennis' | 'volley';
const SPORTS: { key: SportKey | 'luck'; tkey: string; icon: string; soon?: boolean }[] = [
  { key: 'live', tkey: 'feed.tab.live', icon: '⚡' },
  { key: 'all', tkey: 'feed.tab.all', icon: '📋' },
  { key: 'football', tkey: 'feed.tab.football', icon: '⚽' },
  { key: 'efootball', tkey: 'feed.tab.efootball', icon: '' },
  { key: 'basketball', tkey: 'feed.tab.basketball', icon: '🏀' },
  { key: 'tennis', tkey: 'feed.tab.tennis', icon: '🎾' },
  { key: 'volley', tkey: 'feed.tab.volley', icon: '🏐' },
  { key: 'luck', tkey: 'feed.tab.luck', icon: '🎰' },
];

function Cols({ bb, tn, vb }: { bb?: boolean; tn?: boolean; vb?: boolean } = {}) {
  const { t } = useI18n();
  const M = <span className="lead">{t('feed.col.match')}</span>;
  const plus = <span className="ll-c-plus">+</span>;
  if (vb) return (
    <div className="ll-cols">{M}<span>1</span><span>2</span>
      <span className="ll-c-sec">{t('feed.col.over')}</span><span className="ll-c-sec">{t('feed.col.under')}</span>
      <span className="ll-c-sec">{t('feed.col.hnd')}</span><span className="ll-c-sec">{t('feed.col.hnd')}</span>{plus}
    </div>
  );
  if (tn) return (
    <div className="ll-cols">{M}<span>1</span><span>2</span>
      <span className="ll-c-sec">{t('feed.col.over')}</span><span className="ll-c-sec">{t('feed.col.under')}</span>
      <span className="ll-c-sec">{t('feed.col.set1')}</span><span className="ll-c-sec">{t('feed.col.set2')}</span>{plus}
    </div>
  );
  if (bb) return (
    <div className="ll-cols">{M}<span>1</span><span>2</span>
      <span className="ll-c-sec">{t('feed.col.hnd')}</span><span className="ll-c-sec">{t('feed.col.hnd')}</span>
      <span className="ll-c-sec">{t('feed.col.over')}</span><span className="ll-c-sec">{t('feed.col.under')}</span>{plus}
    </div>
  );
  return (
    <div className="ll-cols">{M}<span>1</span><span>X</span><span>2</span>
      <span className="ll-c-sec">{t('feed.col.under')}</span><span className="ll-c-sec">{t('feed.col.over')}</span><span className="ll-c-sec">{t('feed.col.btts')}</span>{plus}
    </div>
  );
}

// Two-level bulletin grouping (Nesine/bet365 style): country > league. We do NOT
// trust the backend's flow order -- get_bulletin returns by kickoff (sort_at), so
// the same league appears scattered. We CONSOLIDATE every match of a league into
// one group (find/merge) regardless of position, then sort deterministically:
//   countries A-Z, leagues A-Z, matches within a league by kickoff.
// Virtual matches (country null) collect under one "Simulated" bucket, pinned
// last, sorted by kickoff.
type LeagueGroup = { league: string; matches: BulletinMatch[] };
type CountryGroup = { country: string; count: number; leagues: LeagueGroup[] };
function groupMatches(list: BulletinMatch[]): { countries: CountryGroup[]; virtual: BulletinMatch[] } {
  const countries: CountryGroup[] = [];
  const virtual: BulletinMatch[] = [];
  for (const m of list) {
    // ONLY true virtual matches go to "Simulated". A real match with a missing
    // country (backend data gap) still groups as real -- under "Other" -- never
    // mislabelled as simulated.
    if (m.kind === 'virtual') { virtual.push(m); continue; }
    const cName = m.country ?? 'Other';
    const lName = m.league ?? 'Other';
    let cg = countries.find((c) => c.country === cName);
    if (!cg) { cg = { country: cName, count: 0, leagues: [] }; countries.push(cg); }
    cg.count++;
    let lg = cg.leagues.find((l) => l.league === lName);
    if (!lg) { lg = { league: lName, matches: [] }; cg.leagues.push(lg); }
    lg.matches.push(m);
  }
  const byKickoff = (a: BulletinMatch, b: BulletinMatch) => a.starts_at.localeCompare(b.starts_at);
  for (const cg of countries) {
    for (const lg of cg.leagues) lg.matches.sort(byKickoff);
    // busiest league first; alphabetical tiebreak keeps it deterministic
    cg.leagues.sort((a, b) => b.matches.length - a.matches.length || a.league.localeCompare(b.league));
  }
  countries.sort((a, b) => b.count - a.count || a.country.localeCompare(b.country));
  virtual.sort(byKickoff);
  return { countries, virtual };
}

export default function FeedScreen() {
  const { session } = useAuth();
  const { t } = useI18n();
  // Bugün/Yarın etiketi (Nesine esinli) — lig başlığında ilk maçın gününe göre.
  const dayLabel = (iso?: string): string => {
    if (!iso) return '';
    const d = new Date(iso), now = new Date();
    const diff = Math.round(
      (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
        - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
    return diff <= 0 ? t('feed.today') : diff === 1 ? t('feed.tomorrow') : d.toLocaleDateString();
  };
  const [matches, setMatches] = useState<BulletinMatch[]>([]);
  const [sport, setSport] = useState<SportKey>('all');
  const [luckOpen, setLuckOpen] = useState(false);   // Şans Oyunları sekmesi: Aviator/Gates seçici
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const poll = useCallback(async () => {
    try {
      const ms = await matchProvider.getBulletin();
      setMatches(ms);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the bulletin');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // slower loop advances the virtual world (finish/settle/seed); fast loop just
    // refreshes prices + scores.
    const advance = async () => {
      await matchProvider.finalizeDueMatches().catch(() => 0);
      await matchProvider.settleDueCoupons().catch(() => 0);
      await matchProvider.ensureMatches().catch(() => undefined);
    };
    void advance().then(poll);
    const world = setInterval(() => void advance().then(poll), 20000);
    const fast = setInterval(() => void poll(), 5000);
    return () => { clearInterval(world); clearInterval(fast); };
  }, [poll]);

  const notFinished = matches.filter((m) => m.status !== 'finished');
  const liveAll = notFinished.filter((m) => LIVE.has(m.status));
  const realOnes = notFinished.filter((m) => m.kind === 'real');
  const virtualOnes = notFinished.filter((m) => m.kind === 'virtual' && m.sport === 'football');
  const basketballOnes = notFinished.filter((m) => m.sport === 'basketball');
  const tennisOnes = notFinished.filter((m) => m.sport === 'tennis');
  const volleyOnes = notFinished.filter((m) => m.sport === 'volleyball');

  const spec = SPORTS.find((s) => s.key === sport);
  const set = sport === 'live' ? liveAll : sport === 'all' ? notFinished
    : sport === 'football' ? realOnes : sport === 'efootball' ? virtualOnes
    : sport === 'basketball' ? basketballOnes : sport === 'tennis' ? tennisOnes
    : sport === 'volley' ? volleyOnes : [];
  // Live stays a single flat section (few matches, cross-league). Upcoming keeps
  // the backend's country>league>sort_at order untouched so the grouping headers
  // fall in the right places -- no client re-sort.
  // Live: REAL live matches first, then virtual live matches; minute desc within each.
  const live = set.filter((m) => LIVE.has(m.status)).sort((a, b) => {
    const ak = a.kind === 'virtual' ? 1 : 0, bk = b.kind === 'virtual' ? 1 : 0;
    return ak - bk || (b.minute ?? 0) - (a.minute ?? 0);
  });
  const upcoming = set.filter((m) => !LIVE.has(m.status));
  const grouped = groupMatches(upcoming);

  const section = (title: string, right: ReactNode, list: BulletinMatch[], icon: ReactNode = <EFootballIcon size={19} />, cols: { bb?: boolean; tn?: boolean; vb?: boolean } = {}) => list.length > 0 && (
    <>
      <div className="ll-bar"><span className="ll-bar-l">{icon} {title}</span>{right}</div>
      <Cols {...cols} />
      {list.map((m) => <MatchRow key={m.id} m={m} hideLeague />)}
    </>
  );

  const liveCount = (n: number) => <span className="ll-bar-r"><span className="dot" />{t('feed.live', { n })}</span>;

  return (
    <div className="app-shell app-shell-wide">
      {!session && (
        <div className="landing-hero card">
          <h2>{t('landing.title')}</h2>
          <p>{t('landing.sub')}</p>
          <div className="row" style={{ gap: 'var(--s2)' }}>
            <Link to="/login" className="btn btn-primary">{t('feed.signup')}</Link>
            <Link to="/login" className="btn btn-ghost">{t('feed.login')}</Link>
          </div>
        </div>
      )}

      <div className="sport-bar">
        {SPORTS.map((s) => {
          const cnt = s.key === 'live' ? liveAll.length : s.key === 'all' ? notFinished.length
            : s.key === 'football' ? realOnes.length : s.key === 'efootball' ? virtualOnes.length
            : s.key === 'basketball' ? basketballOnes.length : s.key === 'tennis' ? tennisOnes.length
            : s.key === 'volley' ? volleyOnes.length : null;
          return (
            <button
              key={s.key}
              className={`sport-tab ${sport === s.key ? 'active' : ''} ${s.soon ? 'soon' : ''} ${s.key === 'luck' && luckOpen ? 'active' : ''}`}
              onClick={() => { if (s.key === 'luck') { setLuckOpen((o) => !o); } else { setLuckOpen(false); setSport(s.key as SportKey); } }}
            >
              {s.key === 'efootball' ? <EFootballIcon size={19} /> : s.key === 'basketball' ? <EBasketballIcon size={19} /> : s.key === 'tennis' ? <ETennisIcon size={19} /> : s.key === 'volley' ? <EVolleyballIcon size={19} /> : <span className="sport-ic">{s.icon}</span>}
              {t(s.tkey)}
              {s.soon ? <span className="soon-badge">{t('feed.soon')}</span> : cnt != null ? <span className="sport-cnt">{cnt}</span> : null}
            </button>
          );
        })}
      </div>
      {luckOpen && (
        <div className="luck-pop">
          <span className="luck-pop-t">{t('luck.choose')}</span>
          <button className="luck-opt" onClick={() => navigate('/aviator')}>✈️ Aviator</button>
          <button className="luck-opt" onClick={() => navigate('/gates')}>🏛️ Gates of</button>
        </div>
      )}

      <div className="std-link-row"><Link to="/standings" className="std-link">{t('feed.stdlink')}</Link></div>

      {error && <div className="banner banner-error">{error}</div>}

      {spec?.soon ? (
        <div className="empty"><p>{t('feed.comingsoon', { label: t(spec.tkey) })}</p></div>
      ) : loading ? (
        <div className="center-pad"><div className="spinner" /></div>
      ) : set.length === 0 ? (
        <div className="empty"><p>{sport === 'live' ? t('feed.nolive') : t('feed.noopen')}</p></div>
      ) : (
        <div className="ll">
          {section(`${t('feed.livePrefix')} · ${t('feed.sport.football')}`, liveCount(live.filter((m) => m.kind === 'real').length), live.filter((m) => m.kind === 'real'), <BallIcon size={18} />)}
          {section(`${t('feed.livePrefix')} · ${t('feed.sport.efootball')}`, liveCount(live.filter((m) => m.kind === 'virtual' && m.sport === 'football').length), live.filter((m) => m.kind === 'virtual' && m.sport === 'football'))}
          {section(`${t('feed.livePrefix')} · ${t('feed.sport.basketball')}`, liveCount(live.filter((m) => m.sport === 'basketball').length), live.filter((m) => m.sport === 'basketball'), <EBasketballIcon size={19} />, { bb: true })}
          {section(`${t('feed.livePrefix')} · ${t('feed.sport.tennis')}`, liveCount(live.filter((m) => m.sport === 'tennis').length), live.filter((m) => m.sport === 'tennis'), <ETennisIcon size={19} />, { tn: true })}
          {section(`${t('feed.livePrefix')} · ${t('feed.sport.volleyball')}`, liveCount(live.filter((m) => m.sport === 'volleyball').length), live.filter((m) => m.sport === 'volleyball'), <EVolleyballIcon size={19} />, { vb: true })}
          {sport !== 'live' && (
            <>
              {grouped.countries.map((cg) => (
                <div key={cg.country} className="ll-cgrp">
                  <div className="ll-country"><span>{countryFlag(cg.country) && <span className="ll-flag" aria-hidden>{countryFlag(cg.country)} </span>}{cg.country}</span><span className="ll-country-n">{cg.count}</span></div>
                  {cg.leagues.map((lg) => (
                    <div key={lg.league}>
                      <div className="ll-bar"><span className="ll-bar-l">{lg.league}</span><span className="ll-bar-r"><span className="ll-day">{dayLabel(lg.matches[0]?.starts_at)}</span>{lg.matches.length}</span></div>
                      <Cols />
                      {lg.matches.map((m) => <MatchRow key={m.id} m={m} hideLeague />)}
                    </div>
                  ))}
                </div>
              ))}
              {grouped.virtual.filter((m) => m.sport === 'football').length > 0 && (
                <div className="ll-cgrp">
                  <div className="ll-country"><span>{t('feed.simulated')}</span><span className="ll-country-n">{grouped.virtual.filter((m) => m.sport === 'football').length}</span></div>
                  <div className="ll-bar"><span className="ll-bar-l"><EFootballIcon size={19} /> E-Football · 2×4 min</span><span className="ll-bar-r">sim</span></div>
                  <Cols />
                  {grouped.virtual.filter((m) => m.sport === 'football').map((m) => <MatchRow key={m.id} m={m} hideLeague />)}
                </div>
              )}
              {(() => {
                const bb = grouped.virtual.filter((m) => m.sport === 'basketball');
                if (bb.length === 0) return null;
                const leagues = [...new Set(bb.map((m) => m.league || 'e-Basketball'))].sort();
                return (
                  <div className="ll-cgrp">
                    <div className="ll-country"><span className="ll-cty-l"><EBasketballIcon size={16} /> e-Basketball</span><span className="ll-country-n">{bb.length}</span></div>
                    {leagues.map((lg) => (
                      <div key={lg}>
                        <div className="ll-bar"><span className="ll-bar-l">{lg} · 4×2 min</span><span className="ll-bar-r">sim</span></div>
                        <Cols bb />
                        {bb.filter((m) => (m.league || 'e-Basketball') === lg).map((m) => <MatchRow key={m.id} m={m} hideLeague />)}
                      </div>
                    ))}
                  </div>
                );
              })()}
              {(() => {
                const tn = grouped.virtual.filter((m) => m.sport === 'tennis');
                if (tn.length === 0) return null;
                const leagues = [...new Set(tn.map((m) => m.league || 'e-Tennis'))].sort();
                return (
                  <div className="ll-cgrp">
                    <div className="ll-country"><span className="ll-cty-l"><ETennisIcon size={16} /> e-Tennis</span><span className="ll-country-n">{tn.length}</span></div>
                    {leagues.map((lg) => (
                      <div key={lg}>
                        <div className="ll-bar"><span className="ll-bar-l">{lg} · Best of 3</span><span className="ll-bar-r">sim</span></div>
                        <Cols tn />
                        {tn.filter((m) => (m.league || 'e-Tennis') === lg).map((m) => <MatchRow key={m.id} m={m} hideLeague />)}
                      </div>
                    ))}
                  </div>
                );
              })()}
              {(() => {
                const vb = grouped.virtual.filter((m) => m.sport === 'volleyball');
                if (vb.length === 0) return null;
                const leagues = [...new Set(vb.map((m) => m.league || 'e-Volleyball'))].sort();
                return (
                  <div className="ll-cgrp">
                    <div className="ll-country"><span className="ll-cty-l"><EVolleyballIcon size={16} /> e-Volleyball</span><span className="ll-country-n">{vb.length}</span></div>
                    {leagues.map((lg) => (
                      <div key={lg}>
                        <div className="ll-bar"><span className="ll-bar-l">{lg} · Best of 5</span><span className="ll-bar-r">sim</span></div>
                        <Cols vb />
                        {vb.filter((m) => (m.league || 'e-Volleyball') === lg).map((m) => <MatchRow key={m.id} m={m} hideLeague />)}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </>
          )}
        </div>
      )}
    </div>
  );
}
