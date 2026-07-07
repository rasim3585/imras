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

const STORAGE_KEY = 'pickplay.cart.v2';

interface CartState {
  selections: CartSelection[];
  count: number;
  totalOdds: number;
  isSelected: (optionId: string) => boolean;
  /** Which option (if any) is chosen for a match — one pick per match. */
  optionForMatch: (matchId: string) => string | null;
  /** Toggle an option: adds it, or replaces the match's pick, or removes it. */
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
      // tapping the already-selected option clears the match
      if (existing && existing.option_id === leg.option_id) {
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

  const isSelected = useCallback(
    (optionId: string) => selections.some((s) => s.option_id === optionId),
    [selections],
  );
  const optionForMatch = useCallback(
    (matchId: string) => selections.find((s) => s.match_id === matchId)?.option_id ?? null,
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
    isSelected,
    optionForMatch,
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
