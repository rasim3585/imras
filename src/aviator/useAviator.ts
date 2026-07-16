import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { logEvent } from '../lib/behaviorLog';
import {
  type AviatorRound, type AviatorConfig, type AviatorBet, type AviatorPlayer,
  DEFAULT_CONFIG, GROWTH,
  fetchCurrentRound, fetchConfig, fetchHistory, fetchRoundBets, placeBet, cashout,
} from '../lib/aviator';

// Anchor for the live multiplier. The curve tracks the TRUE server clock:
// t = (Date.now() - flyingAtMs - clockOffset) / 1000. `clockOffset` is the
// min-calibrated client<->server skew (see useAviator), so the curve is INDEPENDENT
// of any single flying-event's arrival latency -- a late flying event no longer
// makes the curve lag (undershoot) nor a fast one make it lead (overshoot). At the
// prompt crash broadcast the curve is ~exactly the crash point.
export interface FlightAnchor { flyingAtMs: number; clockOffset: number }

// One rAF-driven live multiplier, isolated in leaf components (the big display +
// each cashout button) so the whole screen does NOT re-render 60fps. On 'crashed'
// it freezes at the revealed crash point (never snaps to 1.00 mid-reveal).
export function useLiveMultiplier(
  phase: AviatorRound['status'] | undefined, anchor: FlightAnchor | null,
  frozen: number | null, cap: number,
): number {
  const [m, setM] = useState(1);
  useEffect(() => {
    if (phase === 'flying' && anchor) {
      let raf = 0;
      const tick = () => {
        const t = (Date.now() - anchor.flyingAtMs - anchor.clockOffset) / 1000;
        setM(Math.min(cap, Math.exp(GROWTH * Math.max(0, t))));
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }
    if (phase === 'crashed') { if (frozen != null) setM(frozen); return; }
    setM(1);
  }, [phase, anchor, frozen, cap]);
  return m;
}

type MyBets = Record<number, AviatorBet | undefined>;

export interface AviatorState {
  round: AviatorRound | null;
  phase: AviatorRound['status'] | undefined;
  crashPoint: number | null;         // only when crashed -- NEVER during flight
  flightAnchor: FlightAnchor | null;
  bettingEndsAtMs: number | null;
  config: AviatorConfig;
  history: AviatorRound[];
  myBets: MyBets;
  players: AviatorPlayer[];
  place: (slot: 1 | 2, stake: number, auto: number | null) => Promise<void>;
  cashOut: (slot: 1 | 2, clientMultiplier: number) => Promise<void>;
}

export function useAviator(): AviatorState {
  const { session, refreshProfile } = useAuth();
  const [round, setRound] = useState<AviatorRound | null>(null);
  const [config, setConfig] = useState<AviatorConfig>(DEFAULT_CONFIG);
  const [history, setHistory] = useState<AviatorRound[]>([]);
  const [myBets, setMyBets] = useState<MyBets>({});
  const [players, setPlayers] = useState<AviatorPlayer[]>([]);
  const [flightAnchor, setFlightAnchor] = useState<FlightAnchor | null>(null);

  const prevRound = useRef<AviatorRound | null>(null);
  const anchoredRound = useRef<string | null>(null);   // set the anchor once per round
  // min over rounds of (clientNow - flying_at) at flight observation ~= client-server
  // skew (+ minimal latency). MIN is robust to per-round latency spikes: one slow
  // flying event no longer drags the curve. Only ever decreases toward the truth.
  const clockOffset = useRef(Number.POSITIVE_INFINITY);
  const pendingCrash = useRef<Record<string, number>>({});   // crash that raced ahead of its flying event
  const refreshRef = useRef(refreshProfile);
  refreshRef.current = refreshProfile;
  const uidRef = useRef<string | undefined>(session?.user?.id);
  uidRef.current = session?.user?.id;

  const playersTimer = useRef<number | null>(null);
  const reloadPlayers = useCallback((roundId: string | number) => {
    if (playersTimer.current) window.clearTimeout(playersTimer.current);
    playersTimer.current = window.setTimeout(() => {
      fetchRoundBets(roundId).then(setPlayers).catch(() => { /* cosmetic */ });
    }, 250);
  }, []);

  const applyRound = useCallback((raw: AviatorRound) => {
    // DEFENCE IN DEPTH: strip crash_point from client state until crashed.
    const r: AviatorRound = raw.status === 'crashed' ? raw : { ...raw, crash_point: null };
    const prev = prevRound.current;
    const isNew = !prev || String(prev.id) !== String(r.id);
    prevRound.current = r;
    setRound(r);
    if (isNew) { setMyBets({}); setPlayers([]); reloadPlayers(r.id); }

    // Calibrate the clock offset from every flying observation (running min).
    if (r.status === 'flying' && r.flying_at) {
      const cand = Date.now() - Date.parse(r.flying_at);
      if (cand < clockOffset.current) clockOffset.current = cand;
    }

    // Flight anchor: bind to the SERVER flight start (flying_at) + calibrated
    // offset, so the curve tracks true server time regardless of when this round's
    // flying event happened to arrive. Set once per round.
    if (r.status === 'flying' && r.flying_at && anchoredRound.current !== String(r.id)) {
      anchoredRound.current = String(r.id);
      const offset = Number.isFinite(clockOffset.current) ? clockOffset.current : 0;
      setFlightAnchor({ flyingAtMs: Date.parse(r.flying_at), clockOffset: offset });
    } else if (r.status !== 'flying') {
      setFlightAnchor(null);   // betting resets; crashed reads the frozen value
    }

    // a crash broadcast that RACED ahead of this flying event (fast/instacrash) ->
    // apply it now so the curve freezes immediately instead of waiting on the row.
    if (r.status === 'flying') {
      const pc = pendingCrash.current[String(r.id)];
      if (pc != null) {
        delete pendingCrash.current[String(r.id)];
        applyRound({ ...r, status: 'crashed', crash_point: pc });
        return;
      }
    }

    const justCrashed = r.status === 'crashed'
      && !(prev && String(prev.id) === String(r.id) && prev.status === 'crashed');
    if (justCrashed) {
      setHistory((h) => [r, ...h.filter((x) => String(x.id) !== String(r.id))].slice(0, 12));
      refreshRef.current();
      reloadPlayers(r.id);
    }
  }, [reloadPlayers]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Offline'da realtime de ölüdür — "realtime nasılsa yakalar" varsayımı
    // sonsuz "Connecting" bırakıyordu. İlk yükleme başarısızsa 5sn'de bir
    // yeniden dene (başarınca durur; realtime oradan devralır).
    const load = async () => {
      try {
        const [r, c, h] = await Promise.all([fetchCurrentRound(), fetchConfig(), fetchHistory()]);
        if (!alive) return;
        if (c) setConfig(c);
        setHistory(h);
        if (r) applyRound(r);
      } catch {
        if (alive) timer = setTimeout(load, 5000);
      }
    };
    void load();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [applyRound]);

  useEffect(() => {
    const ch = supabase.channel('aviator')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'aviator_rounds' }, (p) => {
        const r = p.new as AviatorRound | undefined;
        if (r && r.id != null) applyRound(r);
      })
      // LOW-LATENCY crash: a broadcast fired by the backend AT the crash instant
      // freezes the curve immediately, ahead of the ~780ms-late postgres_changes
      // 'crashed' row event -- this is what kills the overshoot. Safe: it arrives
      // AT crash (crash_point is no longer secret then), and cashout is already
      // closed. No-op until the backend sends it; the row event stays a fallback.
      .on('broadcast', { event: 'crash' }, (msg) => {
        const pl = (msg as { payload?: { round_id?: string | number; crash_point?: number } }).payload;
        if (!pl || typeof pl.crash_point !== 'number' || pl.round_id == null) return;
        const cur = prevRound.current;
        if (cur && String(pl.round_id) === String(cur.id)) {
          if (cur.status !== 'crashed') applyRound({ ...cur, status: 'crashed', crash_point: pl.crash_point });
        } else {
          // arrived before we processed this round's flying event -> buffer, applied on flying
          pendingCrash.current[String(pl.round_id)] = pl.crash_point;
        }
      })
      // LOW-LATENCY takeoff: fired by the backend AT betting->flying, ~780ms ahead
      // of the postgres_changes 'flying' row. Carries flying_at so the flight anchor
      // is set precisely -> the curve starts right on "Kalkış!", no startup lag.
      .on('broadcast', { event: 'takeoff' }, (msg) => {
        const pl = (msg as { payload?: { round_id?: string | number; flying_at?: string } }).payload;
        if (!pl || pl.round_id == null || !pl.flying_at) return;
        const cur = prevRound.current;
        if (cur && String(pl.round_id) === String(cur.id) && cur.status === 'betting') {
          applyRound({ ...cur, status: 'flying', flying_at: pl.flying_at });
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'aviator_bets' }, (p) => {
        const b = (p.new ?? p.old) as AviatorBet | undefined;
        if (!b) return;
        if (String(b.round_id) === String(prevRound.current?.id)) reloadPlayers(b.round_id);
        if (b.user_id && b.user_id === uidRef.current
          && String(b.round_id) === String(prevRound.current?.id)) {
          setMyBets((m) => ({ ...m, [b.slot]: b }));
          if (b.status === 'won') refreshRef.current();
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [applyRound, reloadPlayers, session?.user?.id]);

  const place = useCallback(async (slot: 1 | 2, stake: number, auto: number | null) => {
    const res = await placeBet(stake, slot, auto);
    // Risk psychology at commit: stake size and whether they PRE-SET an auto-cashout
    // (discipline) vs. left it manual (live greed). round_id ties it to the outcome.
    logEvent('aviator', 'bet_placed',
      { slot, stake, auto_cashout_at: auto, has_auto: auto != null },
      { round_id: prevRound.current?.id ?? null });
    setMyBets((m) => ({
      ...m,
      [slot]: {
        id: res.bet_id, round_id: prevRound.current?.id ?? '', user_id: uidRef.current ?? '',
        slot, stake, auto_cashout_at: auto, status: 'placed', cashout_multiplier: null, payout: null,
      },
    }));
    refreshRef.current();
  }, []);

  const cashOut = useCallback(async (slot: 1 | 2, clientMultiplier: number) => {
    // THE cleanest risk signal: the multiplier the user chose to pull out at.
    // clientMultiplier = what they SAW when they tapped (their decision point);
    // res.multiplier = what the server paid. Gap between them = reflex/latency.
    logEvent('aviator', 'cashout',
      { seen_multiplier: Number(clientMultiplier.toFixed(2)), slot, was_auto: false },
      { round_id: prevRound.current?.id ?? null });
    const res = await cashout(slot, clientMultiplier);
    setMyBets((m) => {
      const b = m[slot];
      if (!b) return m;
      return { ...m, [slot]: { ...b, status: 'won', cashout_multiplier: res.multiplier, payout: res.payout } };
    });
    refreshRef.current();
  }, []);

  const crashPoint = round?.status === 'crashed' ? round.crash_point : null;   // gated
  const bettingEndsAtMs = round?.status === 'betting' && round.betting_at
    ? Date.parse(round.betting_at) + config.bet_window_secs * 1000 : null;

  return {
    round, phase: round?.status, crashPoint, flightAnchor, bettingEndsAtMs,
    config, history, myBets, players, place, cashOut,
  };
}
