import { useEffect, useState } from "react";
import {
  Bell,
  BookOpen,
  CalendarDays,
  GraduationCap,
  House,
  Menu,
  Route,
  Settings,
  Sparkles,
  Timer,
  Undo2,
  X,
} from "lucide-react";
import { daySessionMinutes, todayActual } from "@/lib/bac/analytics";
import {
  focusRemaining,
  initStore,
  maybeFinishFocus,
  setTab,
  undoLast,
  useApp,
  addNotification,
  markNotificationRead,
  markAllNotificationsRead,
  clearNotifications,
} from "@/lib/bac/store";
import { algiersNow, clock, daysUntil, weekdayIndex } from "@/lib/bac/time";
import { checkStudyNotifications } from "@/lib/bac/notifications";
import { syncTermuxStudyReminders } from "@/lib/bac/termux-notifications";
import type { TabId } from "@/lib/bac/types";
import { AiView } from "./ai-view";
import { HomeView } from "./home-view";
import { LibraryView } from "./library-view";
import { LearningView } from "./learning-view";
import { PlannerView } from "./planner-view";
import { ScheduleView } from "./schedule-view";
import { SettingsView } from "./settings-view";
import { TimerView } from "./timer-view";

const TABS: { id: TabId; label: string; icon: typeof House }[] = [
  { id: "home", label: "الرئيسية", icon: House }, { id: "schedule", label: "جدولي", icon: CalendarDays },
  { id: "learning", label: "التعلّم", icon: GraduationCap }, { id: "timer", label: "المؤقت", icon: Timer }, { id: "ai", label: "ذكاء", icon: Sparkles },
];
const MORE_TABS: { id: TabId; label: string; icon: typeof House }[] = [
  { id: "planner", label: "المخطط", icon: Route },
  { id: "library", label: "المكتبة", icon: BookOpen }, { id: "settings", label: "الإعدادات", icon: Settings },
];

function contrastFg(hex: string): string {
  const h = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return "#1a140c";
  const n = Number.parseInt(h, 16);
  const y = (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000;
  return y > 160 ? "#1a140c" : "#f7f4ee";
}

export function App() {
  const snap = useApp();
  const [now, setNow] = useState(() => Date.now());
  const [menuOpen, setMenuOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  useEffect(() => {
    void initStore();
  }, []);

  useEffect(() => {
    const onAi = (event: Event) => {
      const d = (event as CustomEvent<Record<string, unknown>>).detail ?? {};
      addNotification({ kind: "ai", title: String(d.title ?? "حدث AI"), message: String(d.message ?? ""), code: d.status ? String(d.status) : undefined, provider: d.provider as any, model: d.model ? String(d.model) : undefined });
    };
    window.addEventListener("rafiq:ai-event", onAi);
    return () => window.removeEventListener("rafiq:ai-event", onAi);
  }, []);

  useEffect(() => {
    const onReminder = (event: Event) => {
      const d = (event as CustomEvent<{title:string;message:string;code:string}>).detail;
      if (d) addNotification({ kind: "study", title: d.title, message: d.message, code: d.code });
    };
    window.addEventListener("rafiq:study-reminder", onReminder);
    return () => window.removeEventListener("rafiq:study-reminder", onReminder);
  }, []);

  useEffect(() => {
    if (!snap.ready) return;
    const id = window.setTimeout(() => {
      void syncTermuxStudyReminders(snap.state).catch(() => {
        // The bridge exists only in the local Termux dev server. Browser reminders still work without it.
      });
    }, 500);
    return () => window.clearTimeout(id);
  }, [snap.ready, snap.state.sessions, snap.state.subjects, snap.state.settings.notificationsEnabled, snap.state.settings.reminderMinutes]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const next = Date.now();
      setNow(next);
      maybeFinishFocus(next);
      if (snap.ready) checkStudyNotifications(snap.state, new Date(next));
    }, 1000);
    return () => window.clearInterval(id);
  }, [snap.ready, snap.state]);

  useEffect(() => {
    if (!snap.ready) return;
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const mode =
        snap.state.settings.mode === "auto" ? (media.matches ? "dark" : "light") : snap.state.settings.mode;
      root.dataset.style = snap.state.settings.style;
      root.dataset.palette = snap.state.settings.palette;
      root.dataset.mode = mode;
      const today = algiersNow().date;
      const planned = daySessionMinutes(snap.state, today, "planned") + daySessionMinutes(snap.state, today, "done");
      const actual = todayActual(snap.state, today);
      const cap = snap.state.days[weekdayIndex(today)]?.maxMinutes ?? 180;
      const progress = planned > 0 ? Math.min(1, actual / planned) : Math.min(1, actual / cap);
      root.style.setProperty("--day-progress", String(progress));
      if (snap.state.settings.customPrimary) {
        root.style.setProperty("--p-primary", snap.state.settings.customPrimary);
        root.style.setProperty("--p-primary-fg", contrastFg(snap.state.settings.customPrimary));
      } else {
        root.style.removeProperty("--p-primary");
        root.style.removeProperty("--p-primary-fg");
      }
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [snap.ready, snap.state]);

  if (!snap.ready) {
    return (
      <div className="boot">
        <p className="muted">رفيق الدراسة · البكالوريا الجزائرية</p>
        <h1>رفيق البكالوريا</h1>
        <p>جارٍ فتح دفترك على هذا الجهاز.</p>
      </div>
    );
  }

  const today = algiersNow(new Date(now));
  const days = daysUntil(today.date, snap.state.settings.bacDate);
  const focus = snap.state.focus;
  const showNav = !(focus && snap.tab === "timer");

  return (
    <div className="app-root">
      <header className="topbar">
        <div className="brand">
          <strong>رفيق البكالوريا</strong>
          <span className="muted">{days >= 0 ? `باقي ${days} يومًا` : "انتهى موعد البكالوريا"}</span>
        </div>
        <div className="top-actions">
          <button type="button" className="icon-btn" aria-label="القائمة" onClick={() => setMenuOpen(true)}><Menu size={21}/></button>
          <button type="button" className="icon-btn bell-btn" aria-label="الإشعارات" onClick={() => setNotesOpen(true)}><Bell size={21}/>{snap.state.notifications.some(n=>!n.read)?<span className="note-dot">{Math.min(99,snap.state.notifications.filter(n=>!n.read).length)}</span>:null}</button>
          <button type="button" className="icon-btn" aria-label="تراجع" onClick={undoLast} disabled={snap.undoCount === 0}><Undo2 size={19}/></button>
        </div>
      </header>
      {menuOpen && <><button className="drawer-backdrop" aria-label="إغلاق القائمة" onClick={()=>setMenuOpen(false)}/><aside className="app-drawer"><div className="spread"><strong>أقسام رفيق</strong><button className="icon-btn" onClick={()=>setMenuOpen(false)}><X/></button></div>{[...TABS,...MORE_TABS].map(t=>{const Icon=t.icon;return <button className="drawer-link" key={t.id} aria-current={snap.tab===t.id?"page":undefined} onClick={()=>{setTab(t.id);setMenuOpen(false)}}><Icon size={19}/>{t.label}</button>})}</aside></>}
      {notesOpen && <><button className="drawer-backdrop" aria-label="إغلاق الإشعارات" onClick={()=>setNotesOpen(false)}/><aside className="notifications-panel"><div className="spread"><strong>الإشعارات</strong><button className="icon-btn" onClick={()=>setNotesOpen(false)}><X/></button></div><div className="row"><button className="chip" onClick={markAllNotificationsRead}>تحديد الكل كمقروء</button><button className="chip" onClick={clearNotifications}>مسح السجل</button></div><div className="notification-list">{snap.state.notifications.length?snap.state.notifications.map(n=><button key={n.id} className={`notification-item ${n.read?"":"unread"}`} onClick={()=>markNotificationRead(n.id)}><strong>{n.title}</strong><span>{n.message}</span><small>{n.provider?`${n.provider}${n.model?` · ${n.model}`:""} · `:""}{new Date(n.at).toLocaleString("ar-DZ")}{n.code?` · ${n.code}`:""}</small></button>):<p className="muted">لا توجد إشعارات محفوظة بعد.</p>}</div></aside></>}
      <main className="main">
        <div hidden={snap.tab !== "home"}><HomeView now={now} /></div>
        <div hidden={snap.tab !== "schedule"}><ScheduleView now={now} /></div>
        <div hidden={snap.tab !== "planner"}><PlannerView /></div>
        <div hidden={snap.tab !== "timer"}><TimerView now={now} /></div>
        <div hidden={snap.tab !== "library"}><LibraryView /></div>
        <div hidden={snap.tab !== "learning"}><LearningView /></div>
        <div hidden={snap.tab !== "ai"}><AiView /></div>
        <div hidden={snap.tab !== "settings"}><SettingsView /></div>
      </main>
      {focus && snap.tab !== "timer" ? (
        <button type="button" className="toast" onClick={() => setTab("timer")}>
          تركيز · {clock(focusRemaining(now))} · اضغط للعودة
        </button>
      ) : null}
      {showNav ? (
        <nav className="nav" aria-label="الأقسام">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} type="button" aria-current={snap.tab === tab.id ? "page" : undefined} onClick={() => setTab(tab.id)}>
                <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      ) : null}
      {snap.toast && !(focus && snap.tab !== "timer") ? <div className="toast">{snap.toast}</div> : null}
    </div>
  );
}
