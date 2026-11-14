import "./Hud.css";

export default function Hud() {
  return (
    <div className="hud-container">
      <div className="hud-ring inner-line" />
      <div className="hud-ring ticks" />
      <div className="hud-ring mid-line" />
      <div className="hud-ring blocks" />
      <div className="hud-ring double-arc" />
      <div className="hud-ring main-border" />
      <div className="hud-ring outer-segments" />
      <div className="hud-ring outer-tabs" />
    </div>
  );
}