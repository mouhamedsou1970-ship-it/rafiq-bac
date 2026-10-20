import type { AppState } from "./types";

const BASE = "/__rafiq/termux-notifications";

export type TermuxBridgeStatus = { ok: boolean; bridge?: boolean; reminders?: number; sent?: number; error?: string };

async function bridgeFetch(path: string, init?: RequestInit) {
  const response = await fetch(`${BASE}${path}`, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function getTermuxBridgeStatus(): Promise<TermuxBridgeStatus> {
  try { return await bridgeFetch("/status"); } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}

export async function sendTermuxTestNotification() {
  return bridgeFetch("/test", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
}

function algiersTimestamp(date: string, time: string): number {
  // Algeria is UTC+1 year-round. Construct explicitly so device timezone cannot shift study sessions.
  const iso = `${date}T${time}:00+01:00`;
  return new Date(iso).getTime();
}

export async function syncTermuxStudyReminders(state: AppState) {
  const minutes = Math.max(0, Number(state.settings.reminderMinutes) || 0);
  const reminders = state.settings.notificationsEnabled ? state.sessions
    .filter((s) => s.status === "planned")
    .map((session) => {
      const subject = state.subjects.find((x) => x.id === session.subjectId)?.name ?? "حصة دراسة";
      const at = algiersTimestamp(session.date, session.start) - minutes * 60_000;
      return {
        id: `rafiq-${session.id}-${session.date}-${session.start}-${minutes}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
        at,
        title: `📚 ${subject} بعد ${minutes} د`,
        content: `${session.task} · ${session.start}–${session.end}`,
      };
    })
    .filter((r) => Number.isFinite(r.at) && r.at > Date.now() - 12 * 60 * 60 * 1000)
    : [];
  return bridgeFetch("/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reminders }) });
}
