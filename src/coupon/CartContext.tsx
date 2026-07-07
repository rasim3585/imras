import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { CartSelection, Outcome } from '../lib/types';

const STORAGE_KEY = 'pickplay.cart.v1';

interface CartState {
  selections: CartSelection[];
  count: number;
  totalOdds: number;
  pickFor: (matchId: string) => Outcome | null;
  /** Add a leg, or replace the pick if the match is already in the coupon. */
  select: (leg: CartSelection) => void;
  remove: (matchId: string) => void;
  clear: () => void;
}

const CartContext = createContext<CartState | undefined>(undefined);

function load(): CartSelection[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CartSelection[]) : [];
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [selections, setSelections] = useState<CartSelection[]>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(selections));
    } catch {
      /* ignore quota / private mode */
    }
  }, [selections]);

  const select = useCallback((leg: CartSelection) => {
    setSelections((prev) => {
      const existing = prev.find((s) => s.match_id === leg.match_id);
      // tapping the already-selected pick removes it (toggle off)
      if (existing && existing.pick === leg.pick) {
        return prev.filter((s) => s.match_id !== leg.match_id);
      }
      const without = prev.filter((s) => s.match_id !== leg.match_id);
      return [...without, leg];
    });
  }, []);

  const remove = useCallback((matchId: string) => {
    setSelections((prev) => prev.filter((s) => s.match_id !== matchId));
  }, []);

  const clear = useCallback(() => setSelections([]), []);

  const pickFor = useCallback(
    (matchId: string) => selections.find((s) => s.match_id === matchId)?.pick ?? null,
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
    pickFor,
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
