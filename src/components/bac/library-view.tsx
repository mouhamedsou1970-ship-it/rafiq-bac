import { useEffect, useMemo, useState } from "react";
import { gradeAnswer, makeQuiz, splitLesson, type Grade, type QuizQ } from "@/lib/bac/prompts";
import { openLessonInAi, patch, toast, useApp } from "@/lib/bac/store";
import { addDays, algiersNow, uid } from "@/lib/bac/time";
import { nextReviewDays, statusFromMastery } from "@/lib/bac/analytics";
import { lessonStatusLabel } from "@/lib/bac/defaults";
import type { Lesson, LessonStatus } from "@/lib/bac/types";
import { Bar, Btn, Modal } from "./ui";

type Unit = { title: string; text: string };
type Mem = {
  lessonId: string;
  units: Unit[];
  index: number;
  phase: "read" | "write" | "feedback" | "done";
  answer: string;
  grade: Grade | null;
  scores: number[];
  missing: string[];
  startedAt: number;
  busy: boolean;
};
type ExamRun = {
  lesson: Lesson;
  questions: QuizQ[];
  answers: string[];
  index: number;
  result: { score: number; wrong: string[]; durationMinutes: number } | null;
  busy: boolean;
  startedAt: number;
};

export function LibraryView() {
  const { state } = useApp();
  const [subjectId, setSubjectId] = useState(state.subjects[0]?.id ?? "");
  const [selected, setSelected] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [mem, setMem] = useState<Mem | null>(null);
  const [exam, setExam] = useState<ExamRun | null>(null);
  const [cardsOf, setCardsOf] = useState<string | null>(null);
  const [cardFace, setCardFace] = useState(0);
  const [showBack, setShowBack] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<LessonStatus | "all" | "due">("all");
  const [examNow, setExamNow] = useState(Date.now());
  const today = algiersNow().date;
  const lessons = useMemo(() => state.lessons
    .filter((l) => l.subjectId === subjectId)
    .filter((l) => statusFilter === "all" ? true : statusFilter === "due" ? Boolean(l.nextReview && l.nextReview <= today) : l.status === statusFilter)
    .filter((l) => !query.trim() || `${l.title} ${l.body}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => {
      const ad = a.nextReview ?? "9999-99-99";
      const bd = b.nextReview ?? "9999-99-99";
      return ad.localeCompare(bd) || b.updatedAt.localeCompare(a.updatedAt);
    }), [state.lessons, subjectId, statusFilter, query, today]);
  const lesson = state.lessons.find((l) => l.id === selected) ?? null;

  function saveLesson() {
    if (!title.trim() || !body.trim()) {
      toast("العنوان والنص مطلوبان");
      return;
    }
    if (lesson) {
      patch((s) => ({
        ...s,
        lessons: s.lessons.map((item) => item.id === lesson.id ? { ...item, title: title.trim(), body: body.trim(), subjectId, updatedAt: new Date().toISOString() } : item),
      }));
      toast("حُفظ الدرس");
      return;
    }
    const created: Lesson = {
      id: uid("les"),
      subjectId,
      title: title.trim(),
      body: body.trim(),
      status: "new",
      mastery: 0,
      lastReview: null,
      nextReview: null,
      updatedAt: new Date().toISOString(),
      weakPoints: [],
    };
    patch((s) => ({ ...s, lessons: [created, ...s.lessons] }));
    setSelected(created.id);
    toast("أُضيف الدرس إلى المكتبة");
  }

  async function beginMemorize() {
    if (!lesson) return;
    setMem({ lessonId: lesson.id, units: [], index: 0, phase: "read", answer: "", grade: null, scores: [], missing: [], startedAt: Date.now(), busy: true });
    const units = await splitLesson(state, lesson.body);
    setMem({ lessonId: lesson.id, units, index: 0, phase: "read", answer: "", grade: null, scores: [], missing: [], startedAt: Date.now(), busy: false });
  }

  async function gradeUnit() {
    if (!mem || !lesson) return;
    const unit = mem.units[mem.index];
    if (!unit) return;
    setMem({ ...mem, busy: true });
    const grade = await gradeAnswer(state, unit.text, mem.answer);
    const missing = grade.mastery < 60 ? [...mem.missing, ...grade.missing] : mem.missing;
    setMem({ ...mem, busy: false, phase: "feedback", grade, scores: [...mem.scores, grade.mastery], missing });
  }

  function finishMemorize(current: Mem) {
    const source = state.lessons.find((l) => l.id === current.lessonId);
    if (!source || current.scores.length === 0) {
      setMem(null);
      return;
    }
    const avg = Math.round(current.scores.reduce((a, b) => a + b, 0) / current.scores.length);
    const today = algiersNow().date;
    const status = statusFromMastery(avg);
    patch((s) => ({
      ...s,
      lessons: s.lessons.map((l) => l.id === source.id ? {
        ...l,
        mastery: avg,
        status,
        lastReview: today,
        nextReview: addDays(today, nextReviewDays(avg, (l.reviewHistory ?? []).map((r) => r.mastery))),
        updatedAt: new Date().toISOString(),
        weakPoints: [...new Set(current.missing)].slice(0, 8),
        reviewHistory: [...(l.reviewHistory ?? []), { at: new Date().toISOString(), mastery: avg }].slice(-30),
      } : l),
      logs: [...s.logs, {
        id: uid("log"),
        at: new Date().toISOString(),
        date: today,
        subjectId: source.subjectId,
        minutes: Math.max(1, Math.round((Date.now() - current.startedAt) / 60000)),
        task: `حفظ: ${source.title}`,
        kind: "memorize" as const,
        lessonId: source.id,
        mastery: avg,
      }].slice(-500),
      errors: avg < 70 ? [...s.errors, {
        id: uid("err"),
        at: new Date().toISOString(),
        date: today,
        subjectId: source.subjectId,
        lessonId: source.id,
        concept: source.title,
        kind: "memorize" as const,
        note: current.missing.slice(0, 4).join("، ") || "إتقان منخفض",
      }].slice(-300) : s.errors,
    }));
    setMem({ ...current, phase: "done", grade: { mastery: avg, correct: [], missing: current.missing, note: status === "mastered" ? "الدرس متقن حسب هذه الجلسة." : "خُططت مراجعة أقرب لأن الإتقان لم يكتمل." } });
  }

  async function beginExam(kind: "quiz" | "exam" | "cards") {
    if (!lesson) return;
    if (kind === "cards") {
      const questions = await makeQuiz(state, lesson.body, "cards");
      patch((s) => ({
        ...s,
        lessons: s.lessons.map((l) => l.id === lesson.id ? { ...l, cards: questions.map((q) => ({ id: uid("card"), front: q.prompt, back: q.expected })) } : l),
      }));
      setCardsOf(lesson.id);
      setCardFace(0);
      setShowBack(false);
      toast("حُفظت البطاقات مع الدرس");
      return;
    }
    const questions = await makeQuiz(state, lesson.body, kind);
    setExam({ lesson, questions, answers: questions.map(() => ""), index: 0, result: null, busy: false, startedAt: Date.now() });
  }

  async function finishExam() {
    if (!exam) return;
    setExam({ ...exam, busy: true });
    const grades: Grade[] = [];
    for (let i = 0; i < exam.questions.length; i += 1) {
      const q = exam.questions[i]!;
      grades.push(await gradeAnswer(state, `${q.concept}\n${q.expected}`, exam.answers[i] ?? ""));
    }
    const score = Math.round(grades.reduce((sum, g) => sum + g.mastery, 0) / Math.max(1, grades.length));
    const wrong = grades.map((g, i) => ({ g, q: exam.questions[i]! })).filter((item) => item.g.mastery < 60).map((item) => item.q.concept);
    const today = algiersNow().date;
    const durationMinutes = Math.max(1, Math.round((Date.now() - exam.startedAt) / 60000));
    patch((s) => ({
      ...s,
      exams: [...s.exams, { id: uid("exam"), subjectId: exam.lesson.subjectId, title: `اختبار: ${exam.lesson.title}`, date: today, lessonIds: [exam.lesson.id], score, takenAt: new Date().toISOString(), durationMinutes }],
      lessons: s.lessons.map((l) => l.id === exam.lesson.id ? { ...l, mastery: score, status: statusFromMastery(score), lastReview: today, nextReview: addDays(today, nextReviewDays(score, (l.reviewHistory ?? []).map((r) => r.mastery))), reviewHistory: [...(l.reviewHistory ?? []), { at: new Date().toISOString(), mastery: score }].slice(-30), weakPoints: [...new Set([...l.weakPoints, ...wrong])].slice(0, 8) } : l),
      logs: [...s.logs, { id: uid("log"), at: new Date().toISOString(), date: today, subjectId: exam.lesson.subjectId, minutes: durationMinutes, task: `اختبار ${exam.lesson.title}`, kind: "exam" as const, lessonId: exam.lesson.id, mastery: score }].slice(-500),
      errors: [...s.errors, ...wrong.map((concept) => ({ id: uid("err"), at: new Date().toISOString(), date: today, subjectId: exam.lesson.subjectId, lessonId: exam.lesson.id, concept, kind: "exam" as const, note: "إجابة ناقصة في الاختبار" }))].slice(-300),
    }));
    setExam({ ...exam, busy: false, result: { score, wrong, durationMinutes } });
  }

  useEffect(() => {
    if (!exam || exam.result) return;
    const id = window.setInterval(() => setExamNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [exam]);

  const examElapsed = exam ? Math.max(0, Math.floor((examNow - exam.startedAt) / 1000)) : 0;
  const examClock = `${String(Math.floor(examElapsed / 60)).padStart(2, "0")}:${String(examElapsed % 60).padStart(2, "0")}`;
  const cards = state.lessons.find((l) => l.id === cardsOf)?.cards ?? [];

  return (
    <>
      <section className="card stack">
        <h1>المكتبة</h1>
        <p className="muted">الدروس تبقى على هذا الجهاز. الحفظ يختبرك من النص نفسه، بلا معلومات من خارجه.</p>
        <label className="stack">المادة
          <select className="field" value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setSelected(null); setTitle(""); setBody(""); }}>
            {state.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <div className="grid-2">
          <input className="field" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث في الدروس…" />
          <select className="field" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as LessonStatus | "all" | "due")}>
            <option value="all">كل الدروس</option><option value="due">مستحقة للمراجعة</option><option value="new">لم أبدأ</option><option value="memorizing">أحفظه</option><option value="review">مراجعة</option><option value="mastered">متقن</option>
          </select>
        </div>
        <span className="muted">{lessons.length} درس</span>
      </section>
      {lessons.length === 0 ? <p className="muted">لا توجد دروس تطابق البحث أو الفلتر.</p> : null}
      {lessons.map((item) => (
        <button key={item.id} type="button" className="choice" onClick={() => { setSelected(item.id); setTitle(item.title); setBody(item.body); }}>
          <strong>{item.title}</strong>
          <span className="muted"> {lessonStatusLabel(item.status)} · {item.mastery}%</span>
        </button>
      ))}
      <section className="card stack">
        <h2>{lesson ? "تعديل الدرس" : "درس جديد"}</h2>
        <input className="field" value={title} placeholder="عنوان الدرس" onChange={(e) => setTitle(e.target.value)} />
        <textarea className="area" value={body} placeholder="الصق نص الدرس هنا" onChange={(e) => setBody(e.target.value)} />
        {lesson ? (
          <label className="stack">الحالة
            <select className="field" value={lesson.status} onChange={(e) => patch((s) => ({ ...s, lessons: s.lessons.map((l) => l.id === lesson.id ? { ...l, status: e.target.value as LessonStatus, updatedAt: new Date().toISOString() } : l) }))}>
              <option value="new">لم أبدأ</option>
              <option value="memorizing">أحفظه</option>
              <option value="review">مراجعة</option>
              <option value="mastered">متقن</option>
            </select>
          </label>
        ) : null}
        <div className="row">
          <Btn onClick={saveLesson}>حفظ الدرس</Btn>
          {lesson ? <Btn kind="danger" onClick={() => setConfirmDelete(true)}>حذف</Btn> : null}
        </div>
        {lesson ? (
          <div className="row">
            <Btn onClick={() => void beginMemorize()}>ابدأ الحفظ</Btn>
            <Btn kind="ghost" onClick={() => void beginExam("quiz")}>أسئلة</Btn>
            <Btn kind="ghost" onClick={() => void beginExam("exam")}>وضع اختبار</Btn>
            <Btn kind="ghost" onClick={() => void beginExam("cards")}>بطاقات</Btn>
            <Btn kind="ghost" onClick={() => { openLessonInAi(lesson.id); toast("رُبط الدرس بالمساعد"); }}>استخدمه مع المساعد</Btn>
          </div>
        ) : null}
        {lesson?.lastReview ? <p className="muted">آخر مراجعة {lesson.lastReview} · القادمة {lesson.nextReview ?? "—"} · إتقان {lesson.mastery}%</p> : null}
        {lesson && lesson.weakPoints.length ? <p className="muted">نقاط ضعيفة: {lesson.weakPoints.join("، ")}</p> : null}
      </section>

      <Modal open={Boolean(mem)} title="الحفظ" onClose={() => setMem(null)}>
        {mem?.busy ? <p>يجري تجهيز الوحدة…</p> : null}
        {mem && !mem.busy && mem.phase === "done" ? (
          <>
            <h2>نتيجة الجلسة {mem.grade?.mastery}%</h2>
            <Bar value={mem.grade?.mastery ?? 0} />
            <p>{mem.grade?.note}</p>
            <Btn onClick={() => setMem(null)}>إغلاق</Btn>
          </>
        ) : null}
        {mem && !mem.busy && mem.phase !== "done" && mem.units[mem.index] ? (
          <>
            <p className="muted">وحدة {mem.index + 1} من {mem.units.length}</p>
            <h2>{mem.units[mem.index]!.title}</h2>
            {mem.phase === "read" ? <p style={{ whiteSpace: "pre-wrap" }}>{mem.units[mem.index]!.text}</p> : null}
            {mem.phase === "write" ? (
              <>
                <p>النص مخفي. اكتب ما تتذكره من الوحدة.</p>
                <textarea className="area" value={mem.answer} onChange={(e) => setMem({ ...mem, answer: e.target.value })} />
              </>
            ) : null}
            {mem.phase === "feedback" && mem.grade ? (
              <>
                <strong>{mem.grade.mastery}%</strong>
                <Bar value={mem.grade.mastery} />
                {mem.grade.correct.length ? <p>صحيح: {mem.grade.correct.join("، ")}</p> : null}
                {mem.grade.missing.length ? <p>ناقص: {mem.grade.missing.join("، ")}</p> : null}
                <p>{mem.grade.note}</p>
              </>
            ) : null}
            <div className="row">
              {mem.phase === "read" ? <Btn onClick={() => setMem({ ...mem, phase: "write", answer: "" })}>اختبرني</Btn> : null}
              {mem.phase === "write" ? <Btn onClick={() => void gradeUnit()}>تصحيح</Btn> : null}
              {mem.phase === "feedback" && (mem.grade?.mastery ?? 100) < 60 ? <Btn kind="ghost" onClick={() => setMem({ ...mem, phase: "read", answer: "", grade: null, scores: mem.scores.slice(0, -1) })}>إعادة الوحدة</Btn> : null}
              {mem.phase === "feedback" ? (
                <Btn onClick={() => {
                  if (mem.index + 1 >= mem.units.length) finishMemorize(mem);
                  else setMem({ ...mem, index: mem.index + 1, phase: "read", answer: "", grade: null });
                }}>{mem.index + 1 >= mem.units.length ? "إنهاء الجلسة" : "الوحدة التالية"}</Btn>
              ) : null}
            </div>
          </>
        ) : null}
      </Modal>

      <Modal open={Boolean(exam)} title="الاختبار" onClose={() => setExam(null)}>
        {exam?.busy ? <p>يجري التصحيح…</p> : null}
        {exam && !exam.busy && exam.result ? (
          <>
            <h2>النتيجة {exam.result.score}%</h2>
            <p className="muted">المدة الفعلية: {exam.result.durationMinutes} دقيقة</p>
            <Bar value={exam.result.score} />
            {exam.result.wrong.length ? <p>أخطاء سُجلت: {exam.result.wrong.join("، ")}</p> : <p>لا أخطاء كبيرة في هذه الجولة.</p>}
            <Btn onClick={() => setExam(null)}>إغلاق</Btn>
          </>
        ) : null}
        {exam && !exam.busy && !exam.result ? (
          <>
            <div className="spread"><p className="muted">سؤال {exam.index + 1} من {exam.questions.length}</p><strong>⏱ {examClock}</strong></div>
            <h2>{exam.questions[exam.index]?.prompt}</h2>
            <textarea className="area" value={exam.answers[exam.index] ?? ""} onChange={(e) => setExam({ ...exam, answers: exam.answers.map((a, i) => i === exam.index ? e.target.value : a) })} />
            <div className="row">
              {exam.index > 0 ? <Btn kind="ghost" onClick={() => setExam({ ...exam, index: exam.index - 1 })}>السابق</Btn> : null}
              {exam.index + 1 < exam.questions.length ? <Btn onClick={() => setExam({ ...exam, index: exam.index + 1 })}>التالي</Btn> : <Btn onClick={() => void finishExam()}>إنهاء وحساب النتيجة</Btn>}
            </div>
          </>
        ) : null}
      </Modal>

      <Modal open={cards.length > 0 && cardsOf !== null} title="بطاقات المراجعة" onClose={() => setCardsOf(null)}>
        {cards[cardFace] ? (
          <>
            <p className="muted">{cardFace + 1} / {cards.length}</p>
            <button type="button" className="choice" onClick={() => setShowBack(!showBack)}>
              {showBack ? cards[cardFace]!.back : cards[cardFace]!.front}
            </button>
            <div className="row">
              <Btn kind="ghost" onClick={() => { setCardFace((cardFace + cards.length - 1) % cards.length); setShowBack(false); }}>السابقة</Btn>
              <Btn onClick={() => { setCardFace((cardFace + 1) % cards.length); setShowBack(false); }}>التالية</Btn>
            </div>
          </>
        ) : null}
      </Modal>

      <Modal open={confirmDelete} title="حذف الدرس" onClose={() => setConfirmDelete(false)}>
        <p>سيُحذف النص من هذا الجهاز.</p>
        <div className="row">
          <Btn kind="danger" onClick={() => {
            if (!lesson) return;
            patch((s) => ({ ...s, lessons: s.lessons.filter((l) => l.id !== lesson.id) }));
            setSelected(null);
            setTitle("");
            setBody("");
            setConfirmDelete(false);
          }}>حذف</Btn>
          <Btn kind="ghost" onClick={() => setConfirmDelete(false)}>إلغاء</Btn>
        </div>
      </Modal>
    </>
  );
}
