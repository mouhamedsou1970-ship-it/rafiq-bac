export type StyleId =
  | "glass"
  | "minimal"
  | "aurora"
  | "neo"
  | "paper"
  | "focus"
  | "dynamic";

export type PaletteId =
  | "oasis"
  | "ink"
  | "dawn"
  | "night"
  | "emerald"
  | "sand"
  | "sea"
  | "amber"
  | "iris"
  | "frost";

export type ModeId = "light" | "dark" | "auto";
export type LessonStatus = "new" | "memorizing" | "review" | "mastered";
export type SessionStatus = "planned" | "done" | "skipped";
export type AiProvider = "gemini" | "openrouter" | "xai" | "custom";

export type AiEndpointSettings = { provider: AiProvider; apiKey: string; model: string; fastModel: string; endpoint: string };
export type AiFallbackSettings = AiEndpointSettings & { enabled: boolean };

export type AppNotification = {
  id: string;
  at: string;
  kind: "ai" | "study" | "system" | "exam";
  title: string;
  message: string;
  read: boolean;
  code?: string;
  provider?: AiProvider;
  model?: string;
};
export type LogKind = "focus" | "memorize" | "exam" | "manual";

export type CurriculumStatus = "not_started" | "learning" | "practice" | "review" | "mastered";

export type CurriculumUnit = {
  id: string;
  subjectId: string;
  order: number;
  title: string;
  status: CurriculumStatus;
  targetDate?: string;
  source?: string;
  verified?: boolean;
};

export type StudyProfile = {
  oneCorePerDay: boolean;
  coreSubjectIds: string[];
  coreDailyMin: number;
  secondaryDailyMin: number;
  reserveMin: number;
};

export type Subject = {
  id: string;
  name: string;
  coefficient: number;
  weakness: number;
  weeklyGoalMin: number;
  core: boolean;
};

export type DayConfig = {
  enabled: boolean;
  start: string;
  end: string;
  maxMinutes: number;
};

export type Commitment = {
  id: string;
  name: string;
  days: number[];
  start: string;
  end: string;
};

export type PrayerDay = {
  fajr: string;
  sunrise: string;
  dhuhr: string;
  asr: string;
  maghrib: string;
  isha: string;
  source: "api" | "manual";
};

export type StudySession = {
  id: string;
  date: string;
  start: string;
  end: string;
  subjectId: string;
  task: string;
  status: SessionStatus;
  actualMinutes?: number;
  source: "local" | "ai" | "manual" | "review";
};

export type FlashCard = { id: string; front: string; back: string };

export type Lesson = {
  id: string;
  subjectId: string;
  title: string;
  body: string;
  status: LessonStatus;
  mastery: number;
  lastReview: string | null;
  nextReview: string | null;
  updatedAt: string;
  weakPoints: string[];
  cards?: FlashCard[];
  reviewHistory?: { at: string; mastery: number }[];
};

export type StudyLog = {
  id: string;
  at: string;
  date: string;
  subjectId: string;
  minutes: number;
  task: string;
  kind: LogKind;
  lessonId?: string;
  mastery?: number;
  sessionId?: string;
};

export type QuizAttempt = {
  id: string;
  unitId: string;
  subjectId: string;
  unitTitle: string;
  at: string;
  score: number;
  total: number;
  questions: { q: string; choices: string[]; answer: number; explanation: string; selected?: number }[];
};

export type ExamItem = {
  id: string;
  subjectId: string;
  title: string;
  date: string;
  lessonIds: string[];
  score?: number;
  takenAt?: string;
  durationMinutes?: number;
};

export type ErrorLogItem = {
  id: string;
  at: string;
  date: string;
  subjectId: string;
  lessonId?: string;
  concept: string;
  kind: "exam" | "memorize" | "review";
  note: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: string;
};

export type ChatThread = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  lessonId?: string;
};

export type AssistantMemory = {
  enabled: boolean;
  summary: string;
  updatedAt?: string;
};

export type FocusState = {
  sessionId: string | null;
  subjectId: string;
  task: string;
  lessonId?: string;
  durationSec: number;
  startedAt: number;
  pausedAccumMs: number;
  pauseStartedAt: number | null;
};

export type AiSettings = AiEndpointSettings & { fallback: AiFallbackSettings };

export type AppState = {
  schema: 1;
  subjects: Subject[];
  curriculum: CurriculumUnit[];
  studyProfile: StudyProfile;
  days: DayConfig[];
  commitments: Commitment[];
  sessions: StudySession[];
  lessons: Lesson[];
  logs: StudyLog[];
  exams: ExamItem[];
  quizAttempts: QuizAttempt[];
  errors: ErrorLogItem[];
  notifications: AppNotification[];
  chat: ChatMessage[];
  chats: ChatThread[];
  activeChatId: string | null;
  assistantMemory: AssistantMemory;
  prayerByDate: Record<string, PrayerDay>;
  prayerBufferBefore: number;
  prayerBufferAfter: number;
  prayerLocked: boolean;
  settings: {
    bacDate: string;
    branchId: "math" | "science" | "technical" | "management" | "literature" | "languages" | "arts";
    wake: string;
    sleep: string;
    nightEnabled: boolean;
    nightStart: string;
    nightMinutes: number;
    allowWithoutPrayer: boolean;
    style: StyleId;
    palette: PaletteId;
    mode: ModeId;
    customPrimary: string;
    ai: AiSettings;
    includeKeysInBackup: boolean;
    notificationsEnabled: boolean;
    reminderMinutes: number;
  };
  focus: FocusState | null;
};

export type TabId =
  | "home"
  | "schedule"
  | "planner"
  | "timer"
  | "library"
  | "learning"
  | "ai"
  | "settings";

export type PlannerPane = "system" | "local" | "ai" | "reverse" | "limits";
