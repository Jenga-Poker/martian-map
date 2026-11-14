import type { ReactNode } from "react";
import arrowIcon from "../assets/arrow-back-outline.svg";

type SidePanelProps = {
  title: string;
  open?: boolean;
  onGo?: () => void;
  onClose?: () => void;
  children?: ReactNode;
  className?: string;
  headerExtra?: ReactNode;
};

export default function SidePanel({
  title,
  open = true,
  onGo,
  onClose,
  children,
  className = "",
  headerExtra,
}: SidePanelProps) {
  return (
    <aside
      className={`side-panel${open ? " side-panel--open" : ""}${className ? ` ${className}` : ""}`}
      aria-label={title}
      aria-hidden={!open}
    >
      <div className="side-panel__header">
        {onClose && (
          <button
            type="button"
            className="side-panel__close"
            onClick={onClose}
            aria-label="Cerrar panel"
          >
            <img src={arrowIcon} alt="" className="side-panel__close-icon" />
          </button>
        )}
        <h2 className="side-panel__title">{title}</h2>
        {headerExtra}
      </div>
      {children && <div className="side-panel__content">{children}</div>}
      {onGo && (
        <div className="side-panel__actions">
          <button type="button" className="mars-forward" onClick={onGo}>
            Ir
          </button>
        </div>
      )}
    </aside>
  );
}