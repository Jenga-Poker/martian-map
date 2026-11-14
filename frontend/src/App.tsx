import { Routes, Route } from "react-router";
import Global from "./routes/Global";
import Partial from "./routes/Partial";

function App() {
  return (
    <Routes>
      <Route path="/global" element={<Global />} />
      <Route path="/partial" element={<Partial />} />
      <Route path="/partial/:poiId" element={<Partial />} />
    </Routes>
  );
}

export default App;
