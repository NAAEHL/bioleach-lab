// BioLeach Lab · ICP-OES Dashboard
// University of Sydney · Bioleaching Research
// Data persisted in localStorage — works fully offline

const { useState, useEffect, useCallback } = React;

// ─── localStorage helpers ─────────────────────────────────────────────────────
function save(key, value) {
  try { localStorage.setItem("bioleach_" + key, JSON.stringify(value)); } catch(e) { console.warn("Storage error:", e); }
}
function load(key, fallback) {
  try { const v = localStorage.getItem("bioleach_" + key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}

// ─── Constants ────────────────────────────────────────────────────────────────
const C = {
  bg: "#0d1117", surface: "#161b22", surfaceHigh: "#21262d",
  border: "#30363d", accent: "#58a6ff", accentGlow: "rgba(88,166,255,0.12)",
  green: "#3fb950", yellow: "#d29922", red: "#f85149",
  muted: "#8b949e", text: "#e6edf3", textDim: "#c9d1d9",
};

const REE = ["Ce","Dy","Er","Eu","Gd","Ho","La","Lu","Nd","Pr","Sc","Sm","Tb","Th","Tm","U","Y","Yb"];
const ICP_MIN = 1, ICP_MAX = 50;
const EXP_TYPES = ["Bioleaching","Precipitation","Leaching","Characterisation","Calibration","Other"];
const EXP_STATUSES = ["In progress","Pending","Completed","Abandoned"];
const STATUS_COLOR = { "Completed": C.green, "In progress": C.accent, "Pending": C.yellow, "Abandoned": C.red };

const EL_GROUPS = [
  { label: "Matrix / Impurities", els: ["Al","Ca","Fe","K","Mg","Na","Si","As"] },
  { label: "Target metals",        els: ["Cu","Au","Ag"] },
  { label: "Rare Earth Elements",  els: REE },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const rangeStatus = v => (v == null || isNaN(v)) ? "unknown" : v > ICP_MAX ? "high" : v < ICP_MIN ? "low" : "ok";
const statusColor  = s => ({ ok: C.green, high: C.red, low: C.yellow }[s] || C.muted);
const statusBg     = s => ({ ok:"rgba(63,185,80,0.1)", high:"rgba(248,81,73,0.1)", low:"rgba(210,153,34,0.1)" }[s] || "transparent");

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
  const headers = lines[0].split(sep).map(h => h.trim().replace(/[\n\r]/g," ").replace(/\s+/g," "));
  const elementCols = {};
  headers.forEach((h,i) => { const m = h.match(/^([A-Z][a-z]?)\s+\d+/); if (m) elementCols[m[1]] = i; });
  const sidIdx = headers.findIndex(h => /sample.?id/i.test(h));
  if (sidIdx === -1) return null;
  const SKIP = ["blank","std","calibrat","mili","qc","sample id","wire"];
  const samples = [];
  for (let r = 1; r < lines.length; r++) {
    const cols = lines[r].split(sep);
    const name = cols[sidIdx]?.trim();
    if (!name || SKIP.some(s => name.toLowerCase().includes(s))) continue;
    const data = {};
    for (const [el,ci] of Object.entries(elementCols)) {
      const v = cols[ci]?.trim();
      data[el] = v !== undefined && v !== "" ? parseFloat(v) : null;
    }
    samples.push({ name, data });
  }
  return samples.length ? { samples, elements: Object.keys(elementCols) } : null;
}

// ─── Shared style primitives ──────────────────────────────────────────────────
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

// ─── Module 1 — Dilution Planner ─────────────────────────────────────────────
function DilutionPlanner() {
  const [estimates, setEstimates] = useState({});
  const [sampleName, setSampleName] = useState("");
  const [sampleVol,  setSampleVol]  = useState(1);
  const [finalVol,   setFinalVol]   = useState(10);
  const [result,     setResult]     = useState(null);

  const setEl = (el, v) => setEstimates(p => ({ ...p, [el]: v === "" ? "" : parseFloat(v) || "" }));

  function calculate() {
    const est = Object.fromEntries(
      Object.entries(estimates).filter(([,v]) => v !== "" && !isNaN(parseFloat(v))).map(([k,v]) => [k, parseFloat(v)])
    );
    if (!Object.keys(est).length) return;
    const dfCalc = recommendDF(est);
    const dfVol  = Math.ceil(parseFloat(finalVol) / parseFloat(sampleVol));
    const df     = Math.max(dfCalc, dfVol);
    setResult({ df, actualVol: (parseFloat(finalVol)/df).toFixed(3), finalVol: parseFloat(finalVol), est,
      projected: Object.fromEntries(Object.entries(est).map(([el,c]) => [el, c/df])) });
  }

  return (
    <div>
      <div style={S.card}>
        <div style={S.cardTitle}>Sample information</div>
        <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
          <div style={{ flex:"1 1 220px" }}>
            <label style={S.label}>Sample name</label>
            <input style={S.input} value={sampleName} onChange={e => setSampleName(e.target.value)} placeholder="e.g. Leachate_PCB_run3" />
          </div>
          <div style={{ flex:"0 0 150px" }}>
            <label style={S.label}>Sample volume (mL)</label>
            <input style={S.input} type="number" min="0.01" step="0.1" value={sampleVol} onChange={e => setSampleVol(e.target.value)} />
          </div>
          <div style={{ flex:"0 0 170px" }}>
            <label style={S.label}>Final vol. in 2% HNO₃ (mL)</label>
            <input style={S.input} type="number" min="1" step="1" value={finalVol} onChange={e => setFinalVol(e.target.value)} />
          </div>
        </div>
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
                  <input style={{ ...S.input, textAlign:"right", padding:"7px 8px" }} type="number" min="0" placeholder="?" value={estimates[el]??""} onChange={e => setEl(el, e.target.value)} />
                </div>
              ))}
            </div>
          </div>
        ))}
        <button style={S.btn("primary")} onClick={calculate}>Calculate dilution</button>
      </div>

      {result && (
        <div style={{ ...S.card, border:`1px solid ${C.accent}44` }}>
          <div style={S.cardTitle}>Result{sampleName ? ` — "${sampleName}"` : ""}</div>
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
                const proj = result.projected[el]; const s = rangeStatus(proj);
                return (
                  <tr key={el} style={{ background: s!=="ok" ? statusBg(s) : "transparent" }}>
                    <td style={{ ...S.td, fontWeight:600, color:REE.includes(el)?C.accent:C.text }}>
                      {el}{REE.includes(el) && <span style={{ fontSize:9, color:C.accent, marginLeft:4 }}>REE</span>}
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
    </div>
  );
}

// ─── Module 2 — ICP Analysis ──────────────────────────────────────────────────
function ICPAnalyser({ experiments, onSaveRun }) {
  const [raw,       setRaw]       = useState("");
  const [parsed,    setParsed]    = useState(null);
  const [error,     setError]     = useState("");
  const [dfMap,     setDfMap]     = useState({});
  const [selected,  setSelected]  = useState(null);
  const [linkExp,   setLinkExp]   = useState({});
  const [savedMsg,  setSavedMsg]  = useState("");

  function parse() {
    setError(""); setParsed(null);
    const res = parseICPData(raw);
    if (!res) { setError("Could not parse data. Paste the full 'Conc. in Sample Units' sheet including the header row."); return; }
    setParsed(res);
    const dfs = {}; res.samples.forEach(s => { dfs[s.name] = 1; });
    setDfMap(dfs); setSelected(res.samples[0]?.name);
  }

  function overallStatus(sample) {
    let high=false, low=false;
    for (const v of Object.values(sample.data)) {
      if (v==null||isNaN(v)) continue;
      const s=rangeStatus(v); if(s==="high")high=true; if(s==="low")low=true;
    }
    return high?"high":low?"low":"ok";
  }

  function doSaveRun(sample) {
    const expId = linkExp[sample.name];
    if (!expId) { setSavedMsg("⚠ Please select an experiment first."); setTimeout(()=>setSavedMsg(""),3000); return; }
    onSaveRun(parseInt(expId), sample, parseFloat(dfMap[sample.name])||1);
    setSavedMsg(`✓ "${sample.name}" saved.`);
    setTimeout(()=>setSavedMsg(""),3000);
  }

  const selSample = parsed?.samples.find(s => s.name === selected);

  return (
    <div>
      <div style={S.card}>
        <div style={S.cardTitle}>Paste ICP data — "Conc. in Sample Units" sheet</div>
        <div style={{ fontSize:11, color:C.muted, marginBottom:10 }}>
          In Excel: select all (Ctrl+A) → copy (Ctrl+C) → paste below. Standards, blanks and calibration rows are excluded automatically.
        </div>
        <textarea style={{ ...S.textarea, minHeight:110 }} value={raw} onChange={e=>setRaw(e.target.value)} placeholder="Paste here..." />
        {error && <div style={{ color:C.red, fontSize:12, marginTop:8 }}>{error}</div>}
        <div style={{ marginTop:12, display:"flex", gap:10, alignItems:"center" }}>
          <button style={S.btn("primary")} onClick={parse}>Analyse</button>
          {parsed && <button style={S.btn("secondary")} onClick={()=>{setParsed(null);setRaw("");}}>Clear</button>}
          {savedMsg && <span style={{ fontSize:12, color: savedMsg.startsWith("⚠") ? C.yellow : C.green }}>{savedMsg}</span>}
        </div>
      </div>

      {parsed && (
        <>
          <div style={S.card}>
            <div style={S.cardTitle}>{parsed.samples.length} sample{parsed.samples.length>1?"s":""} detected</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:16 }}>
              {parsed.samples.map(s => {
                const st = overallStatus(s);
                return (
                  <button key={s.name} onClick={()=>setSelected(s.name)} style={{ padding:"6px 14px", borderRadius:6, border:`1px solid ${selected===s.name?C.accent:statusColor(st)+"55"}`, background:selected===s.name?C.accentGlow:statusBg(st), color:selected===s.name?C.accent:statusColor(st), fontFamily:"inherit", fontSize:12, cursor:"pointer", fontWeight:selected===s.name?700:400 }}>
                    {s.name}
                  </button>
                );
              })}
            </div>
            <table style={S.table}>
              <thead><tr>
                <th style={S.th}>Sample</th>
                <th style={S.th}>Dilution factor</th>
                <th style={S.th}>Out-of-range elements</th>
                <th style={S.th}>Link to experiment</th>
                <th style={S.th}>Status</th>
              </tr></thead>
              <tbody>
                {parsed.samples.map(s => {
                  const st = overallStatus(s);
                  const oor = Object.entries(s.data).filter(([,v])=>v!=null&&!isNaN(v)&&rangeStatus(v)!=="ok").map(([el,v])=>({el,v,s:rangeStatus(v)}));
                  return (
                    <tr key={s.name} style={{ cursor:"pointer", background:selected===s.name?C.accentGlow:"transparent" }} onClick={()=>setSelected(s.name)}>
                      <td style={{ ...S.td, fontWeight:600 }}>{s.name}</td>
                      <td style={S.td} onClick={e=>e.stopPropagation()}>
                        <input style={{ ...S.input, width:70, padding:"4px 8px", textAlign:"center" }} type="number" min="1" step="1" value={dfMap[s.name]||1} onChange={e=>setDfMap(p=>({...p,[s.name]:e.target.value}))} />
                      </td>
                      <td style={S.td}>
                        {oor.length===0
                          ? <span style={{color:C.muted,fontSize:11}}>—</span>
                          : oor.slice(0,5).map(({el,v,s:es})=>(
                              <span key={el} style={S.tag(statusColor(es))}>{el} {v>ICP_MAX?`↑${v.toFixed(1)}`:`↓${v.toFixed(3)}`}</span>
                            ))
                        }
                      </td>
                      <td style={S.td} onClick={e=>e.stopPropagation()}>
                        <select style={{ ...S.input, width:180, padding:"4px 8px", fontSize:11 }} value={linkExp[s.name]||""} onChange={e=>setLinkExp(p=>({...p,[s.name]:e.target.value}))}>
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
            const df = parseFloat(dfMap[selSample.name])||1;
            const entries = Object.entries(selSample.data).filter(([,v])=>v!=null&&!isNaN(v)).sort(([a],[b])=>a.localeCompare(b));
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
                    <th style={S.th}>Element</th>
                    <th style={S.th}>Machine reading (mg/L)</th>
                    <th style={S.th}>Real conc. ×{df} (mg/L)</th>
                    <th style={S.th}>Range status</th>
                    <th style={S.th}>Group</th>
                  </tr></thead>
                  <tbody>
                    {entries.map(([el,v]) => {
                      const s=rangeStatus(v); const real=v*df;
                      return (
                        <tr key={el} style={{ background:s!=="ok"?statusBg(s):"transparent" }}>
                          <td style={{ ...S.td, fontWeight:600, color:REE.includes(el)?C.accent:C.text }}>
                            {el}{REE.includes(el)&&<span style={{fontSize:9,color:C.accent,marginLeft:4}}>REE</span>}
                          </td>
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
        </>
      )}
    </div>
  );
}

// ─── Module 3 — Recovery Yield ────────────────────────────────────────────────
function RecoveryCalc({ runs }) {
  const [baseId,  setBaseId]  = useState("");
  const [finalId, setFinalId] = useState("");

  const baseRun  = runs.find(r => r.id === baseId);
  const finalRun = runs.find(r => r.id === finalId);

  function calcRecovery() {
    if (!baseRun || !finalRun) return null;
    const els = Object.keys(baseRun.data).filter(el => {
      const b=baseRun.data[el]; const f=finalRun.data[el];
      return b!=null&&f!=null&&!isNaN(b)&&!isNaN(f)&&b>0;
    });
    return els.map(el => ({
      el,
      base:  baseRun.data[el]  * (baseRun.df||1),
      final: finalRun.data[el] * (finalRun.df||1),
      pct:   (finalRun.data[el] * (finalRun.df||1)) / (baseRun.data[el] * (baseRun.df||1)) * 100,
    })).sort((a,b) => b.pct - a.pct);
  }

  const recovery = calcRecovery();
  const recovColor = pct => pct>=70?C.green:pct>=40?C.yellow:C.red;

  if (!runs.length) return (
    <div style={S.card}>
      <div style={{ color:C.muted, fontSize:12, textAlign:"center", padding:"32px 0" }}>
        No ICP runs saved yet.<br/>
        Analyse your data in the <strong style={{color:C.accent}}>ICP Analysis</strong> tab and save runs to an experiment first.
      </div>
    </div>
  );

  return (
    <div>
      <div style={S.card}>
        <div style={S.cardTitle}>Recovery yield calculator</div>
        <div style={{ fontSize:11, color:C.muted, marginBottom:14 }}>
          Select a baseline sample (e.g. "14.5 base") and a final sample (e.g. "14.5 final") to compute % recovery per element.
        </div>
        <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
          <div style={{ flex:"1 1 200px" }}>
            <label style={S.label}>Baseline sample</label>
            <select style={S.input} value={baseId} onChange={e=>setBaseId(e.target.value)}>
              <option value="">— select —</option>
              {runs.map(r=><option key={r.id} value={r.id}>{r.name} ({r.expName})</option>)}
            </select>
          </div>
          <div style={{ flex:"1 1 200px" }}>
            <label style={S.label}>Final sample</label>
            <select style={S.input} value={finalId} onChange={e=>setFinalId(e.target.value)}>
              <option value="">— select —</option>
              {runs.map(r=><option key={r.id} value={r.id}>{r.name} ({r.expName})</option>)}
            </select>
          </div>
        </div>
      </div>

      {recovery && (() => {
        const reeData   = recovery.filter(r => REE.includes(r.el));
        const otherData = recovery.filter(r => !REE.includes(r.el));
        return (
          <div style={S.card}>
            <div style={S.cardTitle}>Recovery — {baseRun.name} → {finalRun.name}</div>
            {[{ label:"REE", data:reeData },{ label:"Other elements", data:otherData }].map(g => g.data.length>0 && (
              <div key={g.label} style={{ marginBottom:22 }}>
                <div style={{ fontSize:10, textTransform:"uppercase", letterSpacing:"0.1em", color:C.accent, marginBottom:10 }}>{g.label}</div>
                <table style={S.table}>
                  <thead><tr>
                    <th style={S.th}>Element</th>
                    <th style={S.th}>Baseline (mg/L)</th>
                    <th style={S.th}>Final (mg/L)</th>
                    <th style={S.th}>Recovery (%)</th>
                    <th style={S.th} style={{ width:140 }}>Bar</th>
                  </tr></thead>
                  <tbody>
                    {g.data.map(({ el, base, final, pct }) => (
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
function ExperimentDashboard({ experiments, setExperiments, allRuns }) {
  const [showNew,  setShowNew]  = useState(false);
  const [selected, setSelected] = useState(null);
  const emptyForm = { name:"", date:new Date().toISOString().slice(0,10), type:"Bioleaching", matrix:"", conditions:"", organism:"", status:"In progress", notes:"" };
  const [form, setForm] = useState(emptyForm);

  function addExp() {
    if (!form.name.trim()) return;
    const updated = [{ ...form, id: Date.now(), icpRunIds:[] }, ...experiments];
    setExperiments(updated); save("experiments", updated);
    setShowNew(false); setForm(emptyForm);
  }

  function updateStatus(id, status) {
    const updated = experiments.map(e => e.id===id ? { ...e, status } : e);
    setExperiments(updated); save("experiments", updated);
  }

  function deleteExp(id) {
    if (!window.confirm("Delete this experiment? Linked ICP runs will be unlinked.")) return;
    const updated = experiments.filter(e => e.id !== id);
    setExperiments(updated); save("experiments", updated);
    if (selected===id) setSelected(null);
  }

  const exp     = experiments.find(e => e.id === selected);
  const expRuns = exp ? allRuns.filter(r => exp.icpRunIds?.includes(r.id)) : [];

  const fieldDefs = [
    { label:"Name", key:"name", type:"text", placeholder:"e.g. REE bioleaching G.oxydans run4" },
    { label:"Date", key:"date", type:"date" },
    { label:"Matrix / Material", key:"matrix", type:"text", placeholder:"e.g. PCB, NdFeB magnet, Phosphors" },
    { label:"Conditions", key:"conditions", type:"text", placeholder:"e.g. pH 6.5, 30°C, 48h" },
    { label:"Organism", key:"organism", type:"text", placeholder:"e.g. A. thiooxidans, G. oxydans" },
  ];

  return (
    <div style={{ display:"grid", gridTemplateColumns: selected ? "310px 1fr" : "1fr", gap:16 }}>
      <div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
          <div style={{ fontSize:11, color:C.muted, textTransform:"uppercase", letterSpacing:"0.08em" }}>{experiments.length} experiment{experiments.length!==1?"s":""}</div>
          <button style={S.btn("primary")} onClick={()=>setShowNew(v=>!v)}>+ New</button>
        </div>

        {showNew && (
          <div style={{ ...S.card, border:`1px solid ${C.accent}44`, marginBottom:14 }}>
            <div style={S.cardTitle}>New experiment</div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {fieldDefs.map(f => (
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

        {experiments.map(e => (
          <div key={e.id} onClick={()=>setSelected(selected===e.id?null:e.id)} style={{ ...S.card, cursor:"pointer", border:`1px solid ${selected===e.id?C.accent:C.border}`, background:selected===e.id?C.accentGlow:C.surface, marginBottom:10, padding:"14px 16px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
              <div style={{ fontSize:13, fontWeight:600, color:selected===e.id?C.accent:C.text, lineHeight:1.3 }}>{e.name}</div>
              <span style={{ fontSize:9, padding:"2px 7px", borderRadius:4, fontWeight:600, background:`${STATUS_COLOR[e.status]||C.muted}22`, color:STATUS_COLOR[e.status]||C.muted, border:`1px solid ${STATUS_COLOR[e.status]||C.muted}44`, whiteSpace:"nowrap", marginLeft:8 }}>{e.status}</span>
            </div>
            <div style={{ fontSize:11, color:C.muted, marginTop:3 }}>{e.date} · {e.type}</div>
            {e.matrix   && <div style={{ fontSize:11, color:C.muted }}>Matrix: {e.matrix}</div>}
            {e.organism && <div style={{ fontSize:11, color:C.muted }}>Organism: {e.organism}</div>}
            {e.icpRunIds?.length>0 && <div style={{ fontSize:10, color:C.accent, marginTop:4 }}>📊 {e.icpRunIds.length} ICP run{e.icpRunIds.length>1?"s":""} linked</div>}
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
                No ICP runs linked yet. Go to <strong style={{color:C.accent}}>ICP Analysis</strong>, select this experiment in the dropdown, then click "Save to experiment".
              </div>
            : <table style={S.table}>
                <thead><tr>
                  <th style={S.th}>Sample</th><th style={S.th}>DF</th>
                  <th style={S.th}>Cu</th><th style={S.th}>La</th>
                  <th style={S.th}>Nd</th><th style={S.th}>Ce</th><th style={S.th}>Fe</th>
                  <th style={S.th}>Alerts</th>
                </tr></thead>
                <tbody>
                  {expRuns.map(run => {
                    const df=run.df||1;
                    const get=el=>{ const v=run.data[el]; return (v!=null&&!isNaN(v))?(v*df).toFixed(3):"—"; };
                    const alerts=Object.entries(run.data).filter(([,v])=>v!=null&&!isNaN(v)&&rangeStatus(v)!=="ok").map(([el])=>el);
                    return (
                      <tr key={run.id}>
                        <td style={{ ...S.td, fontWeight:600 }}>{run.name}</td>
                        <td style={S.td}>×{df}</td>
                        {["Cu","La","Nd","Ce","Fe"].map(el=><td key={el} style={S.td}>{get(el)}</td>)}
                        <td style={S.td}>
                          {alerts.length===0
                            ? <span style={{color:C.green,fontSize:11}}>✓ OK</span>
                            : alerts.slice(0,4).map(el=><span key={el} style={S.tag(C.red)}>{el}</span>)}
                        </td>
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

// ─── Root App ─────────────────────────────────────────────────────────────────
function App() {
  const [tab, setTab] = useState("planner");
  const [experiments, setExperiments] = useState([]);
  const [allRuns,     setAllRuns]     = useState([]);

  useEffect(() => {
    setExperiments(load("experiments", [{
      id:1, name:"REE Carbonate Precipitation pH 6.5", date:"2026-05-28",
      type:"Precipitation", matrix:"Fluorescent lamp phosphors",
      conditions:"(NH₄)₂CO₃, pH 6.0–6.5, room temperature", organism:"",
      status:"Completed", notes:"Best performance: ~67–76% REE yield", icpRunIds:[],
    }]));
    setAllRuns(load("icpRuns", []));
  }, []);

  function saveRun(expId, sample, df) {
    const newRun = { id:`run_${Date.now()}`, name:sample.name, data:sample.data, df, expName:experiments.find(e=>e.id===expId)?.name||"" };
    const updatedRuns = [...allRuns, newRun];
    const updatedExps = experiments.map(e => e.id===expId ? { ...e, icpRunIds:[...(e.icpRunIds||[]), newRun.id] } : e);
    setAllRuns(updatedRuns); setExperiments(updatedExps);
    save("icpRuns", updatedRuns); save("experiments", updatedExps);
  }

  const tabs = [
    { id:"planner",   label:"① Dilution Planner" },
    { id:"analyser",  label:"② ICP Analysis" },
    { id:"recovery",  label:"③ Recovery Yield" },
    { id:"dashboard", label:"④ Experiments" },
  ];

  return (
    <div style={{ fontFamily:"'IBM Plex Mono','Fira Code',monospace", background:C.bg, minHeight:"100vh", color:C.text }}>
      {/* Header */}
      <div style={{ borderBottom:`1px solid ${C.border}`, padding:"18px 32px", display:"flex", alignItems:"center", gap:14, background:C.surface }}>
        <div style={{ width:38, height:38, borderRadius:8, background:`linear-gradient(135deg,${C.accent},#1f6feb)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>⚗</div>
        <div>
          <div style={{ fontSize:15, fontWeight:700, letterSpacing:"0.02em" }}>BioLeach Lab · ICP-OES Dashboard</div>
          <div style={{ fontSize:10, color:C.muted, letterSpacing:"0.07em", textTransform:"uppercase" }}>University of Sydney · Bioleaching Research</div>
        </div>
        <div style={{ marginLeft:"auto", fontSize:10, color:C.muted, textAlign:"right", lineHeight:1.7 }}>
          ICP calibration range: 1–50 mg/L<br/>Matrix: 2% HNO₃ · Data saved locally
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", borderBottom:`1px solid ${C.border}`, padding:"0 32px", background:C.surface }}>
        {tabs.map(t => (
          <button key={t.id} onClick={()=>setTab(t.id)} style={{ padding:"11px 16px", fontSize:11, fontWeight:500, letterSpacing:"0.05em", textTransform:"uppercase", cursor:"pointer", border:"none", background:"transparent", color:tab===t.id?C.accent:C.muted, borderBottom:tab===t.id?`2px solid ${C.accent}`:"2px solid transparent", marginBottom:-1, fontFamily:"inherit" }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding:"28px 32px", maxWidth:1200 }}>
        {tab==="planner"   && <DilutionPlanner />}
        {tab==="analyser"  && <ICPAnalyser experiments={experiments} onSaveRun={saveRun} />}
        {tab==="recovery"  && <RecoveryCalc runs={allRuns} />}
        {tab==="dashboard" && <ExperimentDashboard experiments={experiments} setExperiments={setExperiments} allRuns={allRuns} />}
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(React.createElement(App));
