"use client";

import { useState, type MouseEvent } from "react";
import { useCart } from "@/lib/cart/cart-context";
import { useDictionary } from "@/lib/i18n/locale-context";

// Add a product to the cart. Stops propagation so it works inside a linked
// ProductCard without navigating.
export function AddToCartButton({
  productId,
  className,
  label,
  optionChoiceIds,
  addonIds,
}: {
  productId: string;
  className?: string;
  label?: string;
  optionChoiceIds?: string[];
  addonIds?: string[];
}) {
  const { add } = useCart();
  const d = useDictionary();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);

  const onClick = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setAdding(true);
    await add(productId, { optionChoiceIds, addonIds });
    setAdding(false);
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={adding}
      className={
        className ??
        "w-full rounded-full bg-green-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-60"
      }
    >
      {added ? d["cart.added"] : (label ?? d["cart.add"])}
    </button>
  );
}
