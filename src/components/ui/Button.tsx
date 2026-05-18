import { ButtonHTMLAttributes, forwardRef, ReactNode } from "react";
import Link from "next/link";

type Variant = "primary" | "secondary" | "amber";
type Size = "sm" | "md" | "lg";

interface CommonProps {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
}

type ButtonAsButton = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
    href?: undefined;
  };

type ButtonAsLink = CommonProps & {
  href: string;
  prefetch?: boolean;
  target?: string;
  rel?: string;
  onClick?: () => void;
  title?: string;
};

export type ButtonProps = ButtonAsButton | ButtonAsLink;

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  amber: "btn-amber",
};

// Size variants ride on top of the .btn-* base padding. Defaults to `md`
// (the existing .btn-* base padding); sm/lg override via Tailwind utilities
// with `!` so they win against the base CSS.
const SIZE_CLASS: Record<Size, string> = {
  sm: "!py-2 !px-4 text-xs",
  md: "",
  lg: "!py-3.5 text-lg",
};

function joinClasses(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/**
 * Unified Button primitive. Renders a `<button>` by default; if `href` is
 * supplied, renders a Next.js `<Link>` instead so we don't lose
 * client-side navigation on link-styled buttons.
 *
 * className is appended AFTER variant + size classes so caller overrides
 * (e.g. `!py-3.5 w-full`) win without changing the primitive.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(props, ref) {
    const {
      variant = "primary",
      size = "md",
      fullWidth,
      loading,
      icon,
      children,
      className,
    } = props;

    const composed = joinClasses(
      VARIANT_CLASS[variant],
      SIZE_CLASS[size],
      fullWidth && "w-full",
      className
    );

    const content = (
      <>
        {loading && (
          <svg
            className="w-4 h-4 animate-spin"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        )}
        {!loading && icon}
        {children}
      </>
    );

    if ("href" in props && props.href !== undefined) {
      const {
        href,
        prefetch,
        target,
        rel,
        onClick,
        title,
      } = props as ButtonAsLink;
      return (
        <Link
          href={href}
          prefetch={prefetch}
          target={target}
          rel={rel}
          onClick={onClick}
          title={title}
          className={composed}
        >
          {content}
        </Link>
      );
    }

    const { href: _href, ...buttonProps } = props as ButtonAsButton & {
      href?: undefined;
    };
    void _href;
    return (
      <button
        ref={ref}
        {...buttonProps}
        disabled={loading || buttonProps.disabled}
        className={composed}
      >
        {content}
      </button>
    );
  }
);
