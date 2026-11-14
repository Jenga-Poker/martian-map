import { Routes, Route, Navigate } from "react-router";
import Global from "./routes/Global";
import Partial from "./routes/Partial";

function App() {
  return (
    <Routes>
      <Route path="/global" element={<Global />} />
      <Route path="/partial/:poiId" element={<Partial />} />
      <Route path="/" element={<Navigate to="/global" replace />} />

    </Routes>
  );
}

export default App;
