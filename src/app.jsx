import { useState, useEffect, useRef, useCallback } from "react";

// ─── TEMI ─────────────────────────────────────────────────────────────────────
const DARK = {
  bg:"#0a0a0a", surface:"#111111", card:"#181818", border:"#252525",
  accent:"#e8ff47", accentDim:"#b8cc35", blue:"#4af0ff",
  red:"#ff4a4a", green:"#44ff88", orange:"#ff9a3c", purple:"#b478ff",
  muted:"#444444", text:"#f0f0f0", textDim:"#666666",
};
const LIGHT = {
  bg:"#f2f2f2", surface:"#ffffff", card:"#e8e8e8", border:"#cccccc",
  accent:"#4a8800", accentDim:"#336000", blue:"#0066bb",
  red:"#bb1111", green:"#116611", orange:"#aa5500", purple:"#7a3ccc",
  muted:"#999999", text:"#111111", textDim:"#666666",
};

// ─── AUDIO ────────────────────────────────────────────────────────────────────
let _audioCtx = null, _unlocked = false;
function getAudioCtx() {
  try {
    if (!_audioCtx || _audioCtx.state === "closed")
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return _audioCtx;
  } catch { return null; }
}
function unlockAudio() {
  const ctx = getAudioCtx(); if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();
  if (!_unlocked) {
    try {
      const b = ctx.createBuffer(1,1,22050), s = ctx.createBufferSource();
      s.buffer = b; s.connect(ctx.destination); s.start(0); _unlocked = true;
    } catch {}
  }
}
function playBip(freq, t, dur=0.13) {
  try {
    const ctx = getAudioCtx(); if (!ctx) return;
    const go = (c) => {
      const o=c.createOscillator(), g=c.createGain();
      o.connect(g); g.connect(c.destination); o.frequency.value=freq;
      const now=c.currentTime;
      g.gain.setValueAtTime(0,now+t); g.gain.linearRampToValueAtTime(0.5,now+t+0.01);
      g.gain.exponentialRampToValueAtTime(0.001,now+t+dur);
      o.start(now+t); o.stop(now+t+dur+0.05);
    };
    ctx.state==="suspended" ? ctx.resume().then(()=>go(ctx)) : go(ctx);
  } catch {}
}
const bipStart = () => { playBip(1320,0); playBip(1100,0.15); playBip(880,0.30); };
const bipEnd   = () => { playBip(880,0); playBip(1100,0.15); playBip(1320,0.30); };
const bipTick  = () => playBip(880, 0, 0.09);

// ─── WAKE LOCK ────────────────────────────────────────────────────────────────
function useWakeLock(active) {
  const lockRef = useRef(null);
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    if (active) navigator.wakeLock.request('screen').then(l => { lockRef.current=l; }).catch(()=>{});
    else { lockRef.current?.release().catch(()=>{}); lockRef.current=null; }
    return () => { lockRef.current?.release().catch(()=>{}); lockRef.current=null; };
  }, [active]);
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
let _uid = Date.now();
const uid  = () => String(++_uid);
const fmt2 = n => String(n).padStart(2,"0");
const fmtTime = s => `${fmt2(Math.floor(s/60))}:${fmt2(s%60)}`;
const fmtDate = d => new Date(d).toLocaleDateString("it-IT",{day:"numeric",month:"short",year:"2-digit"});

// ─── VALIDAZIONE INPUT ────────────────────────────────────────────────────────
const MAX_KG = 500, MAX_REPS = 200, MAX_SETS = 20, MAX_REST = 600;

function validateField(key, rawVal) {
  const v = parseFloat(rawVal);
  if (rawVal === "" || rawVal === undefined) return { val: "", err: null };
  if (isNaN(v) || v < 0) return { val: rawVal, err: "Valore non valido" };
  if (key === "kg"   && v > MAX_KG)   return { val: rawVal, err: `Max ${MAX_KG} kg` };
  if (key === "reps" && v > MAX_REPS) return { val: rawVal, err: `Max ${MAX_REPS} rip` };
  if (key === "sets" && v > MAX_SETS) return { val: rawVal, err: `Max ${MAX_SETS} serie` };
  if (key === "rest" && v > MAX_REST) return { val: rawVal, err: `Max ${MAX_REST}s` };
  return { val: rawVal, err: null };
}

// ─── CALORIE (stima) ──────────────────────────────────────────────────────────
function calcCalories(ex, bodyKg) {
  if (!bodyKg || bodyKg <= 0) return 0;
  const rom = ex.rom ?? 0;
  const doneKgs = (ex.seriesData||[]).filter(s=>s.done).map(s=>parseFloat(s.kg)||0);
  const avgKg = doneKgs.length ? doneKgs.reduce((a,b)=>a+b,0)/doneKgs.length : parseFloat(ex.kg)||0;
  const sets=ex.sets||0, reps=parseFloat(ex.reps)||0;
  const workKcal = rom>0&&avgKg>0 ? (avgKg*9.81*rom*reps*sets)/(4186*0.25) : 0;
  const restKcal = 2.0*3.5*bodyKg*(ex.rest*Math.max(sets-1,0)/3600)/200;
  const isoKcal  = rom===0&&sets>0 ? 2.5*3.5*bodyKg*((reps*sets)/3600)/200 : 0;
  return Math.round((workKcal+restKcal+isoKcal)*10)/10;
}

function makeSeriesData(sets, reps, kg) {
  return Array.from({length:sets},(_,i)=>({index:i, kg:String(kg||""), reps:String(reps||""), done:false}));
}

// ─── STORICO PER ESERCIZIO ────────────────────────────────────────────────────
// Raccoglie da history tutte le entry relative allo stesso nome esercizio
function getExHistory(exName, history) {
  const entries = [];
  for (const sess of history) {
    for (const ex of (sess.exercises||[])) {
      if (ex.name.trim().toLowerCase() === exName.trim().toLowerCase()) {
        const doneSets = (ex.seriesData||[]).filter(s=>s.done);
        if (doneSets.length === 0) continue;
        entries.push({
          date: sess.date,
          sessName: sess.name,
          sets: doneSets,
          rpe: ex.rpe ?? null,
        });
      }
    }
  }
  return entries.sort((a,b) => b.date - a.date).slice(0, 10); // ultime 10
}

// ─── SCHEDE ───────────────────────────────────────────────────────────────────
const mkEx = (name,rom,sets,reps,kg,rest,machineNote="",nextNote="") => ({
  id:uid(), name, rom, sets, reps:String(reps), kg:String(kg), rest,
  machineNote, nextNote, rpe:null,
  seriesData: makeSeriesData(sets,reps,kg)
});

const SCHEDA_A_EXERCISES = () => [
  mkEx("Leg Press",0.40,4,12,32,120,"Sedile grande 6, piccola 3, altezza 3","Gamba dx da affondare di più"),
  mkEx("Leg Extension",0.35,3,12,18,90,"",""),
  mkEx("Hamstring Curl",0.35,3,12,38,90,"Grande 6, piccola 3, altezza 3, schiena 2",""),
  mkEx("Lat Pull",0.60,4,10,40,90,"","Attenzione al collo"),
  mkEx("Rematore Presa Stretta",0.50,4,10,25,90,"Longpull","Iniziare con +2 kg"),
  mkEx("Hammer Bicep Curl",0.35,3,12,6,60,"",""),
  mkEx("Plank sui gomiti",0,3,45,0,60,"",""),
  mkEx("Taglialegna",0.50,3,15,18,60,"",""),
];
const SCHEDA_B_EXERCISES = () => [
  mkEx("Rotazione esterna",0.40,3,15,0,60,"Elastico o cavo basso",""),
  mkEx("Chest Press",0.50,4,10,30,90,"",""),
  mkEx("Chest Press panca inclinata",0.50,3,10,25,90,"Inclinazione 30°",""),
  mkEx("Croci",0.60,4,12,12,90,"",""),
  mkEx("Spinte sopra la testa",0.55,4,10,20,90,"",""),
  mkEx("Alzate laterali",0.50,3,12,8,60,"",""),
  mkEx("Tricep Extension al cavo alto",0.35,3,12,15,60,"Super Set con Bicep Curl",""),
  mkEx("Bicep Curl bilancere presa larga",0.35,3,12,15,60,"",""),
  mkEx("Core stability - Plank gomiti",0,4,40,0,60,"",""),
];
const BUILT_IN_SCHEDE = [{id:"a",name:"Scheda A"},{id:"b",name:"Scheda B"}];

// ─── LIBRERIA ESERCIZI ────────────────────────────────────────────────────────
const EX_LIBRARY = [
  {cat:"🦵 Gambe",rom:0.40,defaults:{sets:4,reps:12,rest:90},items:[{name:"Leg Press",rom:0.40},{name:"Squat",rom:0.45},{name:"Leg Extension",rom:0.35},{name:"Hamstring Curl",rom:0.35},{name:"Affondi",rom:0.45},{name:"Calf Raise",rom:0.15},{name:"Leg Curl sdraiato",rom:0.35}]},
  {cat:"🏋 Petto",rom:0.50,defaults:{sets:4,reps:10,rest:90},items:[{name:"Chest Press",rom:0.50},{name:"Chest Press inclinata",rom:0.50},{name:"Croci",rom:0.60},{name:"Pectoral Machine",rom:0.55},{name:"Dip",rom:0.40},{name:"Push Up",rom:0.35}]},
  {cat:"🔽 Schiena",rom:0.55,defaults:{sets:4,reps:10,rest:90},items:[{name:"Lat Pull",rom:0.60},{name:"Rematore",rom:0.50},{name:"Seated Row",rom:0.50},{name:"Pulley basso",rom:0.55},{name:"Stacco",rom:0.65},{name:"Pullover",rom:0.60}]},
  {cat:"🔺 Spalle",rom:0.55,defaults:{sets:3,reps:12,rest:60},items:[{name:"Military Press",rom:0.55},{name:"Alzate laterali",rom:0.50},{name:"Alzate frontali",rom:0.50},{name:"Face Pull",rom:0.45},{name:"Rotazione esterna",rom:0.40},{name:"Arnold Press",rom:0.55}]},
  {cat:"💪 Braccia",rom:0.35,defaults:{sets:3,reps:12,rest:60},items:[{name:"Bicep Curl",rom:0.35},{name:"Hammer Curl",rom:0.35},{name:"Bicep Curl bilancere",rom:0.35},{name:"Tricep Extension cavo",rom:0.35},{name:"Skull Crusher",rom:0.40},{name:"Tricep Dip",rom:0.35},{name:"Tricep Kickback",rom:0.35}]},
  {cat:"🧘 Core",rom:0,defaults:{sets:3,reps:20,rest:60},items:[{name:"Plank sui gomiti",rom:0},{name:"Crunch",rom:0.15},{name:"Russian Twist",rom:0.20},{name:"Leg Raise",rom:0.40},{name:"Ab Machine",rom:0.25},{name:"Taglialegna",rom:0.50},{name:"Mountain Climber",rom:0}]},
];

// ─── RPE SELECTOR ─────────────────────────────────────────────────────────────
const RPE_LABELS = ["","Leggerissimo","Molto facile","Facile","Moderato","Moderato+","Faticoso","Molto faticoso","Quasi al limite","Al limite","Massimale"];
function RpeSelector({ value, onChange, color, C }) {
  return (
    <div style={{marginTop:12}}>
      <div style={{fontSize:10,letterSpacing:2,color:C.textDim,marginBottom:8,textTransform:"uppercase"}}>
        💢 RPE — Sforzo percepito {value ? `(${value}/10 — ${RPE_LABELS[value]})` : "(non inserito)"}
      </div>
      <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
        {[1,2,3,4,5,6,7,8,9,10].map(n => {
          const active = value === n;
          const rpeColor = n <= 4 ? "#44ff88" : n <= 6 ? "#f5a623" : n <= 8 ? "#ff8c42" : "#ff4a4a";
          return (
            <button key={n} onClick={() => onChange(active ? null : n)} style={{
              width:36, height:36, borderRadius:8, border:`2px solid ${active ? rpeColor : C.border}`,
              background: active ? rpeColor+"33" : C.surface,
              color: active ? rpeColor : C.textDim,
              fontSize:14, fontWeight:700, cursor:"pointer",
              transition:"all .15s",
            }}>{n}</button>
          );
        })}
      </div>
    </div>
  );
}

// ─── STORICO ESERCIZIO MODAL ──────────────────────────────────────────────────
function ExHistoryModal({ exName, history, C, onClose }) {
  const entries = getExHistory(exName, history);
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",backdropFilter:"blur(6px)",
      display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:160,padding:16}}
      onClick={onClose}>
      <div style={{background:C.surface,borderRadius:20,padding:20,width:"100%",maxWidth:480,
        border:`1px solid ${C.border}`,maxHeight:"75vh",display:"flex",flexDirection:"column"}}
        onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <div>
            <div style={{fontSize:17,fontWeight:800,color:C.text}}>📈 {exName}</div>
            <div style={{fontSize:12,color:C.textDim,marginTop:2}}>Ultime {entries.length} sessioni trovate</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:`1px solid ${C.border}`,
            borderRadius:8,padding:"4px 10px",cursor:"pointer",color:C.textDim,fontSize:14}}>✕</button>
        </div>
        {entries.length === 0
          ? <div style={{textAlign:"center",color:C.textDim,padding:"32px 0",fontSize:14}}>
              Nessuna sessione salvata per questo esercizio.
            </div>
          : <div style={{overflowY:"auto",flex:1}}>
              {entries.map((entry,i) => (
                <div key={i} style={{background:C.card,borderRadius:12,padding:"12px 14px",
                  marginBottom:10,border:`1px solid ${C.border}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <div style={{fontSize:14,fontWeight:700,color:C.text}}>{fmtDate(entry.date)}</div>
                    <div style={{display:"flex",gap:8,alignItems:"center"}}>
                      {entry.rpe && (
                        <span style={{fontSize:12,fontWeight:700,
                          color: entry.rpe<=4?"#44ff88":entry.rpe<=6?"#f5a623":entry.rpe<=8?"#ff8c42":"#ff4a4a",
                          background: (entry.rpe<=4?"#44ff88":entry.rpe<=6?"#f5a623":entry.rpe<=8?"#ff8c42":"#ff4a4a")+"22",
                          borderRadius:6,padding:"2px 8px"}}>
                          RPE {entry.rpe}
                        </span>
                      )}
                      <span style={{fontSize:12,color:C.textDim}}>{entry.sessName}</span>
                    </div>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:4}}>
                    {entry.sets.map((s,j) => (
                      <div key={j} style={{display:"flex",gap:8,alignItems:"center",fontSize:13}}>
                        <span style={{color:C.textDim,width:20}}>#{j+1}</span>
                        <span style={{fontWeight:700,color:C.text}}>
                          {s.kg ? `${s.kg} kg` : "—"} × {s.reps} {parseFloat(s.reps)>=30?"sec":"rip"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>}
      </div>
    </div>
  );
}

// ─── PLANK TIMER ─────────────────────────────────────────────────────────────
function PlankTimer({ targetSec, color, C }) {
  const [sec, setSec] = useState(0);
  const [running, setRunning] = useState(false);
  const intRef = useRef(null);
  const pct = targetSec>0 ? Math.min(sec/targetSec,1) : 0;
  const r=22, circ=2*Math.PI*r;
  const done = sec>=targetSec && targetSec>0;
  const urgent = !done && running && (targetSec-sec)<=5;
  const toggle = () => {
    if (done) { setSec(0); setRunning(false); clearInterval(intRef.current); return; }
    if (running) { clearInterval(intRef.current); setRunning(false); }
    else {
      if (sec===0) unlockAudio();
      intRef.current = setInterval(()=>{
        setSec(s=>{
          const next=s+1;
          if (next>=targetSec) { clearInterval(intRef.current); setRunning(false); bipEnd(); navigator.vibrate?.([300,100,300]); return targetSec; }
          if (targetSec-next<=5) bipTick();
          return next;
        });
      },1000);
      setRunning(true);
    }
  };
  useEffect(()=>()=>clearInterval(intRef.current),[]);
  return (
    <div onClick={toggle} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}>
      <div style={{position:"relative",width:52,height:52,flexShrink:0}}>
        <svg width={52} height={52} style={{transform:"rotate(-90deg)"}}>
          <circle cx={26} cy={26} r={r} fill="none" stroke={C.border} strokeWidth="4"/>
          <circle cx={26} cy={26} r={r} fill="none" stroke={done?C.green:urgent?C.red:color} strokeWidth="4"
            strokeDasharray={`${circ*pct} ${circ}`} strokeLinecap="round"
            style={{transition:"stroke-dasharray 1s linear,stroke 0.3s"}}/>
        </svg>
        <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",
          fontSize:10,fontWeight:800,fontFamily:"monospace",color:done?C.green:urgent?C.red:C.textDim}}>
          {done?"✓":fmtTime(running?targetSec-sec:sec>0?targetSec-sec:targetSec)}
        </div>
      </div>
      <div style={{fontSize:11,color:done?C.green:running?color:C.textDim,fontWeight:600}}>
        {done?"fatto! 💪":running?"in corso…":sec>0?"continua":"▶ avvia"}
      </div>
    </div>
  );
}

// ─── RECOVERY MINI ────────────────────────────────────────────────────────────
function RecoveryMini({ seconds, total, color, onExpand, onSkip }) {
  const pct=total>0?1-seconds/total:1, r=20, circ=2*Math.PI*r;
  const urgent=seconds<=5&&seconds>0, done=seconds<=0;
  return (
    <div style={{position:"fixed",bottom:80,right:14,zIndex:190,display:"flex",alignItems:"center",gap:8,
      background:"rgba(10,10,10,0.95)",border:`2px solid ${urgent?"#ff4a4a":done?"#44ff88":color}`,borderRadius:60,
      padding:"6px 10px 6px 6px",boxShadow:"0 6px 28px rgba(0,0,0,0.7)",cursor:"pointer",backdropFilter:"blur(8px)"}}
      onClick={onExpand}>
      <div style={{position:"relative",width:52,height:52}}>
        <svg width={52} height={52} style={{transform:"rotate(-90deg)"}}>
          <circle cx={26} cy={26} r={r} fill="none" stroke="#333" strokeWidth="4"/>
          <circle cx={26} cy={26} r={r} fill="none" stroke={done?"#44ff88":urgent?"#ff4a4a":color} strokeWidth="4"
            strokeDasharray={`${circ*pct} ${circ}`} strokeLinecap="round" style={{transition:"stroke-dasharray 1s linear"}}/>
        </svg>
        <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",
          fontSize:done?11:14,fontWeight:800,fontFamily:"monospace",color:done?"#44ff88":urgent?"#ff4a4a":"#f0f0f0"}}>
          {done?"💪":seconds}
        </div>
      </div>
      <button onClick={e=>{e.stopPropagation();onSkip();}} style={{background:"none",border:"none",color:"#666",cursor:"pointer",fontSize:18,padding:"0 2px",lineHeight:1}}>✕</button>
    </div>
  );
}

// ─── RECOVERY OVERLAY ─────────────────────────────────────────────────────────
function RecoveryOverlay({ seconds, total, exName, serieIdx, onSkip, onMinimize, C }) {
  const done=seconds<=0, pct=total>0?1-seconds/total:1;
  const r=45, circ=2*Math.PI*r, urgent=seconds<=5&&!done;
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.95)",backdropFilter:"blur(8px)",zIndex:200,
      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"3vmin"}}>
      <div style={{fontSize:"min(3.2vmin,18px)",letterSpacing:5,color:"#888",textTransform:"uppercase"}}>RECUPERO</div>
      <div style={{fontSize:"min(4.5vmin,26px)",color:"#f0f0f0",fontWeight:700,textAlign:"center",padding:"0 16px"}}>
        {exName} <span style={{opacity:0.6,fontWeight:500}}>— Serie {serieIdx} ✓</span>
      </div>
      <div style={{position:"relative",width:"min(70vmin,420px)",height:"min(70vmin,420px)"}}>
        <svg width="100%" height="100%" viewBox="0 0 100 100" style={{transform:"rotate(-90deg)"}}>
          <circle cx="50" cy="50" r={r} fill="none" stroke="#222" strokeWidth="5"/>
          <circle cx="50" cy="50" r={r} fill="none" stroke={urgent?"#ff4a4a":C.accent} strokeWidth="5"
            strokeDasharray={`${circ*pct} ${circ}`} strokeLinecap="round" style={{transition:"stroke-dasharray 1s linear,stroke 0.3s"}}/>
        </svg>
        <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
          {done
            ? <div style={{fontSize:"min(22vmin,130px)",animation:"pulse .4s ease infinite alternate"}}>💪</div>
            : <div style={{fontSize:"min(20vmin,120px)",fontWeight:800,color:urgent?"#ff4a4a":"#f0f0f0",fontFamily:"monospace",lineHeight:1,animation:urgent?"urgentPulse .5s ease infinite alternate":"none"}}>{seconds}</div>}
        </div>
      </div>
      {!done && (
        <div style={{display:"flex",gap:"2.5vmin",marginTop:"1vmin"}}>
          <button onClick={onMinimize} style={{background:"#1a1a1a",color:"#aaa",border:"1px solid #333",borderRadius:14,padding:"min(3vmin,16px) min(6vmin,32px)",fontSize:"min(3.5vmin,17px)",cursor:"pointer",fontWeight:600}}>⬇ Minimizza</button>
          <button onClick={onSkip} style={{background:"#1a1a1a",color:"#aaa",border:"1px solid #333",borderRadius:14,padding:"min(3vmin,16px) min(6vmin,32px)",fontSize:"min(3.5vmin,17px)",cursor:"pointer",fontWeight:600}}>salta →</button>
        </div>
      )}
      <style>{`@keyframes pulse{from{transform:scale(1);}to{transform:scale(1.08);}} @keyframes urgentPulse{from{opacity:1;}to{opacity:.4;}}`}</style>
    </div>
  );
}

// ─── SORTABLE LIST (Pointer Events) ──────────────────────────────────────────
function SortableList({ items, renderItem, onReorder }) {
  const [dragging, setDragging] = useState(null);
  const [over,     setOver]     = useState(null);
  const stateRef  = useRef({ dragging:null, over:null, active:false, startY:0, longTimer:null });
  const autoRaf   = useRef(null);
  const lastPY    = useRef(0);
  const EDGE=70, MAX_SPEED=14;

  // ── Desktop: HTML5 DnD ──
  const onDragEnd = () => {
    if (dragging!==null && over!==null && dragging!==over) {
      const n=[...items]; const [m]=n.splice(dragging,1); n.splice(over,0,m); onReorder(n);
    }
    setDragging(null); setOver(null);
  };

  // ── Auto-scroll loop ──
  const autoScroll = () => {
    const y=lastPY.current, vh=window.innerHeight;
    let sp=0;
    if (y<EDGE) sp=-MAX_SPEED*(1-y/EDGE);
    else if (y>vh-EDGE) sp=MAX_SPEED*(1-(vh-y)/EDGE);
    if (sp!==0) window.scrollBy(0,sp);
    const el=document.elementFromPoint(window.innerWidth/2,y);
    const card=el?.closest('[data-sortidx]');
    if (card) { const idx=parseInt(card.getAttribute('data-sortidx')); if(!isNaN(idx)&&idx!==stateRef.current.over){stateRef.current.over=idx;setOver(idx);} }
    if (stateRef.current.active) autoRaf.current=requestAnimationFrame(autoScroll);
  };

  // ── Pointer Events sul manico ──
  const onHandlePointerDown = useCallback((idx, e) => {
    if (e.pointerType==="mouse") return; // desktop usa DnD
    const sy=e.clientY;
    stateRef.current.startY=sy;
    stateRef.current.longTimer=setTimeout(()=>{
      stateRef.current.active=true; stateRef.current.dragging=idx; stateRef.current.over=idx;
      setDragging(idx); setOver(idx);
      navigator.vibrate?.(15);
      document.body.style.touchAction="none";
      lastPY.current=sy;
      autoRaf.current=requestAnimationFrame(autoScroll);
    },150);
  }, [items]);

  const onHandlePointerMove = useCallback((e) => {
    if (!stateRef.current.active) {
      if (stateRef.current.longTimer && Math.abs(e.clientY-stateRef.current.startY)>8) {
        clearTimeout(stateRef.current.longTimer); stateRef.current.longTimer=null;
      }
      return;
    }
    e.preventDefault();
    lastPY.current=e.clientY;
    const el=document.elementFromPoint(e.clientX,e.clientY);
    const card=el?.closest('[data-sortidx]');
    if (card) { const idx=parseInt(card.getAttribute('data-sortidx')); if(!isNaN(idx)&&idx!==stateRef.current.over){stateRef.current.over=idx;setOver(idx);} }
  }, []);

  const onHandlePointerUp = useCallback(() => {
    clearTimeout(stateRef.current.longTimer); stateRef.current.longTimer=null;
    cancelAnimationFrame(autoRaf.current);
    document.body.style.touchAction="";
    if (stateRef.current.active) {
      const {dragging:from, over:to}=stateRef.current;
      if (from!==null && to!==null && from!==to) {
        const n=[...items]; const [m]=n.splice(from,1); n.splice(to,0,m); onReorder(n);
      }
    }
    stateRef.current={dragging:null,over:null,active:false,startY:0,longTimer:null};
    setDragging(null); setOver(null);
  }, [items]);

  useEffect(()=>()=>{ cancelAnimationFrame(autoRaf.current); document.body.style.touchAction=""; },[]);

  return (
    <div>
      {items.map((item,i)=>(
        <div key={item.id} data-sortidx={i} draggable
          onDragStart={()=>setDragging(i)} onDragEnter={()=>setOver(i)}
          onDragEnd={onDragEnd} onDragOver={e=>e.preventDefault()}
          style={{opacity:dragging===i?0.35:1,transform:dragging===i?"scale(1.02)":"none",
            boxShadow:dragging===i?"0 8px 24px rgba(0,0,0,0.5)":"none",
            transition:"opacity .15s,transform .15s,box-shadow .15s",
            borderTop:over===i&&dragging!==i?"3px solid #e8ff47":"3px solid transparent",borderRadius:14}}>
          {renderItem(item,i,{onHandlePointerDown:e=>onHandlePointerDown(i,e),onHandlePointerMove,onHandlePointerUp})}
        </div>
      ))}
    </div>
  );
}

// ─── EXERCISE CARD ────────────────────────────────────────────────────────────
function ExCard({ ex, color, bodyKg, history, onUpdate, onDelete, onStartTimer, C, dragHandlers }) {
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [errors, setErrors] = useState({});

  const doneSeries=(ex.seriesData||[]).filter(s=>s.done).length;
  const totalSeries=ex.sets||0;
  const isComplete=doneSeries===totalSeries&&totalSeries>0;
  const inProgress=doneSeries>0&&!isComplete;
  const dotColor=isComplete?C.green:inProgress?color:C.muted;
  const dotGlow=isComplete?`0 0 8px ${C.green}`:"none";
  const nextSerieIdx=(ex.seriesData||[]).findIndex(s=>!s.done);
  const isIso=ex.rom===0;

  const iSt={background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 10px",color:C.text,fontSize:14,outline:"none",fontFamily:"inherit",WebkitAppearance:"none",MozAppearance:"textfield"};

  const setErr = (k,msg) => setErrors(e=>({...e,[k]:msg}));
  const clearErr = (k) => setErrors(e=>{const n={...e};delete n[k];return n;});

  const updateSeriesField = (i, field, raw) => {
    const {err}=validateField(field,raw);
    const key=`s${i}_${field}`;
    err ? setErr(key,err) : clearErr(key);
    const sd=[...(ex.seriesData||[])]; sd[i]={...sd[i],[field]:raw}; onUpdate({...ex,seriesData:sd});
  };

  const registerSerie = (i) => {
    // Controlla errori prima di registrare
    const s=ex.seriesData[i];
    const kgV=validateField("kg",s.kg), repV=validateField("reps",s.reps);
    if (kgV.err||repV.err) { setErr(`s${i}_kg`,kgV.err); setErr(`s${i}_reps`,repV.err); return; }
    unlockAudio();
    const sd=[...(ex.seriesData||[])]; sd[i]={...sd[i],done:true}; onUpdate({...ex,seriesData:sd});
    onStartTimer(ex.rest||90,ex.name,i+1);
  };

  const resetSeries = () => { setErrors({}); onUpdate({...ex,seriesData:makeSeriesData(ex.sets,ex.reps,ex.kg)}); };

  const updateConfig = (patch) => {
    const updated={...ex,...patch};
    // Valida
    if (patch.sets!==undefined) { const {err}=validateField("sets",patch.sets); err?setErr("sets",err):clearErr("sets"); }
    if (patch.rest!==undefined) { const {err}=validateField("rest",patch.rest); err?setErr("rest",err):clearErr("rest"); }
    const newSets=parseInt(updated.sets)||0;
    const existing=ex.seriesData||[];
    const sd=Array.from({length:newSets},(_,i)=>{
      const prev=existing[i]||{kg:String(updated.kg||""),reps:String(updated.reps||""),done:false};
      return {...prev,index:i,reps:patch.reps!==undefined?String(updated.reps||""):prev.reps};
    });
    onUpdate({...updated,seriesData:sd});
  };

  const ErrMsg = ({k}) => errors[k] ? <div style={{fontSize:10,color:C.red,marginTop:1}}>{errors[k]}</div> : null;

  return (
    <>
    <div style={{background:C.card,borderRadius:14,border:`1px solid ${C.border}`,marginBottom:10,overflow:"hidden"}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",padding:"14px 14px",gap:12}}>
        <div
          onPointerDown={dragHandlers?.onHandlePointerDown}
          onPointerMove={dragHandlers?.onHandlePointerMove}
          onPointerUp={dragHandlers?.onHandlePointerUp}
          style={{color:C.muted,fontSize:22,cursor:"grab",padding:"8px 6px",userSelect:"none",WebkitUserSelect:"none",touchAction:"none",lineHeight:1}}>⠿</div>
        <div style={{width:11,height:11,borderRadius:"50%",background:dotColor,boxShadow:dotGlow,flexShrink:0}}/>
        <div style={{flex:1,minWidth:0,cursor:"pointer"}} onClick={()=>setOpen(o=>!o)}>
          <div style={{fontSize:16,fontWeight:700,color:isComplete?C.textDim:C.text,textDecoration:isComplete?"line-through":"none",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{ex.name}</div>
          <div style={{fontSize:12,color:C.textDim,marginTop:3}}>{doneSeries}/{totalSeries} serie · {ex.reps} {isIso?"sec":"reps"} · {ex.rest}s rec{ex.rpe?` · RPE ${ex.rpe}`:""}</div>
        </div>
        <button onClick={e=>{e.stopPropagation();setShowHistory(true);}}
          style={{background:"none",border:"none",color:C.textDim,cursor:"pointer",fontSize:16,padding:"4px"}}>📈</button>
        <span style={{color:C.muted,fontSize:13,cursor:"pointer"}} onClick={()=>setOpen(o=>!o)}>{open?"▲":"▼"}</span>
      </div>

      {open && (
        <div style={{padding:"0 14px 14px",borderTop:`1px solid ${C.border}`}}>
          <input value={ex.name} onChange={e=>onUpdate({...ex,name:e.target.value})}
            style={{...iSt,width:"100%",marginTop:12,fontSize:15,fontWeight:700}} placeholder="Nome esercizio"/>

          <FL icon="⚙" t="Regolazioni macchinario" C={C}/>
          <TA value={ex.machineNote} onChange={v=>onUpdate({...ex,machineNote:v})} placeholder="es. sedile 3…" bc={C.border} C={C}/>
          <FL icon="📝" t="Note prossima volta" C={C}/>
          <TA value={ex.nextNote} onChange={v=>onUpdate({...ex,nextNote:v})} placeholder="es. aumentare peso…" bc={C.blue+"55"} C={C}/>

          {/* Config */}
          <div style={{display:"flex",gap:8,marginBottom:4,alignItems:"flex-start"}}>
            {[{label:"Serie tot.",key:"sets",type:"number"},{label:isIso?"Sec":"Reps",key:"reps",type:"number"},{label:"Rec (s)",key:"rest",type:"number"}].map(({label,key,type})=>(
              <div key={key} style={{display:"flex",flexDirection:"column",gap:3,alignItems:"center"}}>
                <span style={{fontSize:10,color:C.textDim,whiteSpace:"nowrap"}}>{label}</span>
                <input type={type} value={ex[key]} onFocus={e=>{if(e.target.value==="0")e.target.value="";}}
                  onChange={e=>updateConfig({[key]:type==="number"?Number(e.target.value):e.target.value})}
                  style={{...iSt,textAlign:"center",padding:"7px 0",fontSize:16,fontWeight:700,width:58,
                    borderColor:errors[key]?C.red:C.border}}/>
                <ErrMsg k={key}/>
              </div>
            ))}
          </div>

          {/* Serie rows */}
          <div style={{marginTop:10}}>
            {(ex.seriesData||[]).map((s,i)=>{
              const isDone=s.done, isNext=i===nextSerieIdx;
              const targetSec=parseInt(s.reps)||parseInt(ex.reps)||45;
              return (
                <div key={i} style={{display:"flex",alignItems:"flex-start",gap:6,marginBottom:8,background:C.surface,borderRadius:10,padding:"8px 8px",border:`1px solid ${C.border}`}}>
                  <div style={{width:22,height:22,borderRadius:"50%",border:`2px solid ${isDone?C.green:C.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:isDone?C.green:C.textDim,flexShrink:0,background:isDone?C.green+"22":"none",marginTop:4}}>
                    {isDone?"✓":i+1}
                  </div>
                  {isIso ? (
                    <div style={{display:"flex",alignItems:"center",gap:8,flex:1}}>
                      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
                        <input type="number" value={s.reps} onFocus={e=>{if(e.target.value==="0")e.target.value="";}}
                          onChange={e=>updateSeriesField(i,"reps",e.target.value)}
                          style={{...iSt,width:52,textAlign:"center",padding:"6px 0",fontSize:16,fontWeight:700,borderColor:errors[`s${i}_reps`]?C.red:C.border}}/>
                        <span style={{fontSize:9,color:C.textDim}}>sec</span>
                        <ErrMsg k={`s${i}_reps`}/>
                      </div>
                      <PlankTimer targetSec={targetSec} color={color} C={C}/>
                    </div>
                  ) : (
                    <div style={{display:"flex",alignItems:"flex-start",gap:6,flex:1}}>
                      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
                        <input type="number" value={s.kg} onFocus={e=>{if(e.target.value==="0")e.target.value="";}}
                          onChange={e=>updateSeriesField(i,"kg",e.target.value)}
                          style={{...iSt,width:52,textAlign:"center",padding:"6px 0",fontSize:16,fontWeight:700,borderColor:errors[`s${i}_kg`]?C.red:C.border}}/>
                        <span style={{fontSize:9,color:C.textDim}}>kg</span>
                        <ErrMsg k={`s${i}_kg`}/>
                      </div>
                      <span style={{color:C.muted,fontSize:13,flexShrink:0,marginTop:8}}>×</span>
                      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
                        <input value={s.reps} onFocus={e=>{if(e.target.value==="0")e.target.value="";}}
                          onChange={e=>updateSeriesField(i,"reps",e.target.value)}
                          style={{...iSt,width:52,textAlign:"center",padding:"6px 0",fontSize:16,fontWeight:700,borderColor:errors[`s${i}_reps`]?C.red:C.border}}/>
                        <span style={{fontSize:9,color:C.textDim}}>rip</span>
                        <ErrMsg k={`s${i}_reps`}/>
                      </div>
                    </div>
                  )}
                  <div style={{marginLeft:"auto",flexShrink:0,marginTop:4}}>
                    {isDone
                      ? <span style={{fontSize:12,fontWeight:600,color:C.green}}>fatto</span>
                      : isNext
                        ? <button onClick={()=>registerSerie(i)} style={{background:color,color:"#000",border:"none",borderRadius:8,padding:"6px 10px",cursor:"pointer",fontSize:12,fontWeight:700,whiteSpace:"nowrap"}}>✓ Registra</button>
                        : <span style={{fontSize:12,color:C.textDim}}>in attesa</span>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* RPE */}
          <RpeSelector value={ex.rpe} onChange={v=>onUpdate({...ex,rpe:v})} color={color} C={C}/>

          {/* Stima calorica con disclaimer */}
          {bodyKg>0 && (() => { const kcal=calcCalories(ex,bodyKg); return kcal>0 ? (
            <div style={{marginTop:12,background:C.surface,borderRadius:10,padding:"8px 12px",border:`1px dashed ${C.border}`}}>
              <span style={{fontSize:12,color:"#ff8c42"}}>🔥 ~{kcal} kcal stimate</span>
              <span style={{fontSize:11,color:C.textDim}}> · stima orientativa (±30%)</span>
            </div>
          ) : null; })()}

          <div style={{display:"flex",gap:8,marginTop:12}}>
            {doneSeries>0&&<button onClick={resetSeries} style={{flex:1,background:C.surface,color:C.textDim,border:`1px solid ${C.border}`,borderRadius:9,padding:"7px 0",cursor:"pointer",fontSize:12}}>↺ reset serie</button>}
            <button onClick={()=>{if(window.confirm(`Eliminare "${ex.name}"?`))onDelete();}} style={{flex:1,background:C.red+"18",color:C.red,border:`1px solid ${C.red}33`,borderRadius:9,padding:"7px 0",cursor:"pointer",fontSize:12}}>🗑 Elimina</button>
          </div>
        </div>
      )}
    </div>
    {showHistory && <ExHistoryModal exName={ex.name} history={history} C={C} onClose={()=>setShowHistory(false)}/>}
    </>
  );
}

const FL=({icon,t,C})=><div style={{fontSize:10,letterSpacing:2,color:C.textDim,margin:"12px 0 6px",textTransform:"uppercase"}}>{icon} {t}</div>;
const TA=({value,onChange,placeholder,bc,C})=>(
  <textarea value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} rows={2}
    style={{width:"100%",background:C.surface,border:`1px solid ${bc}`,borderRadius:10,padding:"8px 12px",color:C.text,fontSize:13,resize:"vertical",fontFamily:"inherit",boxSizing:"border-box",lineHeight:1.5,marginBottom:12,outline:"none"}}/>
);

// ─── ADD EXERCISE MODAL ───────────────────────────────────────────────────────
function AddExModal({ onAdd, onClose, C }) {
  const [cat,setCat]=useState(null);
  const catData=cat!==null?EX_LIBRARY[cat]:null;
  const add=(name,rom,def)=>{ onAdd(mkEx(name,rom,def.sets,def.reps,0,def.rest)); onClose(); };
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",backdropFilter:"blur(6px)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:150,padding:16}} onClick={onClose}>
      <div style={{background:C.surface,borderRadius:20,padding:20,width:"100%",maxWidth:480,border:`1px solid ${C.border}`,maxHeight:"70vh",display:"flex",flexDirection:"column"}} onClick={e=>e.stopPropagation()}>
        {cat===null?(
          <>
            <div style={{fontWeight:700,fontSize:16,marginBottom:16,color:C.text}}>Scegli categoria</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,overflowY:"auto"}}>
              {EX_LIBRARY.map((c,i)=>(
                <button key={i} onClick={()=>setCat(i)} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:"14px 10px",cursor:"pointer",textAlign:"left"}}>
                  <div style={{fontSize:20,marginBottom:4}}>{c.cat.split(" ")[0]}</div>
                  <div style={{fontSize:13,fontWeight:600,color:C.text}}>{c.cat.split(" ").slice(1).join(" ")}</div>
                  <div style={{fontSize:11,color:C.textDim,marginTop:2}}>ROM {c.rom}m · {c.defaults.sets}×{c.defaults.reps}</div>
                </button>
              ))}
            </div>
          </>
        ):(
          <>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
              <button onClick={()=>setCat(null)} style={{background:"none",border:"none",color:C.accent,cursor:"pointer",fontSize:13,fontWeight:700}}>← Back</button>
              <div style={{fontWeight:700,fontSize:16,color:C.text}}>{catData.cat}</div>
            </div>
            <div style={{overflowY:"auto",flex:1}}>
              {catData.items.map((item,i)=>(
                <div key={i} onClick={()=>add(item.name,item.rom,catData.defaults)}
                  style={{padding:"12px 14px",borderRadius:10,cursor:"pointer",marginBottom:4,display:"flex",justifyContent:"space-between",alignItems:"center"}}
                  onMouseEnter={e=>e.currentTarget.style.background=C.card}
                  onMouseLeave={e=>e.currentTarget.style.background="none"}>
                  <span style={{fontSize:14,color:C.text}}>{item.name}</span>
                  <span style={{fontSize:11,color:C.textDim}}>ROM {item.rom}m</span>
                </div>
              ))}
              <div onClick={()=>add("Nuovo esercizio",catData.rom,catData.defaults)}
                style={{padding:"12px 14px",borderRadius:10,cursor:"pointer",marginTop:4,border:`1px dashed ${C.border}`,color:C.accent,fontSize:13,fontWeight:600,textAlign:"center"}}>
                + Altro esercizio {catData.cat.split(" ")[0]}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── NEW SCHEDA MODAL ─────────────────────────────────────────────────────────
// ─── PARSER TEMPLATE SCHEDA ───────────────────────────────────────────────────
// Formato: una riga per esercizio
// NomeEsercizio | serie x reps | kg | rec
// Es: Leg Press | 4x12 | 32 | 120
// kg e rec sono opzionali (default 0 e 90)
function parseSchedaTemplate(text) {
  // Pre-processing: unisce righe spezzate dal word-wrap della textarea.
  // Una riga "orfana" è qualsiasi riga che NON contiene il separatore |
  // e non è un commento — viene attaccata alla riga precedente.
  const rawLines = text.split("\n");
  const joined = [];
  for (const line of rawLines) {
    const t = line.trim();
    if (!t) { joined.push(""); continue; }
    if (t.startsWith("#")) { joined.push(t); continue; }
    if (!t.includes("|") && joined.length > 0) {
      const last = joined[joined.length - 1];
      if (last && !last.startsWith("#") && last.includes("|")) {
        joined[joined.length - 1] = last.trimEnd() + " " + t;
        continue;
      }
    }
    joined.push(t);
  }

  const lines = joined.filter(l => l && !l.startsWith("#"));
  const errors = [];
  const exercises = [];

  lines.forEach((line, i) => {
    const parts = line.split(/[|;]/).map(p => p.trim());

    // Tutti e 4 i campi sono obbligatori
    if (parts.length < 4) {
      errors.push(`Riga ${i+1}: campi mancanti — servono tutti e 4: Nome | Serie x Reps | Kg | Rec(s)`);
      return;
    }

    const name = parts[0];
    if (!name) { errors.push(`Riga ${i+1}: nome mancante`); return; }

    const serieMatch = parts[1].replace(/[×x]/gi,"x").replace(/\s/g,"").match(/^(\d+)x(\d+)$/i);
    if (!serieMatch) { errors.push(`Riga ${i+1}: formato serie non valido — usa "4x12"`); return; }

    const sets = parseInt(serieMatch[1]);
    const reps = parseInt(serieMatch[2]);

    const kg = parseFloat(parts[2]);
    if (isNaN(kg) || kg < 0) { errors.push(`Riga ${i+1}: kg non valido`); return; }

    const rest = parseInt(parts[3]);
    if (isNaN(rest) || rest < 1) { errors.push(`Riga ${i+1}: recupero non valido — inserisci i secondi (es. 90)`); return; }

    if (sets < 1 || sets > 20)  { errors.push(`Riga ${i+1}: serie fuori range (1-20)`); return; }
    if (reps < 1 || reps > 200) { errors.push(`Riga ${i+1}: reps fuori range (1-200)`); return; }
    if (kg > 500)                { errors.push(`Riga ${i+1}: kg fuori range (max 500)`); return; }
    if (rest > 600)              { errors.push(`Riga ${i+1}: recupero fuori range (max 600s)`); return; }

    exercises.push(mkEx(name, 0.40, sets, reps, kg, rest));
  });

  return { exercises, errors };
}

const TEMPLATE_EXAMPLE = `# Tutti e 4 i campi sono OBBLIGATORI:
# Nome | Serie x Reps | Kg | Recupero(s)

Leg Press | 4x12 | 32 | 120
Leg Extension | 3x12 | 18 | 90
Hamstring Curl | 3x12 | 38 | 90
Lat Pull | 4x10 | 40 | 90
Rematore Presa Stretta | 4x10 | 25 | 90`;

function NewSchedaModal({ onAdd, onClose, C }) {
  const [tab, setTab] = useState("crea"); // "crea" | "importa"
  const [name, setName] = useState("");
  const [importName, setImportName] = useState("");
  const [templateText, setTemplateText] = useState(TEMPLATE_EXAMPLE);
  const [parseResult, setParseResult] = useState(null); // {exercises, errors}

  const handleParse = () => {
    const result = parseSchedaTemplate(templateText);
    setParseResult(result);
  };

  const handleImport = () => {
    if (!importName.trim()) return;
    if (!parseResult || parseResult.exercises.length === 0) return;
    onAdd(importName.trim(), parseResult.exercises);
    onClose();
  };

  const tabSt = (active) => ({
    flex:1, background:"none", border:"none",
    borderBottom:`2px solid ${active ? C.accent : "transparent"}`,
    color: active ? C.text : C.textDim,
    padding:"10px 0", cursor:"pointer", fontSize:14, fontWeight: active ? 700 : 500,
    transition:"border-color .15s",
  });

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",backdropFilter:"blur(6px)",
      display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:150,padding:16}} onClick={onClose}>
      <div style={{background:C.surface,borderRadius:20,width:"100%",maxWidth:480,
        border:`1px solid ${C.border}`,maxHeight:"88vh",display:"flex",flexDirection:"column"}}
        onClick={e=>e.stopPropagation()}>

        {/* Tab header */}
        <div style={{display:"flex",borderBottom:`1px solid ${C.border}`,padding:"0 20px"}}>
          <button style={tabSt(tab==="crea")} onClick={()=>setTab("crea")}>✏️ Nuova scheda</button>
          <button style={tabSt(tab==="importa")} onClick={()=>setTab("importa")}>📋 Importa template</button>
        </div>

        <div style={{overflowY:"auto",padding:20,flex:1}}>
          {tab==="crea" && (
            <>
              <div style={{fontSize:14,color:C.textDim,marginBottom:12}}>
                Crea una scheda vuota e aggiungi gli esercizi uno per uno.
              </div>
              <input autoFocus value={name} onChange={e=>setName(e.target.value)}
                placeholder="Nome scheda…"
                onKeyDown={e=>{if(e.key==="Enter"&&name.trim()){onAdd(name.trim(),[]);onClose();}}}
                style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 14px",
                  color:C.text,fontSize:15,outline:"none",width:"100%",marginBottom:16,fontFamily:"inherit"}}/>
              <div style={{display:"flex",gap:8}}>
                <button onClick={onClose} style={{flex:1,background:"none",color:C.textDim,border:`1px solid ${C.border}`,borderRadius:10,padding:"11px 0",cursor:"pointer",fontSize:14}}>Annulla</button>
                <button onClick={()=>{if(name.trim()){onAdd(name.trim(),[]);onClose();}}}
                  style={{flex:1,background:C.orange,color:"#000",border:"none",borderRadius:10,padding:"11px 0",cursor:"pointer",fontWeight:700,fontSize:14}}>Crea</button>
              </div>
            </>
          )}

          {tab==="importa" && (
            <>
              <div style={{background:C.card,borderRadius:10,padding:"10px 14px",marginBottom:14,
                border:`1px solid ${C.border}`}}>
                <div style={{fontSize:12,fontWeight:700,color:C.accent,marginBottom:4}}>FORMATO — tutti i campi obbligatori</div>
                <div style={{fontSize:12,color:C.text,lineHeight:1.6,fontFamily:"monospace"}}>
                  Nome | Serie x Reps | Kg | Rec(s)
                </div>
                <div style={{fontSize:11,color:C.textDim,marginTop:4}}>
                  Es: <span style={{fontFamily:"monospace"}}>Leg Press | 4x12 | 32 | 120</span>
                </div>
                <div style={{fontSize:11,color:C.textDim,marginTop:2}}>Le righe con # sono commenti e vengono ignorate</div>
              </div>

              <div style={{fontSize:11,color:C.textDim,marginBottom:6}}>Incolla o modifica qui sotto:</div>
              <textarea
                value={templateText}
                onChange={e=>{setTemplateText(e.target.value); setParseResult(null);}}
                rows={10}
                style={{width:"100%",background:C.card,border:`1px solid ${C.border}`,borderRadius:10,
                  padding:"10px 12px",color:C.text,fontSize:13,fontFamily:"monospace",resize:"vertical",
                  lineHeight:1.7,outline:"none",boxSizing:"border-box",marginBottom:12,
                  whiteSpace:"pre",overflowX:"auto",overflowY:"auto"}}/>

              {/* Risultato parsing */}
              {parseResult && (
                <div style={{marginBottom:14}}>
                  {parseResult.errors.length > 0 ? (
                    <div style={{background:C.red+"18",border:`1px solid ${C.red}44`,borderRadius:10,padding:"10px 14px"}}>
                      <div style={{fontSize:12,fontWeight:700,color:C.red,marginBottom:6}}>⚠ Errori da correggere:</div>
                      {parseResult.errors.map((e,i)=>(
                        <div key={i} style={{fontSize:12,color:C.red,marginBottom:3}}>• {e}</div>
                      ))}
                    </div>
                  ) : (
                    <div style={{background:C.green+"18",border:`1px solid ${C.green}44`,borderRadius:10,padding:"12px 14px",display:"flex",alignItems:"center",gap:10}}>
                      <span style={{fontSize:20}}>✅</span>
                      <div>
                        <div style={{fontSize:14,fontWeight:700,color:C.green}}>{parseResult.exercises.length} esercizi pronti</div>
                        <div style={{fontSize:11,color:C.textDim,marginTop:2}}>Nessuna difformità rilevata</div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <button onClick={handleParse}
                style={{width:"100%",background:C.blue,color:"#000",border:"none",borderRadius:10,
                  padding:"11px 0",cursor:"pointer",fontWeight:700,fontSize:14,marginBottom:12}}>
                🔍 Controlla template
              </button>

              {parseResult && parseResult.exercises.length > 0 && parseResult.errors.length === 0 && (
                <>
                  <input value={importName} onChange={e=>setImportName(e.target.value)}
                    placeholder="Nome della nuova scheda…"
                    style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 14px",
                      color:C.text,fontSize:15,outline:"none",width:"100%",marginBottom:12,fontFamily:"inherit"}}/>
                  <button onClick={handleImport} disabled={!importName.trim()}
                    style={{width:"100%",background:importName.trim()?C.accent:C.muted,color:"#000",border:"none",
                      borderRadius:10,padding:"12px 0",cursor:importName.trim()?"pointer":"not-allowed",
                      fontWeight:800,fontSize:15}}>
                    ✅ Importa scheda
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── STORICO SESSIONI ─────────────────────────────────────────────────────────
function StoricoView({ history, bodyKg, activeId, schedaLabel, onLoad, onUseAsBase, onDelete, C }) {
  if (!history.length) return <div style={{textAlign:"center",color:C.textDim,padding:"48px 0",fontSize:16}}>Nessuna sessione salvata.</div>;
  return (
    <div>
      {[...history].reverse().map((sess,i)=>{
        const vol=(sess.exercises||[]).reduce((a,e)=>a+(e.seriesData||[]).filter(s=>s.done).reduce((b,s)=>b+(parseFloat(s.kg)||0)*(parseFloat(s.reps)||0),0),0);
        const sessBodyKg=sess.bodyKg||bodyKg;
        const kcal=sess.kcal!=null?sess.kcal:Math.round((sess.exercises||[]).reduce((a,e)=>a+calcCalories(e,sessBodyKg),0));
        const sameScheda=sess.schedaId===activeId;
        const sessSchedaName=schedaLabel(sess.schedaId);
        return (
          <div key={i} style={{background:C.card,borderRadius:14,padding:18,marginBottom:12,border:`1px solid ${C.border}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  <div style={{fontWeight:700,fontSize:18,color:C.text}}>{sess.name||"Sessione"}</div>
                  <span style={{fontSize:11,fontWeight:700,color:C.textDim,background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:"2px 8px"}}>{sessSchedaName}</span>
                </div>
                <div style={{fontSize:14,color:C.textDim,marginTop:3}}>
                  {new Date(sess.date).toLocaleDateString("it-IT",{weekday:"long",day:"numeric",month:"long",year:"numeric"})} · {new Date(sess.date).toLocaleTimeString("it-IT",{hour:"2-digit",minute:"2-digit"})}
                </div>
                <div style={{display:"flex",gap:10,marginTop:6,flexWrap:"wrap",alignItems:"center"}}>
                  <span style={{fontSize:14,color:C.accentDim}}>{(sess.exercises||[]).length} es · {vol>0?`${vol.toLocaleString("it")} kg vol`:"—"}</span>
                  {sess.duration&&<span style={{fontSize:14,color:C.textDim}}>⏱ {fmtTime(sess.duration)}</span>}
                  {kcal>0&&sessBodyKg>0&&<span style={{fontSize:14,color:"#ff8c42",fontWeight:700}}>🔥 ~{kcal} kcal <span style={{fontWeight:400,fontSize:11,color:C.textDim}}>(stima)</span></span>}
                </div>
              </div>
              <button onClick={()=>{if(window.confirm("Eliminare questa sessione?"))onDelete(i);}}
                style={{background:"none",color:C.textDim,border:`1px solid ${C.border}`,borderRadius:9,padding:"6px 11px",cursor:"pointer",fontSize:15,flexShrink:0}}>🗑</button>
            </div>
            <div style={{marginTop:10,display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>
              {(sess.exercises||[]).map((e,j)=>(
                <span key={j} style={{background:C.surface,borderRadius:7,padding:"4px 10px",fontSize:13,
                  color:e.rpe?(e.rpe<=4?"#44ff88":e.rpe<=6?"#f5a623":e.rpe<=8?"#ff8c42":"#ff4a4a"):C.textDim}}>
                  {e.name}{e.rpe?` · RPE${e.rpe}`:""}
                </span>
              ))}
            </div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>onLoad(sess)} style={{flex:1,background:C.surface,color:C.text,border:`1px solid ${C.border}`,borderRadius:10,padding:"11px 0",cursor:"pointer",fontSize:15,fontWeight:600}}>📂 Riapri</button>
              <button onClick={()=>sameScheda&&onUseAsBase(sess)} disabled={!sameScheda}
                title={sameScheda?"":` Passa a ${sessSchedaName} per usarla come base.`}
                style={{flex:1,background:sameScheda?C.accent:C.surface,color:sameScheda?"#000":C.muted,
                  border:sameScheda?"none":`1px solid ${C.border}`,borderRadius:10,padding:"11px 6px",
                  cursor:sameScheda?"pointer":"not-allowed",fontSize:14,fontWeight:700,opacity:sameScheda?1:0.6}}>
                {sameScheda?"🚀 Usa come base":`🔒 Solo per ${sessSchedaName}`}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── SESSION TIMER ────────────────────────────────────────────────────────────
function SessionTimer({ color, bodyKg, exercises, onSave, C, onRunningChange }) {
  const [state,setState]=useState("idle");
  const [elapsed,setElapsed]=useState(0);
  const startRef=useRef(null), intRef=useRef(null);
  const start=()=>{ startRef.current=Date.now()-elapsed*1000; intRef.current=setInterval(()=>setElapsed(Math.floor((Date.now()-startRef.current)/1000)),1000); setState("running"); onRunningChange?.(true); };
  const stop=()=>{ clearInterval(intRef.current); setState("done"); onRunningChange?.(false); };
  const reset=()=>{ clearInterval(intRef.current); setState("idle"); setElapsed(0); onRunningChange?.(false); };
  useEffect(()=>()=>clearInterval(intRef.current),[]);
  const metKcal=bodyKg>0?Math.round(5.0*bodyKg*(elapsed/3600)):0;
  if (state==="idle") return <button onClick={start} style={{width:"100%",background:color,color:"#000",border:"none",borderRadius:12,padding:"14px",fontSize:15,fontWeight:800,cursor:"pointer",marginBottom:14}}>▶ Inizia allenamento</button>;
  if (state==="running") return (
    <div style={{display:"flex",gap:8,marginBottom:14,alignItems:"center"}}>
      <div style={{flex:1,background:C.card,borderRadius:12,padding:"12px 16px",border:`1px solid ${C.border}`,fontFamily:"monospace",fontSize:22,fontWeight:800,color,textAlign:"center"}}>{fmtTime(elapsed)}</div>
      <button onClick={stop} style={{background:C.red,color:"#fff",border:"none",borderRadius:12,padding:"12px 18px",cursor:"pointer",fontSize:13,fontWeight:700,whiteSpace:"nowrap"}}>⏹ Fine</button>
    </div>
  );
  return (
    <div style={{background:C.card,borderRadius:12,padding:"14px 16px",border:`1px solid ${C.border}`,marginBottom:14}}>
      <div style={{fontSize:13,color:C.textDim,marginBottom:6}}>Allenamento completato</div>
      <div style={{display:"flex",gap:12,marginBottom:6}}>
        <div style={{textAlign:"center"}}><div style={{fontSize:20,fontWeight:800,color,fontFamily:"monospace"}}>{fmtTime(elapsed)}</div><div style={{fontSize:10,color:C.textDim}}>durata</div></div>
        {bodyKg>0&&<div style={{textAlign:"center"}}><div style={{fontSize:20,fontWeight:800,color:"#ff8c42"}}>~{metKcal}</div><div style={{fontSize:10,color:C.textDim}}>kcal (stima MET)</div></div>}
      </div>
      <div style={{fontSize:11,color:C.textDim,marginBottom:10}}>⚠ Stima orientativa ±30% — basata su MET 5.0 × peso × durata</div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={reset} style={{flex:1,background:C.surface,color:C.textDim,border:`1px solid ${C.border}`,borderRadius:9,padding:"8px 0",cursor:"pointer",fontSize:13}}>↺ Reset</button>
        <button onClick={()=>onSave(elapsed,metKcal)} style={{flex:1,background:color,color:"#000",border:"none",borderRadius:9,padding:"8px 0",cursor:"pointer",fontWeight:700,fontSize:13}}>💾 Salva sessione</button>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
// ─── SCHEDA SELECTOR ──────────────────────────────────────────────────────────
function SchedaSelector({ visibleBuiltin, customSchede, activeId, C, onSelect, onAdd, onDeleteBuiltin, onDeleteCustom }) {
  const [ctxMenu, setCtxMenu] = useState(null); // {id, name, isBuiltin}
  const pressTimer = useRef(null);

  const handlePressStart = (id, name, isBuiltin) => {
    pressTimer.current = setTimeout(() => {
      navigator.vibrate?.(30);
      setCtxMenu({ id, name, isBuiltin });
    }, 600);
  };
  const handlePressEnd = () => clearTimeout(pressTimer.current);

  const deleteScheda = () => {
    if (!ctxMenu) return;
    if (ctxMenu.isBuiltin) onDeleteBuiltin(ctxMenu.id);
    else onDeleteCustom(ctxMenu.id);
    setCtxMenu(null);
  };

  return (
    <>
      <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
        {visibleBuiltin.map(s => {
          const sc = s.id==="a" ? DARK.accent : DARK.blue;
          return (
            <button key={s.id}
              onClick={() => onSelect(s.id)}
              onMouseDown={() => handlePressStart(s.id, s.name, true)}
              onMouseUp={handlePressEnd} onMouseLeave={handlePressEnd}
              onTouchStart={() => handlePressStart(s.id, s.name, true)}
              onTouchEnd={handlePressEnd} onTouchCancel={handlePressEnd}
              style={{background:activeId===s.id?sc:C.card,color:activeId===s.id?"#000":C.textDim,
                border:`1px solid ${activeId===s.id?sc:C.border}`,borderRadius:11,padding:"9px 18px",
                cursor:"pointer",fontSize:15,fontWeight:700,transition:"all .15s",userSelect:"none"}}>
              {s.name}
            </button>
          );
        })}
        {customSchede.map(s => (
          <button key={s.id}
            onClick={() => onSelect(s.id)}
            onMouseDown={() => handlePressStart(s.id, s.name, false)}
            onMouseUp={handlePressEnd} onMouseLeave={handlePressEnd}
            onTouchStart={() => handlePressStart(s.id, s.name, false)}
            onTouchEnd={handlePressEnd} onTouchCancel={handlePressEnd}
            style={{background:activeId===s.id?DARK.orange:C.card,color:activeId===s.id?"#000":C.textDim,
              border:`1px solid ${activeId===s.id?DARK.orange:C.border}`,borderRadius:11,padding:"9px 18px",
              cursor:"pointer",fontSize:15,fontWeight:700,userSelect:"none"}}>
            {s.name}
          </button>
        ))}
        <button onClick={onAdd} style={{background:"none",border:`1px dashed ${C.border}`,borderRadius:11,padding:"9px 16px",cursor:"pointer",color:C.textDim,fontSize:15}}>+</button>
      </div>
      <div style={{fontSize:11,color:C.textDim,marginBottom:12,paddingLeft:2}}>
        Tieni premuto su una scheda per eliminarla
      </div>

      {ctxMenu && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",backdropFilter:"blur(4px)",
          zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}
          onClick={()=>setCtxMenu(null)}>
          <div style={{background:C.surface,borderRadius:18,padding:24,width:"100%",maxWidth:320,
            border:`1px solid ${C.border}`}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:17,fontWeight:800,color:C.text,marginBottom:6}}>{ctxMenu.name}</div>
            <div style={{fontSize:13,color:C.textDim,marginBottom:20}}>
              Vuoi eliminare questa scheda? Lo storico delle sessioni resterà intatto.
            </div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>setCtxMenu(null)} style={{flex:1,background:C.card,color:C.text,
                border:`1px solid ${C.border}`,borderRadius:11,padding:"12px 0",cursor:"pointer",fontSize:15,fontWeight:600}}>
                Annulla
              </button>
              <button onClick={deleteScheda} style={{flex:1,background:C.red,color:"#fff",border:"none",
                borderRadius:11,padding:"12px 0",cursor:"pointer",fontSize:15,fontWeight:700}}>
                🗑 Elimina
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function GymBro() {
  const [darkMode,setDarkMode]=useState(()=>{ try{return localStorage.getItem("gymbro_dark")!=="false";}catch{return true;} });
  const C=darkMode?DARK:LIGHT;
  const [tab,setTab]=useState("workout");
  const [bodyKg,setBodyKg]=useState(()=>{ try{return parseFloat(localStorage.getItem("gymbro_bodykg")||"0");}catch{return 0;} });
  const [activeId,setActiveId]=useState(()=>localStorage.getItem("gymbro_scheda")||"a");
  const [customSchede,setCustomSchede]=useState(()=>{ try{return JSON.parse(localStorage.getItem("gymbro_custom_schede")||"[]");}catch{return[];} });
  const [history,setHistory]=useState(()=>{ try{return JSON.parse(localStorage.getItem("gymbro_history")||"[]");}catch{return[];} });
  const [sessName,setSessName]=useState("");
  const [exercises,setExercises]=useState([]);
  const [draftBanner,setDraftBanner]=useState(false); // banner ripristino bozza
  const [showAddEx,setShowAddEx]=useState(false);
  const [showNewScheda,setShowNewScheda]=useState(false);
  const [editName,setEditName]=useState(false);
  const [hiddenBuiltin,setHiddenBuiltin]=useState(()=>{ try{return JSON.parse(localStorage.getItem("gymbro_hidden_builtin")||"[]");}catch{return[];} });
  const [workoutRunning,setWorkoutRunning]=useState(false);
  const [bodyKgErr,setBodyKgErr]=useState(null);
  const [toast,setToast]=useState(null);
  const toastRef=useRef(null);

  const showToast=useCallback((text,icon="✅",color=null)=>{
    clearTimeout(toastRef.current);
    setToast({text,icon,color});
    navigator.vibrate?.(40);
    toastRef.current=setTimeout(()=>setToast(null),3000);
  },[]);

  const [recovery,setRecovery]=useState(null);
  const recIntRef=useRef(null);

  useWakeLock(workoutRunning||!!recovery);

  const schedaColor=activeId==="a"?DARK.accent:activeId==="b"?DARK.blue:DARK.orange;

  useEffect(()=>{
    if(activeId==="a") setExercises(SCHEDA_A_EXERCISES());
    else if(activeId==="b") setExercises(SCHEDA_B_EXERCISES());
    else { const cs=customSchede.find(s=>s.id===activeId); setExercises(cs?.exercises?cs.exercises.map(e=>({...e,id:uid(),seriesData:makeSeriesData(e.sets,e.reps,e.kg)})):[]); }
    setSessName("");
  },[activeId]);

  useEffect(()=>{ try{localStorage.setItem("gymbro_dark",String(darkMode));}catch{} },[darkMode]);
  useEffect(()=>{ try{localStorage.setItem("gymbro_bodykg",String(bodyKg));}catch{} },[bodyKg]);
  useEffect(()=>{ try{localStorage.setItem("gymbro_scheda",activeId);}catch{} },[activeId]);
  useEffect(()=>{ try{localStorage.setItem("gymbro_custom_schede",JSON.stringify(customSchede));}catch{} },[customSchede]);
  useEffect(()=>{ try{localStorage.setItem("gymbro_hidden_builtin",JSON.stringify(hiddenBuiltin));}catch{} },[hiddenBuiltin]);
  useEffect(()=>{ try{localStorage.setItem("gymbro_history",JSON.stringify(history));}catch{} },[history]);

  // ── Controlla bozza al primo avvio ──
  useEffect(()=>{
    try {
      const draft = localStorage.getItem("gymbro_draft");
      if (draft) setDraftBanner(true);
    } catch {}
  }, []);

  // ── Autosave bozza: si attiva quando almeno una serie è fatta ──
  useEffect(()=>{
    const hasDone = exercises.some(e=>(e.seriesData||[]).some(s=>s.done));
    if (!hasDone) return; // non salvare se non è ancora iniziata
    try {
      const draft = { exercises, sessName, activeId, date: Date.now() };
      localStorage.setItem("gymbro_draft", JSON.stringify(draft));
    } catch {}
  }, [exercises, sessName]);

  useEffect(()=>{
    const init=()=>unlockAudio();
    window.addEventListener("touchstart",init,{once:true});
    window.addEventListener("mousedown",init,{once:true});
    window.addEventListener("touchstart",unlockAudio);
    return()=>{ window.removeEventListener("touchstart",init); window.removeEventListener("mousedown",init); window.removeEventListener("touchstart",unlockAudio); };
  },[]);

  const startTimer=useCallback((total,exName,serieIdx)=>{
    clearInterval(recIntRef.current);
    bipStart();
    setRecovery({total,seconds:total,exName,serieIdx,minimized:false});
    recIntRef.current=setInterval(()=>{
      setRecovery(r=>{
        if(!r) return null;
        const next=r.seconds-1;
        if(next<=5&&next>0) bipTick();
        if(next<=0){ clearInterval(recIntRef.current); bipEnd(); navigator.vibrate?.([200,100,200,100,400]); setTimeout(()=>setRecovery(null),1500); return{...r,seconds:0,minimized:false}; }
        return{...r,seconds:next};
      });
    },1000);
  },[]);

  const closeRecovery=()=>{ clearInterval(recIntRef.current); setRecovery(null); };
  const minimizeRecovery=()=>setRecovery(r=>r?{...r,minimized:true}:null);
  const expandRecovery=()=>setRecovery(r=>r?{...r,minimized:false}:null);

  const visibleBuiltin = BUILT_IN_SCHEDE.filter(s=>!hiddenBuiltin.includes(s.id));
  const allSchede=[...visibleBuiltin,...customSchede.map(s=>({id:s.id,name:s.name}))];
  const activeScheda=allSchede.find(s=>s.id===activeId)||allSchede[0];
  const schedaLabel=useCallback((id)=>{ const s=allSchede.find(s=>s.id===id); return s?s.name:"Scheda eliminata"; },[allSchede]);

  const updateEx=useCallback((id,data)=>setExercises(xs=>xs.map(e=>e.id===id?data:e)),[]);
  const deleteEx=useCallback((id)=>setExercises(xs=>xs.filter(e=>e.id!==id)),[]);
  const addEx=(ex)=>setExercises(xs=>[...xs,ex]);
  const reorderEx=(nl)=>setExercises(nl);
  const addCustomScheda=(name, exercises=[])=>{ const ns={id:uid(),name,exercises}; setCustomSchede(prev=>[...prev,ns]); setActiveId(ns.id); if(exercises.length>0) setExercises(exercises.map(e=>({...e,id:uid(),seriesData:makeSeriesData(e.sets,e.reps,e.kg)}))); };
  const deleteCustomScheda=(id)=>{ setCustomSchede(prev=>prev.filter(s=>s.id!==id)); if(activeId===id)setActiveId("a"); };

  const doneSeries=exercises.reduce((a,e)=>(e.seriesData||[]).filter(s=>s.done).length+a,0);
  const totalSeries=exercises.reduce((a,e)=>a+(e.sets||0),0);
  const totalVol=exercises.reduce((a,e)=>a+(e.seriesData||[]).filter(s=>s.done).reduce((b,s)=>b+(parseFloat(s.kg)||0)*(parseFloat(s.reps)||0),0),0);

  const saveSession=(duration,metKcal)=>{
    const kcal=metKcal||Math.round(exercises.reduce((a,e)=>a+calcCalories(e,bodyKg),0));
    const sess={id:uid(),name:sessName||activeScheda.name,date:Date.now(),schedaId:activeId,bodyKg,duration,kcal,exercises:exercises.map(e=>({...e}))};
    setHistory(prev=>[...prev,sess]);
    try { localStorage.removeItem("gymbro_draft"); } catch {} // cancella bozza
    showToast("Sessione salvata!","✅",DARK.green);
  };

  const restoreDraft=()=>{
    try {
      const raw = localStorage.getItem("gymbro_draft");
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (draft.activeId && draft.activeId !== activeId) setActiveId(draft.activeId);
      setExercises((draft.exercises||[]).map(e=>({...e,id:uid()})));
      setSessName(draft.sessName||"");
      setDraftBanner(false);
      setTab("workout");
      showToast("Sessione ripristinata!","🔄",DARK.blue);
    } catch { setDraftBanner(false); }
  };

  const discardDraft=()=>{
    try { localStorage.removeItem("gymbro_draft"); } catch {}
    setDraftBanner(false);
  };

  const loadSession=(sess)=>{
    if(sess.schedaId&&sess.schedaId!==activeId&&allSchede.some(s=>s.id===sess.schedaId)) setActiveId(sess.schedaId);
    setExercises((sess.exercises||[]).map(e=>({...e,id:uid()})));
    setSessName(sess.name||""); setTab("workout");
  };

  const useAsBase=(sess)=>{
    setExercises((sess.exercises||[]).map(e=>({...e,id:uid(),kcal:0,seriesData:makeSeriesData(e.sets,e.reps,e.kg)})));
    setSessName(""); setTab("workout");
    showToast("Sessione caricata come base","🚀",DARK.purple);
  };

  const deleteHistoryItem=(idx)=>{ const realIdx=history.length-1-idx; setHistory(prev=>prev.filter((_,i)=>i!==realIdx)); };

  const handleBodyKg=(raw)=>{
    const {err}=validateField("kg",raw);
    setBodyKgErr(err);
    if(!err) setBodyKg(parseFloat(raw)||0);
  };

  const iSt={background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 10px",color:C.text,fontSize:14,outline:"none",fontFamily:"inherit",WebkitAppearance:"none",MozAppearance:"textfield"};

  return (
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"'DM Sans','DM Mono','Helvetica Neue',sans-serif",maxWidth:480,margin:"0 auto",paddingBottom:90}}>
      <style>{`* {box-sizing:border-box;} input[type=number]{-webkit-appearance:none;-moz-appearance:textfield;} input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0;} @keyframes pulse{from{transform:scale(1);}to{transform:scale(1.06);}} @keyframes urgentPulse{from{opacity:1;}to{opacity:.4;}} textarea{outline:none;} @keyframes toastSlide{0%{opacity:0;transform:translateY(-30px) scale(.95);}8%{opacity:1;transform:translateY(0) scale(1);}88%{opacity:1;transform:translateY(0) scale(1);}100%{opacity:0;transform:translateY(-12px) scale(.97);}}`}</style>

      {/* HEADER */}
      <div style={{padding:"20px 16px 14px",borderBottom:`1px solid ${C.border}`,position:"sticky",top:0,background:C.bg,zIndex:10}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
          <div style={{fontSize:26,fontWeight:900,letterSpacing:-0.5}}>
            <span style={{color:schedaColor,WebkitTextStroke:darkMode?"0px":"0.6px #333",textShadow:darkMode?"none":"0 0 1px #33333355"}}>GYM</span>
            <span style={{color:C.text}}>BRO</span>
          </div>
          <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
            <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:2}}>
              <div style={{display:"flex",alignItems:"center",gap:5}}>
                <span style={{fontSize:13,color:C.textDim}}>⚖️</span>
                <input type="number" value={bodyKg||""} placeholder="kg"
                  onFocus={e=>{if(e.target.value==="0")e.target.value="";}}
                  onChange={e=>handleBodyKg(e.target.value)}
                  style={{...iSt,width:62,textAlign:"center",fontSize:15,padding:"6px 6px",fontWeight:700,borderColor:bodyKgErr?C.red:C.border}}/>
                <span style={{fontSize:13,color:C.textDim}}>kg</span>
              </div>
              {bodyKgErr&&<div style={{fontSize:10,color:C.red}}>{bodyKgErr}</div>}
            </div>
            <button onClick={()=>setDarkMode(d=>!d)} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:9,padding:"6px 9px",cursor:"pointer",fontSize:18,lineHeight:1}}>
              {darkMode?"☀️":"🌙"}
            </button>
          </div>
        </div>
        <div style={{display:"flex"}}>
          {[{id:"workout",label:"💪 Workout"},{id:"storico",label:"📅 Storico"}].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{flex:1,background:"none",border:"none",borderBottom:`2px solid ${tab===t.id?schedaColor:"transparent"}`,color:tab===t.id?C.text:C.textDim,padding:"10px 0",cursor:"pointer",fontSize:16,fontWeight:tab===t.id?700:500,transition:"border-color .15s"}}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* BANNER BOZZA — sessione interrotta */}
      {draftBanner && (
        <div style={{background:"#1a1a2e",border:`1px solid ${DARK.blue}`,borderRadius:0,
          padding:"12px 16px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <span style={{fontSize:18}}>🔄</span>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:13,fontWeight:700,color:DARK.blue}}>Sessione interrotta trovata</div>
            <div style={{fontSize:11,color:"#888",marginTop:1}}>Vuoi riprendere da dove avevi lasciato?</div>
          </div>
          <div style={{display:"flex",gap:8,flexShrink:0}}>
            <button onClick={discardDraft} style={{background:"none",color:"#666",border:"1px solid #333",
              borderRadius:8,padding:"6px 12px",cursor:"pointer",fontSize:13}}>Scarta</button>
            <button onClick={restoreDraft} style={{background:DARK.blue,color:"#000",border:"none",
              borderRadius:8,padding:"6px 14px",cursor:"pointer",fontWeight:700,fontSize:13}}>Riprendi</button>
          </div>
        </div>
      )}

      {/* BODY */}
      <div style={{padding:"14px 14px"}}>
        {tab==="workout"&&(
          <>
            {/* Selettore schede — tieni premuto per eliminare */}
            <SchedaSelector
              visibleBuiltin={visibleBuiltin}
              customSchede={customSchede}
              activeId={activeId}
              C={C}
              onSelect={setActiveId}
              onAdd={()=>setShowNewScheda(true)}
              onDeleteBuiltin={id=>{
                setHiddenBuiltin(prev=>[...prev,id]);
                if(activeId===id) setActiveId(visibleBuiltin.find(x=>x.id!==id)?.id||customSchede[0]?.id||"");
              }}
              onDeleteCustom={deleteCustomScheda}
            />

            {/* Nome sessione */}
            {editName
              ?<input autoFocus value={sessName} onChange={e=>setSessName(e.target.value)} onBlur={()=>setEditName(false)} onKeyDown={e=>{if(e.key==="Enter")setEditName(false);}} style={{...iSt,fontSize:20,fontWeight:700,width:"100%",marginBottom:14}} placeholder="Nome sessione…"/>
              :<div onClick={()=>setEditName(true)} style={{fontSize:20,fontWeight:700,color:sessName?C.text:C.textDim,marginBottom:14,cursor:"text",padding:"7px 2px",borderBottom:`1px solid ${C.border}`}}>
                {sessName||`${activeScheda?.name} — tap per rinominare`}
              </div>}

            {/* Stats */}
            <div style={{display:"flex",gap:8,marginBottom:14}}>
              {[{l:"Serie",v:`${doneSeries}/${totalSeries}`},{l:"Esercizi",v:exercises.length},{l:"Volume kg",v:totalVol>0?totalVol.toLocaleString("it"):"—"}].map(({l,v})=>(
                <div key={l} style={{flex:1,background:C.card,borderRadius:12,padding:"12px 6px",border:`1px solid ${C.border}`,textAlign:"center"}}>
                  <div style={{fontSize:20,fontWeight:800,color:schedaColor}}>{v}</div>
                  <div style={{fontSize:11,color:C.textDim,marginTop:3}}>{l}</div>
                </div>
              ))}
            </div>

            <SessionTimer color={schedaColor} bodyKg={bodyKg} exercises={exercises} onSave={saveSession} C={C} onRunningChange={setWorkoutRunning}/>

            {exercises.length>1&&<div style={{fontSize:11,color:C.textDim,marginBottom:8,paddingLeft:2}}>⠿ tieni premuto sull'icona per riordinare</div>}
            <SortableList items={exercises} onReorder={reorderEx} renderItem={(e,idx,dragHandlers)=>(
              <ExCard key={e.id} ex={e} color={schedaColor} bodyKg={bodyKg} history={history} C={C} dragHandlers={dragHandlers}
                onUpdate={data=>updateEx(e.id,data)} onDelete={()=>deleteEx(e.id)} onStartTimer={startTimer}/>
            )}/>

            <button onClick={()=>setShowAddEx(true)} style={{width:"100%",background:C.card,color:schedaColor,border:`2px dashed ${schedaColor}44`,borderRadius:14,padding:"14px",cursor:"pointer",fontSize:15,fontWeight:700,marginTop:4}}>
              + Aggiungi esercizio
            </button>
          </>
        )}
        {tab==="storico"&&<StoricoView history={history} bodyKg={bodyKg} activeId={activeId} schedaLabel={schedaLabel} C={C} onLoad={loadSession} onUseAsBase={useAsBase} onDelete={deleteHistoryItem}/>}
      </div>

      {recovery&&recovery.minimized&&<RecoveryMini seconds={recovery.seconds} total={recovery.total} color={schedaColor} onExpand={expandRecovery} onSkip={closeRecovery}/>}
      {recovery&&!recovery.minimized&&<RecoveryOverlay seconds={recovery.seconds} total={recovery.total} exName={recovery.exName} serieIdx={recovery.serieIdx} onSkip={closeRecovery} onMinimize={minimizeRecovery} C={C}/>}

      {showAddEx&&<AddExModal onAdd={addEx} onClose={()=>setShowAddEx(false)} C={C}/>}
      {showNewScheda&&<NewSchedaModal onAdd={addCustomScheda} onClose={()=>setShowNewScheda(false)} C={C}/>}

      {/* TOAST */}
      {toast&&(
        <div style={{position:"fixed",top:0,left:0,right:0,zIndex:300,display:"flex",justifyContent:"center",padding:"14px 16px 0",pointerEvents:"none"}}>
          <div style={{background:toast.color?toast.color:"#181818",color:toast.color?"#000":"#f0f0f0",border:toast.color?"none":"1px solid #333",borderRadius:16,padding:"16px 28px",fontSize:17,fontWeight:800,boxShadow:"0 8px 30px rgba(0,0,0,0.5)",display:"flex",alignItems:"center",gap:10,animation:"toastSlide 3s ease forwards",maxWidth:"92%",textAlign:"center"}}>
            <span style={{fontSize:22}}>{toast.icon}</span>
            <span>{toast.text}</span>
          </div>
        </div>
      )}
    </div>
  );
}
