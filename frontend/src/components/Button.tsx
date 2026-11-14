import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  active?: boolean;
};

export default function Button({
  children,
  active = false,
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  const classes = ["btn", active ? "btn--active" : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} className={classes} {...props}>
      {children}
    </button>
  );
}
