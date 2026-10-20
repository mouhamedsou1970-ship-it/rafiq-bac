import { createState, defaultState } from "./defaults";
import type { AppState } from "./types";

const DB_NAME = "rafiq-bac";
const STORE = "kv";
const KEY = "state";
const LS_KEY = "rafiq-bac-state";

export type StorageBackend = "indexeddb" | "localstorage" | "memory";
export let storageBackend: StorageBackend = "memory";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("no-idb"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb"));
  });
}

function idbGet(db: IDBDatabase): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve(typeof req.result === "string" ? req.result : null);
    req.onerror = () => reject(req.error ?? new Error("idb-get"));
  });
}

function idbSet(db: IDBDatabase, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("idb-set"));
  });
}

export function normalizeState(raw: unknown): AppState {
  const base = defaultState();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Partial<AppState>;
  const days = Array.isArray(o.days) && o.days.length === 7 ? o.days : base.days;
  const subjects = Array.isArray(o.subjects) && o.subjects.length > 0 ? o.subjects : base.subjects;
  return createState({
    ...base,
    ...o,
    schema: 1,
    days,
    subjects,
    commitments: Array.isArray(o.commitments) ? o.commitments : base.commitments,
    sessions: Array.isArray(o.sessions) ? o.sessions : [],
    lessons: Array.isArray(o.lessons) ? o.lessons : [],
    logs: Array.isArray(o.logs) ? o.logs : [],
    exams: Array.isArray(o.exams) ? o.exams : [],
    quizAttempts: Array.isArray(o.quizAttempts) ? o.quizAttempts.slice(-100) : [],
    errors: Array.isArray(o.errors) ? o.errors : [],
    notifications: Array.isArray(o.notifications) ? o.notifications.slice(-300) : [],
    chat: Array.isArray(o.chat) ? o.chat.slice(-40) : [],
    chats: Array.isArray(o.chats) && o.chats.length ? o.chats : (Array.isArray(o.chat) && o.chat.length ? [{ id: "chat-legacy", title: "المحادثة السابقة", createdAt: o.chat[0]?.at ?? new Date().toISOString(), updatedAt: o.chat[o.chat.length - 1]?.at ?? new Date().toISOString(), messages: o.chat.slice(-80) }] : []),
    activeChatId: typeof o.activeChatId === "string" ? o.activeChatId : (Array.isArray(o.chat) && o.chat.length ? "chat-legacy" : null),
    assistantMemory: o.assistantMemory && typeof o.assistantMemory === "object" ? o.assistantMemory : base.assistantMemory,
    prayerByDate: o.prayerByDate && typeof o.prayerByDate === "object" ? o.prayerByDate : {},
    prayerBufferBefore: o.prayerBufferBefore ?? base.prayerBufferBefore,
    prayerBufferAfter: o.prayerBufferAfter ?? base.prayerBufferAfter,
    prayerLocked: Boolean(o.prayerLocked),
    settings: {
      ...base.settings,
      ...o.settings,
      ai: { ...base.settings.ai, ...o.settings?.ai, fallback: { ...base.settings.ai.fallback, ...o.settings?.ai?.fallback } },
    },
    focus: o.focus ?? null,
  });
}

function readLocal(): string | null {
  try {
    return localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
}

function writeLocal(text: string) {
  try {
    localStorage.setItem(LS_KEY, text);
    return true;
  } catch {
    return false;
  }
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = openDb().catch(() => null);
  }
  return dbPromise;
}

export async function storageLoad(): Promise<AppState> {
  const database = await db();
  if (database) {
    try {
      const text = await idbGet(database);
      if (text) {
        storageBackend = "indexeddb";
        return normalizeState(JSON.parse(text));
      }
    } catch {
      /* fall through */
    }
  }
  const local = readLocal();
  if (local) {
    storageBackend = "localstorage";
    try {
      return normalizeState(JSON.parse(local));
    } catch {
      return defaultState();
    }
  }
  storageBackend = database ? "indexeddb" : readLocal() !== null ? "localstorage" : "memory";
  if (!database) {
    try {
      localStorage.setItem(LS_KEY + "-probe", "1");
      localStorage.removeItem(LS_KEY + "-probe");
      storageBackend = "localstorage";
    } catch {
      storageBackend = "memory";
    }
  }
  return defaultState();
}

let queue: Promise<void> = Promise.resolve();

export function storageSave(state: AppState): void {
  const text = JSON.stringify(state);
  queue = queue
    .then(async () => {
      const database = await db();
      let wrote = false;
      if (database) {
        try {
          await idbSet(database, text);
          storageBackend = "indexeddb";
          wrote = true;
        } catch {
          wrote = false;
        }
      }
      const localOk = writeLocal(text);
      if (!wrote && localOk) storageBackend = "localstorage";
      if (!wrote && !localOk) storageBackend = "memory";
    })
    .catch(() => undefined);
}
