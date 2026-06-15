"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import { track } from "@/lib/analytics/client";

interface AddOptions {
  quantity?: number;
  optionChoiceIds?: string[];
  addonIds?: string[];
}

interface CartState {
  count: number;
  refresh: () => Promise<void>;
  add: (productId: string, opts?: AddOptions) => Promise<void>;
}

const CartContext = createContext<CartState>({
  count: 0,
  refresh: async () => {},
  add: async () => {},
});

// App-wide cart state: the count drives the header badge; add() is called from
// product cards / detail. The server cart (Redis) is the source of truth — this
// just mirrors the count and refreshes after mutations.
export function CartProvider({ children }: { children: React.ReactNode }) {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/cart");
      if (r.ok) {
        const d = await r.json();
        setCount(d.count ?? 0);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = useCallback(async (productId: string, opts: AddOptions = {}) => {
    const { quantity = 1, optionChoiceIds, addonIds } = opts;
    try {
      const r = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, quantity, optionChoiceIds, addonIds }),
      });
      if (r.ok) {
        const d = await r.json();
        setCount(d.count ?? 0);
        // Funnel event — fired centrally so every add-to-cart entry point
        // (product cards, grid, detail page) is covered.
        track("add_to_cart", {
          productId,
          quantity,
          valueKurus: typeof d.lineKurus === "number" ? d.lineKurus : undefined,
        });
      }
    } catch {
      // ignore
    }
  }, []);

  return (
    <CartContext.Provider value={{ count, refresh, add }}>
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => useContext(CartContext);
