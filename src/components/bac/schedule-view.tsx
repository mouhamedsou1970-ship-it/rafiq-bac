import { useState } from "react";
import { subjectName, validateIncoming } from "@/lib/bac/schedule";
import { patch, startFocus, toast, useApp } from "@/lib/bac/store";
import { addDays, algiersNow, minutes, saturdayOnOrBefore, uid, weekDates, weekdayIndex, WEEKDAY_NAMES } from "@/lib/bac/time";
import type { StudySession } from "@/lib/bac/types";
import { Btn, Modal } from "./ui";

export function ScheduleView({ now }: { now: number }) {
  const { state } = useApp();
  const today = algiersNow(new Date(now)).date;
  const [anchor, setAnchor] = useState(today);
  const [selected, setSelected] = useState(today);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<StudySession | null>(null);
  const [form, setForm] = useState({ subjectId: state.subjects[0]?.id ?? "", task: "", start: "16:00", end: "16:50" });
  const days = weekDates(anchor);
  const list = state.sessions.filter((s) => s.date === selected).sort((a, b) => a.start.localeCompare(b.start));

  function save() {
    const subject = state.subjects.find((s) => s.id === form.subjectId)?.name ?? "";
    const ignore = new Set(editing ? [editing.id] : []);
    const check = validateIncoming(
      state,
      [{ date: selected, start: form.start, end: form.end, subject, task: form.task, source: "manual" }],
      { ignoreIds: ignore, source: "manual" },
    );
    if (!check.ok) {
      toast(check.errors[0] ?? "الحصة غير صالحة");
      return;
    }
    const session = { ...check.sessions[0]!, id: editing?.id ?? uid("ses"), source: "manual" as const, status: editing?.status ?? "planned" };
    patch((s) => ({
      ...s,
      sessions: editing ? s.sessions.map((item) => (item.id === editing.id ? session : item)) : [...s.sessions, session],
    }));
    setOpen(false);
    setEditing(null);
  }

  return (
    <>
      <section className="spread">
        <Btn kind="ghost" onClick={() => setAnchor(addDays(saturdayOnOrBefore(anchor), -7))}>الأسبوع السابق</Btn>
        <Btn kind="ghost" onClick={() => { setAnchor(today); setSelected(today); }}>اليوم</Btn>
        <Btn kind="ghost" onClick={() => setAnchor(addDays(saturdayOnOrBefore(anchor), 7))}>الأسبوع التالي</Btn>
      </section>
      <div className="week">
        {days.map((date) => (
          <button key={date} type="button" className="chip" aria-pressed={date === selected} onClick={() => setSelected(date)}>
            <b>{date.slice(8)}</b>
            <span>{WEEKDAY_NAMES[weekdayIndex(date)]}</span>
          </button>
        ))}
      </div>
      <Btn onClick={() => { setEditing(null); setForm({ subjectId: state.subjects[0]?.id ?? "", task: "", start: "16:00", end: "16:50" }); setOpen(true); }}>
        حصة يدوية
      </Btn>
      {list.length === 0 ? <p className="muted">لا حصص في هذا اليوم. ولّد الأسبوع من المخطط، أو أضف حصة بعد التأكد أنها خارج الصلاة والارتباطات.</p> : null}
      {list.map((session) => {
        const len = (minutes(session.end) ?? 0) - (minutes(session.start) ?? 0);
        return (
          <article key={session.id} className="card stack">
            <div className="spread">
              <strong>{subjectName(state, session.subjectId)}</strong>
              <span className="muted">{session.status === "done" ? "تمت" : session.status === "skipped" ? "فاتت" : "مخططة"}</span>
            </div>
            <p>{session.task}</p>
            <p className="muted">{session.start} – {session.end} · {session.source === "ai" ? "اقتراح ذكاء" : session.source === "local" ? "مخطط محلي" : "يدوي"}</p>
            <div className="row">
              {session.status === "planned" ? (
                <Btn onClick={() => startFocus({ sessionId: session.id, subjectId: session.subjectId, task: session.task, minutes: Math.max(15, len) })}>ابدأ</Btn>
              ) : null}
              {session.status !== "done" ? (
                <Btn kind="ghost" onClick={() => patch((s) => ({ ...s, sessions: s.sessions.map((item) => item.id === session.id ? { ...item, status: "done", actualMinutes: len } : item), logs: [...s.logs, { id: uid("log"), at: new Date().toISOString(), date: session.date, subjectId: session.subjectId, minutes: len, task: session.task, kind: "manual" as const, sessionId: session.id }].slice(-500) }))}>تمّت</Btn>
              ) : null}
              {session.status === "planned" ? (
                <Btn kind="ghost" onClick={() => patch((s) => ({ ...s, sessions: s.sessions.map((item) => item.id === session.id ? { ...item, status: "skipped" } : item) }))}>فاتتني</Btn>
              ) : null}
              <Btn kind="ghost" onClick={() => { setEditing(session); setForm({ subjectId: session.subjectId, task: session.task, start: session.start, end: session.end }); setOpen(true); }}>تعديل</Btn>
              <Btn kind="danger" onClick={() => patch((s) => ({ ...s, sessions: s.sessions.filter((item) => item.id !== session.id) }))}>حذف</Btn>
            </div>
          </article>
        );
      })}
      <Modal open={open} title={editing ? "تعديل الحصة" : "حصة جديدة"} onClose={() => setOpen(false)}>
        <label className="stack">المادة
          <select className="field" value={form.subjectId} onChange={(e) => setForm({ ...form, subjectId: e.target.value })}>
            {state.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="stack">المهمة
          <input className="field" value={form.task} onChange={(e) => setForm({ ...form, task: e.target.value })} placeholder="حل تمارين الاشتقاق" />
        </label>
        <div className="grid-2">
          <label className="stack">من<input className="field" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></label>
          <label className="stack">إلى<input className="field" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></label>
        </div>
        <Btn onClick={save}>حفظ بعد الفحص</Btn>
      </Modal>
    </>
  );
}
