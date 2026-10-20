import { neglected } from "./analytics";
import { coerceActions, upcoming, type AgentAction } from "./actions";
import { AiError, aiComplete, extractJson } from "./ai";
import { availableStudyMinutes, schedulableStudyMinutes, formatConstraints, subjectName, validateIncoming } from "./schedule";
import { curriculumStatusLabel, currentCurriculum } from "./curriculum";
import type { AppState, StudySession } from "./types";
import { addDays, algiersNow, formatLong } from "./time";
import { getBranch } from "./branches";

function snapshot(state: AppState, today: string): string {
  const sessions = upcoming(state, today)
    .slice(0, 24)
    .map((s, i) => `${i + 1}) id=${s.id} ${s.date} ${s.start}-${s.end} ${subjectName(state, s.subjectId)} — ${s.task}`)
    .join("\n");
  const subjects = state.subjects
    .map((s) => `${s.name} | معامل ${s.coefficient} | ضعف ${s.weakness}/5 | هدف ${s.weeklyGoalMin} د | أساسية=${s.core ? "نعم" : "لا"}`)
    .join("\n");
  const lessons = state.lessons
    .slice(0, 40)
    .map((l) => `id=${l.id} | ${subjectName(state, l.subjectId)} | ${l.title} | ${l.status} | إتقان ${l.mastery} | مراجعة ${l.nextReview ?? "—"}`)
    .join("\n");
  const exams = state.exams.map((e) => `${e.date} ${subjectName(state, e.subjectId)} ${e.title}${e.score !== undefined ? ` نتيجة ${e.score}` : ""}`).join("\n");
  const logs = state.logs.slice(-12).map((l) => `${l.date} ${subjectName(state, l.subjectId)} ${l.minutes} د ${l.task}`).join("\n");
  const late = neglected(state, today).map((s) => s.name).join("، ") || "لا يوجد";
  const misses = state.errors.slice(-8).map((e) => `${e.date} ${e.concept}`).join("\n");
  const curriculum = state.subjects.map((sub) => {
    const units = state.curriculum.filter((u) => u.subjectId === sub.id).sort((a,b) => a.order-b.order);
    if (!units.length) return "";
    const current = currentCurriculum(state, sub.id);
    return `${sub.name}: الحالي=${current?.title ?? "—"} | ${units.map((u) => `${u.order}.${u.title}[${curriculumStatusLabel(u.status)}]`).join(" ← ")}`;
  }).filter(Boolean).join("\n");
  const profile = `نظام الدراسة: مادة أساسية واحدة يوميًا=${state.studyProfile.oneCorePerDay ? "نعم" : "لا"} | الأساسية=${state.studyProfile.coreSubjectIds.map((id) => subjectName(state,id)).join("، ")} | هدف الأساسية=${state.studyProfile.coreDailyMin}د | الثانويات=${state.studyProfile.secondaryDailyMin}د`;
  return [
    `الآن: ${formatLong(today)} ${algiersNow().time} (الوادي، توقيت الجزائر)`,
    `الشعبة: ${getBranch(state.settings.branchId).name}`,
    `المواد:\n${subjects}`,
    `مواد متأخرة أو مهملة: ${late}`,
    `الجدول القادم (index يبدأ من 1):\n${sessions || "فارغ"}`,
    `الدروس:\n${lessons || "لا دروس"}`,
    `الاختبارات:\n${exams || "لا اختبارات"}`,
    `آخر الدراسة:\n${logs || "لا سجل"}`,
    `آخر الأخطاء:\n${misses || "لا أخطاء"}`,
  ].join("\n\n");
}

const ACTION_SPEC = `الأفعال المسموحة داخل actions فقط:
add_session {type, date, start, end, subject, task}
move_session {type, id أو index, date, start, end}
delete_session {type, id أو index}
update_lesson {type, id أو title, status?, mastery?, weakPoints?}
schedule_review {type, lessonId أو title, date, start, end, task?}
add_exam {type, subject, title, date}
set_weakness {type, subject, weakness من 1 إلى 5}
start_focus {type, sessionId? أو subject, minutes?, task?}
status للدرس: new | memorizing | review | mastered
subject اسم مادة حرفي من القائمة. الوصف يذهب إلى task لا إلى subject.
لا تخترع حصصًا تتقاطع مع فترة ممنوعة.
مهم: index يشير دائمًا إلى رقم الحصة في قائمة الجدول القادم التي أُرسلت لك قبل تنفيذ أي إجراء. لا تعِد ترقيمه بعد الحذف أو النقل.
إذا كنت تبني جدولًا جديدًا من الصفر فاستخدم add_session للحصص الجديدة، ولا تستخدم move_session أو delete_session لحصة لم تكن موجودة أصلًا في قائمة الجدول القادم.`;

export async function runPlanner(state: AppState, dates: string[], replacePlanned: boolean, userInstruction = ""): Promise<{ reason: string; sessions: StudySession[]; attempts: number }> {
  const today = algiersNow().date;
  const ignore = new Set<string>();
  if (replacePlanned) {
    for (const s of state.sessions) if (s.status === "planned" && dates.includes(s.date)) ignore.add(s.id);
  }
  const system = [
    `أنت مخطط دراسة لبكالوريا الجزائر، شعبة ${getBranch(state.settings.branchId).name}. أعد JSON فقط.`,
    "لا تنشئ أي حصة تتقاطع ولو دقيقة واحدة مع فترة ممنوعة.",
    "subject يجب أن يكون اسم مادة حقيقية من القائمة حرفيًا.",
    "ممنوع أن يكون subject أحد هذه: مراجعة، حفظ، حل تمارين، دراسة، مراجعة ليلية. هذه توضع في task.",
    "احترم ساعات كل تاريخ والحد اليومي والارتباطات والصلاة وفترة المغرب إلى العشاء كاملة.",
    "ابنِ الخطة لتحقيق احتياج الطالب لا لملء كل الفراغات. اترك الاحتياطي فارغًا متى أمكن.",
    "اتبع ترتيب البرنامج الدراسي: ركز على الوحدة الحالية ثم التالية، ولا تقفز إلى وحدة لاحقة إلا لمراجعة مستحقة أو سبب واضح.",
    "إذا كان خيار مادة أساسية واحدة يوميًا مفعّلًا، لا توزع أكثر من مادة أساسية في اليوم نفسه؛ اختر واحدة من المواد المحددة كأساسية حسب التأخر والضعف والتناوب.",
    "اقترب من هدف دقائق المادة الأساسية والثانويات، لكن لا تتجاوز الوقت الحر أو القيود.",
    "اكتب task بهدف عملي محدد: الوحدة + نوع العمل + ناتج متوقع، بدل عبارات عامة مثل دراسة الرياضيات.",
    "ضع الأعمال التي تحتاج تركيزًا عاليًا للمواد الأساسية في أفضل أوقات التركيز المتاحة.",
    formatConstraints(state, dates),
  ].join("\n\n");

  let errors: string[] = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const prompt = [
      snapshot(state, today),
      `ابنِ حصصًا فقط لهذه التواريخ: ${dates.join("، ")}` ,
      userInstruction.trim() ? `تعليمات الطالب الخاصة لهذه الخطة (احترمها ما لم تصطدم بقيد صلب):\n${userInstruction.trim()}` : "",
      `الوقت الحر المحسوب قبل التخطيط:
${dates.map((d) => `${d}: ${schedulableStudyMinutes(state,d)} دقيقة متبقية لإضافة حصص`).join("\n")}`,
      replacePlanned ? "الحصص المخططة في هذه التواريخ ستُستبدل، فلا تتعارض معها." : "لا تتعارض مع أي حصة موجودة.",
      errors.length ? `المحاولة السابقة رُفضت. صحح الخطة كاملة:\n${errors.join("\n")}` : "",
      `الصيغة الوحيدة:\n{"reason":"سبب مختصر","sessions":[{"date":"YYYY-MM-DD","start":"HH:MM","end":"HH:MM","subject":"رياضيات","task":"حل تمارين الاشتقاق"}]}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    let parsed: { reason?: string; sessions?: IncomingLike[] };
    try {
      const text = await aiComplete(state.settings.ai, prompt, { system, json: true });
      parsed = extractJson(text) as { reason?: string; sessions?: IncomingLike[] };
    } catch (error) {
      if (attempt === 3) throw error;
      errors = [error instanceof Error ? error.message : "فشل الاتصال"];
      continue;
    }
    const list = Array.isArray(parsed.sessions) ? parsed.sessions : [];
    const check = validateIncoming(
      state,
      list.map((s) => ({
        date: String(s.date ?? ""),
        start: String(s.start ?? ""),
        end: String(s.end ?? ""),
        subject: String(s.subject ?? ""),
        task: String(s.task ?? ""),
        source: "ai" as const,
      })),
      { ignoreIds: ignore, source: "ai" },
    );
    if (check.ok) {
      return { reason: String(parsed.reason ?? "خطة مقترحة"), sessions: check.sessions, attempts: attempt };
    }
    errors = check.errors;
  }
  throw new AiError(errors.join("\n") || "لم تنجح الخطة بعد 3 محاولات");
}

type IncomingLike = { date?: string; start?: string; end?: string; subject?: string; task?: string };

export async function runAgent(state: AppState, history: { role: "user" | "assistant"; text: string }[], userText: string): Promise<{ reply: string; actions: AgentAction[]; memory: string }> {
  const today = algiersNow().date;
  const dates = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const system = [
    `أنت رفيق البكالوريا، مساعد دراسة لطالب بكالوريا في الجزائر، شعبة ${getBranch(state.settings.branchId).name}. لست دردشة عامة.`,
    "اقرأ حالة التطبيق وأجب بالعربية بجملة أو جملتين واضحتين.",
    "لا تعدّل البيانات بنفسك. إذا لزم تغيير، أعد actions منظمة وسيفحصها التطبيق قبل التطبيق.",
    "إذا كان السؤال معلوماتيًا فقط فاترك actions مصفوفة فارغة.",
    "لا تنشئ أي حصة تتقاطع ولو دقيقة واحدة مع فترة ممنوعة.",
    "حوّل المواقيت إلى فترات ممنوعة كما هي في القيود، لا تكتفِ بذكر اسم الصلاة.",
    formatConstraints(state, dates),
    ACTION_SPEC,
    state.assistantMemory.enabled ? "لديك ذاكرة دراسية بين المحادثات. حدّث memory فقط بمعلومة دراسية مستقرة ومفيدة قالها الطالب أو استنتجتها من تقدمه. لا تحفظ أسرارًا أو دردشة عابرة. اجعلها ملخصًا قصيرًا، ويمكن إبقاء الذاكرة السابقة كما هي." : "اجعل memory فارغًا.",
    "الصيغة الوحيدة للرد:\n{\"reply\":\"...\",\"actions\":[],\"memory\":\"ملخص الذاكرة الدراسية\"}",
  ].join("\n\n");
  const convo = history.slice(-8).map((m) => `${m.role === "user" ? "الطالب" : "الرفيق"}: ${m.text}`).join("\n");
  const prompt = `${snapshot(state, today)}\n\nذاكرة الرفيق بين المحادثات:\n${state.assistantMemory.enabled ? (state.assistantMemory.summary || "لا توجد ذاكرة محفوظة بعد") : "معطلة"}\n\nالحوار السابق:\n${convo || "—"}\n\nرسالة الطالب:\n${userText}`;
  const text = await aiComplete(state.settings.ai, prompt, { system, json: true });
  const parsed = extractJson(text) as { reply?: string; actions?: unknown[]; memory?: string };
  const reply = String(parsed.reply ?? "").trim() || "تم.";
  const coerced = coerceActions(Array.isArray(parsed.actions) ? parsed.actions : []);
  if (coerced.errors.length) {
    return { reply: `${reply}\n\nتعذّر فهم بعض الإجراءات:\n${coerced.errors.join("\n")}`, actions: [], memory: state.assistantMemory.summary };
  }
  return { reply, actions: coerced.actions, memory: state.assistantMemory.enabled ? String(parsed.memory ?? state.assistantMemory.summary).trim().slice(0, 3000) : "" };
}

export function splitLocal(body: string): { title: string; text: string }[] {
  const chunks = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 20);
  const units: { title: string; text: string }[] = [];
  let buf = "";
  const flush = () => {
    if (buf.trim().length < 20) return;
    const line = buf.trim().split("\n")[0] ?? "وحدة";
    units.push({ title: line.slice(0, 48), text: buf.trim() });
    buf = "";
  };
  for (const chunk of chunks.length ? chunks : [body.trim()]) {
    if ((buf + "\n" + chunk).length > 700) flush();
    buf = buf ? `${buf}\n${chunk}` : chunk;
  }
  flush();
  return units.slice(0, 12);
}

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export async function splitLesson(state: AppState, body: string): Promise<{ title: string; text: string }[]> {
  const local = splitLocal(body);
  if (!state.settings.ai.apiKey.trim()) return local;
  try {
    const system = "قسّم نص الدرس إلى وحدات حفظ قصيرة. ممنوع إضافة أي معلومة ليست في النص. كل text مقتطع حرفيًا من النص. أعد JSON فقط.";
    const prompt = `{"units":[{"title":"عنوان قصير","text":"مقتطف حرفي"}]}\n\nالنص:\n${body.slice(0, 12000)}`;
    const text = await aiComplete(state.settings.ai, prompt, { system, json: true, fast: true });
    const parsed = extractJson(text) as { units?: { title?: string; text?: string }[] };
    const source = norm(body);
    const units = (parsed.units ?? [])
      .map((u) => ({ title: String(u.title ?? "وحدة").slice(0, 60), text: String(u.text ?? "").trim() }))
      .filter((u) => u.text.length > 15 && source.includes(norm(u.text)));
    if (units.length >= 1 && units.length >= Math.min(2, local.length || 1)) return units.slice(0, 12);
  } catch {
    /* local fallback */
  }
  return local;
}

export type Grade = { mastery: number; correct: string[]; missing: string[]; note: string };

const STOP = new Set("في من إلى على عن أن إن كان ما لا لم لن قد هذا هذه ذلك تلك ثم أو بل حتى بين كل أي هو هي هم هن الذي التي".split(" "));

function tokens(text: string): string[] {
  const found = text.match(/[\u0600-\u06FF]{3,}/g) ?? [];
  const uniq = new Set(found.filter((w) => !STOP.has(w)));
  return [...uniq];
}

export function gradeLocal(reference: string, answer: string): Grade {
  const keys = tokens(reference).slice(0, 24);
  const ans = norm(answer);
  if (!keys.length) return { mastery: ans.length > 10 ? 60 : 20, correct: [], missing: [], note: "تقييم تقريبي بدون اتصال." };
  const hit = keys.filter((k) => ans.includes(k));
  const mastery = Math.round((hit.length / keys.length) * 100);
  return {
    mastery,
    correct: hit.slice(0, 6),
    missing: keys.filter((k) => !hit.includes(k)).slice(0, 6),
    note: "تقييم محلي بالكلمات المفتاحية لأن المساعد غير متاح. المعنى قد يكون أفضل من الرقم.",
  };
}

export async function gradeAnswer(state: AppState, reference: string, answer: string): Promise<Grade> {
  if (!state.settings.ai.apiKey.trim()) return gradeLocal(reference, answer);
  try {
    const system = "قيّم إجابة الحفظ اعتمادًا على النص المرجعي فقط. لا تعاقب اختلاف الصياغة إذا كان المعنى صحيحًا. لا تستخدم معرفة خارج النص. أعد JSON فقط.";
    const prompt = `{"mastery":0,"correct":[""],"missing":[""],"note":""}\n\nالمرجع:\n${reference}\n\nإجابة الطالب:\n${answer}`;
    const text = await aiComplete(state.settings.ai, prompt, { system, json: true, fast: true });
    const parsed = extractJson(text) as Partial<Grade>;
    const mastery = Math.max(0, Math.min(100, Math.round(Number(parsed.mastery ?? 0))));
    return {
      mastery,
      correct: Array.isArray(parsed.correct) ? parsed.correct.map(String).slice(0, 6) : [],
      missing: Array.isArray(parsed.missing) ? parsed.missing.map(String).slice(0, 6) : [],
      note: String(parsed.note ?? ""),
    };
  } catch {
    return gradeLocal(reference, answer);
  }
}

export type QuizQ = { prompt: string; expected: string; concept: string };

export async function makeQuiz(state: AppState, body: string, kind: "quiz" | "exam" | "cards"): Promise<QuizQ[]> {
  const local = splitLocal(body).slice(0, 5).map((u) => ({
    prompt: kind === "cards" ? u.title : `اشرح بأسلوبك: ${u.title}`,
    expected: u.text.slice(0, 400),
    concept: u.title,
  }));
  if (!state.settings.ai.apiKey.trim()) return local;
  try {
    const system = "اكتب أسئلة من نص الدرس فقط دون إضافة حقائق خارجية. أعد JSON فقط.";
    const prompt = `النوع: ${kind}\n{"questions":[{"prompt":"...","expected":"جواب مختصر من النص","concept":"..."}]}\n\nالنص:\n${body.slice(0, 8000)}`;
    const text = await aiComplete(state.settings.ai, prompt, { system, json: true, fast: true });
    const parsed = extractJson(text) as { questions?: QuizQ[] };
    const qs = (parsed.questions ?? [])
      .map((q) => ({ prompt: String(q.prompt ?? ""), expected: String(q.expected ?? ""), concept: String(q.concept ?? "مفهوم") }))
      .filter((q) => q.prompt && q.expected);
    return qs.length ? qs.slice(0, 8) : local;
  } catch {
    return local;
  }
}
