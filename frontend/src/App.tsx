import "./App.css";
import YellowMap from "./components/map/YellowMap";
import Cabecera from "./components/ui/Cabecera";
import Hud from "./components/ui/Hud";

export default function App() {
  return (
    <>
      <YellowMap />
      <Cabecera />
      <div className="rounded-square" aria-hidden="true">
        <Hud />
      </div>
    </>
  );
}