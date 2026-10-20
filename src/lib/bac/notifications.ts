import type { AppState } from "./types";

const SENT_KEY = "rafiq-notifications-sent-v1";

export function notificationSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!notificationSupported()) return "unsupported";
  return Notification.requestPermission();
}

function sentSet(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SENT_KEY) || "[]") as string[]); } catch { return new Set(); }
}

export function checkStudyNotifications(state: AppState, now = new Date()) {
  if (!state.settings.notificationsEnabled) return;
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Algiers", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Algiers", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  const [h, m] = time.split(":").map(Number);
  const current = h * 60 + m;
  const sent = sentSet(); let changed = false;
  for (const session of state.sessions) {
    if (session.date !== date || session.status !== "planned") continue;
    const [sh, sm] = session.start.split(":").map(Number); const delta = sh * 60 + sm - current;
    if (delta < 0 || delta > state.settings.reminderMinutes) continue;
    const key = `${session.id}:${session.date}:${session.start}:${state.settings.reminderMinutes}`;
    if (sent.has(key)) continue;
    const subject = state.subjects.find((x) => x.id === session.subjectId)?.name ?? "حصة دراسة";
    window.dispatchEvent(new CustomEvent("rafiq:study-reminder", { detail: { title: `📚 ${subject}${delta > 0 ? ` بعد ${delta} د` : " الآن"}`, message: `${session.task} · ${session.start}–${session.end}`, code: key } }));
    if (notificationSupported() && Notification.permission === "granted") new Notification(`📚 ${subject}${delta > 0 ? ` بعد ${delta} د` : " الآن"}`, { body: `${session.task} · ${session.start}–${session.end}`, tag: key });
    sent.add(key); changed = true;
  }
  if (changed) localStorage.setItem(SENT_KEY, JSON.stringify([...sent].slice(-120)));
}


export async function sendTestNotification(delayMs = 0): Promise<NotificationPermission | "unsupported"> {
  if (!notificationSupported()) return "unsupported";
  let permission = Notification.permission;
  if (permission !== "granted") permission = await Notification.requestPermission();
  if (permission !== "granted") return permission;
  const show = () => new Notification("🔔 اختبار إشعارات رفيق البكالوريا", {
    body: "إذا ظهر هذا الإشعار فإشعارات المتصفح تعمل على جهازك.",
    tag: `rafiq-test-${Date.now()}`,
  });
  if (delayMs > 0) window.setTimeout(show, delayMs); else show();
  return "granted";
}
