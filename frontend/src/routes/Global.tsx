import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import GlobalMap, { type GlobalMapHandle, type Poi } from "../components/GlobalMap";
import Cabecera from "../components/Cabecera";
import SidePanel from "../components/SidePanel";

function Global() {
  const navigate = useNavigate();
  const mapRef = useRef<GlobalMapHandle>(null);
  const [selectedPoi, setSelectedPoi] = useState<Poi | null>(null);

  const handleClose = () => {
    setSelectedPoi(null);
    mapRef.current?.resetView();
  };

  return (
    <div>
      <Cabecera />
      <GlobalMap
        ref={mapRef}
        onPoiSelect={(poi) => setSelectedPoi(poi)}
        onPoiDeselect={() => setSelectedPoi(null)}
      />
      <SidePanel
        title={selectedPoi?.name ?? ""}
        open={!!selectedPoi}
        onClose={handleClose}
        onGo={() => navigate("/partial")}
      />
    </div>
  );
}

export default Global;