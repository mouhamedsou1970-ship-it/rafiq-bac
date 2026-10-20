import { useState } from "react";
import { PALETTES, STYLES } from "@/lib/bac/defaults";
import { BAC_BRANCHES, curriculumForBranch, getBranch, profileForBranch, subjectsForBranch } from "@/lib/bac/branches";
import { DEFAULT_CURRICULUM } from "@/lib/bac/curriculum";
import { aiComplete } from "@/lib/bac/ai";
import { exportBackup, parseBackup } from "@/lib/bac/backup";
import { storageBackend } from "@/lib/bac/storage";
import { clearAssistantMemory, patch, refreshPrayer, replaceState, toast, useApp, setPlannerPane } from "@/lib/bac/store";
import { notificationSupported, requestNotificationPermission, sendTestNotification } from "@/lib/bac/notifications";
import { getTermuxBridgeStatus, sendTermuxTestNotification, syncTermuxStudyReminders } from "@/lib/bac/termux-notifications";
import { algiersNow, uid } from "@/lib/bac/time";
import type { AiProvider, ModeId, PaletteId, PrayerDay, StyleId } from "@/lib/bac/types";
import { Btn, Modal } from "./ui";
import { ModelPicker } from "./model-picker";

const SWATCH: Record<PaletteId, string> = {
  oasis: "#1f6b4a",
  ink: "#1e3a5f",
  dawn: "#a33b32",
  night: "#3a3f78",
  emerald: "#0f7a4b",
  sand: "#8a5a2a",
  sea: "#0e6e78",
  amber: "#a15c12",
  iris: "#5b3f8c",
  frost: "#3a5166",
};

export function SettingsView() {
  const { state, backend } = useApp();
  const today = algiersNow().date;
  const prayer = state.prayerByDate[today];
  const [manual, setManual] = useState<PrayerDay>(prayer ?? { fajr: "05:16", sunrise: "06:39", dhuhr: "12:18", asr: "15:31", maghrib: "17:57", isha: "19:15", source: "manual" });
  const [testing, setTesting] = useState(false);
  const [wipe, setWipe] = useState(false);
  const [termuxTesting, setTermuxTesting] = useState(false);
  const ai = state.settings.ai;

  function saveManual() {
    patch((s) => ({
      ...s,
      prayerLocked: true,
      prayerByDate: { ...s.prayerByDate, [today]: { ...manual, source: "manual" } },
    }));
    toast("حُفظت المواقيت اليدوية ولن يستبدلها التحديث التلقائي");
  }

  async function testAi() {
    setTesting(true);
    try {
      const reply = await aiComplete(ai, "أجب بكلمة واحدة: تم", { system: "أجب بالعربية بكلمة واحدة.", fast: true });
      toast(reply.slice(0, 80) || "الاتصال نجح");
    } catch (error) {
      toast(error instanceof Error ? error.message : "فشل الاتصال");
    } finally {
      setTesting(false);
    }
  }

  function download() {
    const blob = new Blob([exportBackup(state, state.settings.includeKeysInBackup)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `rafiq-${today}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <section className="card stack">
        <h1>الإعدادات</h1>
        <p className="muted">الحفظ على هذا الجهاز عبر {backend || storageBackend}. المفتاح لا يغادر الجهاز إلا عندما تراسل المزود الذي اخترته.</p>
        <label className="stack">تاريخ البكالوريا
          <input className="field" type="date" value={state.settings.bacDate} onChange={(e) => patch((s) => ({ ...s, settings: { ...s.settings, bacDate: e.target.value } }))} />
        </label>
        <Btn kind="ghost" onClick={() => setPlannerPane("limits")}>أوقات الدراسة والارتباطات</Btn>
        <label className="check">
          <input type="checkbox" checked={state.settings.allowWithoutPrayer} onChange={(e) => patch((s) => ({ ...s, settings: { ...s.settings, allowWithoutPrayer: e.target.checked } }))} />
          اسمح بالجدولة إذا غابت المواقيت، مع تحذير
        </label>
      </section>

      <section className="card stack">
        <h2>الإشعارات والذاكرة</h2>
        <label className="check"><input type="checkbox" checked={state.settings.notificationsEnabled} onChange={async (e) => {
          if (e.target.checked) {
            const permission = await requestNotificationPermission();
            if (permission !== "granted") { toast(permission === "unsupported" ? "هذا المتصفح لا يدعم إشعارات الويب" : "لم يُمنح إذن الإشعارات"); return; }
          }
          patch((s) => ({ ...s, settings: { ...s.settings, notificationsEnabled: e.target.checked } }));
          toast(e.target.checked ? "فُعّلت تذكيرات الحصص" : "أُوقفت التذكيرات");
        }} /> إشعارات مواعيد الدراسة</label>
        <label className="stack">ذكّرني قبل الحصة
          <select className="field" value={state.settings.reminderMinutes} onChange={(e) => patch((s) => ({ ...s, settings: { ...s.settings, reminderMinutes: Number(e.target.value) } }))}>
            <option value={0}>عند البداية</option><option value={5}>5 دقائق</option><option value={10}>10 دقائق</option><option value={15}>15 دقيقة</option><option value={30}>30 دقيقة</option>
          </select>
        </label>
        <div className="row">
          <Btn kind="ghost" onClick={async () => {
            const permission = await sendTestNotification();
            if (permission === "granted") toast("أُرسل إشعار اختبار الآن");
            else toast(permission === "unsupported" ? "هذا المتصفح لا يدعم إشعارات الويب" : "لم يُمنح إذن الإشعارات");
          }}>🔔 اختبار الإشعار الآن</Btn>
          <Btn kind="ghost" onClick={async () => {
            const permission = await sendTestNotification(10000);
            if (permission === "granted") toast("سيظهر إشعار الاختبار بعد 10 ثوانٍ. اخرج من التطبيق وجرب.");
            else toast(permission === "unsupported" ? "هذا المتصفح لا يدعم إشعارات الويب" : "لم يُمنح إذن الإشعارات");
          }}>⏱ اختبار بعد 10 ثوانٍ</Btn>
        </div>
        <div className="row">
          <Btn kind="ghost" disabled={termuxTesting} onClick={async () => {
            setTermuxTesting(true);
            try {
              await sendTermuxTestNotification();
              toast("أُرسل إشعار Android عبر Termux:API ✅");
            } catch (error) {
              toast(`تعذر جسر Termux: ${error instanceof Error ? error.message : "خطأ غير معروف"}`);
            } finally { setTermuxTesting(false); }
          }}>📱 اختبار إشعار خارجي</Btn>
          <Btn kind="ghost" onClick={async () => {
            try {
              const result = await syncTermuxStudyReminders(state);
              toast(`تمت مزامنة ${result.reminders ?? 0} تذكير خارجي`);
            } catch (error) { toast(`تعذر مزامنة Termux: ${error instanceof Error ? error.message : "خطأ غير معروف"}`); }
          }}>↻ مزامنة الحصص مع Termux</Btn>
        </div>
        <p className="muted">جسر Termux يحفظ مواعيد الحصص في الخادم المحلي ويرسل إشعار Android حتى لو أغلقت Brave، بشرط أن يبقى خادم رفيق في Termux يعمل وألا يوقف Android تطبيق Termux. عند تعديل الجدول أو مدة التذكير تتم المزامنة تلقائيًا.</p>
        {!notificationSupported() ? <p className="muted">المتصفح الحالي لا يوفّر Notification API، لكن جسر Termux يمكنه الاستمرار مستقلًا عن إشعار المتصفح.</p> : null}
        <hr />
        <label className="check"><input type="checkbox" checked={state.assistantMemory.enabled} onChange={(e) => patch((s) => ({ ...s, assistantMemory: { ...s.assistantMemory, enabled: e.target.checked } }))} /> ذاكرة الرفيق بين المحادثات</label>
        <p className="muted">{state.assistantMemory.summary ? `الذاكرة الحالية: ${state.assistantMemory.summary}` : "لا توجد ذاكرة دراسية محفوظة بعد."}</p>
        <Btn kind="ghost" onClick={() => { clearAssistantMemory(); toast("مُسحت ذاكرة المساعد"); }}>مسح ذاكرة المساعد</Btn>
      </section>

      <section className="card stack">
        <h2>الشعبة والمواد</h2>
        <label className="stack">شعبة البكالوريا
          <select className="field" value={state.settings.branchId} onChange={(e) => {
            const branchId = e.target.value as typeof state.settings.branchId;
            const branch = getBranch(branchId);
            patch((s) => ({
              ...s,
              subjects: subjectsForBranch(branchId),
              curriculum: curriculumForBranch(branchId, DEFAULT_CURRICULUM),
              studyProfile: profileForBranch(branchId, s.studyProfile),
              settings: { ...s.settings, branchId },
            }));
            toast(`تم اختيار شعبة ${branch.name}. يمكنك تعديل المواد والمعاملات يدويًا.`);
          }}>
            {BAC_BRANCHES.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </label>
        <p className="muted">{getBranch(state.settings.branchId).description}. المواد والمعاملات قابلة للتعديل لأن التنظيم الرسمي قد يتغير بين المواسم.</p>
        {state.subjects.map((subject) => (
          <div key={subject.id} className="stack">
            <input className="field" value={subject.name} onChange={(e) => patch((s) => ({ ...s, subjects: s.subjects.map((item) => item.id === subject.id ? { ...item, name: e.target.value } : item) }))} />
            <div className="grid-3">
              <label className="stack">المعامل<input className="field" type="number" min={1} value={subject.coefficient} onChange={(e) => patch((s) => ({ ...s, subjects: s.subjects.map((item) => item.id === subject.id ? { ...item, coefficient: Number(e.target.value) } : item) }))} /></label>
              <label className="stack">الضعف 1–5<input className="field" type="number" min={1} max={5} value={subject.weakness} onChange={(e) => patch((s) => ({ ...s, subjects: s.subjects.map((item) => item.id === subject.id ? { ...item, weakness: Number(e.target.value) } : item) }))} /></label>
              <label className="stack">هدف أسبوعي (د)<input className="field" type="number" min={0} value={subject.weeklyGoalMin} onChange={(e) => patch((s) => ({ ...s, subjects: s.subjects.map((item) => item.id === subject.id ? { ...item, weeklyGoalMin: Number(e.target.value) } : item) }))} /></label>
            </div>
            <label className="check"><input type="checkbox" checked={subject.core} onChange={(e) => patch((s) => ({ ...s, subjects: s.subjects.map((item) => item.id === subject.id ? { ...item, core: e.target.checked } : item) }))} />مادة أساسية تُفضَّل في التركيز والحصة الليلية</label>
            <Btn kind="danger" onClick={() => patch((s) => ({ ...s, subjects: s.subjects.filter((item) => item.id !== subject.id) }))}>حذف المادة</Btn>
          </div>
        ))}
        <Btn kind="ghost" onClick={() => patch((s) => ({ ...s, subjects: [...s.subjects, { id: uid("sub"), name: "مادة جديدة", coefficient: 2, weakness: 3, weeklyGoalMin: 60, core: false }] }))}>إضافة مادة</Btn>
        <Btn kind="ghost" onClick={() => patch((s) => ({ ...s, subjects: subjectsForBranch(s.settings.branchId), curriculum: curriculumForBranch(s.settings.branchId, DEFAULT_CURRICULUM), studyProfile: profileForBranch(s.settings.branchId, s.studyProfile) }))}>استعادة مواد الشعبة</Btn>
      </section>

      <section className="card stack">
        <h2>صلاة الوادي</h2>
        <p className="muted">الجلب يستخدم رابطة العالم الإسلامي (فجر 18° وعشاء 17°) وقد لا يطابق مواقيت الوزارة. عدّل يدويًا إذا اختلف المسجد.</p>
        <div className="row">
          <Btn onClick={() => void refreshPrayer(true)}>تحديث من الإنترنت</Btn>
        </div>
        <p className="muted">هامش قبل الصلاة وبعدها، بالدقائق. المغرب إلى العشاء يبقى محجوزًا كاملًا.</p>
        <div className="grid-2">
          <label className="stack">قبل<input className="field" type="number" value={state.prayerBufferBefore} onChange={(e) => patch((s) => ({ ...s, prayerBufferBefore: Number(e.target.value) }))} /></label>
          <label className="stack">بعد<input className="field" type="number" value={state.prayerBufferAfter} onChange={(e) => patch((s) => ({ ...s, prayerBufferAfter: Number(e.target.value) }))} /></label>
        </div>
        {(["fajr", "dhuhr", "asr", "maghrib", "isha"] as const).map((key) => (
          <label key={key} className="stack">{key === "fajr" ? "الفجر" : key === "dhuhr" ? "الظهر" : key === "asr" ? "العصر" : key === "maghrib" ? "المغرب" : "العشاء"}
            <input className="field" value={manual[key]} onChange={(e) => setManual({ ...manual, [key]: e.target.value })} />
          </label>
        ))}
        <Btn kind="ghost" onClick={saveManual}>حفظ أوقات اليوم يدويًا</Btn>
      </section>

      <section className="card stack">
        <h2>الذكاء الاصطناعي · أساسي واحتياطي</h2>
        <p className="muted">تُجلب قائمة النماذج من المزود نفسه. عند فشل النموذج الأساسي بعد إعادة المحاولة، يستطيع رفيق تحويل نفس الطلب تلقائيًا إلى النموذج الاحتياطي.</p>
        <label className="stack">المزود الأساسي<select className="field" value={ai.provider} onChange={(e) => patch((s) => ({ ...s, settings: { ...s.settings, ai: { ...s.settings.ai, provider: e.target.value as AiProvider } } }))}><option value="gemini">Google Gemini</option><option value="openrouter">OpenRouter</option><option value="xai">xAI</option><option value="custom">OpenAI-compatible</option></select></label>
        <label className="stack">مفتاح المزود الأساسي<input className="field" type="password" value={ai.apiKey} autoComplete="off" onChange={(e) => patch((s) => ({ ...s, settings: { ...s.settings, ai: { ...s.settings.ai, apiKey: e.target.value } } }))}/></label>
        {ai.provider === "custom" && <label className="stack">عنوان المزود<input className="field" value={ai.endpoint} placeholder="https://example.com/v1" onChange={(e)=>patch(s=>({...s,settings:{...s.settings,ai:{...s.settings.ai,endpoint:e.target.value}}}))}/></label>}
        <ModelPicker settings={ai} value={ai.model} label="🤖 النموذج الأساسي" onChange={(model)=>patch(s=>({...s,settings:{...s.settings,ai:{...s.settings.ai,model}}}))}/>
        <label className="stack">نموذج سريع (اختياري)<input className="field" value={ai.fastModel} onChange={(e)=>patch(s=>({...s,settings:{...s.settings,ai:{...s.settings.ai,fastModel:e.target.value}}}))}/></label>
        <Btn kind="ghost" disabled={testing} onClick={() => void testAi()}>{testing ? "يجري الاختبار…" : "اختبار الاتصال"}</Btn>
        <hr/>
        <label className="check"><input type="checkbox" checked={ai.fallback.enabled} onChange={(e)=>patch(s=>({...s,settings:{...s.settings,ai:{...s.settings.ai,fallback:{...s.settings.ai.fallback,enabled:e.target.checked}}}}))}/> تفعيل النموذج الاحتياطي تلقائيًا</label>
        {ai.fallback.enabled && <>
          <label className="stack">المزود الاحتياطي<select className="field" value={ai.fallback.provider} onChange={(e)=>patch(s=>({...s,settings:{...s.settings,ai:{...s.settings.ai,fallback:{...s.settings.ai.fallback,provider:e.target.value as AiProvider}}}}))}><option value="gemini">Google Gemini</option><option value="openrouter">OpenRouter</option><option value="xai">xAI</option><option value="custom">OpenAI-compatible</option></select></label>
          <label className="stack">مفتاح المزود الاحتياطي<input className="field" type="password" value={ai.fallback.apiKey} autoComplete="off" placeholder={ai.fallback.provider===ai.provider?"يمكن استخدام مفتاح آخر أو نسخ نفس المفتاح":"مفتاح المزود الاحتياطي"} onChange={(e)=>patch(s=>({...s,settings:{...s.settings,ai:{...s.settings.ai,fallback:{...s.settings.ai.fallback,apiKey:e.target.value}}}}))}/></label>
          {ai.fallback.provider === "custom" && <label className="stack">عنوان المزود الاحتياطي<input className="field" value={ai.fallback.endpoint} onChange={(e)=>patch(s=>({...s,settings:{...s.settings,ai:{...s.settings.ai,fallback:{...s.settings.ai.fallback,endpoint:e.target.value}}}}))}/></label>}
          <ModelPicker settings={ai.fallback} value={ai.fallback.model} label="🤖 النموذج الاحتياطي" onChange={(model)=>patch(s=>({...s,settings:{...s.settings,ai:{...s.settings.ai,fallback:{...s.settings.ai.fallback,model}}}}))}/>
        </>}
      </section>

      <section className="card stack">
        <h2>المظهر</h2>
        <div className="row">
          {(["light", "dark", "auto"] as ModeId[]).map((mode) => (
            <button key={mode} type="button" className="chip" aria-pressed={state.settings.mode === mode} onClick={() => patch((s) => ({ ...s, settings: { ...s.settings, mode } }))}>
              {mode === "light" ? "فاتح" : mode === "dark" ? "داكن" : "تلقائي"}
            </button>
          ))}
        </div>
        <div className="stack">
          {STYLES.map((style) => (
            <button key={style.id} type="button" className="choice" aria-pressed={state.settings.style === style.id} onClick={() => patch((s) => ({ ...s, settings: { ...s.settings, style: style.id as StyleId } }))}>
              <strong>{style.name}</strong>
              <span className="muted"> {style.blurb}</span>
            </button>
          ))}
        </div>
        <div className="row">
          {PALETTES.map((palette) => (
            <button key={palette.id} type="button" className="chip" aria-pressed={state.settings.palette === palette.id} onClick={() => patch((s) => ({ ...s, settings: { ...s.settings, palette: palette.id as PaletteId } }))}>
              <span className="swatch" style={{ background: SWATCH[palette.id] }} /> {palette.name}
            </button>
          ))}
        </div>
        <label className="stack">لون خاص
          <input className="field" type="color" value={state.settings.customPrimary || "#1f6b4a"} onChange={(e) => patch((s) => ({ ...s, settings: { ...s.settings, customPrimary: e.target.value } }))} />
        </label>
        <Btn kind="ghost" onClick={() => patch((s) => ({ ...s, settings: { ...s.settings, customPrimary: "" } }))}>إلغاء اللون الخاص</Btn>
      </section>

      <section className="card stack">
        <h2>نسخة احتياطية</h2>
        <label className="check">
          <input type="checkbox" checked={state.settings.includeKeysInBackup} onChange={(e) => patch((s) => ({ ...s, settings: { ...s.settings, includeKeysInBackup: e.target.checked } }))} />
          تضمين مفتاح الذكاء في الملف
        </label>
        <div className="row">
          <Btn onClick={download}>تصدير</Btn>
          <label className="btn btn-ghost">
            استيراد
            <input
              hidden
              type="file"
              accept="application/json"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                try {
                  const incoming = parseBackup(await file.text());
                  if (!incoming.settings.ai.apiKey) incoming.settings.ai.apiKey = state.settings.ai.apiKey;
                  replaceState(incoming);
                  toast("استُعيدت النسخة");
                } catch {
                  toast("الملف غير مفهوم");
                }
                event.target.value = "";
              }}
            />
          </label>
        </div>
        <Btn kind="danger" onClick={() => setWipe(true)}>مسح بيانات هذا الجهاز</Btn>
      </section>

      <Modal open={wipe} title="مسح البيانات" onClose={() => setWipe(false)}>
        <p>يُحذف الجدول والدروس والسجل من هذا الجهاز. لا يمكن التراجع بعد التصدير إلا بملف النسخة.</p>
        <div className="row">
          <Btn kind="danger" onClick={() => {
            const keepAi = state.settings.ai;
            const style = state.settings.style;
            const palette = state.settings.palette;
            const mode = state.settings.mode;
            replaceState({
              ...state,
              sessions: [],
              lessons: [],
              logs: [],
              exams: [],
              errors: [],
              notifications: [],
              chat: [],
              chats: [],
              activeChatId: null,
              assistantMemory: { ...state.assistantMemory, summary: "" },
              focus: null,
              settings: { ...state.settings, ai: keepAi, style, palette, mode },
            });
            setWipe(false);
            toast("مُسحت بيانات الدراسة");
          }}>مسح</Btn>
          <Btn kind="ghost" onClick={() => setWipe(false)}>إلغاء</Btn>
        </div>
      </Modal>
    </>
  );
}
