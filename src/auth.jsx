import { useState } from "react";
import { supabase } from "./supabase.js";

const C = {
  bg:"#0a0a0a", surface:"#161616", card:"#1c1c1c", border:"#252525",
  accent:"#e8ff47", text:"#f0f0f0", textDim:"#666666",
  red:"#ff4a4a", green:"#44ff88",
};

export default function Auth() {
  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  const iSt = {
    width:"100%", background:C.card, border:`1px solid ${C.border}`,
    borderRadius:12, padding:"14px 16px", color:C.text, fontSize:16,
    outline:"none", fontFamily:"inherit", marginBottom:12,
  };

  const handle = async () => {
    setLoading(true); setError(null); setMessage(null);
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message || JSON.stringify(error));
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setError(error.message || JSON.stringify(error));
      else setMessage("Controlla la tua email per confermare la registrazione!");
    }
    setLoading(false);
  };

  return (
    <div style={{minHeight:"100vh", background:C.bg, display:"flex",
      alignItems:"center", justifyContent:"center", padding:24}}>
      <div style={{width:"100%", maxWidth:380}}>
        {/* Logo */}
        <div style={{textAlign:"center", marginBottom:40}}>
          <div style={{fontSize:36, fontWeight:900, letterSpacing:-1}}>
            <span style={{color:C.accent}}>GYM</span>
            <span style={{color:C.text}}>BRO</span>
          </div>
          <div style={{fontSize:13, color:C.textDim, marginTop:6}}>
            Il tuo tracker di allenamento
          </div>
        </div>

        {/* Card */}
        <div style={{background:C.surface, borderRadius:20, padding:28,
          border:`1px solid ${C.border}`}}>
          <div style={{fontSize:20, fontWeight:800, color:C.text, marginBottom:24}}>
            {mode === "login" ? "Accedi" : "Registrati"}
          </div>

          <input type="email" placeholder="Email" value={email}
            onChange={e=>setEmail(e.target.value)} style={iSt}/>
          <input type="password" placeholder="Password" value={password}
            onChange={e=>setPassword(e.target.value)} style={iSt}
            onKeyDown={e=>{if(e.key==="Enter")handle();}}/>

          {error && (
            <div style={{background:C.red+"22", border:`1px solid ${C.red}44`,
              borderRadius:10, padding:"10px 14px", color:C.red,
              fontSize:13, marginBottom:12}}>
              {error}
            </div>
          )}
          {message && (
            <div style={{background:C.green+"22", border:`1px solid ${C.green}44`,
              borderRadius:10, padding:"10px 14px", color:C.green,
              fontSize:13, marginBottom:12}}>
              {message}
            </div>
          )}

          <button onClick={handle} disabled={loading || !email || !password}
            style={{width:"100%", background:C.accent, color:"#000", border:"none",
              borderRadius:12, padding:"16px", fontSize:16, fontWeight:800,
              cursor:loading?"not-allowed":"pointer", opacity:loading?0.7:1,
              marginBottom:16}}>
            {loading ? "..." : mode === "login" ? "Accedi" : "Registrati"}
          </button>

          <div style={{textAlign:"center", fontSize:14, color:C.textDim}}>
            {mode === "login" ? "Non hai un account? " : "Hai già un account? "}
            <span onClick={()=>{setMode(mode==="login"?"signup":"login");setError(null);setMessage(null);}}
              style={{color:C.accent, cursor:"pointer", fontWeight:700}}>
              {mode === "login" ? "Registrati" : "Accedi"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
