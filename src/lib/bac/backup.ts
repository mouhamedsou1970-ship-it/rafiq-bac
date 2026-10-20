import { normalizeState } from "./storage";
import type { AppState } from "./types";

export function exportBackup(state: AppState, includeKeys: boolean): string {
  const copy = structuredClone(state);
  if (!includeKeys) { copy.settings.ai.apiKey = ""; copy.settings.ai.fallback.apiKey = ""; }
  return JSON.stringify(
    { app: "rafiq-bac", version: 1, exportedAt: new Date().toISOString(), state: copy },
    null,
    2,
  );
}

export function parseBackup(text: string): AppState {
  const parsed = JSON.parse(text) as { state?: unknown };
  return normalizeState(parsed && typeof parsed === "object" && "state" in parsed ? parsed.state : parsed);
}
