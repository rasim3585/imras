import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { matchProvider } from '../lib/matchProvider';
import { useI18n } from '../i18n/LanguageContext';
import type { Challenge, Coupon } from '../lib/types';
import { accuracyPct, formatOdds } from '../lib/format';
import { SurveyEditor } from '../analiz/MirrorPlus';

function isBonusAvailable(last: string | null): boolean {
  if (!last) return true;
  const d = new Date(last);
  const now = new Date();
  return (
    d.getFullYear() !== now.getFullYear() ||
    d.getMonth() !== now.getMonth() ||
    d.getDate() !== now.getDate()
  );
}

export default function ProfileScreen() {
  const { profile, refreshProfile } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [exact, setExact] = useState<{ played: number; settled: number; won: number; biggest: number } | null>(null);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadChallenges = useCallback(async () => {
    try { setChallenges(await matchProvider.getChallenges()); } catch { /* optional */ }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setCoupons(await matchProvider.getMyCoupons());
        matchProvider.getCouponStats().then(setExact).catch(() => {});
        await loadChallenges();
      } catch (err) {
        setError(err instanceof Error ? err.message : t('pr.err.load'));
      } finally {
        setLoading(false);
      }
    })();
  }, [loadChallenges]);

  async function claimChallenge(key: string) {
    setBusy(true);
    try { await matchProvider.claimChallenge(key); await refreshProfile(); await loadChallenges(); }
    catch (err) { setError(err instanceof Error ? err.message : t('pr.err.claim')); }
    finally { setBusy(false); }
  }

  const stats = useMemo(() => {
    const settled = coupons.filter((c) => c.status !== 'pending');
    const won = settled.filter((c) => c.status === 'won');
    const biggest = won.reduce((m, c) => Math.max(m, c.potential_win), 0);
    // pick-level accuracy across all graded legs
    let legTotal = 0, legHit = 0;
    for (const c of coupons)
      for (const s of c.legs)
        if (s.status !== 'pending') { legTotal++; if (s.status === 'won') legHit++; }
    // liste son 200 ile sınırlı — sayıların KESİNİ sunucu sayımından (exact);
    // isabet oranı orandır, son 200 bacak üzerinden sağlıklı.
    return {
      played: exact?.played ?? coupons.length,
      settled: exact?.settled ?? settled.length,
      won: exact?.won ?? won.length,
      biggest: Math.max(exact?.biggest ?? 0, biggest),
      accuracy: accuracyPct(legHit, legTotal),
    };
  }, [coupons, exact]);

  const balance = profile?.gold_balance ?? 0;
  const bonusReady = isBonusAvailable(profile?.last_daily_bonus_at ?? null);
  const canTopup = balance < 100;

  async function claimBonus() {
    setBusy(true);
    try { await matchProvider.claimDailyBonus(); await refreshProfile(); }
    catch (err) { setError(err instanceof Error ? err.message : t('pr.err.bonus')); }
    finally { setBusy(false); }
  }
  async function topup() {
    setBusy(true);
    try { await matchProvider.topupGold(); await refreshProfile(); }
    catch (err) { setError(err instanceof Error ? err.message : t('pr.err.topup')); }
    finally { setBusy(false); }
  }

  return (
    <div className="app-shell">
      <div className="page-head">
        <h1>{profile?.username ?? '—'}</h1>
        <p className="page-sub">{t('pr.sub')}</p>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {/* Mobilde alt bardan kaldırılan hedefler burada erişilebilir kalır */}
      <div className="pr-quicklinks">
        <button className="pr-qlink" onClick={() => navigate('/ranks')}>🏆 {t('nav.ranks')}</button>
        <button className="pr-qlink" onClick={() => navigate('/social')}>👥 {t('nav.social')}</button>
      </div>

      <div className="card gold-panel">
        <div className="gold-main">
          <span className="stat-k">{t('pr.gold')}</span>
          <span className="gold-value tnum">{balance.toLocaleString()}</span>
        </div>
        <div className="gold-actions">
          {bonusReady && (
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={claimBonus}>
              {t('pr.claimbonus')}
            </button>
          )}
          {canTopup && (
            <button className="btn btn-sm" disabled={busy} onClick={topup}>
              {t('pr.topup')}
            </button>
          )}
          {!bonusReady && !canTopup && (
            <span className="dim" style={{ fontSize: '0.82rem' }}>{t('pr.bonusclaimed')}</span>
          )}
        </div>
      </div>

      <div className="stat-grid" style={{ marginTop: 'var(--s2)' }}>
        <div className="stat">
          <span className="stat-k">{t('pr.winstreak')}</span>
          <span className={`stat-v tnum ${(profile?.current_streak ?? 0) > 0 ? 'pos' : ''}`}>
            {profile?.current_streak ?? 0}{(profile?.current_streak ?? 0) > 0 ? ' \u{1F525}' : ''}
          </span>
        </div>
        <div className="stat">
          <span className="stat-k">{t('pr.beststreak')}</span>
          <span className="stat-v tnum">{profile?.best_streak ?? 0}</span>
        </div>
        <div className="stat">
          <span className="stat-k">{t('pr.accuracy')}</span>
          <span className="stat-v tnum">{stats.accuracy}%</span>
        </div>
        <div className="stat">
          <span className="stat-k">{t('pr.couponswon')}</span>
          <span className="stat-v tnum">{stats.won}</span>
        </div>
        <div className="stat">
          <span className="stat-k">{t('pr.couponsplayed')}</span>
          <span className="stat-v tnum">{stats.played}</span>
        </div>
        <div className="stat">
          <span className="stat-k">{t('pr.biggestwin')}</span>
          <span className="stat-v tnum pos">{stats.biggest.toLocaleString()}</span>
        </div>
      </div>

      <div className="section-head"><h3>{t('pr.challenges')}</h3></div>
      <div className="card dna">
        {challenges.map((ch) => {
          const done = ch.progress >= ch.target;
          return (
            <div key={ch.key} className="dna-row">
              <div className="dna-top">
                <span className="name">{ch.label}</span>
                {ch.claimed ? (
                  <span className="chip chip-pos">{t('pr.claimed')}</span>
                ) : done ? (
                  <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => claimChallenge(ch.key)}>+{ch.reward}</button>
                ) : (
                  <span className="val tnum">{ch.progress}/{ch.target} · +{ch.reward}</span>
                )}
              </div>
              <div className="dna-track"><div className="dna-fill" style={{ width: `${Math.min(100, (ch.progress / ch.target) * 100)}%` }} /></div>
            </div>
          );
        })}
      </div>

      <div className="section-head"><h3>🪞 {t('svy.edit.title')}</h3></div>
      <SurveyEditor />

      <div className="section-head"><h3>{t('pr.recent')}</h3></div>
      {loading ? (
        <div className="center-pad"><div className="spinner" /></div>
      ) : coupons.length === 0 ? (
        <div className="empty">
          <p>{t('pr.nocoupons')}</p>
          <button className="btn" onClick={() => navigate('/')}>{t('mc.gotomarkets')}</button>
        </div>
      ) : (
        <div className="table">
          {coupons.slice(0, 12).map((c) => (
            <button
              key={c.id}
              className="trow trow-btn"
              onClick={() => navigate(c.status === 'pending' ? `/settle/${c.id}` : '/coupons')}
            >
              <div className="trow-main">
                <div className="trow-match">
                  {c.legs.length === 1 ? t('mc.single') : t('mc.fold', { n: c.legs.length })} · {c.stake} {t('unit.gold')}
                </div>
                <div className="trow-sub">@ {formatOdds(c.total_odds)} · {t('pr.towin', { p: c.potential_win })}</div>
              </div>
              <div className="trow-right">
                {c.status === 'won' ? (
                  <span className="chip chip-pos tnum">+{c.potential_win - c.stake}</span>
                ) : c.status === 'lost' ? (
                  <span className="chip chip-neg">{t('mc.st.lost')}</span>
                ) : c.status === 'cashed_out' ? (
                  <span className="chip chip-accent tnum">{t('pr.cashed', { a: c.cashout_amount ?? 0 })}</span>
                ) : (
                  <span className="chip chip-accent">{t('mc.st.open')}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
