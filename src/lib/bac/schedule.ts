import type { AppState, Lesson, StudySession, Subject } from "./types.ts";
import {
  addDays,
  daysUntil,
  hhmm,
  minutes,
  rangesOverlap,
  saturdayOnOrBefore,
  uid,
  weekdayIndex,
} from "./time.ts";

export type Busy = { start: number; end: number; reason: string };

export type IncomingSession = {
  date: string;
  start: string;
  end: string;
  subject?: string;
  subjectId?: string;
  task: string;
  source?: StudySession["source"];
};

const MIN_SLOT = 25;
const PREFER_SLOT = 50;
const GAP = 10;

export function subjectName(state: AppState, id: string): string {
  return state.subjects.find((s) => s.id === id)?.name ?? "مادة محذوفة";
}

export function subjectByName(state: AppState, name: string): Subject | undefined {
  const n = name.trim();
  return state.subjects.find((s) => s.name === n);
}

export function clipWindow(state: AppState, date: string): [number, number] | null {
  const day = state.days[weekdayIndex(date)];
  if (!day?.enabled) return null;
  const start = minutes(day.start);
  const end = minutes(day.end);
  const wake = minutes(state.settings.wake);
  const sleep = minutes(state.settings.sleep);
  if (start === null || end === null || wake === null || sleep === null) return null;
  let a = start;
  let b = end;
  if (sleep > wake) {
    a = Math.max(a, wake);
    b = Math.min(b, sleep);
  } else {
    a = Math.max(a, wake);
  }
  if (b - a < MIN_SLOT) return null;
  return [a, b];
}

function pushBlock(blocks: Busy[], start: string, end: string, reason: string) {
  const a = minutes(start);
  const b = minutes(end);
  if (a === null || b === null || b <= a) return;
  blocks.push({ start: a, end: b, reason });
}

export function busyBlocks(
  state: AppState,
  date: string,
  opts?: { includeSessions?: boolean; ignoreIds?: Set<string> },
): Busy[] {
  const blocks: Busy[] = [];
  const wd = weekdayIndex(date);
  for (const c of state.commitments) {
    if (!c.days.includes(wd)) continue;
    pushBlock(blocks, c.start, c.end, c.name);
  }
  const prayer = state.prayerByDate[date];
  if (prayer) {
    const before = state.prayerBufferBefore;
    const after = state.prayerBufferAfter;
    const wrap = (t: string, pre: number, post: number, reason: string) => {
      const m = minutes(t);
      if (m === null) return;
      blocks.push({
        start: Math.max(0, m - pre),
        end: Math.min(24 * 60, m + post),
        reason,
      });
    };
    wrap(prayer.fajr, before, after, "الصلاة");
    if (wd === 5) wrap(prayer.dhuhr, Math.max(before, 20), Math.max(after, 70), "صلاة الجمعة");
    else wrap(prayer.dhuhr, before, after, "الصلاة");
    wrap(prayer.asr, before, after, "الصلاة");
    const mag = minutes(prayer.maghrib);
    const isha = minutes(prayer.isha);
    if (mag !== null && isha !== null && isha > mag) {
      blocks.push({ start: mag, end: isha, reason: "المغرب إلى العشاء" });
    }
  }
  if (opts?.includeSessions) {
    for (const s of state.sessions) {
      if (s.date !== date || s.status === "skipped") continue;
      if (opts.ignoreIds?.has(s.id)) continue;
      pushBlock(blocks, s.start, s.end, `حصة ${subjectName(state, s.subjectId)}`);
    }
  }
  return blocks;
}

export function formatBusyDay(state: AppState, date: string): string {
  const blocks = busyBlocks(state, date).sort((a, b) => a.start - b.start);
  if (!blocks.length) {
    const prayer = state.prayerByDate[date];
    return prayer ? `${date}:\nلا توجد فترات ممنوعة معروفة` : `${date}:\nمواقيت الصلاة غير متوفرة`;
  }
  const lines = blocks.map((b) => `${hhmm(b.start)}-${hhmm(b.end)} ${b.reason}`);
  return `${date}:\n${lines.join("\n")}`;
}

export function formatConstraints(state: AppState, dates: string[]): string {
  const names = state.subjects.map((s) => s.name).join("، ");
  const windows = dates
    .map((date) => {
      const day = state.days[weekdayIndex(date)];
      const clip = clipWindow(state, date);
      if (!day?.enabled || !clip) return `${date}: لا دراسة`;
      return `${date}: ${hhmm(clip[0])}-${hhmm(clip[1])} — الحد ${day.maxMinutes} دقيقة`;
    })
    .join("\n");
  const busy = dates.map((date) => formatBusyDay(state, date)).join("\n\n");
  const night = state.settings.nightEnabled
    ? `مفعّلة من ${state.settings.nightStart} لمدة ${state.settings.nightMinutes} د، ويُفضَّل فيها الرياضيات والفيزياء`
    : "متوقفة";
  return [
    `المواد المسموح بها حرفيًا: ${names}`,
    `ساعات الدراسة المسموحة:\n${windows}`,
    `الحصة الليلية: ${night}`,
    `الفترات الممنوعة (لا تتقاطع أي حصة ولو دقيقة واحدة معها):\n${busy}`,
  ].join("\n\n");
}

function subtract(free: [number, number][], block: Busy): [number, number][] {
  const out: [number, number][] = [];
  for (const [s, e] of free) {
    if (block.end <= s || block.start >= e) {
      out.push([s, e]);
      continue;
    }
    if (block.start > s) out.push([s, Math.min(block.start, e)]);
    if (block.end < e) out.push([Math.max(block.end, s), e]);
  }
  return out.filter(([s, e]) => e - s >= MIN_SLOT);
}

function freeMinutesAfter(state: AppState, date: string, includeSessions: boolean): number {
  const window = clipWindow(state, date);
  const day = state.days[weekdayIndex(date)];
  if (!window || !day?.enabled) return 0;
  let free: [number, number][] = [window];
  for (const block of busyBlocks(state, date, { includeSessions })) free = subtract(free, block);
  return free.reduce((sum, [a, b]) => sum + Math.max(0, b - a), 0);
}

// الوقت الذي يستطيع الطالب الدراسة فيه فعليًا. لا نخلط هنا بين "الوقت المتاح"
// وبين هدف الدراسة أو الحد اليومي أو الحصص التي تم جدولتها بالفعل.
export function availableStudyMinutes(state: AppState, date: string): number {
  return freeMinutesAfter(state, date, false);
}

// الوقت المتبقي لإضافة حصص جديدة، بعد حجز الحصص الموجودة.
export function schedulableStudyMinutes(state: AppState, date: string): number {
  return freeMinutesAfter(state, date, true);
}

export function scheduledStudyMinutes(state: AppState, date: string): number {
  return state.sessions
    .filter((s) => s.date === date && s.status !== "skipped")
    .reduce((sum, s) => sum + Math.max(0, (minutes(s.end) ?? 0) - (minutes(s.start) ?? 0)), 0);
}

export function studyTimeBreakdown(state: AppState, date: string) {
  const window = clipWindow(state, date);
  const day = state.days[weekdayIndex(date)];
  if (!window || !day?.enabled) return { window: 0, blocked: 0, available: 0, scheduled: scheduledStudyMinutes(state, date), remaining: 0 };
  const windowMinutes = Math.max(0, window[1] - window[0]);
  const available = availableStudyMinutes(state, date);
  return {
    window: windowMinutes,
    blocked: Math.max(0, windowMinutes - available),
    available,
    scheduled: scheduledStudyMinutes(state, date),
    remaining: schedulableStudyMinutes(state, date),
  };
}

function sliceSlots(ranges: [number, number][]): [number, number][] {
  const slots: [number, number][] = [];
  for (const [s, e] of ranges) {
    let t = s;
    while (e - t >= MIN_SLOT) {
      let use = Math.min(PREFER_SLOT, e - t);
      const leftover = e - (t + use + GAP);
      if (leftover > 0 && leftover < MIN_SLOT && use + GAP + leftover <= 80) use = e - t;
      if (use < MIN_SLOT) break;
      slots.push([t, t + use]);
      t = t + use + GAP;
    }
  }
  return slots;
}

function studiedSince(state: AppState, subjectId: string, from: string): number {
  return state.logs
    .filter((l) => l.subjectId === subjectId && l.date >= from)
    .reduce((sum, l) => sum + l.minutes, 0);
}

function lastStudy(state: AppState, subjectId: string): string | null {
  let best: string | null = null;
  for (const l of state.logs) {
    if (l.subjectId === subjectId && (!best || l.date > best)) best = l.date;
  }
  for (const s of state.sessions) {
    if (s.subjectId === subjectId && s.status === "done" && (!best || s.date > best)) best = s.date;
  }
  return best;
}

function nextLesson(state: AppState, subjectId: string): Lesson | undefined {
  return state.lessons
    .filter((l) => l.subjectId === subjectId && l.status !== "mastered")
    .sort((a, b) => (a.nextReview ?? "9999-99-99").localeCompare(b.nextReview ?? "9999-99-99"))[0];
}

function scoreSubject(
  state: AppState,
  sub: Subject,
  today: string,
  counts: Record<string, number>,
  highFocus: boolean,
  inNight: boolean,
): number {
  const weekStart = saturdayOnOrBefore(today);
  const studied = studiedSince(state, sub.id, weekStart);
  const goalGap = Math.max(0, sub.weeklyGoalMin - studied) / 40;
  const last = lastStudy(state, sub.id);
  const neglect = last ? Math.min(14, daysUntil(last, today)) : 8;
  const examBoost = state.exams.some(
    (e) => e.subjectId === sub.id && e.score === undefined && daysUntil(today, e.date) >= 0 && daysUntil(today, e.date) <= 14,
  )
    ? 4
    : 0;
  const lessons = state.lessons.filter((l) => l.subjectId === sub.id && l.status !== "mastered").length;
  let score = sub.coefficient * (0.4 + sub.weakness / 5) + goalGap + neglect * 0.35 + examBoost + lessons * 0.35;
  if (inNight && sub.core) score += 6;
  if (highFocus && sub.core) score += 2;
  score -= (counts[sub.id] ?? 0) * 1.5;
  return score;
}

function taskFor(state: AppState, sub: Subject, highFocus: boolean): string {
  const lesson = nextLesson(state, sub.id);
  if (highFocus && sub.core) return lesson ? `حل مسائل: ${lesson.title}` : "حل مسائل وتمارين";
  if (lesson && lesson.nextReview) return `مراجعة: ${lesson.title}`;
  if (lesson) return `دراسة: ${lesson.title}`;
  return `مراجعة ${sub.name}`;
}

export type PlanResult = {
  sessions: StudySession[];
  warnings: string[];
};

export function generateLocalPlan(state: AppState, dates: string[], replacePlanned = true): PlanResult {
  const warnings: string[] = [];
  const ignore = new Set<string>();
  if (replacePlanned) {
    for (const s of state.sessions) {
      if (s.status === "planned" && dates.includes(s.date)) ignore.add(s.id);
    }
  }
  const placed: StudySession[] = [];
  const virtual: AppState = {
    ...state,
    sessions: state.sessions.filter((s) => !ignore.has(s.id)),
  };

  for (const date of dates) {
    const day = state.days[weekdayIndex(date)];
    if (!day?.enabled) continue;
    if (!state.prayerByDate[date] && !state.settings.allowWithoutPrayer) {
      warnings.push(`${date}: لا مواقيت صلاة، تُرك اليوم فارغًا`);
      continue;
    }
    const window = clipWindow(state, date);
    if (!window) continue;
    let free: [number, number][] = [window];
    for (const block of busyBlocks(virtual, date, { includeSessions: true })) {
      free = subtract(free, block);
    }
    const slots = sliceSlots(free);
    let used = virtual.sessions
      .filter((s) => s.date === date && s.status !== "skipped")
      .reduce((sum, s) => sum + ((minutes(s.end) ?? 0) - (minutes(s.start) ?? 0)), 0);
    const counts: Record<string, number> = {};
    let lastId: string | null = null;
    const night0 = minutes(state.settings.nightStart) ?? 21 * 60;
    const night1 = night0 + state.settings.nightMinutes;

    for (const [a, b] of slots) {
      const budget = day.maxMinutes - used;
      if (budget < MIN_SLOT) break;
      const len = Math.min(b - a, budget);
      if (len < MIN_SLOT) break;
      const start = a;
      const end = a + len;
      const highFocus = start < 12 * 60 || (start >= 16 * 60 && start < 19 * 60);
      const inNight = state.settings.nightEnabled && start < night1 && night0 < end;
      const ranked = state.subjects.map((sub) => ({
        sub,
        score: scoreSubject(virtual, sub, date, counts, highFocus, inNight),
      }));
      const usable = ranked.filter((c) => (counts[c.sub.id] ?? 0) < 2 || ranked.every((x) => (counts[x.sub.id] ?? 0) >= 2));
      usable.sort((x, y) => y.score - x.score);
      if (!usable.length) break;
      let chosen = usable[0]!.sub;
      if (lastId && chosen.id === lastId) {
        const alt = usable.find((s) => s.sub.id !== lastId && s.score >= usable[0]!.score * 0.72);
        if (alt) chosen = alt.sub;
      }
      const session: StudySession = {
        id: uid("ses"),
        date,
        start: hhmm(start),
        end: hhmm(end),
        subjectId: chosen.id,
        task: taskFor(state, chosen, highFocus || inNight),
        status: "planned",
        source: "local",
      };
      placed.push(session);
      virtual.sessions = [...virtual.sessions, session];
      counts[chosen.id] = (counts[chosen.id] ?? 0) + 1;
      lastId = chosen.id;
      used += len;
    }
  }
  if (!placed.length && !warnings.length) warnings.push("لا توجد فترات حرة ضمن الحدود الحالية");
  return { sessions: placed, warnings };
}

export function validateIncoming(
  state: AppState,
  incoming: IncomingSession[],
  opts?: { ignoreIds?: Set<string>; source?: StudySession["source"]; allowConstraintViolations?: boolean },
): { ok: true; sessions: StudySession[] } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const ignore = opts?.ignoreIds ?? new Set<string>();
  const allowConstraintViolations = opts?.allowConstraintViolations ?? false;
  const built: StudySession[] = [];
  const daily = new Map<string, number>();

  for (const s of state.sessions) {
    if (s.status === "skipped" || ignore.has(s.id)) continue;
    const a = minutes(s.start);
    const b = minutes(s.end);
    if (a === null || b === null) continue;
    daily.set(s.date, (daily.get(s.date) ?? 0) + (b - a));
  }

  incoming.forEach((raw, index) => {
    const n = index + 1;
    const fail = (because: string) => errors.push(`الحصة ${n} غير صالحة لأن ${because}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.date) || Number.isNaN(Date.parse(`${raw.date}T00:00:00Z`))) {
      fail(`التاريخ '${raw.date}' غير مفهوم`);
      return;
    }
    const a = minutes(raw.start);
    const b = minutes(raw.end);
    if (a === null || b === null) {
      fail("البداية أو النهاية ليست بصيغة HH:MM");
      return;
    }
    if (b <= a) {
      fail("وقت النهاية ليس بعد البداية");
      return;
    }
    if (b - a < 15) {
      fail("مدتها أقل من 15 دقيقة");
      return;
    }
    const sub = raw.subjectId
      ? state.subjects.find((s) => s.id === raw.subjectId)
      : subjectByName(state, raw.subject ?? "");
    if (!sub) {
      const label = raw.subject || raw.subjectId || "فارغ";
      fail(
        `subject='${label}'. اختر subject من قائمة المواد: ${state.subjects.map((s) => s.name).join("، ")}. وضع الوصف داخل task`,
      );
      return;
    }
    const task = raw.task?.trim() ?? "";
    if (task.length < 2) {
      fail("task فارغ. ضع وصف العمل في task واسم المادة فقط في subject");
      return;
    }
    const window = clipWindow(state, raw.date);
    const day = state.days[weekdayIndex(raw.date)];
    if (!window || !day?.enabled) {
      if (!allowConstraintViolations) {
        fail(`يوم ${raw.date} ليس يوم دراسة`);
        return;
      }
    }
    if (window && (a < window[0] || b > window[1])) {
      if (!allowConstraintViolations) {
        fail(`خارج ساعات الدراسة المسموحة ${hhmm(window[0])}-${hhmm(window[1])}`);
        return;
      }
    }
    if (!state.prayerByDate[raw.date] && !state.settings.allowWithoutPrayer && !allowConstraintViolations) {
      fail("مواقيت الصلاة غير متوفرة لهذا اليوم");
      return;
    }
    for (const block of busyBlocks(state, raw.date)) {
      if (rangesOverlap(a, b, block.start, block.end) && !allowConstraintViolations) {
        fail(`تتقاطع مع فترة ممنوعة ${hhmm(block.start)}-${hhmm(block.end)} ${block.reason}`);
        return;
      }
    }
    for (const other of state.sessions) {
      if (other.date !== raw.date || other.status === "skipped" || ignore.has(other.id)) continue;
      const oa = minutes(other.start);
      const ob = minutes(other.end);
      if (oa === null || ob === null) continue;
      if (rangesOverlap(a, b, oa, ob) && !allowConstraintViolations) {
        fail(`تتعارض مع حصة موجودة ${other.start}-${other.end}`);
        return;
      }
    }
    for (const other of built) {
      if (other.date !== raw.date) continue;
      const oa = minutes(other.start)!;
      const ob = minutes(other.end)!;
      if (rangesOverlap(a, b, oa, ob) && !allowConstraintViolations) {
        fail(`تتعارض مع حصة أخرى في نفس الخطة ${other.start}-${other.end}`);
        return;
      }
    }
    const nextDaily = (daily.get(raw.date) ?? 0) + (b - a);
    if (day && nextDaily > day.maxMinutes && !allowConstraintViolations) {
      fail(`تجاوز الحد اليومي ${day.maxMinutes} دقيقة`);
      return;
    }
    daily.set(raw.date, nextDaily);
    built.push({
      id: uid("ses"),
      date: raw.date,
      start: hhmm(a),
      end: hhmm(b),
      subjectId: sub.id,
      task,
      status: "planned",
      source: raw.source ?? opts?.source ?? "ai",
    });
  });

  if (errors.length) return { ok: false, errors };
  return { ok: true, sessions: built };
}

export type ReverseInput = {
  from: string;
  until: string;
  lessonIds: string[];
  extra: { subjectId: string; minutes: number }[];
};

export function planReverse(state: AppState, input: ReverseInput): PlanResult & { unplaced: number } {
  const dates: string[] = [];
  if (daysUntil(input.from, input.until) < 0) return { sessions: [], warnings: ["تاريخ النهاية قبل البداية"], unplaced: 0 };
  for (let d = input.from; daysUntil(d, input.until) >= 0; d = addDays(d, 1)) dates.push(d);
  const items: { subjectId: string; task: string; minutes: number }[] = [];
  for (const id of input.lessonIds) {
    const lesson = state.lessons.find((l) => l.id === id);
    if (!lesson) continue;
    items.push({ subjectId: lesson.subjectId, task: `إنهاء: ${lesson.title}`, minutes: 40 });
  }
  for (const extra of input.extra) {
    let left = extra.minutes;
    const name = subjectName(state, extra.subjectId);
    while (left >= MIN_SLOT) {
      const take = Math.min(50, left);
      items.push({ subjectId: extra.subjectId, task: `تقدم في ${name}`, minutes: take });
      left -= take;
    }
  }
  const slots = generateLocalPlan(state, dates, true).sessions;
  const sessions: StudySession[] = [];
  const usedSlots = new Set<string>();
  let unplaced = 0;
  for (const item of items) {
    const slot = slots.find((s) => !usedSlots.has(s.id) && s.subjectId === item.subjectId) ?? slots.find((s) => !usedSlots.has(s.id));
    if (!slot) {
      unplaced += 1;
      continue;
    }
    usedSlots.add(slot.id);
    const startMin = minutes(slot.start) ?? 0;
    const slotEnd = minutes(slot.end) ?? startMin;
    const desiredEnd = Math.min(slotEnd, startMin + Math.max(item.minutes, MIN_SLOT));
    sessions.push({
      ...slot,
      id: uid("ses"),
      end: hhmm(desiredEnd),
      subjectId: item.subjectId,
      task: item.task,
      source: "review",
    });
  }
  const warnings: string[] = [];
  if (unplaced) warnings.push(`${unplaced} مهمة لم تجد وقتًا قبل الموعد`);
  if (!sessions.length) warnings.push("لا وقت حر كافٍ قبل الموعد");
  return { sessions, warnings, unplaced };
}

export function replacePlanned(state: AppState, dates: string[], sessions: StudySession[]): AppState {
  const set = new Set(dates);
  const kept = state.sessions.filter((s) => !(set.has(s.date) && s.status === "planned"));
  return { ...state, sessions: [...kept, ...sessions] };
}
