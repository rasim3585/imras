import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { CartSelection } from '../lib/types';

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

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(selections)); }
    catch { /* ignore quota / private mode */ }
  }, [selections]);

  useEffect(() => {
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(saved)); }
    catch { /* ignore */ }
  }, [saved]);

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
    setSelections((prev) => prev.filter((s) => s.match_id !== matchId));
  }, []);

  const clear = useCallback(() => setSelections([]), []);

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
