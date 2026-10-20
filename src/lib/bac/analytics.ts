import type { AppState, Subject } from "./types";
import { addDays, daysUntil, minutes, saturdayOnOrBefore } from "./time";

export function subjectMinutes(state: AppState, subjectId: string, from: string, to: string): number {
  return state.logs
    .filter((l) => l.subjectId === subjectId && l.date >= from && l.date <= to)
    .reduce((sum, l) => sum + l.minutes, 0);
}

export function todayActual(state: AppState, today: string): number {
  return state.logs.filter((l) => l.date === today).reduce((sum, l) => sum + l.minutes, 0);
}

export function daySessionMinutes(state: AppState, date: string, status?: "planned" | "done" | "skipped"): number {
  return state.sessions
    .filter((s) => s.date === date && (!status || s.status === status))
    .reduce((sum, s) => sum + Math.max(0, (minutes(s.end) ?? 0) - (minutes(s.start) ?? 0)), 0);
}

export function neglected(state: AppState, today: string): Subject[] {
  const week = saturdayOnOrBefore(today);
  return state.subjects.filter((sub) => {
    const studied = subjectMinutes(state, sub.id, week, addDays(week, 6));
    const last = state.logs.filter((l) => l.subjectId === sub.id).map((l) => l.date).sort().at(-1);
    const stale = Boolean(last) && daysUntil(last as string, today) >= 5;
    const behind = sub.weeklyGoalMin > 0 && studied < sub.weeklyGoalMin * 0.25 && daysUntil(week, today) >= 3;
    return stale || behind;
  });
}

export function adherence(state: AppState, today: string): number | null {
  const start = saturdayOnOrBefore(today);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i)).filter((d) => d <= today);
  let planned = 0;
  let done = 0;
  for (const date of dates) {
    for (const s of state.sessions) {
      if (s.date !== date) continue;
      const len = Math.max(0, (minutes(s.end) ?? 0) - (minutes(s.start) ?? 0));
      if (s.status === "skipped") continue;
      planned += len;
      if (s.status === "done") done += s.actualMinutes ?? len;
    }
  }
  if (planned <= 0) return null;
  return Math.round((done / planned) * 100);
}

export function weeklyBars(state: AppState, today: string): { label: string; minutes: number }[] {
  const start = saturdayOnOrBefore(today);
  const names = ["سب", "أح", "إث", "ثل", "أر", "خم", "جم"];
  return names.map((label, i) => {
    const date = addDays(start, i);
    return {
      label,
      minutes: state.logs.filter((l) => l.date === date).reduce((sum, l) => sum + l.minutes, 0),
    };
  });
}

export function averageMastery(state: AppState): number | null {
  const scored = state.lessons.filter((l) => l.lastReview);
  if (!scored.length) return null;
  return Math.round(scored.reduce((sum, l) => sum + l.mastery, 0) / scored.length);
}

export function missedCount(state: AppState, today: string): number {
  return state.sessions.filter((s) => s.status === "planned" && s.date < today).length;
}

export function leastStudied(state: AppState, today: string): Subject | null {
  const start = saturdayOnOrBefore(today);
  let pick: Subject | null = null;
  let best = Infinity;
  for (const sub of state.subjects) {
    const m = subjectMinutes(state, sub.id, start, today);
    if (m < best) {
      best = m;
      pick = sub;
    }
  }
  return pick;
}

export function mostSkipped(state: AppState): Subject | null {
  const counts = new Map<string, number>();
  for (const s of state.sessions) {
    if (s.status !== "skipped") continue;
    counts.set(s.subjectId, (counts.get(s.subjectId) ?? 0) + 1);
  }
  let id = "";
  let n = 0;
  for (const [k, v] of counts) {
    if (v > n) {
      id = k;
      n = v;
    }
  }
  return state.subjects.find((s) => s.id === id) ?? null;
}

export function nextReviewDays(mastery: number, previous: number[] = []): number {
  if (mastery < 50) return 1;
  if (mastery < 70) return 2;
  const recent = [...previous.slice(-3), mastery];
  const strongStreak = [...recent].reverse().findIndex((score) => score < 85);
  const streak = strongStreak === -1 ? recent.length : strongStreak;
  if (mastery < 85) return 4;
  if (mastery < 95) return streak >= 3 ? 10 : streak >= 2 ? 7 : 4;
  return streak >= 3 ? 30 : streak >= 2 ? 21 : 14;
}

export function statusFromMastery(mastery: number): "memorizing" | "review" | "mastered" {
  if (mastery >= 85) return "mastered";
  if (mastery >= 45) return "review";
  return "memorizing";
}
