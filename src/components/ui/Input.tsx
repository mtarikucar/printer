import {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  forwardRef,
} from "react";

function compose(className: string | undefined, ...extras: string[]) {
  return [...extras, className].filter(Boolean).join(" ");
}

/**
 * `<input>` primitive bound to the global `.input-base` class. Native
 * input props pass through, className is appended for caller overrides.
 */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} {...rest} className={compose(className, "input-base")} />;
  }
);

/** `<select>` primitive. `.input-base` styling includes the dropdown caret. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select ref={ref} {...rest} className={compose(className, "input-base")}>
        {children}
      </select>
    );
  }
);

/** `<textarea>` primitive. Inherits `.input-base` styling. */
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} {...rest} className={compose(className, "input-base")} />;
});
