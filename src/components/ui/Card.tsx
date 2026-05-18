import { HTMLAttributes, forwardRef } from "react";

type Padding = "none" | "sm" | "md" | "lg";

const PADDING_CLASS: Record<Padding, string> = {
  none: "",
  sm: "p-3",
  md: "p-6",
  lg: "p-8",
};

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: Padding;
  elevated?: boolean;
}

/**
 * Card primitive — wraps the existing `.card` utility from globals.css.
 * Adds optional padding and elevated shadow without changing the base
 * `.card` class so existing global styles + hover transitions still
 * apply.
 *
 * className passthrough comes AFTER variant classes, so callers can
 * override or add layout utilities (`overflow-hidden`, animation
 * delays, etc.) without fighting specificity.
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { padding = "none", elevated, className, children, ...rest },
  ref
) {
  const composed = ["card", PADDING_CLASS[padding], elevated && "shadow-elevated", className]
    .filter(Boolean)
    .join(" ");
  return (
    <div ref={ref} {...rest} className={composed}>
      {children}
    </div>
  );
});
