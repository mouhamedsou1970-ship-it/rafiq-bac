import type { AiEndpointSettings, AiProvider, AiSettings } from "./types";

export class AiError extends Error {
  status?: number;
  provider?: AiProvider;
  model?: string;
  constructor(message: string, meta?: { status?: number; provider?: AiProvider; model?: string }) {
    super(message); this.status = meta?.status; this.provider = meta?.provider; this.model = meta?.model;
  }
}

function emitAiEvent(detail: Record<string, unknown>) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("rafiq:ai-event", { detail }));
}
function stripFences(text: string): string { const fence=text.match(/```(?:json)?\s*([\s\S]*?)```/); return (fence?.[1]??text).trim(); }
export function extractJson(text:string):unknown { const raw=stripFences(text), start=raw.indexOf("{"), end=raw.lastIndexOf("}"); if(start<0||end<=start) throw new AiError("الرد ليس JSON مفهومًا"); try{return JSON.parse(raw.slice(start,end+1))}catch{throw new AiError("تعذّر قراءة JSON من رد المساعد")}}

type ChatBody={model:string;messages:{role:"system"|"user";content:string}[];temperature:number;response_format?:{type:"json_object"}};
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));

async function postJson(url:string, headers:Record<string,string>, body:unknown, meta:{provider:AiProvider;model:string}):Promise<unknown>{
  let last: unknown;
  for (let attempt=0; attempt<4; attempt++) {
    try {
      const res=await fetch(url,{method:"POST",headers,body:JSON.stringify(body)}); const text=await res.text();
      if(res.ok){try{return JSON.parse(text)}catch{throw new AiError("رد المزود ليس JSON",meta)}}
      const err=new AiError(res.status===401||res.status===403?"مفتاح الواجهة مرفوض. راجع الإعدادات.":res.status===429?"المزود رفض الطلب مؤقتًا (حد أو رصيد).":`المزود أعاد خطأ ${res.status}.`,{...meta,status:res.status});
      last=err;
      if (![429,500,502,503,504].includes(res.status) || attempt===3) throw err;
      await wait([1000,2000,4000,8000][attempt] ?? 1000);
    } catch(e) {
      if(e instanceof AiError) throw e;
      last=e; if(attempt===3) throw new AiError("انقطع الاتصال بمزود الذكاء الاصطناعي",meta);
      await wait([1000,2000,4000,8000][attempt] ?? 1000);
    }
  }
  throw last instanceof Error?last:new AiError("تعذر الاتصال",meta);
}
function fromOpenAI(data:unknown):string { const text=(data as {choices?:{message?:{content?:string}}[]})?.choices?.[0]?.message?.content; if(!text) throw new AiError("رد المزود فارغ"); return text; }

async function completeOne(settings:AiEndpointSettings,prompt:string,opts?:{system?:string;json?:boolean;fast?:boolean}):Promise<string>{
 const key=settings.apiKey.trim(); if(!key) throw new AiError("أضف مفتاح الواجهة من الإعدادات أولًا",{provider:settings.provider});
 const model=(opts?.fast&&settings.fastModel.trim())||settings.model.trim(); if(!model) throw new AiError("اسم النموذج فارغ",{provider:settings.provider});
 const system=opts?.system??"أنت مساعد دراسة دقيق. أجب بالعربية."; const meta={provider:settings.provider,model};
 if(settings.provider==="gemini"){
  const url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const data=await postJson(url,{"Content-Type":"application/json"},{systemInstruction:{parts:[{text:system}]},contents:[{role:"user",parts:[{text:prompt}]}],generationConfig:{temperature:.3,...(opts?.json?{responseMimeType:"application/json"}:{})}},meta) as {candidates?:{content?:{parts?:{text?:string}[]}}[]};
  const text=data.candidates?.[0]?.content?.parts?.map(p=>p.text??"").join("")??""; if(!text) throw new AiError("جيميني أعاد ردًا فارغًا",meta); return text;
 }
 const body:ChatBody={model,temperature:.3,messages:[{role:"system",content:system},{role:"user",content:prompt}]}; if(opts?.json)body.response_format={type:"json_object"};
 const base=settings.provider==="openrouter"?"https://openrouter.ai/api/v1":settings.provider==="xai"?"https://api.x.ai/v1":settings.endpoint.trim().replace(/\/$/,"");
 if(!base) throw new AiError("أدخل عنوان نقطة النهاية المتوافقة مع OpenAI",meta);
 return fromOpenAI(await postJson(`${base}/chat/completions`,{"Content-Type":"application/json",Authorization:`Bearer ${key}`},body,meta));
}

export async function aiComplete(settings:AiSettings,prompt:string,opts?:{system?:string;json?:boolean;fast?:boolean}):Promise<string>{
 try { return await completeOne(settings,prompt,opts); }
 catch(primary){
  const e=primary instanceof AiError?primary:new AiError("فشل النموذج الأساسي");
  emitAiEvent({type:"error",title:"فشل النموذج الأساسي",message:e.message,provider:e.provider??settings.provider,model:e.model??settings.model,status:e.status});
  if(!settings.fallback?.enabled) throw e;
  try {
   const fallback = { ...settings.fallback, apiKey: settings.fallback.apiKey.trim() || (settings.fallback.provider === settings.provider ? settings.apiKey : settings.fallback.apiKey) };
   const text=await completeOne(fallback,prompt,opts);
   emitAiEvent({type:"fallback",title:"تم استخدام النموذج الاحتياطي",message:`تعذر ${e.model??settings.model} وتم إكمال الطلب عبر ${settings.fallback.model}.`,provider:settings.fallback.provider,model:settings.fallback.model,status:e.status});
   return text;
  } catch(second) {
   const f=second instanceof AiError?second:new AiError("فشل النموذج الاحتياطي");
   emitAiEvent({type:"error",title:"فشل النموذج الاحتياطي",message:f.message,provider:f.provider??settings.fallback.provider,model:f.model??settings.fallback.model,status:f.status});
   throw f;
  }
 }
}

export async function fetchModels(settings:AiEndpointSettings):Promise<string[]>{
 const key=settings.apiKey.trim(); if(!key) throw new AiError("أدخل المفتاح أولًا");
 let url="", headers:Record<string,string>={};
 if(settings.provider==="gemini") url=`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
 else { const base=settings.provider==="openrouter"?"https://openrouter.ai/api/v1":settings.provider==="xai"?"https://api.x.ai/v1":settings.endpoint.trim().replace(/\/$/,""); if(!base) throw new AiError("أدخل عنوان المزود"); url=`${base}/models`; headers={Authorization:`Bearer ${key}`}; }
 const res=await fetch(url,{headers}); if(!res.ok) throw new AiError(`تعذر جلب النماذج (${res.status})`);
 const data=await res.json() as {models?:{name?:string;supportedGenerationMethods?:string[]}[];data?:{id?:string}[]};
 const list=settings.provider==="gemini"?(data.models??[]).filter(m=>!m.supportedGenerationMethods||m.supportedGenerationMethods.includes("generateContent")).map(m=>(m.name??"").replace(/^models\//,"")):(data.data??[]).map(m=>m.id??"");
 return [...new Set(list.filter(Boolean))].sort((a,b)=>a.localeCompare(b));
}
