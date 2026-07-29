import { Routes, Route } from "react-router-dom";
import { PlayerPreview } from "./pages/PlayerPreview/PlayerPreview";
import { UploadPreview } from "./pages/UploadPreview/UploadPreview";
import { Upload } from "./pages/Upload/Upload";
import { Player } from "./pages/Player/Player";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Upload />} />
      <Route path="/player/:jobId" element={<Player />} />
      <Route path="/preview/upload" element={<UploadPreview />} />
      <Route path="/preview/player" element={<PlayerPreview />} />
    </Routes>
  );
}

export default App;
