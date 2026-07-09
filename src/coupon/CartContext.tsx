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

export function CartProvider({ children }: { children: ReactNode }) {
  const [selections, setSelections] = useState<CartSelection[]>(load);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(selections)); }
    catch { /* ignore quota / private mode */ }
  }, [selections]);

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
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCart(): CartState {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within <CartProvider>');
  return ctx;
}
