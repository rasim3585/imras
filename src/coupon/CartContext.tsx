import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { BulletinMatch, CartSelection } from '../lib/types';
import { matchProvider } from '../lib/matchProvider';
import { logEvent } from '../lib/behaviorLog';

const STORAGE_KEY = 'pickplay.cart.v3';   // v3: kind-aware, option_id nullable
const SAVED_KEY = 'pickplay.saved.v1';    // saved (un-played) coupon drafts

/** A coupon built but not played — kept client-side for the "Saved" tab. */
export interface SavedDraft { id: string; created_at: number; selections: CartSelection[]; }

const newDraftId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// A selection is identified by (match, market, outcome) -- NOT option_id, which
// is null for real fixtures.
const keyOf = (matchId: string, marketType: string, outcomeKey: string) => `${matchId}:${marketType}:${outcomeKey}`;

interface CartState {
  selections: CartSelection[];
  count: number;
  totalOdds: number;
  /** Canlı tazelemede son ~6sn içinde oranı değişen bacaklar (match_id → yön). */
  flash: Record<string, 'up' | 'down'>;
  isPicked: (matchId: string, marketType: string, outcomeKey: string) => boolean;
  /** Toggle a leg: add it, replace the match's pick, or remove it (one per match). */
  select: (leg: CartSelection) => void;
  remove: (matchId: string) => void;
  clear: () => void;
  // saved (un-played) drafts
  saved: SavedDraft[];
  saveDraft: () => void;
  loadDraft: (id: string) => void;
  deleteDraft: (id: string) => void;
}

const CartContext = createContext<CartState | undefined>(undefined);

function load(): CartSelection[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr = raw ? (JSON.parse(raw) as CartSelection[]) : [];
    return arr.filter((s) => s && s.kind && s.match_id && s.market_type && s.outcome_key);
  } catch {
    return [];
  }
}

function loadSaved(): SavedDraft[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    const arr = raw ? (JSON.parse(raw) as SavedDraft[]) : [];
    return arr.filter((d) => d && d.id && Array.isArray(d.selections) && d.selections.length > 0);
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [selections, setSelections] = useState<CartSelection[]>(load);
  const [saved, setSaved] = useState<SavedDraft[]>(loadSaved);
  const [flash, setFlash] = useState<Record<string, 'up' | 'down'>>({});

  // latest selections for behaviour logging (read outside state updaters so we
  // never double-log under StrictMode's double-invoked reducers).
  const selectionsRef = useRef(selections);
  useEffect(() => { selectionsRef.current = selections; }, [selections]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(selections)); }
    catch { /* ignore quota / private mode */ }
  }, [selections]);

  useEffect(() => {
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(saved)); }
    catch { /* ignore */ }
  }, [saved]);

  // --- CANLI ORAN TAZELEME -------------------------------------------------
  // Sepet + kayıtlı taslaklar tıklama anındaki oranı donduruyordu; sunucu ise
  // bahsi HER ZAMAN güncel orandan keser (place_coupon_v2 taze hesaplar) →
  // gösterilen ≠ kesilen olabiliyordu. Sepette/taslakta bacak varken bülteni
  // periyodik çekip oranları eşitliyoruz; bültenden düşen (biten/kapanan)
  // bacak `closed` işaretlenir — panel oynatmayı engeller.
  const reconcile = useCallback((bulletin: BulletinMatch[]) => {
    const byId = new Map(bulletin.map((m) => [m.id, m]));
    const freshOdds = (s: CartSelection): number | null => {
      const m = byId.get(s.match_id);
      if (!m) return null;
      const mk = m.markets.find((k) => k.market_type === s.market_type);
      const o = mk?.options.find((x) => x.outcome_key === s.outcome_key);
      return o ? o.odds : null;
    };
    const patch = (s: CartSelection): CartSelection => {
      const odds = freshOdds(s);
      if (odds == null) return s.closed ? s : { ...s, closed: true };
      if (s.closed || Math.abs(odds - s.odds) >= 0.01) return { ...s, odds, closed: false };
      return s;
    };
    const flashNext: Record<string, 'up' | 'down'> = {};
    setSelections((prev) => {
      let dirty = false;
      const next = prev.map((s) => {
        const p = patch(s);
        if (p !== s) {
          dirty = true;
          if (!p.closed && Math.abs(p.odds - s.odds) >= 0.01) flashNext[s.match_id] = p.odds > s.odds ? 'up' : 'down';
        }
        return p;
      });
      return dirty ? next : prev;
    });
    setSaved((prev) => {
      let dirty = false;
      const next = prev.map((d) => {
        let dDirty = false;
        const sels = d.selections.map((s) => { const p = patch(s); if (p !== s) dDirty = true; return p; });
        if (!dDirty) return d;
        dirty = true;
        return { ...d, selections: sels };
      });
      return dirty ? next : prev;
    });
    if (Object.keys(flashNext).length > 0) {
      setFlash((f) => ({ ...f, ...flashNext }));
      window.setTimeout(() => setFlash((f) => {
        const n = { ...f };
        for (const k of Object.keys(flashNext)) delete n[k];
        return n;
      }), 6000);
    }
  }, []);

  const hasLegs = selections.length > 0 || saved.length > 0;
  const hasActive = selections.length > 0;
  useEffect(() => {
    if (!hasLegs) return;
    let alive = true;
    let inFlight = false;
    const tick = () => {
      if (inFlight) return;   // yavaş DB'de tam-bülten istekleri üst üste binmesin
      inFlight = true;
      matchProvider.getBulletin()
        .then((b) => { if (alive && b.length > 0) reconcile(b); })
        .catch(() => { /* ağ hatasında eldeki oran kalır, kapatma İŞARETLEME */ })
        .finally(() => { inFlight = false; });
    };
    tick();
    // DB-yük (sayım bulgusu): aktif seçim varken 12sn (canlı oran hissi);
    // YALNIZ kayıtlı taslak varken 60sn — localStorage'taki tek taslak,
    // kullanıcı Aviator'da gezerken bile 12sn'de TAM BÜLTEN çektiriyordu.
    const iv = window.setInterval(() => { if (document.visibilityState !== 'hidden') tick(); }, hasActive ? 12000 : 60000);
    return () => { alive = false; window.clearInterval(iv); };
  }, [hasLegs, hasActive, reconcile]);

  const saveDraft = useCallback(() => {
    if (selections.length === 0) return;
    // Compute the draft ONCE, then a pure updater — no side effects inside a
    // reducer (that double-fires under StrictMode → duplicate saves).
    const draft: SavedDraft = { id: newDraftId(), created_at: Date.now(), selections };
    setSaved((prev) => [draft, ...prev].slice(0, 30));
  }, [selections]);

  const loadDraft = useCallback((id: string) => {
    setSaved((prev) => {
      const d = prev.find((x) => x.id === id);
      if (d) setSelections(d.selections);
      return prev;
    });
  }, []);

  const deleteDraft = useCallback((id: string) => {
    setSaved((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const select = useCallback((leg: CartSelection) => {
    const legKey = keyOf(leg.match_id, leg.market_type, leg.outcome_key);
    // Pre-decision behavioural signal (the moat): what the user adds / swaps /
    // taps-off while building a coupon. Logged from a ref, outside the updater.
    const prevSel = selectionsRef.current;
    const onMatch = prevSel.find((s) => s.match_id === leg.match_id);
    const action = onMatch && keyOf(onMatch.match_id, onMatch.market_type, onMatch.outcome_key) === legKey
      ? 'selection_removed' : onMatch ? 'selection_changed' : 'selection_added';
    logEvent('coupon', action,
      { match_id: leg.match_id, kind: leg.kind, market_type: leg.market_type, outcome_key: leg.outcome_key, odds: leg.odds },
      { cart_size_before: prevSel.length });
    setSelections((prev) => {
      const existing = prev.find((s) => s.match_id === leg.match_id);
      // tapping the already-selected leg clears the match
      if (existing && keyOf(existing.match_id, existing.market_type, existing.outcome_key) === legKey) {
        return prev.filter((s) => s.match_id !== leg.match_id);
      }
      // one pick per match: replace any existing selection on this match
      return [...prev.filter((s) => s.match_id !== leg.match_id), leg];
    });
  }, []);

  const remove = useCallback((matchId: string) => {
    logEvent('coupon', 'selection_removed', { match_id: matchId }, { via: 'dock', cart_size_before: selectionsRef.current.length });
    setSelections((prev) => prev.filter((s) => s.match_id !== matchId));
  }, []);

  const clear = useCallback(() => {
    if (selectionsRef.current.length > 0) logEvent('coupon', 'coupon_cleared', {}, { cart_size_before: selectionsRef.current.length });
    setSelections([]);
  }, []);

  const isPicked = useCallback(
    (matchId: string, marketType: string, outcomeKey: string) =>
      selections.some((s) => s.match_id === matchId && s.market_type === marketType && s.outcome_key === outcomeKey),
    [selections],
  );

  const totalOdds = useMemo(
    () => Number(selections.reduce((acc, s) => acc * s.odds, 1).toFixed(2)),
    [selections],
  );

  const value: CartState = {
    selections,
    count: selections.length,
    totalOdds,
    flash,
    isPicked,
    select,
    remove,
    clear,
    saved,
    saveDraft,
    loadDraft,
    deleteDraft,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCart(): CartState {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within <CartProvider>');
  return ctx;
}
