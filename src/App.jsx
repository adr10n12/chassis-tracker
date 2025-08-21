import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import ProtectedRoute from "./lib/ProtectedRoute";
import { signOut } from "./features/auth";
import { useAuth } from "./lib/AuthProvider";


/* ------------------------------------------------------------------
   Chassis Compliance Tracker (Home-only, Mobile-Friendly)
   - Home table + mobile card view (“More” drawer: Inspections / Citations / Repairs)
   - Editor: enter inspection DONE dates; app computes due dates (+365 / +90)
   - Inspection history stored per chassis
   - Repairs can be linked to a Citation (and unlink on citation delete)
   - Import: CSV or Excel (.xlsx/.xls) with Unit/Plate/VIN
   - Persistence: localStorage
------------------------------------------------------------------- */

const STORAGE_KEY = "chassis_tracker_v1";
const LEDGER_KEY = "chassis_ledger_v1";

/* ------------------------- Utils ------------------------- */
function fmtDate(d) {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dt)) return "";
  return dt.toISOString().slice(0, 10);
}
function fmtHumanDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d)) return String(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
}
function addDaysISO(dateStr, days) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d)) return "";
  d.setDate(d.getDate() + days);
  return fmtDate(d);
}
function subDaysISO(dateStr, days) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d)) return "";
  d.setDate(d.getDate() - days);
  return fmtDate(d);
}
function daysUntil(dateStr) {
  if (!dateStr) return Infinity;
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(dateStr); d.setHours(0,0,0,0);
  return Math.round((d - today) / (1000*60*60*24));
}
function statusForDate(dateStr, soonDays = 30) {
  const d = daysUntil(dateStr);
  if (d === Infinity) return { label: "—", tone: "slate", days: d };
  if (d < 0)       return { label: `Overdue ${Math.abs(d)}d`, tone: "red", days: d };
  if (d <= soonDays) return { label: `Due in ${d}d`, tone: "amber", days: d };
  return { label: `OK (${d}d)`, tone: "emerald", days: d };
}
function overallStatus(item) {
  const s = [statusForDate(item.registrationDue), statusForDate(item.annualDue), statusForDate(item.bitDue)];
  const score = (st) => (st.days === Infinity ? 99999 : st.days);
  return s.reduce((a,b)=> (score(a) < score(b) ? a : b));
}
function classNames(...a){return a.filter(Boolean).join(" ");}
function rid(){ try{ return crypto.getRandomValues(new Uint32Array(1))[0].toString(36);} catch { return Math.random().toString(36).slice(2);} }

/* ------------------------- Demo seed ------------------------- */
const y = new Date().getFullYear();
const DEMO = [
  { id: rid(), unit:"CH-101", plate:"4ABC123", vin:"1G1YY26U775123456",
    registrationDue: fmtDate(new Date(y,10,15)), annualDue: fmtDate(new Date(y,8,1)),
    bitDue: fmtDate(new Date(y,7,25)), notes:"Needs reflector replacement" },
  { id: rid(), unit:"CH-202", plate:"9XYZ789", vin:"3N1AB7AP6FY256789",
    registrationDue: fmtDate(new Date(y,0,31)), annualDue: fmtDate(new Date(y,11,20)),
    bitDue: fmtDate(new Date(y,10,5)), notes:"" },
];

/* ------------------------- App ------------------------- */
export default function App(){  
  // auth (let ProtectedRoute handle redirects — don't blank the screen when logged-out)
  const { user, loading } = useAuth();
  // Optional: tiny loading state if you want
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-600">Loading…</div>
    );
  }

  // data
  const [items, setItems] = useState(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEMO;
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p : DEMO; } catch { return DEMO; }
  });
  const [ledger, setLedger] = useState(() => {
    const raw = localStorage.getItem(LEDGER_KEY);
    try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
  });

  // persist
  useEffect(()=> localStorage.setItem(STORAGE_KEY, JSON.stringify(items)), [items]);
  useEffect(()=> localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger)), [ledger]);

  // ensure bucket per chassis (and inspections sub-buckets)
  useEffect(()=>{
    setLedger(prev=>{
      let changed = false; const copy = {...prev};
      items.forEach(it=>{
        if (!copy[it.id]) { copy[it.id] = { citations:[], repairs:[], inspections:{ annual:[], bit:[] } }; changed = true; }
        if (!copy[it.id].citations)   { copy[it.id].citations = []; changed = true; }
        if (!copy[it.id].repairs)     { copy[it.id].repairs   = []; changed = true; }
        if (!copy[it.id].inspections) { copy[it.id].inspections = { annual:[], bit:[] }; changed = true; }
      });
      return changed ? copy : prev;
    });
  },[items]);

  // UI state
  const [editing, setEditing] = useState(null);
  const [openHistory, setOpenHistory] = useState(null); // opens drawer
  const fileRef = useRef(null);

  // Home filters/sort
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState({ key: "nextDue", dir: "asc" });

  const filtered = useMemo(()=>{
    const q = query.trim().toLowerCase();
    const base = items.filter(it => !q ||
      it.unit?.toLowerCase().includes(q) ||
      it.plate?.toLowerCase().includes(q) ||
      it.vin?.toLowerCase().includes(q) ||
      it.notes?.toLowerCase().includes(q)
    );
    const byFilter = base.filter(it=>{
      const ov = [statusForDate(it.registrationDue), statusForDate(it.annualDue), statusForDate(it.bitDue)];
      const isOverdue = ov.some(s=> s.days < 0);
      const isSoon = ov.some(s=> s.days >= 0 && s.days <= 30);
      if (filter==="overdue") return isOverdue;
      if (filter==="soon") return !isOverdue && isSoon;
      if (filter==="ok") return !isOverdue && !isSoon;
      return true;
    });
    const withNext = byFilter.map(it=>{
      const ds = [it.registrationDue, it.annualDue, it.bitDue].filter(Boolean);
      return { ...it, _nextDue: ds.length ? ds.sort()[0] : "9999-12-31" };
    });
    const dir = sort.dir==="asc" ? 1 : -1;
    return [...withNext].sort((a,b)=>{
      if (sort.key==="nextDue") return (a._nextDue > b._nextDue ? 1 : -1) * dir;
      if (sort.key==="unit") return (a.unit > b.unit ? 1 : -1) * dir;
      if (sort.key==="plate") return (a.plate > b.plate ? 1 : -1) * dir;
      return 0;
    });
  },[items,query,filter,sort]);

  /* ---------- Actions ---------- */
  function startAdd(){ setEditing({id:rid(), unit:"", plate:"", vin:"", registrationDue:"", annualDue:"", bitDue:"", notes:""}); }

  // saveEdit gets optional extras { lastAnnual, lastBit } to store history
  function saveEdit(it, extras = {}){
    setItems(prev=>{
      const idx = prev.findIndex(p=>p.id===it.id);
      if (idx===-1) return [it, ...prev];
      const copy = [...prev]; copy[idx]=it; return copy;
    });

    const { lastAnnual, lastBit } = extras;
    if (lastAnnual || lastBit) {
      setLedger(prev => {
        const copy = { ...prev };
        const bucket = copy[it.id] || (copy[it.id] = { citations:[], repairs:[], inspections:{ annual:[], bit:[] } });
        if (!bucket.inspections) bucket.inspections = { annual:[], bit:[] };
        const nowIso = new Date().toISOString();

        if (lastAnnual) {
          const due = addDaysISO(lastAnnual, 365);
          const arr = bucket.inspections.annual;
          if (!arr.length || arr[0].doneDate !== lastAnnual) {
            arr.unshift({ id: rid(), doneDate: lastAnnual, dueDate: due, enteredAt: nowIso });
          }
        }
        if (lastBit) {
          const due = addDaysISO(lastBit, 90);
          const arr = bucket.inspections.bit;
          if (!arr.length || arr[0].doneDate !== lastBit) {
            arr.unshift({ id: rid(), doneDate: lastBit, dueDate: due, enteredAt: nowIso });
          }
        }
        return copy;
      });
    }

    setEditing(null);
  }

  function remove(id){
    if (!confirm("Delete this chassis?")) return;
    setItems(prev=> prev.filter(p=>p.id!==id));
  }
  function exportCSV(){
    const header = ["unit","plate","vin","registrationDue","annualDue","bitDue","notes"];
    const body = filtered.map(r => header.map(h => r[h] ?? "").join(",")).join("\n");
    const csv = `${header.join(",")}\n${body}`;
    const blob = new Blob([csv], { type:"text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `chassis_export_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  // -------- Import (CSV / Excel) ----------
  function importChassisFile(file){
    const name = (file.name || "").toLowerCase();

    const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, "");
    const hasHeaders = (row=[]) => {
      const hdr = row.map(norm);
      return hdr.some(h => [
        "unit","unit#","unitnumber","chassis","chassis#","chassisnumber",
        "plate","plate#","license","licenseplate","tag",
        "vin"
      ].includes(h));
    };
    const mapHeaderToIndex = (header) => {
      const idx = { unit:-1, plate:-1, vin:-1 };
      header.forEach((h,i)=>{
        const hN = norm(h);
        if (["unit","unit#","unitnumber","chassis","chassis#","chassisnumber"].includes(hN)) idx.unit = i;
        if (["plate","plate#","license","licenseplate","tag"].includes(hN)) idx.plate = i;
        if (["vin"].includes(hN)) idx.vin = i;
      });
      return idx;
    };

    const handleRows = (rows) => {
      if (!rows.length) return alert("File is empty.");

      let headerRow = rows[0];
      let dataRows = rows.slice(1);

      // If we can’t detect headers but there are ≥3 cols, assume [Unit, Plate, VIN]
      if (!hasHeaders(headerRow)) {
        if ((rows[0] || []).length >= 3) {
          headerRow = ["unit","plate","vin"];
          dataRows = rows; // first row is data
        } else {
          alert("Could not detect headers. Expected columns: unit/plate/VIN.");
          return;
        }
      }

      const idx = mapHeaderToIndex(headerRow);
      if (idx.unit === -1 || idx.plate === -1 || idx.vin === -1) {
        alert("Missing required columns. Need: unit, plate, vin.");
        return;
      }

      const mapped = [];
      for (const row of dataRows) {
        if (!row) continue;
        const unit  = String(row[idx.unit]  ?? "").trim();
        const plate = String(row[idx.plate] ?? "").trim();
        const vin   = String(row[idx.vin]   ?? "").trim();
        if (!unit && !plate && !vin) continue;
        mapped.push({
          id: rid(),
          unit, plate, vin,
          registrationDue: "", annualDue: "", bitDue: "", notes: ""
        });
      }
      if (!mapped.length) return alert("No usable rows found.");

      // Deduplicate by VIN (preferred) or Unit+Plate
      setItems(prev => {
        const seenVIN = new Set(prev.map(p => (p.vin||"").toUpperCase()));
        const seenKey = new Set(prev.map(p => `${(p.unit||"").toUpperCase()}|${(p.plate||"").toUpperCase()}`));

        const toAdd = mapped.filter(m => {
          const vinKey = (m.vin||"").toUpperCase();
          if (vinKey && seenVIN.has(vinKey)) return false;
          const key = `${(m.unit||"").toUpperCase()}|${(m.plate||"").toUpperCase()}`;
          if (seenKey.has(key)) return false;
          seenVIN.add(vinKey);
          seenKey.add(key);
          return true;
        });

        alert(`Imported ${toAdd.length} chassis${toAdd.length !== mapped.length ? ` (skipped ${mapped.length - toAdd.length} duplicates)` : ""}.`);
        return [...toAdd, ...prev];
      });
    };

    // Excel
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }); // array of arrays
        handleRows(rows);
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    // CSV
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      const lines = text.split(/\r?\n/).filter(l => l.trim().length);
      const rows = lines.map(parseCSVRow);
      handleRows(rows);
    };
    reader.readAsText(file);
  }

  function parseCSVRow(line){
    const out=[]; let cur=""; let inQ=false;
    for (let i=0;i<line.length;i++){
      const ch = line[i];
      if (inQ){
        if (ch === '"'){ if (line[i+1] === '"'){ cur+='"'; i++; } else { inQ=false; } }
        else cur += ch;
      } else {
        if (ch === ","){ out.push(cur); cur=""; }
        else if (ch === '"'){ inQ=true; }
        else cur += ch;
      }
    }
    out.push(cur); return out;
  }

  // Ledger actions (history)
  function addCitation(chassisId, entry){
    setLedger(prev=>{
      const copy = {...prev};
      const bucket = copy[chassisId] || (copy[chassisId] = {citations:[], repairs:[], inspections:{annual:[], bit:[]}})
      if (entry._nonce && (bucket.citations||[]).some(e => e._nonce === entry._nonce)) return prev;
      bucket.citations = [{ id: rid(), ...entry }, ...(bucket.citations||[])];
      return copy;
    });
  }
  function addRepair(chassisId, entry){
    setLedger(prev=>{
      const copy = {...prev};
      const bucket = copy[chassisId] || (copy[chassisId] = {citations:[], repairs:[], inspections:{annual:[], bit:[]}})
      if (entry._nonce && (bucket.repairs||[]).some(e => e._nonce === entry._nonce)) return prev;
      bucket.repairs = [{ id: rid(), ...entry }, ...(bucket.repairs||[])];
      return copy;
    });
  }
  // delete citation AND unlink repairs pointing to it
  function deleteCitation(chassisId, entryId){
    setLedger(prev=>{
      const copy = {...prev};
      const b = copy[chassisId];
      if (!b) return prev;

      b.citations = (b.citations || []).filter(e => e.id !== entryId);
      b.repairs   = (b.repairs   || []).map(r => r.citationId === entryId ? { ...r, citationId: "" } : r);

      return copy;
    });
  }
  function deleteRepair(chassisId, entryId){
    setLedger(prev=>{
      const copy = {...prev}; const b = copy[chassisId]; if (!b) return prev;
      b.repairs = (b.repairs||[]).filter(e=> e.id !== entryId); return copy;
    });
  }
  function deleteInspection(chassisId, type, entryId){
    setLedger(prev=>{
      const copy = {...prev}; const b = copy[chassisId]; if (!b || !b.inspections) return prev;
      b.inspections[type] = (b.inspections[type] || []).filter(e => e.id !== entryId);
      return copy;
    });
  }

  /* ------------------------- UI ------------------------- */
  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-gray-50 text-gray-800">
        {/* Header */}
        <header className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-2 sm:px-4 py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="Nica Container Freight Line Inc."
                   className="w-12 h-12 rounded-full object-contain" />
              <div>
                <h1 className="text-xl font-semibold">Chassis Compliance Tracker</h1>
                <p className="text-sm text-gray-500">Track Annual &amp; BIT inspections, registration, and plates</p>
              </div>
            </div>

            {/* actions - mobile scrollable */}
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              <button onClick={startAdd} className="px-3 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700 shadow whitespace-nowrap">+ Add chassis</button>
              <button onClick={exportCSV} className="px-3 py-2 rounded-xl bg-white border border-gray-300 hover:bg-gray-50 whitespace-nowrap">Export CSV</button>
              <button onClick={()=>window.print()} className="px-3 py-2 rounded-xl bg-white border border-gray-300 hover:bg-gray-50 whitespace-nowrap">Print</button>

              {/* Logout */}
              <button
                onClick={async () => {
                  await signOut();
                  window.location.href = "/login";
                }}
                className="px-3 py-2 rounded-xl bg-red-600 text-white hover:bg-red-700"
              >
                Logout
              </button>

              {/* Import CSV/XLSX */}
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e)=> e.target.files?.[0] && importChassisFile(e.target.files[0])}
              />
              <button onClick={()=>fileRef.current?.click()} className="px-3 py-2 rounded-xl bg-white border border-gray-300 hover:bg-gray-50 whitespace-nowrap">
                Import (CSV/XLSX)
              </button>
            </div>
          </div>
        </header>

        {/* Toolbar */}
        <div className="max-w-7xl mx-auto px-2 sm:px-4 py-4 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
          <input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search unit, plate, VIN, notes..."
                 className="w-full md:w-96 px-3 py-2 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"/>
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            {[
              { key:"all", label:"All" },
              { key:"overdue", label:"Overdue" },
              { key:"soon", label:"Due ≤30d" },
              { key:"ok", label:"OK" },
            ].map(f=> (
              <button key={f.key} onClick={()=>setFilter(f.key)}
                      className={classNames("px-3 py-1.5 rounded-full border whitespace-nowrap",
                        filter===f.key ? "bg-blue-600 text-white border-blue-600" : "bg-white border-gray-300 hover:bg-gray-50")}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Main: Mobile cards + Desktop table */}
        <main className="max-w-7xl mx-auto px-2 sm:px-4 pb-24">
          {/* Mobile list (phones) */}
          <div className="sm:hidden">
            <MobileList
              items={filtered}
              onMore={(it)=>setOpenHistory(it)}
              onEdit={(it)=>setEditing(it)}
              onDelete={(id)=>remove(id)}
            />
          </div>

          {/* Desktop/table view (sm and up) */}
          <div className="hidden sm:block">
            <div className="overflow-x-auto bg-white rounded-2xl shadow-sm border border-gray-200">
              <table className="min-w-full">
                <thead className="bg-gray-50">
                <tr className="text-left text-sm text-gray-600">
                  <Th label="#" className="w-12"/>
                  <Th label="Unit" sortable sort={sort} setSort={setSort} sortKey="unit"/>
                  <Th label="Plate # " sortable sort={sort} setSort={setSort} sortKey="plate"/>
                  <Th label="VIN"/>
                  <Th label="Registration Due"/>
                  <Th label="Annual Due"/>
                  <Th label="BIT Due"/>
                  <Th label="Overall" sortable sort={sort} setSort={setSort} sortKey="nextDue"/>
                  <Th label="Notes"/>
                  <Th label="" className="w-28"/>
                </tr>
                </thead>
                <tbody>
                {filtered.length===0 && (
                  <tr><td colSpan={10} className="text-center py-10 text-gray-500">
                    No chassis yet. Click <span className="font-medium">Add chassis</span> to get started.
                  </td></tr>
                )}
                {filtered.map((it, idx)=>{
                  const regS = statusForDate(it.registrationDue);
                  const annS = statusForDate(it.annualDue);
                  const bitS = statusForDate(it.bitDue);
                  const allS = overallStatus(it);
                  return (
                    <tr key={it.id} className={classNames(idx%2?"bg-white":"bg-gray-50/50")}> 
                      <td className="px-3 py-3 text-sm text-gray-500">{idx+1}</td>
                      <td className="px-3 py-3 font-medium whitespace-nowrap">{it.unit || "—"}</td>
                      <td className="px-3 py-3">{it.plate || "—"}</td>
                      <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">{it.vin || "—"}</td>
                      <td className="px-3 py-3"><DueCell date={it.registrationDue} s={regS}/></td>
                      <td className="px-3 py-3"><DueCell date={it.annualDue} s={annS}/></td>
                      <td className="px-3 py-3"><DueCell date={it.bitDue} s={bitS}/></td>
                      <td className="px-3 py-3"><StatusBadge s={allS} solid/></td>
                      <td className="px-3 py-3 text-sm text-gray-600 truncate max-w-[16rem]" title={it.notes}>{it.notes}</td>
                      <td className="px-3 py-3">
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => setOpenHistory(it)}
                            className="px-3 py-2 rounded-lg text-slate-700 hover:bg-slate-50 border border-slate-200"
                          >
                            More
                          </button>
                          <button onClick={()=>setEditing(it)} className="px-3 py-2 rounded-lg text-blue-700 hover:bg-blue-50 border border-blue-200">Edit</button>
                          <button onClick={()=>remove(it.id)} className="px-3 py-2 rounded-lg text-red-700 hover:bg-red-50 border border-red-200">Delete</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                </tbody>
              </table>
            </div>
          </div>
        </main>

        {/* Drawer */}
        {openHistory && (
          <LedgerDrawer
            key={openHistory.id}
            item={openHistory}
            bucket={ledger[openHistory.id] || { citations: [], repairs: [], inspections: { annual: [], bit: [] } }}
            onClose={() => setOpenHistory(null)}
            initialTab="inspections"
            addCitation={(e) => addCitation(openHistory.id, e)}
            addRepair={(e) => addRepair(openHistory.id, e)}
            deleteCitation={(entryId) => deleteCitation(openHistory.id, entryId)}
            deleteRepair={(entryId) => deleteRepair(openHistory.id, entryId)}
            deleteInspection={(type, id) => deleteInspection(openHistory.id, type, id)}
          />
        )}

        {editing && <Editor value={editing} onCancel={()=>setEditing(null)} onSave={saveEdit}/>}

        <style>{`
          /* Hide horizontal scrollbars on mobile action rows */
          .no-scrollbar::-webkit-scrollbar { display: none; }
          .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

          @media print {
            header, .no-print { display: none !important; }
            main { padding: 0; }
            table { font-size: 11px; }
          }
        `}</style>
      </div>
    </ProtectedRoute>
  );
}

/* ------------------------- Reusable bits ------------------------- */
function Th({ label, className = "", sortable = false, sort, setSort, sortKey }) {
  const isActive = sortable && sort?.key === sortKey;
  return (
    <th
      className={classNames("px-3 py-2 font-medium", className)}
      onClick={() => {
        if (!sortable) return;
        if (sort.key !== sortKey) setSort({ key: sortKey, dir: "asc" });
        else setSort({ key: sortKey, dir: sort.dir === "asc" ? "desc" : "asc" });
      }}
    >
      <div className={classNames("flex items-center gap-1 select-none", sortable && "cursor-pointer")}>
        <span>{label}</span>
        {sortable && (
          <span className="text-xs text-gray-400">{isActive ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
        )}
      </div>
    </th>
  );
}
function StatusBadge({ s, solid = false }) {
  const palette = {
    slate:   solid ? "bg-slate-500 text-white"     : "text-slate-700 bg-slate-100 border border-slate-200",
    red:     solid ? "bg-red-600 text-white"       : "text-red-700 bg-red-50 border border-red-200",
    amber:   solid ? "bg-amber-500 text-white"     : "text-amber-800 bg-amber-50 border border-amber-200",
    emerald: solid ? "bg-emerald-600 text-white"   : "text-emerald-700 bg-emerald-50 border border-emerald-200",
  }[s.tone || "slate"];
  return <span className={classNames("inline-flex items-center px-2 py-1 rounded-full text-xs font-medium", palette)}>{s.label}</span>;
}
function DueCell({ date, s }) {
  if (!date) return <span className="text-slate-400">—</span>;
  return (
    <div className="flex flex-col gap-1">
      <div className="text-sm font-medium text-slate-700">{fmtHumanDate(date)}</div>
      <StatusBadge s={s} />
    </div>
  );
}
function Field({ label, children }) {
  return (
    <label className="block">
      <div className="mb-1 text-sm font-medium text-gray-700">{label}</div>
      {children}
    </label>
  );
}

/* ------------------------- Mobile list (phones) ------------------------- */
function DueLine({ label, date }) {
  const s = statusForDate(date);
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-500">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-slate-700">{date ? fmtHumanDate(date) : "—"}</span>
        <StatusBadge s={s} />
      </div>
    </div>
  );
}

function MobileList({ items, onMore, onEdit, onDelete }) {
  if (!items.length) {
    return (
      <div className="text-center text-gray-500 py-8">
        No chassis yet. Tap <span className="font-medium">Add chassis</span> to get started.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {items.map((it)=>{
        const allS = overallStatus(it);
        return (
          <div key={it.id} className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-base font-semibold">{it.unit || "—"}</div>
                <div className="text-sm text-slate-600">{it.plate || "—"}</div>
                {it.vin && <div className="text-xs text-slate-500 mt-0.5">{it.vin}</div>}
              </div>
              <StatusBadge s={allS} solid />
            </div>

            <div className="my-3 space-y-1.5">
              <DueLine label="Registration" date={it.registrationDue} />
              <DueLine label="Annual" date={it.annualDue} />
              <DueLine label="BIT" date={it.bitDue} />
            </div>

            {it.notes && (
              <div className="text-sm text-slate-600 mb-2 line-clamp-2">{it.notes}</div>
            )}

            <div className="flex gap-2">
              <button onClick={()=>onMore(it)} className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-slate-700">More</button>
              <button onClick={()=>onEdit(it)} className="flex-1 px-3 py-2 rounded-xl border border-blue-200 text-blue-700">Edit</button>
              <button onClick={()=>onDelete(it.id)} className="flex-1 px-3 py-2 rounded-xl border border-red-200 text-red-700">Delete</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------- Editor ------------------------- */
function Editor({ value, onCancel, onSave }) {
  const [it, setIt] = useState(value);

  // Prefill "last done" dates from existing due dates (if present)
  const [lastAnnual, setLastAnnual] = useState(value?.annualDue ? subDaysISO(value.annualDue, 365) : "");
  const [lastBit, setLastBit] = useState(value?.bitDue ? subDaysISO(value.bitDue, 90) : "");

  useEffect(() => {
    setIt(value);
    setLastAnnual(value?.annualDue ? subDaysISO(value.annualDue, 365) : "");
    setLastBit(value?.bitDue ? subDaysISO(value.bitDue, 90) : "");
  }, [value]);

  useEffect(()=>{ const onEsc = e => e.key==="Escape" && onCancel(); window.addEventListener("keydown", onEsc); return ()=>window.removeEventListener("keydown", onEsc); },[onCancel]);

  function bind(field){ return { value: it[field] ?? "", onChange:(e)=> setIt({ ...it, [field]: e.target.value }) }; }

  function save(){
    if (!it.unit && !it.plate){ alert("Enter at least a Unit or Plate number."); return; }
    const computed = {
      ...it,
      annualDue: lastAnnual ? addDaysISO(lastAnnual, 365) : it.annualDue || "",
      bitDue: lastBit ? addDaysISO(lastBit, 90) : it.bitDue || "",
    };
    onSave(computed, { lastAnnual, lastBit });
  }

  return (
    <div className="fixed inset-0 z-20">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel}/>
      <div className="absolute right-0 top-0 h-full w-full md:w-[480px] bg-white shadow-xl p-6 overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{value?.id ? "Edit chassis" : "Add chassis"}</h2>
          <button className="px-2 py-1 rounded-lg border hover:bg-gray-50" onClick={onCancel}>Close</button>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <Field label="Unit Number"><input {...bind("unit")} className="w-full px-3 py-2 rounded-xl border border-gray-300" placeholder="e.g., CH-101"/></Field>
          <Field label="Plate #"><input {...bind("plate")} className="w-full px-3 py-2 rounded-xl border border-gray-300" placeholder="e.g., 4ABC123"/></Field>
          <Field label="VIN"><input {...bind("vin")} className="w-full px-3 py-2 rounded-xl border border-gray-300" placeholder="optional"/></Field>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Registration Due">
              <input type="date" {...bind("registrationDue")} className="w-full px-3 py-2 rounded-xl border border-gray-300"/>
            </Field>

            <Field label="Annual inspection done (adds 365d)">
              <input
                type="date"
                value={lastAnnual}
                onChange={(e)=>setLastAnnual(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-300"
              />
              {lastAnnual && <div className="text-xs text-gray-500 mt-1">Due: {fmtHumanDate(addDaysISO(lastAnnual, 365))}</div>}
            </Field>

            <Field label="BIT inspection done (adds 90d)">
              <input
                type="date"
                value={lastBit}
                onChange={(e)=>setLastBit(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-300"
              />
              {lastBit && <div className="text-xs text-gray-500 mt-1">Due: {fmtHumanDate(addDaysISO(lastBit, 90))}</div>}
            </Field>
          </div>

          <Field label="Notes"><textarea {...bind("notes")} rows={3} className="w-full px-3 py-2 rounded-xl border border-gray-300" placeholder="Any comments..."/></Field>

          <div className="flex items-center justify-between mt-2">
            <div className="text-xs text-gray-500">Tip: Enter the inspection dates when they were completed; we’ll calculate the due dates.</div>
            <div className="flex gap-2">
              <button onClick={onCancel} className="px-3 py-2 rounded-xl border border-gray-300 hover:bg-gray-50">Cancel</button>
              <button onClick={save} className="px-3 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700">Save</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------- Drawer ------------------------- */
function LedgerDrawer({
  item, bucket, onClose,
  addCitation, addRepair, deleteCitation, deleteRepair, deleteInspection,
  initialTab
}) {
  // remember last tab user used; allow initialTab override
  const TAB_KEY = 'cit_rep_last_tab';
  const [tab, setTab] = useState(() => initialTab || localStorage.getItem(TAB_KEY) || 'inspections');
  useEffect(() => { if (initialTab) setTab(initialTab); }, [initialTab]);
  useEffect(() => { localStorage.setItem(TAB_KEY, tab); }, [tab]);

  // new entry state
  const [cit, setCit] = useState({ date: fmtDate(new Date()), number:"", location:"", notes:"" });
  const [rep, setRep] = useState({
    date: fmtDate(new Date()),
    vendor: "",
    work: "",
    notes: "",
    citationId: ""   // link target (optional)
  });

  function addCit(){
    addCitation({ _nonce: rid(), ...cit });
    setCit({ date: fmtDate(new Date()), number:"", location:"", notes:"" });
  }
  function addRep(){
    addRepair({ _nonce: rid(), ...rep });
    setRep({ date: fmtDate(new Date()), vendor:"", work:"", notes:"", citationId:"" });
  }

  const inspections = bucket.inspections || { annual:[], bit:[] };

  // maps for link displays
  const citMap = Object.fromEntries((bucket.citations || []).map(c => [c.id, c]));
  const linkedCount = (bucket.repairs || []).reduce((acc, r) => {
    if (r.citationId) acc[r.citationId] = (acc[r.citationId] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 z-30">
      <div className="absolute inset-0 bg-black/40" onClick={onClose}/>
      <div className="absolute right-0 top-0 h-full w-full md:w-[780px] bg-white shadow-xl p-6 overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm text-gray-500">Chassis</div>
            <div className="text-xl font-semibold">{item.unit} <span className="text-gray-500 font-normal">· {item.plate}</span></div>
          </div>
          <button className="px-2 py-1 rounded-lg border hover:bg-gray-50" onClick={onClose}>Close</button>
        </div>

        <div className="flex gap-2 mb-4">
          <NavBtn active={tab==="inspections"} onClick={()=>setTab("inspections")}>Inspections</NavBtn>
          <NavBtn active={tab==="citations"} onClick={()=>setTab("citations")}>Citations</NavBtn>
          <NavBtn active={tab==="repairs"} onClick={()=>setTab("repairs")}>Repairs</NavBtn>
        </div>

        {tab==="inspections" ? (
          <>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Annual inspections</h3>
            <LedgerTable
              columns={["Done", "Due", "Recorded", ""]}
              rows={(inspections.annual||[]).map(e=>[
                fmtHumanDate(e.doneDate),
                fmtHumanDate(e.dueDate),
                new Date(e.enteredAt).toLocaleString(),
                e.id
              ])}
              onDelete={(id)=>deleteInspection("annual", id)}
              emptyText="No annual inspections yet."
            />
            <div className="h-6"></div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">BIT inspections</h3>
            <LedgerTable
              columns={["Done", "Due", "Recorded", ""]}
              rows={(inspections.bit||[]).map(e=>[
                fmtHumanDate(e.doneDate),
                fmtHumanDate(e.dueDate),
                new Date(e.enteredAt).toLocaleString(),
                e.id
              ])}
              onDelete={(id)=>deleteInspection("bit", id)}
              emptyText="No BIT inspections yet."
            />
          </>
        ) : tab==="citations" ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3">
              <input type="date" className="px-3 py-2 rounded-xl border border-gray-300" value={cit.date} onChange={e=>setCit({...cit, date:e.target.value})}/>
              <input placeholder="Citation #" className="px-3 py-2 rounded-xl border border-gray-300" value={cit.number} onChange={e=>setCit({...cit, number:e.target.value})}/>
              <input placeholder="Location" className="px-3 py-2 rounded-xl border border-gray-300" value={cit.location} onChange={e=>setCit({...cit, location:e.target.value})}/>
              <button type="button" onClick={addCit} className="px-3 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700">Add Citation</button>
            </div>
            <textarea placeholder="Notes (optional)" className="w-full px-3 py-2 rounded-xl border border-gray-300 mb-4" value={cit.notes} onChange={e=>setCit({...cit, notes:e.target.value})}/>
            <LedgerTable
              columns={["Date","Citation #","Location","Notes","Repairs",""]}
              rows={(bucket.citations||[]).map(e => [
                fmtHumanDate(e.date),
                e.number || "—",
                e.location || "—",
                e.notes || "—",
                String(linkedCount[e.id] || 0),
                e.id
              ])}
              // FIX: call the prop directly (it's already bound to chassisId)
              onDelete={deleteCitation}
              emptyText="No citations yet."
            />
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2 mb-3">
              <input
                type="date"
                className="px-3 py-2 rounded-xl border border-gray-300"
                value={rep.date}
                onChange={e=>setRep({...rep, date:e.target.value})}
              />
              <input
                placeholder="Vendor"
                className="px-3 py-2 rounded-xl border border-gray-300"
                value={rep.vendor}
                onChange={e=>setRep({...rep, vendor:e.target.value})}
              />
              <input
                placeholder="Work performed"
                className="px-3 py-2 rounded-xl border border-gray-300"
                value={rep.work}
                onChange={e=>setRep({...rep, work:e.target.value})}
              />

              {/* Link to citation */}
              <select
                className="px-3 py-2 rounded-xl border border-gray-300"
                value={rep.citationId}
                onChange={e=>setRep({...rep, citationId:e.target.value})}
              >
                <option value="">No linked citation</option>
                {(bucket.citations || []).map(c => (
                  <option key={c.id} value={c.id}>
                    {`${fmtHumanDate(c.date)} • ${c.number || 'No #'}${c.location ? ' • ' + c.location : ''}`}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={addRep}
                className="px-3 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700"
              >
                Add Repair
              </button>
            </div>

            <textarea
              placeholder="Notes (optional)"
              className="w-full px-3 py-2 rounded-xl border border-gray-300 mb-4"
              value={rep.notes}
              onChange={e=>setRep({...rep, notes:e.target.value})}
            />

            <LedgerTable
              columns={["Date","Vendor","Work","Linked citation","Notes",""]}
              rows={(bucket.repairs||[]).map(e => {
                const linked = e.citationId ? citMap[e.citationId] : null;
                const linkLabel = linked
                  ? `#${linked.number || '—'} • ${fmtHumanDate(linked.date)}`
                  : "—";
                return [
                  fmtHumanDate(e.date),
                  e.vendor || "—",
                  e.work || "—",
                  linkLabel,
                  e.notes || "—",
                  e.id
                ];
              })}
              // FIX: call the prop directly (it's already bound to chassisId)
              onDelete={deleteRepair}
              emptyText="No repairs yet."
            />
          </>
        )}
      </div>
    </div>
  );
}

/* Drawer helpers */
function NavBtn({active, onClick, children}){
  return (
    <button onClick={onClick}
      className={classNames(
        "px-3 py-1.5 rounded-full border text-sm",
        active ? "bg-blue-600 text-white border-blue-600" : "bg-white border-gray-300 hover:bg-gray-50"
      )}
    >
      {children}
    </button>
  );
}
function LedgerTable({ columns, rows, onDelete, emptyText }) {
  return (
    <div className="overflow-x-auto bg-white rounded-2xl border border-gray-200">
      <table className="min-w-full">
        <thead className="bg-gray-50">
          <tr className="text-left text-sm text-gray-600">
            {columns.map((c,i)=> <th key={i} className="px-3 py-2">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length===0 && (
            <tr><td colSpan={columns.length} className="text-center py-8 text-gray-500">{emptyText}</td></tr>
          )}
          {rows.map((r, idx)=>(
            <tr key={r[r.length-1]} className={classNames(idx%2?"bg-white":"bg-gray-50/50")}>
              {r.slice(0,-1).map((cell,i)=> <td key={i} className="px-3 py-3 text-sm">{cell}</td>)}
              <td className="px-3 py-3">
                <div className="flex justify-end">
                  <button onClick={()=>onDelete(r[r.length-1])} className="px-2 py-1 rounded-lg text-red-700 hover:bg-red-50 border border-red-200">Delete</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
