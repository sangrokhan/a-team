import { useEffect, useState } from "react";
import { getConfig, saveConfig } from "./api.js";

export function ConfigEditor() {
  const [content, setContent] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => { getConfig().then(setContent); }, []);
  return (
    <div style={{ padding: 12 }}>
      <h3>teams.yaml</h3>
      <textarea value={content} onChange={(e) => setContent(e.target.value)} style={{ width: "100%", height: 320, fontFamily: "monospace" }} />
      <button onClick={async () => { await saveConfig(content); setNote("Saved — restart the server to apply."); }}>Save</button>
      <span style={{ marginLeft: 8, color: "#f59e0b" }}>{note}</span>
    </div>
  );
}
