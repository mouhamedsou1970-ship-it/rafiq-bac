import { useState } from "react";
import { Pause, Play, Square } from "lucide-react";
import { subjectName } from "@/lib/bac/schedule";
import { finishFocus, focusRemaining, pauseFocus, resumeFocus, startFocus, useApp } from "@/lib/bac/store";
import { clock } from "@/lib/bac/time";
import { Bar, Btn } from "./ui";

export function TimerView({ now }: { now: number }) {
  const { state } = useApp();
  const focus = state.focus;
  const [subjectId, setSubjectId] = useState(state.subjects[0]?.id ?? "");
  const [task, setTask] = useState("دراسة حرة");
  const [mins, setMins] = useState(50);

  if (focus) {
    const left = focusRemaining(now);
    const pct = Math.min(100, Math.round((1 - left / (focus.durationSec * 1000)) * 100));
    return (
      <div className="focus-screen">
        <div className="stack">
          <p className="muted">وضع التركيز</p>
          <h1>{subjectName(state, focus.subjectId)}</h1>
          <p>{focus.task}</p>
        </div>
        <div className="stack">
          <div className="clock">{clock(left)}</div>
          <Bar value={pct} />
        </div>
        <div className="row">
          {focus.pauseStartedAt ? (
            <Btn onClick={resumeFocus}><Play size={18} aria-hidden="true" /> استئناف</Btn>
          ) : (
            <Btn kind="ghost" onClick={pauseFocus}><Pause size={18} aria-hidden="true" /> إيقاف مؤقت</Btn>
          )}
          <Btn kind="danger" onClick={() => finishFocus(false)}><Square size={18} aria-hidden="true" /> إنهاء وتسجيل</Btn>
        </div>
      </div>
    );
  }

  return (
    <>
      <section className="card stack">
        <h1>جلسة تركيز</h1>
        <p className="muted">الوقت يُحسب من لحظة البداية، لا من عدّاد ينقص كل ثانية، حتى لا يضيع إذا خفّض الهاتف نشاط الصفحة.</p>
        <label className="stack">المادة
          <select className="field" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            {state.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="stack">المهمة
          <input className="field" value={task} onChange={(e) => setTask(e.target.value)} />
        </label>
        <label className="stack">الدقائق
          <input className="field" type="number" min={10} max={180} value={mins} onChange={(e) => setMins(Number(e.target.value))} />
        </label>
        <Btn onClick={() => startFocus({ subjectId, task, minutes: mins })}>ابدأ الدراسة</Btn>
      </section>
    </>
  );
}
