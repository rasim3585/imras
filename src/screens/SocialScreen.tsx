import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { matchProvider } from '../lib/matchProvider';
import { useCart } from '../coupon/CartContext';
import type { League, Rival, SharedCoupon } from '../lib/types';
import { formatOdds } from '../lib/format';

type Tab = 'leagues' | 'rivals' | 'feed';
const fmtNet = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString()}`;

export default function SocialScreen() {
  const [tab, setTab] = useState<Tab>('leagues');
  return (
    <div className="app-shell">
      <div className="page-head"><h1>Social</h1><p className="page-sub">Leagues, rivals and shared coupons.</p></div>
      <div className="segmented">
        <button className={`segmented-item ${tab === 'leagues' ? 'active' : ''}`} onClick={() => setTab('leagues')}>Leagues</button>
        <button className={`segmented-item ${tab === 'rivals' ? 'active' : ''}`} onClick={() => setTab('rivals')}>Rivals</button>
        <button className={`segmented-item ${tab === 'feed' ? 'active' : ''}`} onClick={() => setTab('feed')}>Feed</button>
      </div>
      {tab === 'leagues' && <Leagues />}
      {tab === 'rivals' && <Rivals />}
      {tab === 'feed' && <Feed />}
    </div>
  );
}

function Leagues() {
  const navigate = useNavigate();
  const [leagues, setLeagues] = useState<League[]>([]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setLeagues(await matchProvider.getMyLeagues()); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load leagues'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create() {
    if (name.trim().length < 2) return;
    setBusy(true); setError(null);
    try { await matchProvider.createLeague(name.trim()); setName(''); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not create'); }
    finally { setBusy(false); }
  }
  async function join() {
    if (!code.trim()) return;
    setBusy(true); setError(null);
    try { await matchProvider.joinLeague(code.trim()); setCode(''); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not join'); }
    finally { setBusy(false); }
  }

  return (
    <>
      {error && <div className="banner banner-error">{error}</div>}
      <div className="card" style={{ padding: 'var(--s4)' }}>
        <div className="field"><label>Create a league</label>
          <div className="row"><input className="input" placeholder="League name" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn btn-primary" disabled={busy} onClick={create}>Create</button></div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}><label>Join with an invite code</label>
          <div className="row"><input className="input mono" placeholder="code" value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="btn" disabled={busy} onClick={join}>Join</button></div>
        </div>
      </div>

      {leagues.length === 0 ? (
        <div className="empty" style={{ marginTop: 'var(--s3)' }}><p>You are not in any league yet.</p></div>
      ) : (
        <div className="coupon-list" style={{ marginTop: 'var(--s3)' }}>
          {leagues.map((l) => (
            <button key={l.id} className="card coupon-card trow-btn" style={{ textAlign: 'left' }} onClick={() => navigate(`/league/${l.id}`)}>
              <div className="spread">
                <div className="stack" style={{ gap: 2 }}>
                  <span style={{ fontWeight: 600 }}>{l.name}{l.is_owner ? <span className="chip chip-accent" style={{ marginLeft: 8 }}>Owner</span> : null}</span>
                  <span className="dim" style={{ fontSize: '0.8rem' }}>{l.members} member{l.members === 1 ? '' : 's'} · code <span className="mono">{l.invite_code}</span></span>
                </div>
                <span className="dim">›</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function Rivals() {
  const [rivals, setRivals] = useState<Rival[]>([]);
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setRivals(await matchProvider.getRivals()); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load rivals'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function add() {
    if (!username.trim()) return;
    setBusy(true); setError(null);
    try { await matchProvider.addRival(username.trim()); setUsername(''); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not add rival'); }
    finally { setBusy(false); }
  }
  async function remove(u: string) { try { await matchProvider.removeRival(u); await load(); } catch { /* ignore */ } }

  return (
    <>
      {error && <div className="banner banner-error">{error}</div>}
      <div className="card" style={{ padding: 'var(--s4)' }}>
        <div className="field" style={{ marginBottom: 0 }}><label>Challenge a rival (username)</label>
          <div className="row"><input className="input" placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} />
            <button className="btn btn-primary" disabled={busy} onClick={add}>Add</button></div>
        </div>
      </div>

      {rivals.length === 0 ? (
        <div className="empty" style={{ marginTop: 'var(--s3)' }}><p>No rivals yet. Add a friend's username to start a head-to-head.</p></div>
      ) : (
        <div className="coupon-list" style={{ marginTop: 'var(--s3)' }}>
          {rivals.map((r) => (
            <div key={r.username} className="card" style={{ padding: 'var(--s4)' }}>
              <div className="spread">
                <span style={{ fontWeight: 600 }}>You vs {r.username}</span>
                <span className={`chip ${r.leader === 'me' ? 'chip-pos' : r.leader === 'them' ? 'chip-neg' : ''}`}>
                  {r.h2h_me}-{r.h2h_them} {r.leader === 'me' ? 'ahead' : r.leader === 'them' ? 'behind' : 'level'}
                </span>
              </div>
              <div className="row" style={{ justifyContent: 'space-between', marginTop: 'var(--s3)', fontSize: '0.85rem' }}>
                <span className="muted">Wins <b className="tnum" style={{ color: 'var(--text)' }}>{r.my_won}</b> vs <b className="tnum" style={{ color: 'var(--text)' }}>{r.their_won}</b></span>
                <span className="muted">This week <b className="tnum" style={{ color: 'var(--text)' }}>{fmtNet(r.my_net)}</b> vs <b className="tnum" style={{ color: 'var(--text)' }}>{fmtNet(r.their_net)}</b></span>
              </div>
              <button className="btn btn-ghost btn-sm btn-block" style={{ marginTop: 'var(--s3)' }} onClick={() => remove(r.username)}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Feed() {
  const navigate = useNavigate();
  const { select, clear } = useCart();
  const [feed, setFeed] = useState<SharedCoupon[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try { setFeed(await matchProvider.getSharedFeed()); }
      catch (err) { setError(err instanceof Error ? err.message : 'Could not load the feed'); }
    })();
  }, []);

  function copy(c: SharedCoupon) {
    clear();
    for (const leg of c.legs) {
      select({
        option_id: leg.option_id, match_id: leg.match_id, home_team: leg.home_team, away_team: leg.away_team,
        market_name: leg.market_name, option_label: leg.option_label, odds: leg.odds,
      });
    }
    navigate('/coupon');
  }

  return (
    <>
      {error && <div className="banner banner-error">{error}</div>}
      {feed.length === 0 ? (
        <div className="empty" style={{ marginTop: 'var(--s3)' }}><p>No shared coupons yet. Share one from My Coupons.</p></div>
      ) : (
        <div className="coupon-list" style={{ marginTop: 'var(--s3)' }}>
          {feed.map((c) => (
            <div key={c.coupon_id} className="card coupon-card">
              <div className="coupon-card-head">
                <span className="tag">{c.username} · {c.legs.length === 1 ? 'Single' : `${c.legs.length}-fold`}</span>
                <span className={`chip ${c.status === 'won' ? 'chip-pos' : c.status === 'lost' ? 'chip-neg' : ''}`}>
                  {c.status === 'won' ? `Won +${c.potential_win}` : c.status === 'lost' ? 'Lost' : c.status === 'cashed_out' ? 'Cashed out' : 'Open'}
                </span>
              </div>
              <div className="coupon-legs">
                {c.legs.map((s) => (
                  <div key={s.option_id} className="coupon-leg">
                    <span className="leg-match">{s.home_team} vs {s.away_team}</span>
                    <span className="leg-pick tnum"><span className="muted">{s.market_name}:</span> {s.option_label} @ {formatOdds(s.odds)}</span>
                  </div>
                ))}
              </div>
              <div className="coupon-card-foot">
                <div className="coupon-foot-metrics"><span><span className="muted">Odds</span> <b className="tnum">{formatOdds(c.total_odds)}</b></span></div>
                <button className="btn btn-primary btn-sm" onClick={() => copy(c)}>Copy to slip</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
