import arrowIcon from "../assets/arrow-back-outline.svg";

type SidePanelProps = {
  title: string;
  open: boolean;
  onGo?: () => void;
  onClose?: () => void;
};

export default function SidePanel({ title, open, onGo, onClose }: SidePanelProps) {
  return (
    <aside
      className={`side-panel${open ? " side-panel--open" : ""}`}
      aria-label={title ? `Lugar seleccionado: ${title}` : "Panel lateral"}
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
      </div>
      <div className="side-panel__actions">
        <button type="button" className="mars-forward" onClick={onGo}>
          Ir
        </button>
      </div>
    </aside>
  );
}