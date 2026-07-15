import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useCart } from '../coupon/CartContext';
import { useI18n } from '../i18n/LanguageContext';
import { useSound } from '../settings/SoundContext';
import { LANGS, type Lang } from '../i18n/dict';
import { Brand } from './Brand';
import { MarketsIcon, CouponIcon, RanksIcon, SocialIcon, ProfileIcon, HomeIcon, AviatorIcon, GatesIcon, MirrorIcon, CoinIcon, SettingsIcon, SoundOnIcon, SoundOffIcon, DiceIcon, MinesIcon, PlinkoIcon } from './icons';

// Masaüstü kenar çubuğu: tüm hedefler (yer var).
const NAV = [
  { to: '/', end: true, key: 'nav.matches', Icon: MarketsIcon },
  { to: '/aviator', end: false, key: 'nav.aviator', Icon: AviatorIcon },
  { to: '/gates', end: false, key: 'nav.gates', Icon: GatesIcon },
  { to: '/coupons', end: false, key: 'nav.coupons', Icon: CouponIcon },
  { to: '/analiz', end: false, key: 'nav.mirror', Icon: MirrorIcon },
  { to: '/ranks', end: false, key: 'nav.ranks', Icon: RanksIcon },
  { to: '/social', end: false, key: 'nav.social', Icon: SocialIcon },
  { to: '/profile', end: false, key: 'nav.profile', Icon: ProfileIcon },
];

// Mobil alt bar: 5 birincil sekme (Nesine-tarzı) — "Oyunlar" bir sheet açar.
const TAB = [
  { to: '/', end: true, key: 'nav.matches', Icon: MarketsIcon },
  { to: '/coupons', end: false, key: 'nav.coupons', Icon: CouponIcon },
  { to: '/analiz', end: false, key: 'nav.mirror', Icon: MirrorIcon },
  { to: '/profile', end: false, key: 'nav.profile', Icon: ProfileIcon },
];
const GAMES = [
  { to: '/aviator', key: 'nav.aviator', Icon: AviatorIcon },
  { to: '/gates', key: 'nav.gates', Icon: GatesIcon },
  { to: '/mines', key: 'nav.mines', Icon: MinesIcon },
  { to: '/dice', key: 'nav.dice', Icon: DiceIcon },
  { to: '/plinko', key: 'nav.plinko', Icon: PlinkoIcon },
];

// Settings gear (between home and balance): language, sound on/off, sign out.
function SettingsMenu() {
  const { lang, setLang, t } = useI18n();
  const { enabled, toggle } = useSound();
  const { profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="settings-wrap" ref={ref}>
      <button className="settings-btn" aria-label={t('set.title')} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <SettingsIcon />
      </button>
      {open && (
        <div className="settings-menu" role="menu">
          <div className="settings-row">
            <span className="settings-lbl">{t('lang.label')}</span>
            <select className="lang-picker" value={lang} aria-label={t('lang.label')}
              onChange={(e) => setLang(e.target.value as Lang)}>
              {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </div>
          <div className="settings-row">
            <span className="settings-lbl">{t('set.sound')}</span>
            <button className={`sound-toggle ${enabled ? 'on' : 'off'}`} onClick={toggle} aria-pressed={enabled}>
              {enabled ? <SoundOnIcon /> : <SoundOffIcon />}
              <span>{enabled ? t('set.on') : t('set.off')}</span>
            </button>
          </div>
          {profile && (
            <button className="settings-signout" onClick={() => { setOpen(false); signOut(); }}>{t('set.signout')}</button>
          )}
        </div>
      )}
    </div>
  );
}

// Top-right balance: counts up on a win and floats a green "+amount" below it.
function BalanceChip({ balance }: { balance: number }) {
  const [display, setDisplay] = useState(balance);
  const [gain, setGain] = useState<number | null>(null);
  const prev = useRef(balance);

  useEffect(() => {
    const from = prev.current;
    const to = balance;
    prev.current = to;
    if (to <= from) { setDisplay(to); return; }   // bet placed / no change → snap
    setGain(to - from);
    const clr = window.setTimeout(() => setGain(null), 2600);
    let raf = 0;
    const start = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / 700);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(clr); };
  }, [balance]);

  // büyük bakiyeler dar ekranda topbar'ı sıkıştırmasın: 1M+ → 1.2M, 10K+ → 12.3K
  const compact = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`
    : n >= 100_000 ? `${Math.round(n / 1000)}K` : n.toLocaleString();
  return (
    <span className={`gold-chip ${gain != null ? 'is-gain' : ''}`} title={display.toLocaleString()}>
      <CoinIcon size={15} />
      <span className="tnum">{compact(display)}</span>
      {gain != null && <span className="gold-gain tnum">+{compact(gain)}</span>}
    </span>
  );
}

export default function NavBar() {
  const { profile } = useAuth();
  const { count } = useCart();
  const { t } = useI18n();
  const [gamesOpen, setGamesOpen] = useState(false);

  // icon + an active-selection count badge on the Coupons item
  const navIcon = (icon: ReactNode, to: string) => (
    <span className="nav-ic">
      {icon}
      {to === '/coupons' && count > 0 && <span className="nav-badge tnum">{count}</span>}
    </span>
  );

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Brand />
          <div className="topbar-right">
            <NavLink to="/" end className="home-btn" title="Home" aria-label="Home"><HomeIcon /></NavLink>
            <SettingsMenu />
            {profile ? (
              <BalanceChip balance={profile.gold_balance} />
            ) : (
              <nav className="top-auth">
                <Link to="/login" className="top-link">{t('feed.login')}</Link>
                <Link to="/login" className="btn btn-primary btn-sm">{t('feed.signup')}</Link>
              </nav>
            )}
          </div>
        </div>
      </header>

      {/* desktop sidebar */}
      <nav className="sidebar">
        {NAV.map(({ to, end, key, Icon }) => (
          <NavLink key={to} to={to} end={end} className="side-item">
            {navIcon(<Icon />, to)}
            {t(key)}
          </NavLink>
        ))}
      </nav>

      {/* mobile bottom bar — 5 primary tabs; "Oyunlar" opens a games sheet */}
      <nav className="tabbar">
        <div className="tabbar-inner">
          <NavLink to="/" end className="tab">{navIcon(<MarketsIcon />, '/')}{t('nav.matches')}</NavLink>
          <button className={`tab ${gamesOpen ? 'active' : ''}`} onClick={() => setGamesOpen((o) => !o)}>
            {navIcon(<GatesIcon />, '/games')}{t('nav.games')}
          </button>
          {TAB.slice(1).map(({ to, end, key, Icon }) => (
            <NavLink key={to} to={to} end={end} className="tab" onClick={() => setGamesOpen(false)}>
              {navIcon(<Icon />, to)}
              {t(key)}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* games sheet (mobile) */}
      {gamesOpen && (
        <>
          <div className="games-sheet-back" onClick={() => setGamesOpen(false)} />
          <div className="games-sheet" role="menu">
            {GAMES.map(({ to, key, Icon }) => (
              <NavLink key={to} to={to} className="games-sheet-item" onClick={() => setGamesOpen(false)}>
                <Icon />{t(key)}
              </NavLink>
            ))}
          </div>
        </>
      )}
    </>
  );
}
