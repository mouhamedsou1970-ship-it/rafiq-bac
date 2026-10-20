import type { AppState, DayConfig, Subject } from "./types.ts";
import { DEFAULT_CURRICULUM, mergeCurriculum } from "./curriculum.ts";
import { DEFAULT_BRANCH_ID, profileForBranch, subjectsForBranch } from "./branches.ts";

export const STYLES = [
  { id: "glass", name: "زجاج", blurb: "بطاقات شفافة وضوء منعكس" },
  { id: "minimal", name: "مبسط", blurb: "سطح نظيف بلا ظلال" },
  { id: "aurora", name: "شفق", blurb: "خلفية مضيئة تتحرك بهدوء" },
  { id: "neo", name: "نيون", blurb: "حدود مضيئة وحواف حادة" },
  { id: "paper", name: "دفتر", blurb: "ورق دراسة وحافة تجليد" },
  { id: "focus", name: "تركيز", blurb: "هدوء، خط أوضح، بلا زخرفة" },
  { id: "dynamic", name: "حيوي", blurb: "الخلفية تتبع تقدم اليوم" },
] as const;

export const PALETTES = [
  { id: "oasis", name: "واحة" },
  { id: "ink", name: "حبر" },
  { id: "dawn", name: "فجر" },
  { id: "night", name: "ليل" },
  { id: "emerald", name: "زمرد" },
  { id: "sand", name: "رمل" },
  { id: "sea", name: "بحر" },
  { id: "amber", name: "عنبر" },
  { id: "iris", name: "سوسن" },
  { id: "frost", name: "صقيع" },
] as const;

const day = (enabled: boolean, start: string, end: string, maxMinutes: number): DayConfig => ({
  enabled,
  start,
  end,
  maxMinutes,
});

export const DEFAULT_SUBJECTS: Subject[] = subjectsForBranch(DEFAULT_BRANCH_ID);

export function defaultState(): AppState {
  return {
    schema: 1,
    subjects: DEFAULT_SUBJECTS.map((s) => ({ ...s })),
    curriculum: DEFAULT_CURRICULUM.map((u) => ({ ...u })),
    studyProfile: profileForBranch(DEFAULT_BRANCH_ID),
    days: [
      day(true, "14:00", "22:00", 240),
      day(true, "14:00", "22:00", 240),
      day(true, "14:00", "22:00", 240),
      day(true, "14:00", "22:00", 240),
      day(true, "14:00", "22:00", 180),
      day(true, "15:30", "21:30", 180),
      day(true, "08:30", "21:30", 360),
    ],
    commitments: [
      {
        id: "com-school",
        name: "المدرسة",
        days: [0, 1, 2, 3, 4],
        start: "08:00",
        end: "12:15",
      },
    ],
    sessions: [],
    lessons: [],
    logs: [],
    exams: [],
    quizAttempts: [],
    errors: [],
    notifications: [],
    chat: [],
    chats: [],
    activeChatId: null,
    assistantMemory: { enabled: true, summary: "" },
    prayerByDate: {},
    prayerBufferBefore: 10,
    prayerBufferAfter: 15,
    prayerLocked: false,
    settings: {
      bacDate: "2027-06-06",
      branchId: DEFAULT_BRANCH_ID,
      wake: "06:30",
      sleep: "23:00",
      nightEnabled: false,
      nightStart: "21:00",
      nightMinutes: 50,
      allowWithoutPrayer: false,
      style: "paper",
      palette: "oasis",
      mode: "auto",
      customPrimary: "",
      ai: {
        provider: "gemini",
        apiKey: "",
        model: "gemini-2.5-flash",
        fastModel: "gemini-2.0-flash",
        endpoint: "",
        fallback: { enabled: false, provider: "gemini", apiKey: "", model: "", fastModel: "", endpoint: "" },
      },
      includeKeysInBackup: false,
      notificationsEnabled: false,
      reminderMinutes: 10,
    },
    focus: null,
  };
}

export function createState(partial: Partial<AppState> = {}): AppState {
  const base = defaultState();
  return {
    ...base,
    ...partial,
    subjects: partial.subjects ?? base.subjects,
    curriculum: mergeCurriculum(partial.curriculum).filter((unit) => (partial.subjects ?? base.subjects).some((subject) => subject.id === unit.subjectId)),
    studyProfile: { ...base.studyProfile, ...partial.studyProfile },
    days: partial.days ?? base.days,
    commitments: partial.commitments ?? base.commitments,
    sessions: partial.sessions ?? base.sessions,
    lessons: partial.lessons ?? base.lessons,
    logs: partial.logs ?? base.logs,
    exams: partial.exams ?? base.exams,
    quizAttempts: partial.quizAttempts ?? base.quizAttempts,
    errors: partial.errors ?? base.errors,
    notifications: partial.notifications ?? base.notifications,
    chat: partial.chat ?? base.chat,
    chats: partial.chats ?? base.chats,
    activeChatId: partial.activeChatId ?? base.activeChatId,
    assistantMemory: { ...base.assistantMemory, ...partial.assistantMemory },
    prayerByDate: partial.prayerByDate ?? base.prayerByDate,
    settings: {
      ...base.settings,
      ...partial.settings,
      ai: { ...base.settings.ai, ...partial.settings?.ai, fallback: { ...base.settings.ai.fallback, ...partial.settings?.ai?.fallback } },
    },
  };
}

export function lessonStatusLabel(status: string): string {
  if (status === "memorizing") return "أحفظه";
  if (status === "review") return "مراجعة";
  if (status === "mastered") return "متقن";
  return "لم أبدأ";
}
