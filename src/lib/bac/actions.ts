import type { AppState, FocusState, LessonStatus } from "./types";
import { validateIncoming } from "./schedule";
import { algiersNow, minutes, uid } from "./time";

export type AgentAction =
  | { type: "add_session"; date: string; start: string; end: string; subject: string; task: string }
  | { type: "move_session"; id?: string; index?: number; date: string; start: string; end: string }
  | { type: "delete_session"; id?: string; index?: number }
  | {
      type: "update_lesson";
      id?: string;
      title?: string;
      status?: LessonStatus;
      mastery?: number;
      weakPoints?: string[];
    }
  | { type: "schedule_review"; lessonId?: string; title?: string; date: string; start: string; end: string; task?: string }
  | { type: "add_exam"; subject: string; title: string; date: string }
  | { type: "set_weakness"; subject: string; weakness: number }
  | { type: "start_focus"; sessionId?: string; subject?: string; minutes?: number; task?: string };

const STATUSES: LessonStatus[] = ["new", "memorizing", "review", "mastered"];

export function upcoming(state: AppState, today: string) {
  return state.sessions
    .filter((s) => s.status === "planned" && s.date >= today)
    .slice()
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

function resolveSession(state: AppState, id: string | undefined, index: number | undefined, today: string) {
  if (id) return state.sessions.find((s) => s.id === id);
  if (typeof index === "number" && Number.isFinite(index)) {
    const list = upcoming(state, today);
    return list[index - 1];
  }
  return undefined;
}

function resolveLesson(state: AppState, id?: string, title?: string) {
  if (id) return state.lessons.find((l) => l.id === id);
  if (title) {
    const hits = state.lessons.filter((l) => l.title.trim() === title.trim());
    return hits.length === 1 ? hits[0] : undefined;
  }
  return undefined;
}

export function coerceActions(raw: unknown[]): { actions: AgentAction[]; errors: string[] } {
  const actions: AgentAction[] = [];
  const errors: string[] = [];
  raw.forEach((item, i) => {
    const n = i + 1;
    if (!item || typeof item !== "object") {
      errors.push(`الإجراء ${n} ليس كائنًا`);
      return;
    }
    const o = item as Record<string, unknown>;
    const type = String(o.type ?? "");
    const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
    const num = (k: string) => (typeof o[k] === "number" ? (o[k] as number) : undefined);
    if (type === "add_session") {
      actions.push({ type, date: str("date"), start: str("start"), end: str("end"), subject: str("subject"), task: str("task") });
    } else if (type === "move_session") {
      actions.push({ type, id: str("id") || undefined, index: num("index"), date: str("date"), start: str("start"), end: str("end") });
    } else if (type === "delete_session") {
      actions.push({ type, id: str("id") || undefined, index: num("index") });
    } else if (type === "update_lesson") {
      const status = str("status") as LessonStatus;
      actions.push({
        type,
        id: str("id") || undefined,
        title: str("title") || undefined,
        status: STATUSES.includes(status) ? status : undefined,
        mastery: num("mastery"),
        weakPoints: Array.isArray(o.weakPoints) ? o.weakPoints.map(String) : undefined,
      });
    } else if (type === "schedule_review") {
      actions.push({
        type,
        lessonId: str("lessonId") || undefined,
        title: str("title") || undefined,
        date: str("date"),
        start: str("start"),
        end: str("end"),
        task: str("task") || undefined,
      });
    } else if (type === "add_exam") {
      actions.push({ type, subject: str("subject"), title: str("title"), date: str("date") });
    } else if (type === "set_weakness") {
      actions.push({ type, subject: str("subject"), weakness: num("weakness") ?? NaN });
    } else if (type === "start_focus") {
      actions.push({
        type,
        sessionId: str("sessionId") || undefined,
        subject: str("subject") || undefined,
        minutes: num("minutes"),
        task: str("task") || undefined,
      });
    } else {
      errors.push(`الإجراء ${n} نوعه '${type}' غير معروف`);
    }
  });
  return { actions, errors };
}

export function validateActions(
  state: AppState,
  actions: AgentAction[],
  today = algiersNow().date,
  opts?: { allowConstraintViolations?: boolean },
): { ok: true; lines: string[]; next: AppState } | { ok: false; errors: string[] } {
  let next = state;
  // Keep index references stable for the whole AI batch. Without this, deleting or
  // moving an early session shifts later indexes and makes valid later actions
  // point at the wrong session (or at nothing).
  const originalUpcoming = upcoming(state, today);
  const resolveBatchSession = (id: string | undefined, index: number | undefined) => {
    const original = id
      ? state.sessions.find((s) => s.id === id)
      : (typeof index === "number" && Number.isFinite(index) ? originalUpcoming[index - 1] : undefined);
    return original ? next.sessions.find((s) => s.id === original.id) : undefined;
  };
  const lines: string[] = [];
  const errors: string[] = [];

  const fail = (n: number, because: string) => errors.push(`الإجراء ${n} مرفوض: ${because}`);

  actions.forEach((action, index) => {
    const n = index + 1;
    if (action.type === "add_session" || action.type === "schedule_review") {
      let subject = action.type === "add_session" ? action.subject : "";
      let task = action.type === "add_session" ? action.task : action.task || "مراجعة";
      if (action.type === "schedule_review") {
        const lesson = resolveLesson(next, action.lessonId, action.title);
        if (!lesson) {
          fail(n, "الدرس غير موجود");
          return;
        }
        subject = next.subjects.find((s) => s.id === lesson.subjectId)?.name ?? "";
        task = action.task || `مراجعة: ${lesson.title}`;
        const check = validateIncoming(
          next,
          [{ date: action.date, start: action.start, end: action.end, subject, task, source: "review" }],
          { allowConstraintViolations: opts?.allowConstraintViolations },
        );
        if (!check.ok) {
          fail(n, check.errors.join(" "));
          return;
        }
        const session = check.sessions[0]!;
        next = {
          ...next,
          sessions: [...next.sessions, session],
          lessons: next.lessons.map((l) => (l.id === lesson.id ? { ...l, nextReview: action.date, updatedAt: new Date().toISOString() } : l)),
        };
        lines.push(`مراجعة «${lesson.title}» في ${action.date} ${action.start}–${action.end}`);
        return;
      }
      const check = validateIncoming(next, [{ ...action, source: "ai" }], { allowConstraintViolations: opts?.allowConstraintViolations });
      if (!check.ok) {
        fail(n, check.errors.join(" "));
        return;
      }
      next = { ...next, sessions: [...next.sessions, ...check.sessions] };
      lines.push(`إضافة ${action.subject} ${action.date} ${action.start}–${action.end}: ${action.task}`);
      return;
    }

    if (action.type === "move_session") {
      const current = resolveBatchSession(action.id, action.index);
      if (!current) {
        fail(n, "الحصة غير موجودة. استخدم id أو index من القائمة");
        return;
      }
      const subject = next.subjects.find((s) => s.id === current.subjectId)?.name ?? "";
      const check = validateIncoming(
        next,
        [{ date: action.date, start: action.start, end: action.end, subject, task: current.task, source: current.source }],
        { ignoreIds: new Set([current.id]), allowConstraintViolations: opts?.allowConstraintViolations },
      );
      if (!check.ok) {
        fail(n, check.errors.join(" "));
        return;
      }
      const moved = { ...check.sessions[0]!, id: current.id, source: current.source, status: current.status };
      next = { ...next, sessions: next.sessions.map((s) => (s.id === current.id ? moved : s)) };
      lines.push(`نقل ${subject} إلى ${action.date} ${action.start}–${action.end}`);
      return;
    }

    if (action.type === "delete_session") {
      const current = resolveBatchSession(action.id, action.index);
      if (!current) {
        fail(n, "الحصة غير موجودة");
        return;
      }
      next = { ...next, sessions: next.sessions.filter((s) => s.id !== current.id) };
      lines.push(`حذف حصة ${next.subjects.find((s) => s.id === current.subjectId)?.name ?? ""} ${current.date} ${current.start}`);
      return;
    }

    if (action.type === "update_lesson") {
      const lesson = resolveLesson(next, action.id, action.title);
      if (!lesson) {
        fail(n, "الدرس غير موجود أو العنوان مكرر");
        return;
      }
      if (action.mastery !== undefined && (action.mastery < 0 || action.mastery > 100)) {
        fail(n, "نسبة الإتقان يجب أن تكون بين 0 و 100");
        return;
      }
      next = {
        ...next,
        lessons: next.lessons.map((l) =>
          l.id === lesson.id
            ? {
                ...l,
                status: action.status ?? l.status,
                mastery: action.mastery ?? l.mastery,
                weakPoints: action.weakPoints ?? l.weakPoints,
                updatedAt: new Date().toISOString(),
              }
            : l,
        ),
      };
      lines.push(`تحديث درس «${lesson.title}»`);
      return;
    }

    if (action.type === "add_exam") {
      const sub = next.subjects.find((s) => s.name === action.subject.trim());
      if (!sub) {
        fail(n, `المادة '${action.subject}' غير موجودة`);
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(action.date)) {
        fail(n, "تاريخ الاختبار غير صالح");
        return;
      }
      next = {
        ...next,
        exams: [...next.exams, { id: uid("exam"), subjectId: sub.id, title: action.title || `اختبار ${sub.name}`, date: action.date, lessonIds: [] }],
      };
      lines.push(`اختبار ${sub.name} بتاريخ ${action.date}`);
      return;
    }

    if (action.type === "set_weakness") {
      const sub = next.subjects.find((s) => s.name === action.subject.trim());
      if (!sub) {
        fail(n, "المادة غير موجودة");
        return;
      }
      const w = Math.round(action.weakness);
      if (w < 1 || w > 5) {
        fail(n, "الضعف من 1 إلى 5");
        return;
      }
      next = { ...next, subjects: next.subjects.map((s) => (s.id === sub.id ? { ...s, weakness: w } : s)) };
      lines.push(`مستوى الضعف في ${sub.name} أصبح ${w}`);
      return;
    }

    if (action.type === "start_focus") {
      if (next.focus) {
        fail(n, "هناك جلسة تركيز جارية");
        return;
      }
      const session = action.sessionId ? next.sessions.find((s) => s.id === action.sessionId) : undefined;
      const sub = session
        ? next.subjects.find((s) => s.id === session.subjectId)
        : next.subjects.find((s) => s.name === (action.subject ?? "").trim());
      if (!sub) {
        fail(n, "حدد مادة أو حصة موجودة");
        return;
      }
      const mins = session ? (minutes(session.end) ?? 0) - (minutes(session.start) ?? 0) : Math.round(action.minutes ?? 50);
      if (mins < 10 || mins > 180) {
        fail(n, "مدة التركيز بين 10 و 180 دقيقة");
        return;
      }
      const focus: FocusState = {
        sessionId: session?.id ?? null,
        subjectId: sub.id,
        task: action.task || session?.task || `دراسة ${sub.name}`,
        durationSec: mins * 60,
        startedAt: Date.now(),
        pausedAccumMs: 0,
        pauseStartedAt: null,
      };
      next = { ...next, focus };
      lines.push(`بدء التركيز: ${sub.name} لمدة ${mins} د`);
    }
  });

  if (errors.length) return { ok: false, errors };
  return { ok: true, lines, next };
}
