import "./App.css";
import YellowMap from "./components/map/YellowMap";
import Cabecera from "./components/ui/Cabecera";
import Hud from "./components/ui/Hud";
import PanelIzquierdo from "./components/ui/PanelIzquierdo";

export default function App() {
  return (
    <>
      <YellowMap />
      <div className="rectangulo-izquierdo">
        <PanelIzquierdo />
      </div>
      <Cabecera />
      <div className="rounded-square" aria-hidden="true">
        <Hud />
      </div>
    </>
  );
}