import { useSyncExternalStore } from "react";
import { chime, primeAudio } from "./audio";
import { defaultState } from "./defaults";
import { fetchPrayerMonth } from "./prayer";
import { storageBackend, storageLoad, storageSave } from "./storage";
import type { AppState, FocusState, PlannerPane, TabId } from "./types";
import { algiersNow, uid } from "./time";

export type Snapshot = {
  ready: boolean;
  state: AppState;
  tab: TabId;
  plannerPane: PlannerPane;
  toast: string | null;
  undoCount: number;
  backend: string;
  aiLessonId: string | null;
};

const serverSnap: Snapshot = {
  ready: false,
  state: defaultState(),
  tab: "home",
  plannerPane: "local",
  toast: null,
  undoCount: 0,
  backend: "",
  aiLessonId: null,
};

let snap: Snapshot = serverSnap;
let undo: string[] = [];
const listeners = new Set<() => void>();
let toastTimer = 0;
let booting: Promise<void> | null = null;

function emit() {
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot() {
  return snap;
}

export function getServerSnapshot() {
  return serverSnap;
}

export function useApp() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function commit(next: AppState, undoable: boolean) {
  if (undoable) undo = [...undo.slice(-19), JSON.stringify(snap.state)];
  snap = { ...snap, state: next, undoCount: undo.length };
  emit();
  storageSave(next);
}

export function patch(recipe: (state: AppState) => AppState, undoable = true) {
  commit(recipe(snap.state), undoable);
}

export function replaceState(next: AppState, undoable = true) {
  commit(next, undoable);
}

export function toast(message: string) {
  snap = { ...snap, toast: message };
  emit();
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    if (snap.toast === message) {
      snap = { ...snap, toast: null };
      emit();
    }
  }, 3400);
}

export function setTab(tab: TabId) {
  snap = { ...snap, tab };
  emit();
}


export function openLessonInAi(lessonId: string) {
  const now = new Date().toISOString();
  const id = uid("chat");
  const lesson = snap.state.lessons.find((l) => l.id === lessonId);
  const next = { ...snap.state, activeChatId: id, chats: [{ id, title: lesson?.title ? `درس: ${lesson.title}` : "محادثة حول درس", createdAt: now, updatedAt: now, messages: [], lessonId }, ...snap.state.chats].slice(0, 80) };
  commit(next, false);
  snap = { ...snap, aiLessonId: lessonId, tab: "ai" };
  emit();
}

export function clearAiLesson() {
  if (!snap.aiLessonId) return;
  snap = { ...snap, aiLessonId: null };
  emit();
}

export function setPlannerPane(plannerPane: PlannerPane) {
  snap = { ...snap, plannerPane, tab: "planner" };
  emit();
}

export function undoLast() {
  const prev = undo.pop();
  if (!prev) return;
  const state = JSON.parse(prev) as AppState;
  snap = { ...snap, state, undoCount: undo.length };
  emit();
  storageSave(state);
  toast("تم التراجع");
}

export function focusRemaining(now = Date.now()): number {
  const focus = snap.state.focus;
  if (!focus) return 0;
  const extra = focus.pauseStartedAt ? now - focus.pauseStartedAt : 0;
  const elapsed = now - focus.startedAt - focus.pausedAccumMs - extra;
  return Math.max(0, focus.durationSec * 1000 - elapsed);
}

export function startFocus(input: {
  sessionId?: string | null;
  subjectId: string;
  task: string;
  lessonId?: string;
  minutes: number;
}) {
  primeAudio();
  const focus: FocusState = {
    sessionId: input.sessionId ?? null,
    subjectId: input.subjectId,
    task: input.task,
    lessonId: input.lessonId,
    durationSec: Math.round(input.minutes * 60),
    startedAt: Date.now(),
    pausedAccumMs: 0,
    pauseStartedAt: null,
  };
  commit({ ...snap.state, focus }, true);
  setTab("timer");
}

let finishing = false;

export function finishFocus(natural: boolean) {
  const focus = snap.state.focus;
  if (!focus || finishing) return;
  finishing = true;
  try {
    const now = Date.now();
    const extra = focus.pauseStartedAt ? now - focus.pauseStartedAt : 0;
    const elapsed = Math.min(focus.durationSec * 1000, Math.max(0, now - focus.startedAt - focus.pausedAccumMs - extra));
    const mins = Math.max(1, Math.round(elapsed / 60_000));
    const today = algiersNow();
    const sessions = focus.sessionId
      ? snap.state.sessions.map((s) => (s.id === focus.sessionId ? { ...s, status: "done" as const, actualMinutes: mins } : s))
      : snap.state.sessions;
    commit(
      {
        ...snap.state,
        focus: null,
        sessions,
        logs: [
          ...snap.state.logs,
          {
            id: uid("log"),
            at: new Date().toISOString(),
            date: today.date,
            subjectId: focus.subjectId,
            minutes: mins,
            task: focus.task,
            kind: "focus" as const,
            lessonId: focus.lessonId,
            sessionId: focus.sessionId ?? undefined,
          },
        ].slice(-500),
      },
      true,
    );
    if (natural) chime();
    toast("سُجّلت الحصة في السجل");
  } finally {
    finishing = false;
  }
}

export function maybeFinishFocus(now = Date.now()) {
  const focus = snap.state.focus;
  if (!focus || focus.pauseStartedAt) return;
  if (focusRemaining(now) > 0) return;
  finishFocus(true);
}

export function pauseFocus() {
  const focus = snap.state.focus;
  if (!focus || focus.pauseStartedAt) return;
  commit({ ...snap.state, focus: { ...focus, pauseStartedAt: Date.now() } }, false);
}

export function resumeFocus() {
  const focus = snap.state.focus;
  if (!focus?.pauseStartedAt) return;
  commit(
    {
      ...snap.state,
      focus: {
        ...focus,
        pausedAccumMs: focus.pausedAccumMs + (Date.now() - focus.pauseStartedAt),
        pauseStartedAt: null,
      },
    },
    false,
  );
}

export async function refreshPrayer(force: boolean) {
  const now = algiersNow();
  const [year, month] = now.date.split("-").map(Number);
  try {
    const monthData = await fetchPrayerMonth(year ?? 2026, month ?? 1);
    let extra: Record<string, AppState["prayerByDate"][string]> = {};
    try {
      if ((month ?? 1) === 12) extra = await fetchPrayerMonth((year ?? 2026) + 1, 1);
      else if ((now.date.slice(8, 10) ?? "01") >= "24") extra = await fetchPrayerMonth(year ?? 2026, (month ?? 1) + 1);
    } catch {
      extra = {};
    }
    patch((s) => {
      if (s.prayerLocked && !force) return s;
      return { ...s, prayerByDate: { ...s.prayerByDate, ...monthData, ...extra }, prayerLocked: force ? false : s.prayerLocked };
    }, false);
    toast("حُفظت مواقيت الوادي");
  } catch (error) {
    toast(error instanceof Error ? error.message : "تعذّر تحديث الصلاة");
  }
}

export function initStore() {
  if (booting) return booting;
  booting = (async () => {
    const loaded = await storageLoad();
    snap = { ...snap, ready: true, state: loaded, backend: storageBackend };
    emit();
    const today = algiersNow().date;
    if (!loaded.prayerLocked && !loaded.prayerByDate[today]) void refreshPrayer(false);
    if (storageBackend === "memory") toast("تعذّر الحفظ الدائم هنا. صدّر نسخة قبل إغلاق الصفحة.");
  })();
  return booting;
}

export function pushChat(role: "user" | "assistant", text: string) {
  patch(
    (s) => ({
      ...s,
      chat: [...s.chat, { id: uid("msg"), role, text, at: new Date().toISOString() }].slice(-40),
    }),
    false,
  );
}

export function newChat(lessonId?: string) {
  const now = new Date().toISOString();
  const id = uid("chat");
  patch((s) => ({
    ...s,
    activeChatId: id,
    chats: [{ id, title: lessonId ? "محادثة حول درس" : "محادثة جديدة", createdAt: now, updatedAt: now, messages: [], ...(lessonId ? { lessonId } : {}) }, ...s.chats].slice(0, 80),
  }), false);
  return id;
}

export function selectChat(id: string) {
  patch((s) => ({ ...s, activeChatId: s.chats.some((c) => c.id === id) ? id : s.activeChatId }), false);
}

export function deleteChat(id: string) {
  patch((s) => ({ ...s, chats: s.chats.filter((c) => c.id !== id), activeChatId: s.activeChatId === id ? null : s.activeChatId }), false);
}

export function renameChat(id: string, title: string) {
  const clean = title.trim().slice(0, 70);
  if (!clean) return;
  patch((s) => ({ ...s, chats: s.chats.map((c) => c.id === id ? { ...c, title: clean, updatedAt: new Date().toISOString() } : c) }), false);
}

export function pushThreadMessage(chatId: string, role: "user" | "assistant", text: string) {
  const now = new Date().toISOString();
  patch((s) => ({
    ...s,
    chats: s.chats.map((c) => {
      if (c.id !== chatId) return c;
      const messages = [...c.messages, { id: uid("msg"), role, text, at: now }].slice(-80);
      const title = c.messages.length === 0 && role === "user" ? text.replace(/\s+/g, " ").trim().slice(0, 42) || c.title : c.title;
      return { ...c, messages, title, updatedAt: now };
    }),
  }), false);
}

export function clearAssistantMemory() {
  patch((s) => ({ ...s, assistantMemory: { ...s.assistantMemory, summary: "", updatedAt: new Date().toISOString() } }), false);
}

export function setAssistantMemory(summary: string) {
  patch((s) => ({ ...s, assistantMemory: { ...s.assistantMemory, summary: summary.slice(0, 3000), updatedAt: new Date().toISOString() } }), false);
}

export function addNotification(input: { kind: "ai" | "study" | "system" | "exam"; title: string; message: string; code?: string; provider?: AppState["settings"]["ai"]["provider"]; model?: string }) {
  patch((s) => ({ ...s, notifications: [{ id: uid("note"), at: new Date().toISOString(), read: false, ...input }, ...s.notifications].slice(0, 300) }), false);
}
export function markNotificationRead(id: string) { patch((s) => ({ ...s, notifications: s.notifications.map(n => n.id === id ? { ...n, read: true } : n) }), false); }
export function markAllNotificationsRead() { patch((s) => ({ ...s, notifications: s.notifications.map(n => ({ ...n, read: true })) }), false); }
export function clearNotifications() { patch((s) => ({ ...s, notifications: [] }), false); }
