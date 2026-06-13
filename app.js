// BioLeach Lab · ICP-OES Dashboard
// University of Sydney · Bioleaching Research
// Cloud sync via Supabase — data accessible from any device

const { useState, useEffect, useCallback } = React;

// ─── Supabase config ──────────────────────────────────────────────────────────
const SUPABASE_URL = "https://ovbenuufnwsowknrquko.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im92YmVudXVmbndzb3drbnJxdWtvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5Njc0NzYsImV4cCI6MjA5NjU0MzQ3Nn0.7pnIhpe_QoE5twjzWzI2wZuVQckQs-uDp8eNP4D1kbw";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function dbGetExperiments() {
  const { data, error } = await sb.from("experiments").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}
async function dbSaveExperiment(exp) {
  const { error } = await sb.from("experiments").upsert({ ...exp, icpRunIds: exp.icpRunIds || [] });
  if (error) throw new Error(error.message);
}
async function dbDeleteExperiment(id) {
  const { error } = await sb.from("experiments").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
async function dbGetRuns() {
  const { data, error } = await sb.from("icp_runs").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}
async function dbSaveRun(run) {
  const { error } = await sb.from("icp_runs").upsert({ id: run.id, name: run.name, data: run.data, df: run.df, exp_name: run.expName });
  if (error) throw new Error(error.message);
}

async function dbSaveUpload(upload) {
  const { error } = await sb.from("icp_uploads").upsert({ id: upload.id, file_name: upload.fileName, uploaded_at: upload.uploadedAt, samples: upload.samples, elements: upload.elements });
  if (error) throw new Error(error.message);
}
async function dbGetUploads() {
  const { data, error } = await sb.from("icp_uploads").select("*").order("uploaded_at", { ascending: false }).limit(50);
  if (error) throw new Error(error.message);
  return data;
}

// localStorage fallback helpers (used while loading)
const lsSave = (k, v) => { try { localStorage.setItem("bioleach_" + k, JSON.stringify(v)); } catch {} };
const lsLoad = (k, fb) => { try { const v = localStorage.getItem("bioleach_" + k); return v ? JSON.parse(v) : fb; } catch { return fb; } };

// ─── Constants ────────────────────────────────────────────────────────────────
const C = {
  bg: "#0d1117", surface: "#161b22", surfaceHigh: "#21262d",
  border: "#30363d", accent: "#58a6ff", accentGlow: "rgba(88,166,255,0.12)",
  green: "#3fb950", yellow: "#d29922", red: "#f85149",
  muted: "#8b949e", text: "#e6edf3", textDim: "#c9d1d9",
};

const REE = ["Ce","Dy","Er","Eu","Gd","Ho","La","Lu","Nd","Pr","Sc","Sm","Tb","Th","Tm","U","Y","Yb"];
const ICP_MIN = 1, ICP_MAX = 50;
const EXP_TYPES    = ["Bioleaching","Precipitation","Leaching","Characterisation","Calibration","Other"];
const EXP_STATUSES = ["In progress","Pending","Completed","Abandoned"];
const STATUS_COLOR  = { "Completed":C.green, "In progress":C.accent, "Pending":C.yellow, "Abandoned":C.red };
const EL_GROUPS = [
  { label:"Matrix / Impurities",   els:["Al","Ca","Fe","K","Mg","Na","Si","As"] },
  { label:"Target metals",          els:["Cu","Au","Ag"] },
  { label:"Rare Earth Elements",    els:REE },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const rangeStatus = v => (v==null||isNaN(v)) ? "unknown" : v>ICP_MAX ? "high" : v<ICP_MIN ? "low" : "ok";
const statusColor  = s => ({ok:C.green,high:C.red,low:C.yellow}[s]||C.muted);
const statusBg     = s => ({ok:"rgba(63,185,80,0.1)",high:"rgba(248,81,73,0.1)",low:"rgba(210,153,34,0.1)"}[s]||"transparent");

function recommendDF(est) {
  const vals = Object.values(est).filter(v => v > 0);
  if (!vals.length) return 1;
  const max = Math.max(...vals);
  return max <= ICP_MAX ? 1 : Math.ceil(max / ICP_MAX);
}

function parseICPData(raw) {
  const lines = raw.trim().split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const sep = lines[0].includes("\t") ? "\t" : ",";
  const SKIP = ["blank","std","calibrat","mili","qc","wire","hnо3","hno3","miliq","milli"];

  // PerkinElmer exports multiple header blocks — collect all of them
  // A header line contains "Sample Id" (case-insensitive)
  // Build a map: for each data row, find the most recent header above it
  let currentHeaders = null;
  let currentElementCols = {};
  let currentSidIdx = -1;
  const allElementCols = {}; // union of all element columns seen
  const samples = [];

  for (let r = 0; r < lines.length; r++) {
    const cols = lines[r].split(sep).map(c => c.trim().replace(/^"|"$/g,"").replace(/[\n\r]/g," ").replace(/\s+/g," "));

    // Is this a header line?
    const sidIdx = cols.findIndex(h => /^sample.?id$/i.test(h));
    if (sidIdx !== -1) {
      // Parse element columns from this header
      currentHeaders = cols;
      currentSidIdx  = sidIdx;
      currentElementCols = {};
      cols.forEach((h,i) => {
        const m = h.match(/^([A-Z][a-z]?)\s+[\d.]+/);
        if (m) { currentElementCols[m[1]] = i; allElementCols[m[1]] = true; }
      });
      continue;
    }

    if (currentSidIdx === -1) continue; // no header seen yet

    const name = cols[currentSidIdx]?.trim();
    if (!name) continue;

    // Skip if name is a number only (row index) with no sample name after
    // PerkinElmer format: row number is in col 0, sample name in Sample Id col
    // Sometimes col 0 is a row number — skip pure-number names only if very short
    if (/^\d+$/.test(name) && name.length < 4) continue;
    if (SKIP.some(s => name.toLowerCase().includes(s))) continue;

    const data = {};
    for (const [el, ci] of Object.entries(currentElementCols)) {
      const v = cols[ci]?.trim();
      data[el] = (v !== undefined && v !== "" && v !== "-") ? parseFloat(v) : null;
    }

    // Only add if at least one element has a real value
    const hasData = Object.values(data).some(v => v !== null && !isNaN(v));
    if (!hasData) continue;

    // Avoid duplicates by name
    if (!samples.find(s => s.name === name)) {
      samples.push({ name, data });
    }
  }

  return samples.length ? { samples, elements: Object.keys(allElementCols) } : null;
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  input:     { background:C.surfaceHigh, border:`1px solid ${C.border}`, borderRadius:6, color:C.text, fontFamily:"inherit", fontSize:13, padding:"8px 12px", outline:"none", width:"100%", boxSizing:"border-box" },
  label:     { fontSize:11, color:C.muted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:5, display:"block" },
  card:      { background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"20px 24px", marginBottom:20 },
  cardTitle: { fontSize:11, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.1em", color:C.muted, marginBottom:16 },
  btn: v => ({ padding:"8px 18px", borderRadius:6, border:v==="primary"?"none":`1px solid ${C.border}`, background:v==="primary"?C.accent:C.surfaceHigh, color:v==="primary"?"#0d1117":C.text, fontFamily:"inherit", fontSize:12, fontWeight:600, letterSpacing:"0.05em", cursor:"pointer", textTransform:"uppercase" }),
  badge: s  => ({ display:"inline-block", padding:"2px 8px", borderRadius:4, fontSize:11, fontWeight:600, background:statusBg(s), color:statusColor(s), border:`1px solid ${statusColor(s)}44`, minWidth:42, textAlign:"center" }),
  th:        { textAlign:"left", padding:"8px 10px", fontSize:10, textTransform:"uppercase", letterSpacing:"0.08em", color:C.muted, borderBottom:`1px solid ${C.border}` },
  td:        { padding:"7px 10px", borderBottom:`1px solid ${C.border}22`, fontSize:12 },
  table:     { width:"100%", borderCollapse:"collapse", fontSize:12 },
  textarea:  { background:C.surfaceHigh, border:`1px solid ${C.border}`, borderRadius:6, color:C.text, fontFamily:"inherit", fontSize:11, padding:"10px 12px", width:"100%", boxSizing:"border-box", resize:"vertical", outline:"none" },
  tag: col  => ({ display:"inline-flex", alignItems:"center", padding:"2px 7px", borderRadius:4, fontSize:10, fontWeight:600, background:`${col}22`, color:col, border:`1px solid ${col}44`, marginRight:3 }),
};

// ─── Sync status indicator ────────────────────────────────────────────────────
function SyncBadge({ status }) {
  const cfg = {
    syncing: { color:C.yellow,  text:"Syncing…" },
    synced:  { color:C.green,   text:"Synced ✓" },
    error:   { color:C.red,     text:"Sync error — using local cache" },
    offline: { color:C.muted,   text:"Offline mode" },
  }[status] || { color:C.muted, text:"" };
  return <span style={{ fontSize:10, color:cfg.color, letterSpacing:"0.05em" }}>{cfg.text}</span>;
}

// ─── Module 1 — Dilution Planner ─────────────────────────────────────────────
function DilutionPlanner() {
  const [estimates,  setEstimates]  = useState({});
  const [sampleName, setSampleName] = useState("");
  const [sampleVol,  setSampleVol]  = useState(1);
  const [finalVol,   setFinalVol]   = useState(10);
  const [result,     setResult]     = useState(null);
  const [mode,       setMode]       = useState("single"); // "single" | "double"

  const setEl = (el,v) => setEstimates(p => ({...p,[el]: v===""?"":parseFloat(v)||""}));

  function calculate() {
    const est = Object.fromEntries(
      Object.entries(estimates).filter(([,v])=>v!==""&&!isNaN(parseFloat(v))).map(([k,v])=>[k,parseFloat(v)])
    );
    if (!Object.keys(est).length) return;
    const fv = parseFloat(finalVol), sv = parseFloat(sampleVol);

    if (mode === "single") {
      const dfCalc = recommendDF(est);
      const dfVol  = Math.ceil(fv/sv);
      const df     = Math.max(dfCalc, dfVol);
      setResult({ mode:"single", df, actualVol:(fv/df).toFixed(3), finalVol:fv, est,
        projected:Object.fromEntries(Object.entries(est).map(([el,c])=>[el,c/df])) });
    } else {
      // Group A: Matrix + Target metals (high conc)
      const groupA = Object.fromEntries(Object.entries(est).filter(([el])=>!REE.includes(el)));
      // Group B: REEs (low conc)
      const groupB = Object.fromEntries(Object.entries(est).filter(([el])=>REE.includes(el)));
      const dfA = Math.max(recommendDF(groupA), Math.ceil(fv/sv));
      const dfB = Math.max(recommendDF(groupB), Math.ceil(fv/sv));
      setResult({ mode:"double",
        dfA, volA:(fv/dfA).toFixed(3),
        dfB, volB:(fv/dfB).toFixed(3),
        finalVol:fv, est,
        projA:Object.fromEntries(Object.entries(est).map(([el,c])=>[el,c/dfA])),
        projB:Object.fromEntries(Object.entries(est).map(([el,c])=>[el,c/dfB])),
      });
    }
  }

  return (
    <div>
      <div style={S.card}>
        <div style={S.cardTitle}>Sample information</div>
        <div style={{ display:"flex", gap:16, flexWrap:"wrap", alignItems:"flex-end" }}>
          <div style={{ flex:"1 1 220px" }}>
            <label style={S.label}>Sample name</label>
            <input style={S.input} value={sampleName} onChange={e=>setSampleName(e.target.value)} placeholder="e.g. Leachate_PCB_run3" />
          </div>
          <div style={{ flex:"0 0 150px" }}>
            <label style={S.label}>Sample volume (mL)</label>
            <input style={S.input} type="number" min="0.01" step="0.1" value={sampleVol} onChange={e=>setSampleVol(e.target.value)} />
          </div>
          <div style={{ flex:"0 0 170px" }}>
            <label style={S.label}>Final vol. in 2% HNO₃ (mL)</label>
            <input style={S.input} type="number" min="1" step="1" value={finalVol} onChange={e=>setFinalVol(e.target.value)} />
          </div>
          <div style={{ flex:"0 0 auto" }}>
            <label style={S.label}>Dilution mode</label>
            <div style={{ display:"flex", gap:8 }}>
              {[["single","Single"], ["double","Double (Matrix / REE)"]].map(([v,l])=>(
                <button key={v} onClick={()=>{setMode(v);setResult(null);}} style={{ padding:"7px 14px", borderRadius:6, border:`1px solid ${mode===v?C.accent:C.border}`, background:mode===v?C.accentGlow:"transparent", color:mode===v?C.accent:C.muted, fontFamily:"inherit", fontSize:11, cursor:"pointer", fontWeight:mode===v?700:400 }}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
        {mode==="double" && (
          <div style={{ marginTop:12, fontSize:11, color:C.muted, background:C.surfaceHigh, borderRadius:6, padding:"10px 14px" }}>
            <span style={{color:C.accent,fontWeight:600}}>Double dilution mode</span> — calculates two separate dilution factors:<br/>
            <strong style={{color:C.text}}>Dilution A</strong> (Matrix + Target metals: Cu, Fe, Na, Al…) — optimised to stay under 50 mg/L<br/>
            <strong style={{color:C.text}}>Dilution B</strong> (REEs only) — optimised to stay above 1 mg/L
          </div>
        )}
      </div>

      <div style={S.card}>
        <div style={S.cardTitle}>Estimated concentrations in undiluted sample (mg/L)</div>
        <div style={{ fontSize:11, color:C.muted, marginBottom:14 }}>Leave blank if absent/unknown. Enter 0 if negligible.</div>
        {EL_GROUPS.map(g => (
          <div key={g.label} style={{ marginBottom:18 }}>
            <div style={{ fontSize:10, textTransform:"uppercase", letterSpacing:"0.1em", color:C.accent, marginBottom:10 }}>{g.label}</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:10 }}>
              {g.els.map(el => (
                <div key={el} style={{ width:88 }}>
                  <label style={{ ...S.label, color:C.textDim }}>{el}</label>
                  <input style={{ ...S.input, textAlign:"right", padding:"7px 8px" }} type="number" min="0" placeholder="?" value={estimates[el]??""} onChange={e=>setEl(el,e.target.value)} />
                </div>
              ))}
            </div>
          </div>
        ))}
        <button style={S.btn("primary")} onClick={calculate}>Calculate dilution</button>
      </div>

      {/* Single mode result */}
      {result && result.mode === "single" && (
        <div style={{ ...S.card, border:`1px solid ${C.accent}44` }}>
          <div style={S.cardTitle}>Result{sampleName?` — "${sampleName}"`:""}</div>
          <div style={{ display:"flex", gap:20, flexWrap:"wrap", marginBottom:20 }}>
            <div style={{ background:C.surfaceHigh, border:`1px solid ${C.accent}55`, borderRadius:8, padding:"14px 22px" }}>
              <div style={{ fontSize:10, textTransform:"uppercase", letterSpacing:"0.1em", color:C.accent }}>Dilution factor</div>
              <div style={{ fontSize:38, fontWeight:700, color:C.accent, lineHeight:1.1, marginTop:4 }}>×{result.df}</div>
            </div>
            <div style={{ background:C.surfaceHigh, border:`1px solid ${C.border}`, borderRadius:8, padding:"14px 22px" }}>
              <div style={{ fontSize:10, textTransform:"uppercase", letterSpacing:"0.1em", color:C.muted }}>Volume to pipette</div>
              <div style={{ fontSize:28, fontWeight:600, color:C.text, lineHeight:1.1, marginTop:4 }}>{result.actualVol} mL</div>
              <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>into {result.finalVol} mL of 2% HNO₃</div>
            </div>
          </div>
          <table style={S.table}>
            <thead><tr>
              <th style={S.th}>Element</th>
              <th style={S.th}>Raw estimate</th>
              <th style={S.th}>After dilution ×{result.df}</th>
              <th style={S.th}>ICP status (1–50 mg/L)</th>
            </tr></thead>
            <tbody>
              {Object.entries(result.est).map(([el,c]) => {
                const proj=result.projected[el]; const s=rangeStatus(proj);
                return (
                  <tr key={el} style={{ background:s!=="ok"?statusBg(s):"transparent" }}>
                    <td style={{ ...S.td, fontWeight:600, color:REE.includes(el)?C.accent:C.text }}>
                      {el}{REE.includes(el)&&<span style={{ fontSize:9, color:C.accent, marginLeft:4 }}>REE</span>}
                    </td>
                    <td style={{ ...S.td, textAlign:"right" }}>{c.toFixed(2)} mg/L</td>
                    <td style={{ ...S.td, textAlign:"right", color:statusColor(s), fontWeight:s!=="ok"?700:400 }}>{proj.toFixed(3)} mg/L</td>
                    <td style={S.td}><span style={S.badge(s)}>{s==="ok"?"✓ OK":s==="high"?"↑ TOO HIGH":"↓ TOO LOW"}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Double mode result */}
      {result && result.mode === "double" && (
        <div>
          {[
            { label:"Dilution A — Matrix & Target metals", df:result.dfA, vol:result.volA, proj:result.projA, color:C.yellow, els:Object.keys(result.est).filter(el=>!REE.includes(el)) },
            { label:"Dilution B — REEs",                  df:result.dfB, vol:result.volB, proj:result.projB, color:C.accent, els:Object.keys(result.est).filter(el=>REE.includes(el))  },
          ].filter(g=>g.els.length>0).map(g=>(
            <div key={g.label} style={{ ...S.card, border:`1px solid ${g.color}44`, marginBottom:16 }}>
              <div style={S.cardTitle}>{g.label}</div>
              <div style={{ display:"flex", gap:16, flexWrap:"wrap", marginBottom:16 }}>
                <div style={{ background:C.surfaceHigh, border:`1px solid ${g.color}55`, borderRadius:8, padding:"12px 20px" }}>
                  <div style={{ fontSize:10, textTransform:"uppercase", letterSpacing:"0.1em", color:g.color }}>Dilution factor</div>
                  <div style={{ fontSize:34, fontWeight:700, color:g.color, lineHeight:1.1, marginTop:3 }}>×{g.df}</div>
                </div>
                <div style={{ background:C.surfaceHigh, border:`1px solid ${C.border}`, borderRadius:8, padding:"12px 20px" }}>
                  <div style={{ fontSize:10, textTransform:"uppercase", letterSpacing:"0.1em", color:C.muted }}>Volume to pipette</div>
                  <div style={{ fontSize:24, fontWeight:600, color:C.text, lineHeight:1.1, marginTop:3 }}>{g.vol} mL</div>
                  <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>into {result.finalVol} mL of 2% HNO₃</div>
                </div>
              </div>
              <table style={S.table}>
                <thead><tr>
                  <th style={S.th}>Element</th>
                  <th style={S.th}>Raw estimate</th>
                  <th style={S.th}>After dilution ×{g.df}</th>
                  <th style={S.th}>ICP status (1–50 mg/L)</th>
                </tr></thead>
                <tbody>
                  {g.els.map(el=>{
                    const c=result.est[el]; const proj=g.proj[el]; const s=rangeStatus(proj);
                    return (
                      <tr key={el} style={{ background:s!=="ok"?statusBg(s):"transparent" }}>
                        <td style={{ ...S.td, fontWeight:600, color:REE.includes(el)?C.accent:C.text }}>
                          {el}{REE.includes(el)&&<span style={{fontSize:9,color:C.accent,marginLeft:4}}>REE</span>}
                        </td>
                        <td style={{ ...S.td, textAlign:"right" }}>{c.toFixed(2)} mg/L</td>
                        <td style={{ ...S.td, textAlign:"right", color:statusColor(s), fontWeight:s!=="ok"?700:400 }}>{proj.toFixed(3)} mg/L</td>
                        <td style={S.td}><span style={S.badge(s)}>{s==="ok"?"✓ OK":s==="high"?"↑ TOO HIGH":"↓ TOO LOW"}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Module 2 — ICP Analysis ──────────────────────────────────────────────────
function ICPAnalyser({ experiments, onSaveRun, allUploads, onSaveUpload }) {
  const [raw,      setRaw]      = useState("");
  const [parsed,   setParsed]   = useState(null);
  const [error,    setError]    = useState("");
  const [dfMap,    setDfMap]    = useState({});
  const [selected, setSelected] = useState(null);
  const [linkExp,  setLinkExp]  = useState({});
  const [msg,      setMsg]      = useState("");

  function parse() {
    setError(""); setParsed(null);
    const res = parseICPData(raw);
    if (!res) { setError("Could not parse. Paste the full 'Conc. in Sample Units' sheet including the header row."); return; }
    setParsed(res);
    const dfs={}; res.samples.forEach(s=>{ dfs[s.name]=1; });
    setDfMap(dfs); setSelected(res.samples[0]?.name);
    // Auto-archive this upload
    if (onSaveUpload) onSaveUpload(res, fileName||"paste");
  }

  function overallStatus(sample) {
    let high=false,low=false;
    for (const v of Object.values(sample.data)) { if(v==null||isNaN(v))continue; const s=rangeStatus(v); if(s==="high")high=true; if(s==="low")low=true; }
    return high?"high":low?"low":"ok";
  }

  async function doSaveRun(sample) {
    const expId=linkExp[sample.name];
    if (!expId) { setMsg("⚠ Select an experiment first."); setTimeout(()=>setMsg(""),3000); return; }
    await onSaveRun(parseInt(expId), sample, parseFloat(dfMap[sample.name])||1);
    setMsg(`✓ "${sample.name}" saved.`); setTimeout(()=>setMsg(""),3000);
  }

  const selSample = parsed?.samples.find(s=>s.name===selected);

  return (
    <div>
      <div style={S.card}>
        <div style={S.cardTitle}>Paste ICP data — "Conc. in Sample Units" sheet</div>
        <div style={{ fontSize:11, color:C.muted, marginBottom:10 }}>In Excel: select all (Ctrl+A) → copy (Ctrl+C) → paste below. Standards, blanks and calibration rows excluded automatically.</div>
        <textarea style={{ ...S.textarea, minHeight:110 }} value={raw} onChange={e=>setRaw(e.target.value)} placeholder="Paste here..." />
        {error && <div style={{ color:C.red, fontSize:12, marginTop:8 }}>{error}</div>}
        <div style={{ marginTop:12, display:"flex", gap:10, alignItems:"center" }}>
          <button style={S.btn("primary")} onClick={parse}>Analyse</button>
          {parsed && <button style={S.btn("secondary")} onClick={()=>{setParsed(null);setRaw("");}}>Clear</button>}
          {msg && <span style={{ fontSize:12, color:msg.startsWith("⚠")?C.yellow:C.green }}>{msg}</span>}
        </div>
      </div>

      {/* Upload history */}
      {allUploads && allUploads.length > 0 && !parsed && (
        <div style={S.card}>
          <div style={S.cardTitle}>Recent uploads ({allUploads.length})</div>
          <div style={{ fontSize:11, color:C.muted, marginBottom:12 }}>Click to reload a previous upload into the analyser.</div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {allUploads.slice(0,10).map(u => (
              <div key={u.id} onClick={()=>{ setParsed({samples:u.samples,elements:u.elements}); const dfs={}; u.samples.forEach(s=>{dfs[s.name]=1;}); setDfMap(dfs); setSelected(u.samples[0]?.name); setFileName(u.fileName); }} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 12px", background:C.surfaceHigh, borderRadius:6, cursor:"pointer", border:`1px solid ${C.border}` }}>
                <div>
                  <span style={{ fontSize:12, fontWeight:600, color:C.text }}>{u.fileName}</span>
                  <span style={{ fontSize:10, color:C.muted, marginLeft:10 }}>{u.samples?.length} samples · {new Date(u.uploadedAt).toLocaleDateString()}</span>
                </div>
                <span style={{ fontSize:10, color:C.accent }}>↩ Reload</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {parsed && (<>
        <div style={S.card}>
          <div style={S.cardTitle}>{parsed.samples.length} sample{parsed.samples.length>1?"s":""} detected</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:16 }}>
            {parsed.samples.map(s => {
              const st=overallStatus(s);
              return <button key={s.name} onClick={()=>setSelected(s.name)} style={{ padding:"6px 14px", borderRadius:6, border:`1px solid ${selected===s.name?C.accent:statusColor(st)+"55"}`, background:selected===s.name?C.accentGlow:statusBg(st), color:selected===s.name?C.accent:statusColor(st), fontFamily:"inherit", fontSize:12, cursor:"pointer", fontWeight:selected===s.name?700:400 }}>{s.name}</button>;
            })}
          </div>
          <table style={S.table}>
            <thead><tr>
              <th style={S.th}>Sample</th><th style={S.th}>Dilution factor</th>
              <th style={S.th}>Out-of-range elements</th><th style={S.th}>Link to experiment</th><th style={S.th}>Status</th>
            </tr></thead>
            <tbody>
              {parsed.samples.map(s => {
                const st=overallStatus(s);
                const oor=Object.entries(s.data).filter(([,v])=>v!=null&&!isNaN(v)&&rangeStatus(v)!=="ok").map(([el,v])=>({el,v,s:rangeStatus(v)}));
                return (
                  <tr key={s.name} style={{ cursor:"pointer", background:selected===s.name?C.accentGlow:"transparent" }} onClick={()=>setSelected(s.name)}>
                    <td style={{ ...S.td, fontWeight:600 }}>{s.name}</td>
                    <td style={S.td} onClick={e=>e.stopPropagation()}>
                      <input style={{ ...S.input, width:70, padding:"4px 8px", textAlign:"center" }} type="number" min="1" step="1" value={dfMap[s.name]||1} onChange={e=>setDfMap(p=>({...p,[s.name]:e.target.value}))} />
                    </td>
                    <td style={S.td}>{oor.length===0?<span style={{color:C.muted,fontSize:11}}>—</span>:oor.slice(0,5).map(({el,v,s:es})=><span key={el} style={S.tag(statusColor(es))}>{el} {v>ICP_MAX?`↑${v.toFixed(1)}`:`↓${v.toFixed(3)}`}</span>)}</td>
                    <td style={S.td} onClick={e=>e.stopPropagation()}>
                      <select style={{ ...S.input, width:190, padding:"4px 8px", fontSize:11 }} value={linkExp[s.name]||""} onChange={e=>setLinkExp(p=>({...p,[s.name]:e.target.value}))}>
                        <option value="">— select experiment —</option>
                        {experiments.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
                      </select>
                    </td>
                    <td style={S.td}><span style={S.badge(st)}>{st==="ok"?"✓ OK":st==="high"?"↑ Over":"↓ Under"}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {selSample && (() => {
          const df=parseFloat(dfMap[selSample.name])||1;
          const entries=Object.entries(selSample.data).filter(([,v])=>v!=null&&!isNaN(v)).sort(([a],[b])=>a.localeCompare(b));
          return (
            <div style={S.card}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                <div>
                  <span style={{ fontSize:14, fontWeight:700, color:C.accent }}>{selSample.name}</span>
                  <span style={{ fontSize:11, color:C.muted, marginLeft:10 }}>DF = ×{df}</span>
                </div>
                <button style={S.btn("primary")} onClick={()=>doSaveRun(selSample)}>Save to experiment</button>
              </div>
              <table style={S.table}>
                <thead><tr>
                  <th style={S.th}>Element</th><th style={S.th}>Machine reading (mg/L)</th>
                  <th style={S.th}>Real conc. ×{df} (mg/L)</th><th style={S.th}>Range status</th><th style={S.th}>Group</th>
                </tr></thead>
                <tbody>
                  {entries.map(([el,v]) => {
                    const s=rangeStatus(v); const real=v*df;
                    return (
                      <tr key={el} style={{ background:s!=="ok"?statusBg(s):"transparent" }}>
                        <td style={{ ...S.td, fontWeight:600, color:REE.includes(el)?C.accent:C.text }}>{el}{REE.includes(el)&&<span style={{fontSize:9,color:C.accent,marginLeft:4}}>REE</span>}</td>
                        <td style={{ ...S.td, textAlign:"right", color:statusColor(s), fontWeight:s!=="ok"?700:400 }}>{v.toFixed(4)}</td>
                        <td style={{ ...S.td, textAlign:"right" }}>{real.toFixed(4)}</td>
                        <td style={S.td}><span style={S.badge(s)}>{s==="ok"?"✓ OK":s==="high"?"↑ HIGH":"↓ LOW"}</span></td>
                        <td style={{ ...S.td, fontSize:10, color:C.muted }}>{REE.includes(el)?"REE":["Cu","Au","Ag"].includes(el)?"Target metal":"Matrix"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })()}
      </>)}
    </div>
  );
}

// ─── Module 3 — Recovery Yield ────────────────────────────────────────────────
function RecoveryCalc({ runs }) {
  const [baseId,  setBaseId]  = useState("");
  const [finalId, setFinalId] = useState("");
  const baseRun  = runs.find(r=>r.id===baseId);
  const finalRun = runs.find(r=>r.id===finalId);

  function calcRecovery() {
    if (!baseRun||!finalRun) return null;
    const els=Object.keys(baseRun.data).filter(el=>{ const b=baseRun.data[el],f=finalRun.data[el]; return b!=null&&f!=null&&!isNaN(b)&&!isNaN(f)&&b>0; });
    return els.map(el=>({ el, base:baseRun.data[el]*(baseRun.df||1), final:finalRun.data[el]*(finalRun.df||1), pct:finalRun.data[el]*(finalRun.df||1)/(baseRun.data[el]*(baseRun.df||1))*100 })).sort((a,b)=>b.pct-a.pct);
  }

  const recovery=calcRecovery();
  const recovColor=pct=>pct>=70?C.green:pct>=40?C.yellow:C.red;

  if (!runs.length) return (
    <div style={S.card}>
      <div style={{ color:C.muted, fontSize:12, textAlign:"center", padding:"32px 0" }}>
        No ICP runs saved yet.<br/>Analyse data in the <strong style={{color:C.accent}}>ICP Analysis</strong> tab and save runs to an experiment first.
      </div>
    </div>
  );

  return (
    <div>
      <div style={S.card}>
        <div style={S.cardTitle}>Recovery yield calculator</div>
        <div style={{ fontSize:11, color:C.muted, marginBottom:14 }}>Select a baseline and a final sample to compute % recovery per element.</div>
        <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
          {[["Baseline sample",baseId,setBaseId],["Final sample",finalId,setFinalId]].map(([label,val,setter])=>(
            <div key={label} style={{ flex:"1 1 200px" }}>
              <label style={S.label}>{label}</label>
              <select style={S.input} value={val} onChange={e=>setter(e.target.value)}>
                <option value="">— select —</option>
                {runs.map(r=><option key={r.id} value={r.id}>{r.name} ({r.expName||r.exp_name})</option>)}
              </select>
            </div>
          ))}
        </div>
      </div>

      {recovery && (() => {
        const reeData=recovery.filter(r=>REE.includes(r.el));
        const otherData=recovery.filter(r=>!REE.includes(r.el));
        return (
          <div style={S.card}>
            <div style={S.cardTitle}>Recovery — {baseRun.name} → {finalRun.name}</div>
            {[{label:"REE",data:reeData},{label:"Other elements",data:otherData}].map(g=>g.data.length>0&&(
              <div key={g.label} style={{ marginBottom:22 }}>
                <div style={{ fontSize:10, textTransform:"uppercase", letterSpacing:"0.1em", color:C.accent, marginBottom:10 }}>{g.label}</div>
                <table style={S.table}>
                  <thead><tr>
                    <th style={S.th}>Element</th><th style={S.th}>Baseline (mg/L)</th>
                    <th style={S.th}>Final (mg/L)</th><th style={S.th}>Recovery (%)</th><th style={S.th}>Bar</th>
                  </tr></thead>
                  <tbody>
                    {g.data.map(({el,base,final,pct})=>(
                      <tr key={el}>
                        <td style={{ ...S.td, fontWeight:600, color:REE.includes(el)?C.accent:C.text }}>{el}</td>
                        <td style={{ ...S.td, textAlign:"right" }}>{base.toFixed(4)}</td>
                        <td style={{ ...S.td, textAlign:"right" }}>{final.toFixed(4)}</td>
                        <td style={{ ...S.td, textAlign:"right", fontWeight:700, color:recovColor(pct) }}>{pct.toFixed(1)}%</td>
                        <td style={S.td}>
                          <div style={{ background:C.surfaceHigh, borderRadius:3, height:8, overflow:"hidden" }}>
                            <div style={{ width:`${Math.min(pct,100)}%`, height:"100%", background:recovColor(pct), borderRadius:3 }} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}

// ─── Module 4 — Experiment Dashboard ─────────────────────────────────────────
function ExperimentDashboard({ experiments, setExperiments, allRuns, syncStatus }) {
  const [showNew,  setShowNew]  = useState(false);
  const [selected, setSelected] = useState(null);
  const emptyForm = { name:"", date:new Date().toISOString().slice(0,10), type:"Bioleaching", matrix:"", conditions:"", organism:"", status:"In progress", notes:"" };
  const [form, setForm] = useState(emptyForm);

  async function addExp() {
    if (!form.name.trim()) return;
    const newExp = { ...form, id:Date.now(), icpRunIds:[] };
    const updated = [newExp, ...experiments];
    setExperiments(updated); lsSave("experiments", updated);
    try { await dbSaveExperiment(newExp); } catch(e) { console.warn("Sync error:", e); }
    setShowNew(false); setForm(emptyForm);
  }

  async function updateStatus(id, status) {
    const updated = experiments.map(e=>e.id===id?{...e,status}:e);
    setExperiments(updated); lsSave("experiments", updated);
    const exp = updated.find(e=>e.id===id);
    try { await dbSaveExperiment(exp); } catch(e) { console.warn("Sync error:", e); }
  }

  async function deleteExp(id) {
    if (!window.confirm("Delete this experiment?")) return;
    const updated = experiments.filter(e=>e.id!==id);
    setExperiments(updated); lsSave("experiments", updated);
    try { await dbDeleteExperiment(id); } catch(e) { console.warn("Sync error:", e); }
    if (selected===id) setSelected(null);
  }

  const exp     = experiments.find(e=>e.id===selected);
  const expRuns = exp ? allRuns.filter(r=>exp.icpRunIds?.includes(r.id)||exp.icp_run_ids?.includes(r.id)) : [];

  const fieldDefs = [
    { label:"Name",             key:"name",       type:"text", placeholder:"e.g. REE bioleaching G.oxydans run4" },
    { label:"Date",             key:"date",       type:"date" },
    { label:"Matrix / Material",key:"matrix",     type:"text", placeholder:"e.g. PCB, NdFeB magnet, Phosphors" },
    { label:"Conditions",       key:"conditions", type:"text", placeholder:"e.g. pH 6.5, 30°C, 48h" },
    { label:"Organism",         key:"organism",   type:"text", placeholder:"e.g. A. thiooxidans, G. oxydans" },
  ];

  return (
    <div style={{ display:"grid", gridTemplateColumns:selected?"310px 1fr":"1fr", gap:16 }}>
      <div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ fontSize:11, color:C.muted, textTransform:"uppercase", letterSpacing:"0.08em" }}>{experiments.length} experiment{experiments.length!==1?"s":""}</div>
            <SyncBadge status={syncStatus} />
          </div>
          <button style={S.btn("primary")} onClick={()=>setShowNew(v=>!v)}>+ New</button>
        </div>

        {showNew && (
          <div style={{ ...S.card, border:`1px solid ${C.accent}44`, marginBottom:14 }}>
            <div style={S.cardTitle}>New experiment</div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {fieldDefs.map(f=>(
                <div key={f.key}>
                  <label style={S.label}>{f.label}</label>
                  <input style={S.input} type={f.type} placeholder={f.placeholder||""} value={form[f.key]} onChange={e=>setForm(p=>({...p,[f.key]:e.target.value}))} />
                </div>
              ))}
              {[["type","Type",EXP_TYPES],["status","Status",EXP_STATUSES]].map(([key,label,opts])=>(
                <div key={key}>
                  <label style={S.label}>{label}</label>
                  <select style={S.input} value={form[key]} onChange={e=>setForm(p=>({...p,[key]:e.target.value}))}>
                    {opts.map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
              ))}
              <div>
                <label style={S.label}>Notes</label>
                <textarea style={{ ...S.textarea, minHeight:56 }} value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} />
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <button style={S.btn("primary")} onClick={addExp}>Create</button>
                <button style={S.btn("secondary")} onClick={()=>setShowNew(false)}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {experiments.map(e=>(
          <div key={e.id} onClick={()=>setSelected(selected===e.id?null:e.id)} style={{ ...S.card, cursor:"pointer", border:`1px solid ${selected===e.id?C.accent:C.border}`, background:selected===e.id?C.accentGlow:C.surface, marginBottom:10, padding:"14px 16px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
              <div style={{ fontSize:13, fontWeight:600, color:selected===e.id?C.accent:C.text, lineHeight:1.3 }}>{e.name}</div>
              <span style={{ fontSize:9, padding:"2px 7px", borderRadius:4, fontWeight:600, background:`${STATUS_COLOR[e.status]||C.muted}22`, color:STATUS_COLOR[e.status]||C.muted, border:`1px solid ${STATUS_COLOR[e.status]||C.muted}44`, whiteSpace:"nowrap", marginLeft:8 }}>{e.status}</span>
            </div>
            <div style={{ fontSize:11, color:C.muted, marginTop:3 }}>{e.date} · {e.type}</div>
            {e.matrix   && <div style={{ fontSize:11, color:C.muted }}>Matrix: {e.matrix}</div>}
            {e.organism && <div style={{ fontSize:11, color:C.muted }}>Organism: {e.organism}</div>}
            {(e.icpRunIds||e.icp_run_ids||[]).length>0 && <div style={{ fontSize:10, color:C.accent, marginTop:4 }}>📊 {(e.icpRunIds||e.icp_run_ids).length} ICP run{(e.icpRunIds||e.icp_run_ids).length>1?"s":""} linked</div>}
          </div>
        ))}
      </div>

      {exp && (
        <div style={S.card}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:16 }}>
            <div>
              <div style={{ fontSize:16, fontWeight:700, color:C.text }}>{exp.name}</div>
              <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>{exp.date} · {exp.type}{exp.organism?` · ${exp.organism}`:""}</div>
            </div>
            <div style={{ display:"flex", gap:8, alignItems:"center" }}>
              <select style={{ ...S.input, width:"auto", padding:"6px 10px", fontSize:11 }} value={exp.status} onChange={e=>updateStatus(exp.id,e.target.value)}>
                {EXP_STATUSES.map(s=><option key={s}>{s}</option>)}
              </select>
              <button style={{ ...S.btn("secondary"), fontSize:11, color:C.red, borderColor:`${C.red}44` }} onClick={()=>deleteExp(exp.id)}>Delete</button>
              <button style={{ ...S.btn("secondary"), fontSize:11 }} onClick={()=>setSelected(null)}>✕</button>
            </div>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:20 }}>
            {[["Matrix",exp.matrix],["Conditions",exp.conditions],["Organism",exp.organism],["Notes",exp.notes]].filter(([,v])=>v).map(([label,val])=>(
              <div key={label} style={{ background:C.surfaceHigh, borderRadius:6, padding:"12px 14px" }}>
                <div style={S.label}>{label}</div>
                <div style={{ fontSize:12, color:C.textDim }}>{val}</div>
              </div>
            ))}
          </div>

          <div style={S.cardTitle}>Linked ICP runs ({expRuns.length})</div>
          {expRuns.length===0
            ? <div style={{ color:C.muted, fontSize:12, padding:"16px 0", borderTop:`1px solid ${C.border}` }}>
                No ICP runs linked yet. Go to <strong style={{color:C.accent}}>ICP Analysis</strong>, select this experiment, then click "Save to experiment".
              </div>
            : <table style={S.table}>
                <thead><tr>
                  <th style={S.th}>Sample</th><th style={S.th}>DF</th>
                  <th style={S.th}>Cu</th><th style={S.th}>La</th><th style={S.th}>Nd</th><th style={S.th}>Ce</th><th style={S.th}>Fe</th>
                  <th style={S.th}>Alerts</th>
                </tr></thead>
                <tbody>
                  {expRuns.map(run=>{
                    const df=run.df||1;
                    const get=el=>{ const v=run.data[el]; return (v!=null&&!isNaN(v))?(v*df).toFixed(3):"—"; };
                    const alerts=Object.entries(run.data).filter(([,v])=>v!=null&&!isNaN(v)&&rangeStatus(v)!=="ok").map(([el])=>el);
                    return (
                      <tr key={run.id}>
                        <td style={{ ...S.td, fontWeight:600 }}>{run.name}</td>
                        <td style={S.td}>×{df}</td>
                        {["Cu","La","Nd","Ce","Fe"].map(el=><td key={el} style={S.td}>{get(el)}</td>)}
                        <td style={S.td}>{alerts.length===0?<span style={{color:C.green,fontSize:11}}>✓ OK</span>:alerts.slice(0,4).map(el=><span key={el} style={S.tag(C.red)}>{el}</span>)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
          }
        </div>
      )}
    </div>
  );
}



// ─── Module 5 — Kinetics Tracker ─────────────────────────────────────────────
function KineticsTracker({ experiments }) {
  const [selectedExp, setSelectedExp] = useState("");
  const [params, setParams] = useState({
    mass_initial: "", ree_pct: "", vol_initial: 100, vol_sample: 2, icp_df: 1000,
    lixiviant: "", temp: "", rpm: "", operator: "",
  });
  const [rows, setRows] = useState([
    { id:1, time:0,   vol_res:100, ph:"", c_raw:"", notes:"t0 — baseline" },
    { id:2, time:24,  vol_res:98,  ph:"", c_raw:"", notes:"" },
    { id:3, time:48,  vol_res:96,  ph:"", c_raw:"", notes:"" },
    { id:4, time:72,  vol_res:94,  ph:"", c_raw:"", notes:"" },
    { id:5, time:96,  vol_res:92,  ph:"", c_raw:"", notes:"" },
    { id:6, time:120, vol_res:90,  ph:"", c_raw:"", notes:"" },
  ]);
  const [conditions, setConditions] = useState([
    { id:1, label:"GA culture",  color:C.accent },
    { id:2, label:"Abiotic ctrl",color:C.green  },
    { id:3, label:"Water ctrl",  color:C.muted  },
  ]);
  const [condRows, setCondRows] = useState(
    [0,24,48,72,96,120].map(t => ({ time:t, ph:["","",""], c:["","",""] }))
  );
  const [activeTab, setActiveTab] = useState("kinetics");

  const setParam = (k,v) => setParams(p => ({...p,[k]:v}));
  const setRow = (id, k, v) => setRows(rs => rs.map(r => r.id===id ? {...r,[k]:v} : r));
  const setCondRow = (ti, field, ci, v) => setCondRows(rs => rs.map((r,i) => i===ti ? {...r,[field]: r[field].map((x,j) => j===ci?v:x)} : r));

  function addRow() {
    const lastT = rows.length ? rows[rows.length-1].time : 0;
    const lastV = rows.length ? rows[rows.length-1].vol_res : parseFloat(params.vol_initial)||100;
    const sampleVol = parseFloat(params.vol_sample)||2;
    setRows(rs => [...rs, { id:Date.now(), time:lastT+24, vol_res:Math.max(0,lastV-sampleVol), ph:"", c_raw:"", notes:"" }]);
  }
  function removeRow(id) { setRows(rs => rs.filter(r=>r.id!==id)); }

  // Calculations
  const calc = rows.map((r,i) => {
    const df    = parseFloat(params.icp_df) || 1;
    const c_raw = parseFloat(r.c_raw);
    const c_cor = isNaN(c_raw) ? null : c_raw * df;           // mg/L in leachate
    const vol   = parseFloat(r.vol_res) / 1000;               // L
    const mass_this = (c_cor != null) ? c_cor * vol : null;   // mg REE at this point

    // Cumulative: sum of (C_i * V_i) for all previous + this
    // Using simplified: cumulative mass in solution at time t = C_cor * V_res
    const mass_cum = (c_cor != null) ? c_cor * vol : null;

    const mass_init = parseFloat(params.mass_initial);
    const ree_pct   = parseFloat(params.ree_pct);
    const mass_ree_total = (!isNaN(mass_init) && !isNaN(ree_pct)) ? mass_init * (ree_pct/100) * 1000 : null; // mg

    const yield_pct = (mass_cum != null && mass_ree_total) ? (mass_cum / mass_ree_total * 100) : null;

    return { ...r, c_cor, mass_this, mass_cum, yield_pct };
  });

  // Chart data
  function renderChart(data, xKey, yKey, yLabel, color) {
    const pts = data.filter(d => d[yKey] != null);
    if (pts.length < 1) return <div style={{color:C.muted,fontSize:11,padding:"16px 0"}}>Enter ICP data to see chart.</div>;
    const W=540,H=200,PAD={top:16,right:20,bottom:36,left:60};
    const xs = pts.map(p=>parseFloat(p[xKey]));
    const ys = pts.map(p=>parseFloat(p[yKey]));
    const maxX=Math.max(...xs,1), minX=0;
    const maxY=Math.max(...ys)*1.2||1, minY=0;
    const px=x=>PAD.left+(x-minX)/(maxX-minX)*(W-PAD.left-PAD.right);
    const py=y=>PAD.top+(1-(y-minY)/(maxY-minY))*(H-PAD.top-PAD.bottom);
    const pathD=pts.map((p,i)=>`${i===0?"M":"L"}${px(parseFloat(p[xKey])).toFixed(1)},${py(parseFloat(p[yKey])).toFixed(1)}`).join(" ");
    const yTicks=[0,0.25,0.5,0.75,1].map(f=>minY+f*(maxY-minY));
    const xTicks=[0,0.25,0.5,0.75,1].map(f=>minX+f*(maxX-minX));
    return (
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block",overflow:"visible"}}>
        {yTicks.map((v,i)=>(
          <g key={i}>
            <line x1={PAD.left} x2={W-PAD.right} y1={py(v)} y2={py(v)} stroke={C.border} strokeWidth="1"/>
            <text x={PAD.left-6} y={py(v)+4} textAnchor="end" fontSize="9" fill={C.muted}>{v.toFixed(1)}</text>
          </g>
        ))}
        {xTicks.map((v,i)=>(
          <g key={i}>
            <line x1={px(v)} x2={px(v)} y1={PAD.top} y2={H-PAD.bottom} stroke={C.border} strokeWidth="1" strokeDasharray="3,3"/>
            <text x={px(v)} y={H-PAD.bottom+13} textAnchor="middle" fontSize="9" fill={C.muted}>{v.toFixed(0)}</text>
          </g>
        ))}
        <text x={(W-PAD.left-PAD.right)/2+PAD.left} y={H-2} textAnchor="middle" fontSize="10" fill={C.muted}>Time (h)</text>
        <text x={12} y={H/2} textAnchor="middle" fontSize="10" fill={C.muted} transform={`rotate(-90,12,${H/2})`}>{yLabel}</text>
        <path d={`${pathD} L${px(xs[xs.length-1]).toFixed(1)},${py(0).toFixed(1)} L${px(0).toFixed(1)},${py(0).toFixed(1)} Z`} fill={color} fillOpacity="0.08"/>
        <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round"/>
        {pts.map((p,i)=>(
          <g key={i}>
            <circle cx={px(parseFloat(p[xKey]))} cy={py(parseFloat(p[yKey]))} r="4" fill={color} stroke={C.bg} strokeWidth="2"/>
            <text x={px(parseFloat(p[xKey]))} y={py(parseFloat(p[yKey]))-9} textAnchor="middle" fontSize="8" fill={color}>{parseFloat(p[yKey]).toFixed(1)}</text>
          </g>
        ))}
      </svg>
    );
  }

  const finalYield = calc.filter(c=>c.yield_pct!=null).slice(-1)[0]?.yield_pct;
  const finalCcor  = calc.filter(c=>c.c_cor!=null).slice(-1)[0]?.c_cor;

  const subTabs = [
    {id:"kinetics", label:"Kinetic data"},
    {id:"controls", label:"Controls comparison"},
    {id:"charts",   label:"Charts"},
  ];

  return (
    <div>
      {/* Experiment selector */}
      <div style={S.card}>
        <div style={S.cardTitle}>Experiment & parameters</div>
        <div style={{display:"flex",gap:16,flexWrap:"wrap",marginBottom:16}}>
          <div style={{flex:"1 1 280px"}}>
            <label style={S.label}>Linked experiment</label>
            <select style={S.input} value={selectedExp} onChange={e=>setSelectedExp(e.target.value)}>
              <option value="">— select (optional) —</option>
              {experiments.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div style={{flex:"0 0 130px"}}>
            <label style={S.label}>Initial solid mass (g)</label>
            <input style={S.input} type="number" min="0" step="0.0001" value={params.mass_initial} onChange={e=>setParam("mass_initial",e.target.value)} placeholder="e.g. 0.3529"/>
          </div>
          <div style={{flex:"0 0 130px"}}>
            <label style={S.label}>REE content (%)</label>
            <input style={S.input} type="number" min="0" step="0.01" value={params.ree_pct} onChange={e=>setParam("ree_pct",e.target.value)} placeholder="e.g. 28.5"/>
          </div>
          <div style={{flex:"0 0 120px"}}>
            <label style={S.label}>Initial vol. (mL)</label>
            <input style={S.input} type="number" min="0" step="1" value={params.vol_initial} onChange={e=>setParam("vol_initial",e.target.value)}/>
          </div>
          <div style={{flex:"0 0 120px"}}>
            <label style={S.label}>Sample vol. (mL)</label>
            <input style={S.input} type="number" min="0" step="0.5" value={params.vol_sample} onChange={e=>setParam("vol_sample",e.target.value)}/>
          </div>
          <div style={{flex:"0 0 120px"}}>
            <label style={S.label}>ICP dilution factor</label>
            <input style={S.input} type="number" min="1" step="1" value={params.icp_df} onChange={e=>setParam("icp_df",e.target.value)}/>
          </div>
        </div>
        <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
          <div style={{flex:"1 1 180px"}}>
            <label style={S.label}>Lixiviant</label>
            <input style={S.input} value={params.lixiviant} onChange={e=>setParam("lixiviant",e.target.value)} placeholder="e.g. G. oxydans supernatant"/>
          </div>
          <div style={{flex:"0 0 100px"}}>
            <label style={S.label}>Temp (°C)</label>
            <input style={S.input} type="number" value={params.temp} onChange={e=>setParam("temp",e.target.value)} placeholder="28"/>
          </div>
          <div style={{flex:"0 0 100px"}}>
            <label style={S.label}>Agitation (rpm)</label>
            <input style={S.input} type="number" value={params.rpm} onChange={e=>setParam("rpm",e.target.value)} placeholder="200"/>
          </div>
          <div style={{flex:"0 0 140px"}}>
            <label style={S.label}>Operator</label>
            <input style={S.input} value={params.operator} onChange={e=>setParam("operator",e.target.value)} placeholder="your name"/>
          </div>
        </div>
      </div>

      {/* Sub-tabs */}
      <div style={{display:"flex",gap:0,borderBottom:`1px solid ${C.border}`,marginBottom:16}}>
        {subTabs.map(t=>(
          <button key={t.id} onClick={()=>setActiveTab(t.id)} style={{padding:"8px 16px",fontSize:11,fontWeight:500,letterSpacing:"0.05em",textTransform:"uppercase",cursor:"pointer",border:"none",background:"transparent",color:activeTab===t.id?C.accent:C.muted,borderBottom:activeTab===t.id?`2px solid ${C.accent}`:"2px solid transparent",marginBottom:-1,fontFamily:"inherit"}}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Kinetic data tab */}
      {activeTab==="kinetics" && (
        <div style={S.card}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div style={S.cardTitle} style={{marginBottom:0}}>Kinetic data — {rows.length} time points</div>
            <button style={S.btn("primary")} onClick={addRow}>+ Add time point</button>
          </div>
          <table style={S.table}>
            <thead><tr>
              <th style={S.th}>Time (h)</th>
              <th style={S.th}>V residual (mL)</th>
              <th style={S.th}>pH</th>
              <th style={S.th}>C ICP raw (mg/L)</th>
              <th style={S.th}>C corrected (mg/L)</th>
              <th style={S.th}>REE in solution (mg)</th>
              <th style={S.th}>Leaching yield (%)</th>
              <th style={S.th}>Notes</th>
              <th style={S.th}></th>
            </tr></thead>
            <tbody>
              {calc.map(r => {
                const yc = r.yield_pct!=null ? (r.yield_pct>=70?C.green:r.yield_pct>=40?C.yellow:C.red) : C.muted;
                return (
                  <tr key={r.id}>
                    <td style={S.td}><input style={{...S.input,width:70,padding:"4px 6px",textAlign:"center"}} type="number" value={r.time} onChange={e=>setRow(r.id,"time",e.target.value)}/></td>
                    <td style={S.td}><input style={{...S.input,width:70,padding:"4px 6px",textAlign:"center"}} type="number" value={r.vol_res} onChange={e=>setRow(r.id,"vol_res",e.target.value)}/></td>
                    <td style={S.td}><input style={{...S.input,width:60,padding:"4px 6px",textAlign:"center"}} type="number" step="0.1" value={r.ph} onChange={e=>setRow(r.id,"ph",e.target.value)} placeholder="—"/></td>
                    <td style={S.td}><input style={{...S.input,width:110,padding:"4px 6px",textAlign:"right"}} type="number" step="0.001" value={r.c_raw} onChange={e=>setRow(r.id,"c_raw",e.target.value)} placeholder="ICP reading"/></td>
                    <td style={{...S.td,textAlign:"right",color:C.accent,fontWeight:600}}>{r.c_cor!=null?r.c_cor.toFixed(3):"—"}</td>
                    <td style={{...S.td,textAlign:"right"}}>{r.mass_cum!=null?r.mass_cum.toFixed(4):"—"}</td>
                    <td style={{...S.td,textAlign:"right",fontWeight:700,color:yc}}>{r.yield_pct!=null?`${r.yield_pct.toFixed(1)}%`:"—"}</td>
                    <td style={S.td}><input style={{...S.input,padding:"4px 6px",fontSize:11}} value={r.notes} onChange={e=>setRow(r.id,"notes",e.target.value)} placeholder="optional"/></td>
                    <td style={S.td}><button onClick={()=>removeRow(r.id)} style={{background:"none",border:"none",color:C.red,cursor:"pointer",fontSize:13}}>✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Summary stats */}
          {(finalYield!=null||finalCcor!=null) && (
            <div style={{display:"flex",gap:14,flexWrap:"wrap",marginTop:20}}>
              {finalYield!=null && (
                <div style={{background:C.surfaceHigh,border:`1px solid ${C.border}`,borderRadius:7,padding:"12px 20px"}}>
                  <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",color:C.muted}}>Final leaching yield</div>
                  <div style={{fontSize:28,fontWeight:700,color:finalYield>=70?C.green:finalYield>=40?C.yellow:C.red,lineHeight:1.1,marginTop:3}}>{finalYield.toFixed(1)}%</div>
                </div>
              )}
              {finalCcor!=null && (
                <div style={{background:C.surfaceHigh,border:`1px solid ${C.border}`,borderRadius:7,padding:"12px 20px"}}>
                  <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",color:C.muted}}>Final concentration</div>
                  <div style={{fontSize:22,fontWeight:600,color:C.text,lineHeight:1.1,marginTop:3}}>{finalCcor.toFixed(2)} <span style={{fontSize:11,color:C.muted}}>mg/L</span></div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Controls comparison tab */}
      {activeTab==="controls" && (
        <div style={S.card}>
          <div style={S.cardTitle}>Controls comparison — concentration (mg/L, corrected)</div>
          <div style={{display:"flex",gap:12,marginBottom:16,flexWrap:"wrap"}}>
            {conditions.map((cond,ci)=>(
              <div key={cond.id} style={{display:"flex",alignItems:"center",gap:8,background:C.surfaceHigh,borderRadius:6,padding:"6px 12px"}}>
                <div style={{width:10,height:10,borderRadius:"50%",background:cond.color,flexShrink:0}}/>
                <input style={{...S.input,width:160,padding:"4px 8px",fontSize:12}} value={cond.label} onChange={e=>setConditions(cs=>cs.map((c,i)=>i===ci?{...c,label:e.target.value}:c))}/>
              </div>
            ))}
          </div>
          <table style={S.table}>
            <thead><tr>
              <th style={S.th}>Time (h)</th>
              {conditions.map(c=><th key={c.id} style={{...S.th,color:c.color}}>pH — {c.label}</th>)}
              {conditions.map(c=><th key={c.id} style={{...S.th,color:c.color}}>C — {c.label} (mg/L)</th>)}
              <th style={S.th}>Δ [0] vs [1]</th>
              <th style={S.th}>Δ [0] vs [2]</th>
            </tr></thead>
            <tbody>
              {condRows.map((row,ti)=>(
                <tr key={ti}>
                  <td style={{...S.td,fontWeight:600}}>{row.time}</td>
                  {[0,1,2].map(ci=>(
                    <td key={ci} style={S.td}>
                      <input style={{...S.input,width:70,padding:"4px 6px",textAlign:"center"}} type="number" step="0.1" value={row.ph[ci]} onChange={e=>setCondRow(ti,"ph",ci,e.target.value)} placeholder="—"/>
                    </td>
                  ))}
                  {[0,1,2].map(ci=>(
                    <td key={ci} style={S.td}>
                      <input style={{...S.input,width:90,padding:"4px 6px",textAlign:"right"}} type="number" step="0.01" value={row.c[ci]} onChange={e=>setCondRow(ti,"c",ci,e.target.value)} placeholder="—"/>
                    </td>
                  ))}
                  {[1,2].map(ci=>{
                    const v0=parseFloat(row.c[0]),v=parseFloat(row.c[ci]);
                    const delta=!isNaN(v0)&&!isNaN(v)?v0-v:null;
                    return <td key={ci} style={{...S.td,textAlign:"right",color:delta!=null?(delta>0?C.green:C.red):C.muted,fontWeight:delta!=null?600:400}}>{delta!=null?`${delta>0?"+":""}${delta.toFixed(2)}`:"—"}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Charts tab */}
      {activeTab==="charts" && (
        <div>
          <div style={S.card}>
            <div style={S.cardTitle}>Corrected concentration vs time (mg/L)</div>
            {renderChart(calc,"time","c_cor","C (mg/L)",C.accent)}
          </div>
          {params.ree_pct && params.mass_initial && (
            <div style={S.card}>
              <div style={S.cardTitle}>Leaching yield vs time (%)</div>
              {renderChart(calc,"time","yield_pct","Yield (%)",C.green)}
            </div>
          )}
          <div style={S.card}>
            <div style={S.cardTitle}>pH vs time</div>
            {renderChart(
              calc.map(r=>({...r,ph_num:r.ph!==""&&!isNaN(parseFloat(r.ph))?parseFloat(r.ph):null})),
              "time","ph_num","pH",C.yellow
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────
function App() {
  const [tab,         setTab]         = useState("planner");
  const [experiments, setExperiments] = useState([]);
  const [allRuns,     setAllRuns]     = useState([]);
  const [allUploads,  setAllUploads]  = useState([]);
  const [syncStatus,  setSyncStatus]  = useState("syncing");

  useEffect(() => {
    // Load from localStorage immediately (instant)
    setExperiments(lsLoad("experiments", []));
    setAllRuns(lsLoad("icpRuns", []));

    // Then sync from Supabase (cloud)
    Promise.all([dbGetExperiments(), dbGetRuns(), dbGetUploads()])
      .then(([exps, runs, uploads]) => {
        const normExps = exps.map(e => ({ ...e, icpRunIds: e.icp_run_ids || e.icpRunIds || [] }));
        const normRuns = runs.map(r => ({ ...r, expName: r.exp_name || "" }));
        const normUploads = uploads.map(u => ({ ...u, fileName: u.file_name, uploadedAt: u.uploaded_at }));
        setExperiments(normExps); lsSave("experiments", normExps);
        setAllRuns(normRuns);     lsSave("icpRuns", normRuns);
        setAllUploads(normUploads); lsSave("icpUploads", normUploads);
        setSyncStatus("synced");
      })
      .catch(err => {
        console.warn("Supabase sync failed, using local cache:", err);
        setSyncStatus("error");
      });
  }, []);

  async function saveUpload(parsed, fileName) {
    const upload = { id:`upload_${Date.now()}`, fileName: fileName||"paste", uploadedAt: new Date().toISOString(), samples: parsed.samples, elements: parsed.elements };
    const updated = [upload, ...allUploads].slice(0, 50); // keep last 50
    setAllUploads(updated); lsSave("icpUploads", updated);
    try { await dbSaveUpload(upload); } catch(e) { console.warn("Upload sync error:", e); }
  }

  async function saveRun(expId, sample, df) {
    const newRun = { id:`run_${Date.now()}`, name:sample.name, data:sample.data, df, expName:experiments.find(e=>e.id===expId)?.name||"" };
    const updatedRuns = [...allRuns, newRun];
    const updatedExps = experiments.map(e=>e.id===expId?{...e,icpRunIds:[...(e.icpRunIds||[]),newRun.id]}:e);
    setAllRuns(updatedRuns);     lsSave("icpRuns", updatedRuns);
    setExperiments(updatedExps); lsSave("experiments", updatedExps);
    setSyncStatus("syncing");
    try {
      await dbSaveRun(newRun);
      const updatedExp = updatedExps.find(e=>e.id===expId);
      await dbSaveExperiment(updatedExp);
      setSyncStatus("synced");
    } catch(e) { console.warn("Sync error:", e); setSyncStatus("error"); }
  }

  const tabs = [
    { id:"planner",   label:"① Dilution Planner" },
    { id:"analyser",  label:"② ICP Analysis" },
    { id:"recovery",  label:"③ Recovery Yield" },
    { id:"dashboard", label:"④ Experiments" },
    { id:"kinetics",  label:"⑤ Kinetics" },
  ];

  return (
    <div style={{ fontFamily:"'IBM Plex Mono','Fira Code',monospace", background:C.bg, minHeight:"100vh", color:C.text }}>
      <div style={{ borderBottom:`1px solid ${C.border}`, padding:"18px 32px", display:"flex", alignItems:"center", gap:14, background:C.surface }}>
        <div style={{ width:38, height:38, borderRadius:8, background:`linear-gradient(135deg,${C.accent},#1f6feb)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>⚗</div>
        <div>
          <div style={{ fontSize:15, fontWeight:700, letterSpacing:"0.02em" }}>BioLeach Lab · ICP-OES Dashboard</div>
          <div style={{ fontSize:10, color:C.muted, letterSpacing:"0.07em", textTransform:"uppercase" }}>University of Sydney · Bioleaching Research</div>
        </div>
        <div style={{ marginLeft:"auto", fontSize:10, color:C.muted, textAlign:"right", lineHeight:1.8 }}>
          ICP range: 1–50 mg/L · Matrix: 2% HNO₃<br/>
          <SyncBadge status={syncStatus} />
        </div>
      </div>

      <div style={{ display:"flex", borderBottom:`1px solid ${C.border}`, padding:"0 32px", background:C.surface }}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{ padding:"11px 16px", fontSize:11, fontWeight:500, letterSpacing:"0.05em", textTransform:"uppercase", cursor:"pointer", border:"none", background:"transparent", color:tab===t.id?C.accent:C.muted, borderBottom:tab===t.id?`2px solid ${C.accent}`:"2px solid transparent", marginBottom:-1, fontFamily:"inherit" }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ padding:"28px 32px", maxWidth:1200 }}>
        {tab==="planner"   && <DilutionPlanner />}
        {tab==="analyser"  && <ICPAnalyser experiments={experiments} onSaveRun={saveRun} allUploads={allUploads} onSaveUpload={saveUpload} />}
        {tab==="recovery"  && <RecoveryCalc runs={allRuns} />}
        {tab==="dashboard" && <ExperimentDashboard experiments={experiments} setExperiments={setExperiments} allRuns={allRuns} syncStatus={syncStatus} />}
        {tab==="kinetics"  && <KineticsTracker experiments={experiments} />}
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(React.createElement(App));
