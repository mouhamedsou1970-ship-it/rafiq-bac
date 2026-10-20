import { useState } from "react";
import { AiError } from "@/lib/bac/ai";
import { runPlanner } from "@/lib/bac/prompts";
import { availableStudyMinutes, schedulableStudyMinutes, scheduledStudyMinutes, studyTimeBreakdown, formatBusyDay, generateLocalPlan, planReverse, replacePlanned, subjectName, validateIncoming } from "@/lib/bac/schedule";
import { curriculumStatusLabel } from "@/lib/bac/curriculum";
import { getSnapshot, patch, replaceState, setPlannerPane, toast, useApp } from "@/lib/bac/store";
import { addDays, algiersNow, uid, weekDates, WEEKDAY_NAMES } from "@/lib/bac/time";
import type { StudySession } from "@/lib/bac/types";
import { Btn } from "./ui";

export function PlannerView() {
  const snap = useApp();
  const { state, plannerPane } = snap;
  const today = algiersNow().date;
  const [horizon, setHorizon] = useState(7);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ sessions: StudySession[]; reason: string; dates: string[]; warnings: string[] } | null>(null);
  const [goal, setGoal] = useState("مراجعة قبل الفرض");
  const [deadline, setDeadline] = useState(addDays(today, 14));
  const [subjectId, setSubjectId] = useState(state.subjects[0]?.id ?? "");
  const [picked, setPicked] = useState<string[]>([]);
  const [extraMin, setExtraMin] = useState(0);
  const [commitName, setCommitName] = useState("");
  const [commitStart, setCommitStart] = useState("17:00");
  const [commitEnd, setCommitEnd] = useState("18:30");
  const [commitDays, setCommitDays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [systemInstruction, setSystemInstruction] = useState("");
  const [timeDetails, setTimeDetails] = useState(false);

  const dates = horizon === 7 ? weekDates(today) : Array.from({ length: horizon }, (_, i) => addDays(today, i));

  async function aiPlan() {
    setBusy(true);
    try {
      const result = await runPlanner(getSnapshot().state, dates, true, systemInstruction);
      setPreview({ sessions: result.sessions, reason: result.reason, dates, warnings: [`نجحت بعد ${result.attempts} محاولة`] });
    } catch (error) {
      toast(error instanceof AiError ? error.message : "تعذّر بناء الخطة");
    } finally {
      setBusy(false);
    }
  }

  function applyPreview() {
    if (!preview) return;
    const current = getSnapshot().state;
    const ignore = new Set(current.sessions.filter((s) => s.status === "planned" && preview.dates.includes(s.date)).map((s) => s.id));
    const check = validateIncoming(
      current,
      preview.sessions.map((s) => ({ date: s.date, start: s.start, end: s.end, subjectId: s.subjectId, task: s.task, source: s.source })),
      { ignoreIds: ignore, source: preview.sessions[0]?.source ?? "local" },
    );
    if (!check.ok) {
      toast(check.errors[0] ?? "الخطة لم تعد صالحة");
      return;
    }
    replaceState(replacePlanned(current, preview.dates, check.sessions));
    setPreview(null);
    toast("أُضيفت الحصص إلى الجدول");
  }

  return (
    <>
      <div className="row">
        {(["system", "local", "ai", "reverse", "limits"] as const).map((id) => (
          <button key={id} type="button" className="chip" aria-pressed={plannerPane === id} onClick={() => setPlannerPane(id)}>
            {id === "system" ? "نظامي" : id === "local" ? "محلي" : id === "ai" ? "ذكاء" : id === "reverse" ? "عكسي" : "القيود"}
          </button>
        ))}
      </div>

      {plannerPane === "system" ? (
        timeDetails ? (
          <section className="stack">
            <div className="card stack">
              <div className="spread"><div><h1>كيف يُحسب وقتي؟</h1><p className="muted">هذه هي القواعد التي يستخدمها المخطط وAI نفسه، لا آلة حاسبة سرية تعيش حياة مستقلة.</p></div><Btn kind="ghost" onClick={() => setTimeDetails(false)}>رجوع إلى نظامي</Btn></div>
              {state.days.map((day, index) => (
                <div key={WEEKDAY_NAMES[index]} className="stack">
                  <label className="check"><input type="checkbox" checked={day.enabled} onChange={(e) => patch((st) => ({ ...st, days: st.days.map((item, i) => i === index ? { ...item, enabled: e.target.checked } : item) }))} />{WEEKDAY_NAMES[index]}</label>
                  <div className="grid-3"><label className="stack">من<input className="field" type="time" value={day.start} onChange={(e) => patch((st) => ({ ...st, days: st.days.map((item,i)=>i===index?{...item,start:e.target.value}:item) }))}/></label><label className="stack">إلى<input className="field" type="time" value={day.end} onChange={(e) => patch((st) => ({ ...st, days: st.days.map((item,i)=>i===index?{...item,end:e.target.value}:item) }))}/></label><label className="stack">الحد الأقصى بالدقائق<input className="field" type="number" min={0} step={30} value={day.maxMinutes} onChange={(e) => patch((st) => ({ ...st, days: st.days.map((item,i)=>i===index?{...item,maxMinutes:Number(e.target.value)}:item) }))}/></label></div>
                </div>
              ))}
              <div className="grid-2"><label className="stack">الاستيقاظ<input className="field" type="time" value={state.settings.wake} onChange={(e)=>patch(st=>({...st,settings:{...st.settings,wake:e.target.value}}))}/></label><label className="stack">النوم<input className="field" type="time" value={state.settings.sleep} onChange={(e)=>patch(st=>({...st,settings:{...st.settings,sleep:e.target.value}}))}/></label></div>
            </div>
            <div className="card stack"><h2>كيف وصلنا إلى الرقم؟</h2><p className="muted">ببساطة: نبدأ من الفترة التي قلت إنك متاح فيها، ونطرح الصلاة والالتزامات والأوقات الممنوعة فقط. الحصص الموجودة لا تختفي من حياتك: نعرضها منفصلة.</p>{dates.map(date=>{const x=studyTimeBreakdown(state,date);return <div className="card stack" key={date}><strong>{date}</strong><div className="spread"><span>الفترة التي حددتها</span><b>{Math.floor(x.window/60)}س {x.window%60}د</b></div><div className="spread"><span>صلاة + التزامات + أوقات ممنوعة</span><b>− {Math.floor(x.blocked/60)}س {x.blocked%60}د</b></div><div className="spread"><span>وقتك المتاح للدراسة</span><b>{Math.floor(x.available/60)}س {x.available%60}د</b></div><div className="spread"><span>دراسة مجدولة بالفعل</span><span>{Math.floor(x.scheduled/60)}س {x.scheduled%60}د</span></div><div className="spread"><span>مساحة باقية لإضافة حصص</span><b>{Math.floor(x.remaining/60)}س {x.remaining%60}د</b></div></div>})}</div>
          </section>
        ) : (
        <section className="card stack">
          <div className="spread"><div><h1>نظام دراستي</h1><p className="muted">حدد احتياجك أولًا، ثم دع المخطط يبحث عن الوقت.</p></div><Btn kind="ghost" onClick={() => setTimeDetails(true)}>⚙️ كيف يُحسب وقتي؟</Btn></div>
          <label className="check"><input type="checkbox" checked={state.studyProfile.oneCorePerDay} onChange={(e) => patch((st) => ({ ...st, studyProfile: { ...st.studyProfile, oneCorePerDay: e.target.checked } }))} /> مادة أساسية واحدة في اليوم</label>
          <div className="stack"><strong>المواد الأساسية</strong>{state.subjects.filter(x=>x.core).map(sub=><label className="check" key={sub.id}><input type="checkbox" checked={state.studyProfile.coreSubjectIds.includes(sub.id)} onChange={(e)=>patch(st=>({...st,studyProfile:{...st.studyProfile,coreSubjectIds:e.target.checked?[...new Set([...st.studyProfile.coreSubjectIds,sub.id])]:st.studyProfile.coreSubjectIds.filter(id=>id!==sub.id)}}))}/>{sub.name}</label>)}</div>
          <div className="grid-2"><label className="stack">دقائق المادة الأساسية<input className="field" type="number" min={30} step={30} value={state.studyProfile.coreDailyMin} onChange={(e)=>patch(st=>({...st,studyProfile:{...st.studyProfile,coreDailyMin:Number(e.target.value)}}))}/></label><label className="stack">دقائق المواد الثانوية<input className="field" type="number" min={0} step={30} value={state.studyProfile.secondaryDailyMin} onChange={(e)=>patch(st=>({...st,studyProfile:{...st.studyProfile,secondaryDailyMin:Number(e.target.value)}}))}/></label></div>

          <div className="card stack"><div className="spread"><strong>الالتزامات والأوقات الممنوعة</strong><span className="muted">تُخصم من وقتك تلقائيًا</span></div>{state.commitments.map(item=><div key={item.id} className="spread"><span>{item.name} · {item.days.map(d=>WEEKDAY_NAMES[d]).join("، ")} · {item.start}–{item.end}</span><Btn kind="danger" onClick={()=>patch(st=>({...st,commitments:st.commitments.filter(c=>c.id!==item.id)}))}>حذف</Btn></div>)}<input className="field" placeholder="مثال: مدرسة، درس خصوصي، وقت ممنوع" value={commitName} onChange={e=>setCommitName(e.target.value)}/><div className="grid-2"><input className="field" type="time" value={commitStart} onChange={e=>setCommitStart(e.target.value)}/><input className="field" type="time" value={commitEnd} onChange={e=>setCommitEnd(e.target.value)}/></div><div className="row">{WEEKDAY_NAMES.map((name,index)=><button key={name} type="button" className="chip" aria-pressed={commitDays.includes(index)} onClick={()=>setCommitDays(commitDays.includes(index)?commitDays.filter(d=>d!==index):[...commitDays,index])}>{name}</button>)}</div><Btn kind="ghost" onClick={()=>{if(!commitName.trim()||!commitDays.length)return;patch(st=>({...st,commitments:[...st.commitments,{id:uid("com"),name:commitName.trim(),days:commitDays,start:commitStart,end:commitEnd}]}));setCommitName("")}}>+ إضافة ارتباط / وقت ممنوع</Btn></div>
          <div className="stack"><strong>وقتك وهدفك</strong><p className="muted">«متاح» يعني الوقت الذي تستطيع الدراسة فيه فعلًا. «الهدف» هو فقط كم تريد أن تدرس منه.</p>{dates.map(date=>{const free=availableStudyMinutes(state,date);const remaining=schedulableStudyMinutes(state,date);const done=scheduledStudyMinutes(state,date);const target=state.studyProfile.coreDailyMin+state.studyProfile.secondaryDailyMin;return <div className="card stack" key={date}><div className="spread"><strong>{date}</strong><span>متاح {Math.floor(free/60)}س {free%60}د</span></div><div className="spread"><span className="muted">هدفك {Math.floor(target/60)}س {target%60}د · مجدول {Math.floor(done/60)}س {done%60}د</span><span className="muted">باقٍ للجدولة {Math.floor(remaining/60)}س {remaining%60}د</span></div></div>})}</div>
          <div className="stack"><strong>موقعي في البرنامج</strong>{state.studyProfile.coreSubjectIds.map(sid=><div className="card stack" key={sid}><b>{subjectName(state,sid)}</b>{state.curriculum.filter(u=>u.subjectId===sid).sort((a,b)=>a.order-b.order).map(u=><label className="row" key={u.id}><span>{u.order}. {u.title}</span><select className="field" value={u.status} onChange={e=>patch(st=>({...st,curriculum:st.curriculum.map(x=>x.id===u.id?{...x,status:e.target.value as typeof x.status}:x)}))}><option value="not_started">لم أبدأ</option><option value="learning">أدرسه الآن</option><option value="practice">أتدرب عليه</option><option value="review">يحتاج مراجعة</option><option value="mastered">متقن</option></select></label>)}</div>)}</div>
          <div className="card stack"><strong>تعليمات خاصة للـ AI</strong><p className="muted">محادثة مصغرة للخطة الحالية. مثال: ركّز على الرياضيات هذا الأسبوع ولا تضع الفيزياء بعد التاسعة.</p><textarea className="area" rows={4} value={systemInstruction} onChange={e=>setSystemInstruction(e.target.value)} placeholder="اكتب ما تريد من المخطط…"/><div className="spread"><span className="muted">سيقرأ AI هذه الرسالة مع نظامك ووقتك والمنهاج.</span><Btn disabled={busy} onClick={()=>void aiPlan()}>{busy?"يولد ويفحص…":"✨ ولّد الجدول"}</Btn></div></div>
        </section>
        )
      ) : null}

      {plannerPane === "local" ? (
        <section className="card stack">
          <h1>توليد محلي</h1>
          <p className="muted">يملأ الفراغ فقط. الصلاة، ومن المغرب إلى العشاء، والارتباطات، تُحذف من الوقت قبل اختيار الحصص.</p>
          <Btn onClick={() => {
            const plan = generateLocalPlan(getSnapshot().state, dates, true);
            setPreview({ sessions: plan.sessions, reason: "توزيع حسب المعامل والضعف والتأخر والاختبارات.", dates, warnings: plan.warnings });
          }}>ولّد هذا الأسبوع</Btn>
        </section>
      ) : null}

      {plannerPane === "ai" ? (
        <section className="card stack">
          <h1>مخطط الذكاء</h1>
          <p className="muted">يُرسل للمزود أسماء المواد والفترات الممنوعة صراحة. أي حصة تخالف القيود تُرفض ويُطلب تصحيحها حتى 3 مرات. لا شيء يُحفظ قبل موافقتك.</p>
          <div className="row">
            <button type="button" className="chip" aria-pressed={horizon === 3} onClick={() => setHorizon(3)}>3 أيام</button>
            <button type="button" className="chip" aria-pressed={horizon === 7} onClick={() => setHorizon(7)}>7 أيام</button>
          </div>
          <Btn disabled={busy} onClick={() => void aiPlan()}>{busy ? "يجري الفحص…" : "اطلب خطة"}</Btn>
        </section>
      ) : null}

      {plannerPane === "reverse" ? (
        <section className="card stack">
          <h1>ماذا قبل الموعد</h1>
          <p className="muted">المخطط العكسي يوزع العمل المطلوب. الجدول اليومي يقول متى. الفترات الممنوعة تبقى ممنوعة.</p>
          <label className="stack">الهدف<input className="field" value={goal} onChange={(e) => setGoal(e.target.value)} /></label>
          <label className="stack">التاريخ النهائي<input className="field" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></label>
          <label className="stack">المادة
            <select className="field" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              {state.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <div className="stack">
            {state.lessons.filter((l) => l.subjectId === subjectId).map((lesson) => (
              <label key={lesson.id} className="check">
                <input type="checkbox" checked={picked.includes(lesson.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, lesson.id] : picked.filter((id) => id !== lesson.id))} />
                {lesson.title}
              </label>
            ))}
            {state.lessons.filter((l) => l.subjectId === subjectId).length === 0 ? <p className="muted">لا دروس لهذه المادة في المكتبة.</p> : null}
          </div>
          <label className="stack">دقائق إضافية<input className="field" type="number" min={0} value={extraMin} onChange={(e) => setExtraMin(Number(e.target.value))} /></label>
          <Btn onClick={() => {
            const plan = planReverse(getSnapshot().state, { from: today, until: deadline, lessonIds: picked, extra: extraMin > 0 ? [{ subjectId, minutes: extraMin }] : [] });
            setPreview({ sessions: plan.sessions, reason: goal, dates: plan.sessions.map((s) => s.date), warnings: plan.warnings });
          }}>وزّع العمل</Btn>
          <h2>الاختبارات</h2>
          {state.exams.map((exam) => (
            <div key={exam.id} className="spread">
              <span>{exam.date} · {subjectName(state, exam.subjectId)} · {exam.title}{exam.score !== undefined ? ` · ${exam.score}%` : ""}</span>
              <Btn kind="danger" onClick={() => patch((s) => ({ ...s, exams: s.exams.filter((item) => item.id !== exam.id) }))}>حذف</Btn>
            </div>
          ))}
          <Btn kind="ghost" onClick={() => patch((s) => ({ ...s, exams: [...s.exams, { id: uid("exam"), subjectId, title: goal || "اختبار", date: deadline, lessonIds: picked }] }))}>حفظ هذا الهدف كاختبار</Btn>
        </section>
      ) : null}

      {plannerPane === "limits" ? (
        <section className="stack">
          <div className="card stack">
            <h1>ساعات كل يوم</h1>
            <p className="muted">الجمعة والسبت مستقلان. لا يُفترض أن كل الأيام متشابهة.</p>
            {state.days.map((day, index) => (
              <div key={WEEKDAY_NAMES[index]} className="stack">
                <label className="check"><input type="checkbox" checked={day.enabled} onChange={(e) => patch((s) => ({ ...s, days: s.days.map((item, i) => i === index ? { ...item, enabled: e.target.checked } : item) }))} />{WEEKDAY_NAMES[index]}</label>
                <div className="grid-3">
                  <input className="field" value={day.start} onChange={(e) => patch((s) => ({ ...s, days: s.days.map((item, i) => i === index ? { ...item, start: e.target.value } : item) }))} />
                  <input className="field" value={day.end} onChange={(e) => patch((s) => ({ ...s, days: s.days.map((item, i) => i === index ? { ...item, end: e.target.value } : item) }))} />
                  <input className="field" type="number" value={day.maxMinutes} onChange={(e) => patch((s) => ({ ...s, days: s.days.map((item, i) => i === index ? { ...item, maxMinutes: Number(e.target.value) } : item) }))} />
                </div>
              </div>
            ))}
            <div className="grid-2">
              <label className="stack">الاستيقاظ<input className="field" value={state.settings.wake} onChange={(e) => patch((s) => ({ ...s, settings: { ...s.settings, wake: e.target.value } }))} /></label>
              <label className="stack">النوم<input className="field" value={state.settings.sleep} onChange={(e) => patch((s) => ({ ...s, settings: { ...s.settings, sleep: e.target.value } }))} /></label>
            </div>
          </div>
          <div className="card stack">
            <h2>الحصة الليلية</h2>
            <label className="check"><input type="checkbox" checked={state.settings.nightEnabled} onChange={(e) => patch((s) => ({ ...s, settings: { ...s.settings, nightEnabled: e.target.checked } }))} />تفعيل، مع أفضلية الرياضيات والفيزياء</label>
            <div className="grid-2">
              <input className="field" value={state.settings.nightStart} onChange={(e) => patch((s) => ({ ...s, settings: { ...s.settings, nightStart: e.target.value } }))} />
              <input className="field" type="number" value={state.settings.nightMinutes} onChange={(e) => patch((s) => ({ ...s, settings: { ...s.settings, nightMinutes: Number(e.target.value) } }))} />
            </div>
          </div>
          <div className="card stack">
            <h2>ارتباط ثابت</h2>
            <p className="muted">المدرسة، الدرس الخصوصي، أو أي موعد. هذه الفترات ممنوعة تمامًا.</p>
            {state.commitments.map((item) => (
              <div key={item.id} className="spread">
                <span>{item.name} · {item.days.map((d) => WEEKDAY_NAMES[d]).join("، ")} · {item.start}–{item.end}</span>
                <Btn kind="danger" onClick={() => patch((s) => ({ ...s, commitments: s.commitments.filter((c) => c.id !== item.id) }))}>حذف</Btn>
              </div>
            ))}
            <input className="field" placeholder="الاسم" value={commitName} onChange={(e) => setCommitName(e.target.value)} />
            <div className="grid-2">
              <input className="field" value={commitStart} onChange={(e) => setCommitStart(e.target.value)} />
              <input className="field" value={commitEnd} onChange={(e) => setCommitEnd(e.target.value)} />
            </div>
            <div className="row">
              {WEEKDAY_NAMES.map((name, index) => (
                <button key={name} type="button" className="chip" aria-pressed={commitDays.includes(index)} onClick={() => setCommitDays(commitDays.includes(index) ? commitDays.filter((d) => d !== index) : [...commitDays, index])}>{name}</button>
              ))}
            </div>
            <Btn kind="ghost" onClick={() => {
              if (!commitName.trim()) return;
              patch((s) => ({ ...s, commitments: [...s.commitments, { id: uid("com"), name: commitName.trim(), days: commitDays, start: commitStart, end: commitEnd }] }));
              setCommitName("");
            }}>إضافة الارتباط</Btn>
          </div>
          <div className="card stack">
            <h2>مثال الفترات الممنوعة لليوم</h2>
            <p style={{ whiteSpace: "pre-wrap" }}>{formatBusyDay(state, today)}</p>
          </div>
        </section>
      ) : null}

      {preview ? (
        <section className="card stack">
          <h2>التغييرات المقترحة</h2>
          <p>{preview.reason}</p>
          {preview.warnings.map((w) => <p key={w} className="muted">{w}</p>)}
          {preview.sessions.length === 0 ? <p>لا حصص مقترحة.</p> : preview.sessions.map((s) => (
            <div key={s.id} className="spread">
              <span>{s.date} {s.start}–{s.end}</span>
              <span>{subjectName(state, s.subjectId)} · {s.task}</span>
            </div>
          ))}
          <div className="row">
            <Btn onClick={applyPreview} disabled={preview.sessions.length === 0}>تطبيق الخطة</Btn>
            <Btn kind="ghost" onClick={() => setPreview(null)}>إلغاء</Btn>
          </div>
        </section>
      ) : null}
    </>
  );
}
