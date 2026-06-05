// Button primitives. These emit the SAME class names the app's CSS
// already styles (`primary`, `danger`, `icon-btn`, …) — the point isn't
// new styling, it's one typed component so every call site stops
// hand-assembling `<button className="primary icon-btn" type="button">`
// with its own aria wiring. Variant + the icon-only flag are data, not
// copy-pasted strings.

import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'default' | 'primary' | 'danger' | 'danger-ghost';

const VARIANT_CLASS: Record<Variant, string> = {
  default: '',
  primary: 'primary',
  danger: 'danger',
  'danger-ghost': 'danger-ghost',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// Text (or text+icon) button.
export function Button({
  variant = 'default',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button type="button" className={cx(VARIANT_CLASS[variant], className)} {...rest}>
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Required: icon buttons have no text, so the label is the only
      accessible name (used for aria-label AND the tooltip). */
  label: string;
  children: ReactNode;
}

// Icon-only button — circular (`.icon-btn` is pill-radius), labelled.
export function IconButton({
  variant = 'default',
  label,
  className,
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={cx('icon-btn', VARIANT_CLASS[variant], className)}
      aria-label={label}
      title={rest.title ?? label}
      {...rest}
    >
      {children}
    </button>
  );
}
