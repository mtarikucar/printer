import { ReactNode } from "react";

interface FormFieldProps {
  label: string;
  htmlFor?: string;
  error?: string | null;
  required?: boolean;
  hint?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Lightweight label + control wrapper. Matches the existing form pattern
 * used across /login, /register, /create step 3, and the address-book
 * panel: <label> above the field with optional error/hint below.
 *
 * Does NOT inject a `for`/`id` automatically — callers pass `htmlFor` if
 * they want screen-reader association (the existing form code didn't,
 * so this is opt-in to preserve behavior).
 */
export function FormField({
  label,
  htmlFor,
  error,
  required,
  hint,
  children,
  className,
}: FormFieldProps) {
  return (
    <div className={className}>
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-text-secondary mb-1.5"
      >
        {label}
        {required && <span className="text-error ml-0.5">*</span>}
      </label>
      {children}
      {hint && !error && (
        <p className="text-xs text-text-muted mt-1">{hint}</p>
      )}
      {error && <p className="text-xs text-error mt-1">{error}</p>}
    </div>
  );
}
