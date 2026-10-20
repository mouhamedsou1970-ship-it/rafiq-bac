import { useMemo, useState } from "react";
import { BookOpenCheck, Brain, GraduationCap, LoaderCircle, ShieldCheck } from "lucide-react";
import { aiComplete, extractJson } from "@/lib/bac/ai";
import { curriculumStatusLabel } from "@/lib/bac/curriculum";
import { patch, toast, useApp } from "@/lib/bac/store";
import type { CurriculumStatus } from "@/lib/bac/types";
import { Btn } from "./ui";

const ORDER: CurriculumStatus[]=["not_started","learning","practice","review","mastered"];
function cleanAiText(value:string){
 return value
  .replace(/^\s*[.،,:;؛-]+\s*/,"")
  .replace(/\$([^$]+)\$/g,"$1")
  .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g,"($1)/($2)")
  .replace(/\\sin/g,"sin").replace(/\\cos/g,"cos").replace(/\\tan/g,"tan").replace(/\\ln/g,"ln")
  .replace(/\\times/g,"×").replace(/\\infty/g,"∞").replace(/\\to/g,"→")
  .replace(/\\leq/g,"≤").replace(/\\geq/g,"≥").replace(/\\neq/g,"≠")
  .replace(/\\left|\\right/g,"").replace(/[{}]/g,"")
  .replace(/\\,/g," ").replace(/\\ /g," ").trim();
}
type Quiz={questions:{q:string;choices:string[];answer:number;explanation:string}[]};
export function LearningView(){
 const {state}=useApp(); const [subject,setSubject]=useState(state.subjects[0]?.id??""); const [selected,setSelected]=useState("");
 const [quiz,setQuiz]=useState<Quiz|null>(null); const [answers,setAnswers]=useState<Record<number,number>>({}); const [busy,setBusy]=useState(false); const [done,setDone]=useState(false);
 const units=useMemo(()=>state.curriculum.filter(x=>x.subjectId===subject).sort((a,b)=>a.order-b.order),[state.curriculum,subject]);
 const exams=state.exams.filter(x=>x.subjectId===subject); const chosen=units.find(x=>x.id===selected)??units[0];
 const attempts=chosen?state.quizAttempts.filter(a=>a.unitId===chosen.id).slice().reverse():[];
 function validQuiz(value:unknown): value is Quiz {
  const q=(value as Quiz|undefined)?.questions;
  return Array.isArray(q)&&q.length===5&&q.every(x=>typeof x?.q==="string"&&Array.isArray(x.choices)&&x.choices.length===4&&x.choices.every(c=>typeof c==="string")&&Number.isInteger(x.answer)&&x.answer>=0&&x.answer<4&&typeof x.explanation==="string");
 }
 async function makeQuiz(){
  if(!chosen)return; setBusy(true);setQuiz(null);setAnswers({});setDone(false);
  const request=`أنشئ اختبار مراجعة من 5 أسئلة اختيار من متعدد حول: ${chosen.title}. المستوى: السنة الثالثة ثانوي شعبة رياضيات في الجزائر. لا تدّع أن السؤال مقتبس من بكالوريا رسمية. اكتب الصيغ الرياضية كنص Unicode واضح مناسب للهاتف مثل x₀ و∞ و→ وsin(2x)/x، ولا تستخدم LaTeX ولا علامات $ ولا أوامر مثل \\frac أو \\sin. لا تترجم الرموز الرياضية إلى كلمات عربية داخل الصيغة. أعد كائن JSON فقط، بلا Markdown ولا شرح خارجه، بالشكل {"questions":[{"q":"...","choices":["...","...","...","..."],"answer":0,"explanation":"..."}]}. يجب أن يحتوي questions على 5 عناصر بالضبط، ولكل سؤال 4 اختيارات وanswer عدد صحيح من 0 إلى 3.`;
  const system="أنت مولد اختبارات تعليمية. أخرج JSON صالحًا فقط. التزم بالموضوع المحدد، واجعل answer فهرسًا من 0 إلى 3. لا تنسب أي سؤال إلى امتحان رسمي ما لم يقدمه التطبيق كمصدر رسمي.";
  try{
   let raw=await aiComplete(state.settings.ai,request,{json:true,system});
   let parsed:unknown;
   try{parsed=extractJson(raw)}catch{
    raw=await aiComplete(state.settings.ai,`أصلح الرد التالي ليصبح JSON صالحًا فقط وفق البنية المطلوبة، من دون تغيير معنى الأسئلة أو إضافة نص خارج JSON:\n${raw}`,{json:true,system:"مهمتك إصلاح JSON فقط. أخرج كائن JSON صالحًا ولا تستخدم Markdown."});
    parsed=extractJson(raw);
   }
   if(!validQuiz(parsed)){
    const repaired=await aiComplete(state.settings.ai,`حوّل المحتوى التالي إلى اختبار JSON صالح من 5 أسئلة بالضبط، 4 اختيارات لكل سؤال، وanswer من 0 إلى 3. أخرج JSON فقط:\n${JSON.stringify(parsed)}`,{json:true,system:"أصلح بنية الاختبار فقط وأخرج JSON صالحًا."});
    parsed=extractJson(repaired);
   }
   if(!validQuiz(parsed))throw new Error("أعاد النموذج اختبارًا ببنية غير صالحة حتى بعد محاولة الإصلاح");
   setQuiz(parsed);
  }catch(e){
   window.dispatchEvent(new CustomEvent("rafiq:ai-event",{detail:{type:"error",title:"فشل إنشاء الاختبار",message:e instanceof Error?e.message:"تعذر إنشاء الاختبار"}}));
   toast(e instanceof Error?e.message:"تعذر إنشاء الاختبار");
  }finally{setBusy(false)}
 }
 const score=quiz?quiz.questions.reduce((n,q,i)=>n+(answers[i]===q.answer?1:0),0):0;
 function finishQuiz(){
  if(!quiz||!chosen||done)return;
  const at=new Date().toISOString(); const total=quiz.questions.length; const pct=score/total;
  const nextStatus: CurriculumStatus = pct<0.6?"review":pct>=0.8?(chosen.status==="practice"||chosen.status==="mastered"?"mastered":"practice"):"practice";
  patch(s=>({
   ...s,
   curriculum:s.curriculum.map(x=>x.id===chosen.id?{...x,status:nextStatus}:x),
   quizAttempts:[...s.quizAttempts,{id:`quiz-${Date.now()}`,unitId:chosen.id,subjectId:chosen.subjectId,unitTitle:chosen.title,at,score,total,questions:quiz.questions.map((q,i)=>({...q,selected:answers[i]}))}].slice(-100),
   errors:[...s.errors,...quiz.questions.map((q,i)=>({q,i})).filter(({q,i})=>answers[i]!==q.answer).map(({q,i})=>({id:`err-${Date.now()}-${i}`,at,date:at.slice(0,10),subjectId:chosen.subjectId,concept:chosen.title,kind:"exam" as const,note:`${cleanAiText(q.q)} | إجابتك: ${cleanAiText(q.choices[answers[i]]??"—")} | الصحيح: ${cleanAiText(q.choices[q.answer])}`}))].slice(-300)
  }),false);
  setDone(true); toast(`نتيجتك ${score}/${total}`);
 }
 return <div className="stack">
  <section className="hero"><p className="eyebrow">V5 · نظام التعلّم</p><h1>المنهاج خريطة، والاختبار يخبرك أين أنت فعلًا.</h1><p>المحتوى الموثق يحمل علامة واضحة. وما لم نتحقق منه لن يملأه رفيق بالتخمين.</p></section>
  <section className="card stack"><div className="spread"><h2><BookOpenCheck size={20}/> خريطة المنهاج</h2><span className="badge">{units.length} وحدة</span></div>
   <select className="field" value={subject} onChange={e=>{setSubject(e.target.value);setSelected("");setQuiz(null)}}>{state.subjects.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
   {units.length?units.map(u=><button className={`choice ${chosen?.id===u.id?"selected":""}`} key={u.id} onClick={()=>setSelected(u.id)}><strong>{u.order}. {u.title}</strong><span className="muted">{curriculumStatusLabel(u.status)} {u.verified?"· موثق":""}</span></button>):<p className="muted">لم نتحقق من منهاج هذه المادة بعد، لذلك تُركت فارغة عمدًا.</p>}
   {chosen&&<div className="card stack"><div className="spread"><b>{chosen.title}</b>{chosen.verified&&<span className="badge"><ShieldCheck size={14}/> موثق</span>}</div><small className="muted">{chosen.source}</small><div className="row">{ORDER.map(st=><button key={st} className="btn ghost" onClick={()=>patch(s=>({...s,curriculum:s.curriculum.map(x=>x.id===chosen.id?{...x,status:st}:x)}))}>{curriculumStatusLabel(st)}</button>)}</div></div>}
  </section>
  <section className="card stack"><div className="spread"><h2><Brain size={20}/> اختبار ذكي</h2><Btn onClick={makeQuiz} disabled={!chosen||busy}>{busy?<><LoaderCircle className="spin" size={16}/> يولّد…</>:"أنشئ 5 أسئلة"}</Btn></div><p className="muted">الأسئلة هنا مولّدة بالذكاء الاصطناعي وليست امتحانات رسمية.</p>
   {quiz?.questions.map((q,i)=><div className="quiz-question" key={i}>
    <div className="quiz-title"><span className="quiz-number">{i+1}</span><b>{cleanAiText(q.q)}</b></div>
    <div className="quiz-options" role="radiogroup" aria-label={`السؤال ${i+1}`}>
     {q.choices.map((c,j)=>{const selected=answers[i]===j; const correct=done&&q.answer===j; const wrong=done&&selected&&q.answer!==j; return <button type="button" role="radio" aria-checked={selected} className={`quiz-option ${selected?"selected":""} ${correct?"correct":""} ${wrong?"wrong":""}`} key={j} disabled={done} onClick={()=>setAnswers(a=>({...a,[i]:j}))}><span className="quiz-radio" aria-hidden="true">{selected?"●":"○"}</span><span>{cleanAiText(c)}</span></button>})}
    </div>
    {done&&<div className={`quiz-feedback ${answers[i]===q.answer?"ok":"bad"}`}><b>{answers[i]===q.answer?"✓ إجابة صحيحة":"✗ إجابة غير صحيحة"}</b>{answers[i]!==q.answer&&<span>الصحيح: {cleanAiText(q.choices[q.answer])}</span>}<span>{cleanAiText(q.explanation)}</span></div>}
   </div>)}
   {quiz&&<Btn disabled={Object.keys(answers).length<quiz.questions.length||done} onClick={finishQuiz}>صحّح الاختبار</Btn>}{done&&quiz&&<div className="notice">النتيجة: <b>{score}/{quiz.questions.length}</b> · تم حفظ المحاولة ونقاط الضعف.</div>}{attempts.length>0&&<div className="stack"><strong>آخر المحاولات</strong>{attempts.slice(0,3).map(a=><div className="spread card" key={a.id}><span>{new Date(a.at).toLocaleDateString("ar-DZ")}</span><b>{a.score}/{a.total}</b></div>)}</div>}
  </section>
  <section className="card stack"><GraduationCap/><h2>بنك الامتحانات</h2><p className="muted">{exams.length?`${exams.length} امتحان محفوظ لهذه المادة.`:"لا توجد امتحانات موثقة محفوظة لهذه المادة بعد."}</p><p className="muted">لن نضع علامة «رسمي» على أي موضوع قبل التحقق من مصدره وسنخزن الامتحانات منفصلة عن اختبارات AI.</p></section>
 </div>
}
