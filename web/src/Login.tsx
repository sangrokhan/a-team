import { useState } from "react";
import { login } from "./api.js";

export function Login({ onOk }: { onOk: () => void }) {
  const [pw, setPw] = useState(""); const [err, setErr] = useState(false);
  async function submit() { (await login(pw)) ? onOk() : setErr(true); }
  return (
    <div style={{ display: "grid", placeItems: "center", height: "100vh" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h2>a-team</h2>
        <input type="password" value={pw} placeholder="password"
          onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        {err && <span style={{ color: "#f87171" }}>Wrong password</span>}
        <button onClick={submit}>Log in</button>
      </div>
    </div>
  );
}
