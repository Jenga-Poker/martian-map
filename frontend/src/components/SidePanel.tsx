import type { ReactNode } from "react";
import arrowIcon from "../assets/arrow-back-outline.svg";
import Button from "./Button";

type SidePanelProps = {
  title: string;
  open?: boolean;
  onBack?: () => void;
  onClose?: () => void;
  onGo?: () => void;
  actionLabel?: string;
  children?: ReactNode;
  className?: string;
  headerExtra?: ReactNode;
};

export default function SidePanel({
  title,
  open = true,
  onBack,
  onClose,
  onGo,
  actionLabel = "Ir",
  children,
  className = "",
  headerExtra,
}: SidePanelProps) {
  const backHandler = onBack ?? onClose;
  return (
    <aside
      className={`side-panel${open ? " side-panel--open" : ""}${className ? ` ${className}` : ""}`}
      aria-label={title}
    >
      <div className="side-panel__header">
        {backHandler && (
          <button
            type="button"
            className="side-panel__close"
            onClick={backHandler}
            aria-label={onBack ? "Volver a la vista general" : "Cerrar panel"}
          >
            <span
              className="side-panel__close-icon"
              aria-hidden="true"
              style={{
                WebkitMaskImage: `url("${arrowIcon}")`,
                maskImage: `url("${arrowIcon}")`,
              }}
            />
          </button>
        )}
        <h2 className="side-panel__title">{title}</h2>
        {headerExtra}
      </div>
      {children && <div className="side-panel__content">{children}</div>}
      {onGo && (
        <div className="side-panel__actions">
          <Button onClick={onGo}>{actionLabel}</Button>
        </div>
      )}
    </aside>
  );
}