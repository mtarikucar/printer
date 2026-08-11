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
  /** Adds the line as part of an anahtarlık kutusu (box-ladder pricing). */
  box?: boolean;
}

/** One line of a batch add — same shape as a single add, plus its product. */
export interface AddItem extends AddOptions {
  productId: string;
}

interface CartState {
  count: number;
  refresh: () => Promise<void>;
  add: (productId: string, opts?: AddOptions) => Promise<void>;
  /** Add several products in ONE request (the /toplu-siparis order sheet). */
  addMany: (items: AddItem[]) => Promise<void>;
}

const CartContext = createContext<CartState>({
  count: 0,
  refresh: async () => {},
  add: async () => {},
  addMany: async () => {},
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
    const { quantity = 1, optionChoiceIds, addonIds, box } = opts;
    try {
      const r = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          quantity,
          optionChoiceIds,
          addonIds,
          box,
        }),
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

  // Batch add. One request, one server-side hydrate — adding 8 products from
  // the bulk order sheet as 8 sequential POSTs would mean 8 full cart
  // re-pricing round trips.
  const addMany = useCallback(async (items: AddItem[]) => {
    const payload = items.filter((i) => i.productId && (i.quantity ?? 1) > 0);
    if (payload.length === 0) return;
    try {
      const r = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: payload }),
      });
      if (r.ok) {
        const d = await r.json();
        setCount(d.count ?? 0);
        for (const item of payload) {
          track("add_to_cart", {
            productId: item.productId,
            quantity: item.quantity ?? 1,
          });
        }
      }
    } catch {
      // ignore
    }
  }, []);

  return (
    <CartContext.Provider value={{ count, refresh, add, addMany }}>
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => useContext(CartContext);
