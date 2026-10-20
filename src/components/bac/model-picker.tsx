import { useState } from "react";
import { Bot, RefreshCw, X } from "lucide-react";
import { fetchModels } from "@/lib/bac/ai";
import type { AiEndpointSettings } from "@/lib/bac/types";
import { Btn } from "./ui";

export function ModelPicker({settings,value,onChange,label="النموذج"}:{settings:AiEndpointSettings;value:string;onChange:(v:string)=>void;label?:string}){
 const [open,setOpen]=useState(false),[models,setModels]=useState<string[]>([]),[busy,setBusy]=useState(false),[query,setQuery]=useState(""),[error,setError]=useState("");
 async function load(){setBusy(true);setError("");try{setModels(await fetchModels(settings))}catch(e){setError(e instanceof Error?e.message:"تعذر جلب النماذج")}finally{setBusy(false)}}
 const shown=models.filter(m=>m.toLowerCase().includes(query.toLowerCase()));
 return <div className="stack"><span>{label}</span><button type="button" className="model-trigger" onClick={()=>{setOpen(true);if(!models.length)void load()}}><Bot size={19}/><span>{value||"اختر نموذجًا"}</span></button>
 {open&&<div className="model-sheet"><button className="sheet-backdrop" onClick={()=>setOpen(false)} aria-label="إغلاق"/><section className="sheet-panel stack"><div className="spread"><strong>🤖 النماذج المتاحة</strong><button className="icon-btn" onClick={()=>setOpen(false)}><X/></button></div><input className="field" placeholder="ابحث عن نموذج…" value={query} onChange={e=>setQuery(e.target.value)}/><Btn kind="ghost" disabled={busy} onClick={()=>void load()}><RefreshCw size={16}/>{busy?"يجلب النماذج…":"تحديث من المزود"}</Btn>{error&&<p className="warn">{error}</p>}<div className="model-list">{shown.map(m=><button key={m} className="choice" aria-pressed={m===value} onClick={()=>{onChange(m);setOpen(false)}}>{m}</button>)}</div></section></div>}</div>
}
