import { AlertTriangle } from "lucide-react";
import {
  adherence,
  averageMastery,
  daySessionMinutes,
  leastStudied,
  missedCount,
  mostSkipped,
  neglected,
  todayActual,
  weeklyBars,
} from "@/lib/bac/analytics";
import { lessonStatusLabel } from "@/lib/bac/defaults";
import { subjectName } from "@/lib/bac/schedule";
import { setTab, startFocus, useApp } from "@/lib/bac/store";
import { algiersNow, daysUntil, formatDuration, formatLong, minutes } from "@/lib/bac/time";
import { Bar } from "./ui";

export function HomeView({ now }: { now: number }) {
  const { state } = useApp();
  const today = algiersNow(new Date(now));
  const days = daysUntil(today.date, state.settings.bacDate);
  const sessions = state.sessions.filter((s) => s.date === today.date).sort((a, b) => a.start.localeCompare(b.start));
  const done = sessions.filter((s) => s.status === "done").length;
  const remaining = sessions.filter((s) => s.status === "planned" && (minutes(s.end) ?? 0) > today.minutes).length;
  const actual = todayActual(state, today.date);
  const planned = daySessionMinutes(state, today.date, "planned") + daySessionMinutes(state, today.date, "done");
  const progress = planned > 0 ? Math.min(100, Math.round((actual / Math.max(planned, 1)) * 100)) : 0;
  const next = state.sessions
    .filter((s) => s.status === "planned" && (s.date > today.date || (s.date === today.date && (minutes(s.end) ?? 0) > today.minutes)))
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))[0];
  const prayer = state.prayerByDate[today.date];
  const rows = prayer
    ? [
        ["الفجر", prayer.fajr],
        ["الظهر", prayer.dhuhr],
        ["العصر", prayer.asr],
        ["المغرب", prayer.maghrib],
        ["العشاء", prayer.isha],
      ]
    : [];
  const mag = minutes(prayer?.maghrib ?? "");
  const isha = minutes(prayer?.isha ?? "");
  const blocked = mag !== null && isha !== null && today.minutes >= mag && today.minutes < isha;
  const late = neglected(state, today.date);
  const reviews = state.lessons.filter((l) => l.nextReview && l.nextReview <= today.date && l.status !== "mastered");
  const bars = weeklyBars(state, today.date);
  const maxBar = Math.max(1, ...bars.map((b) => b.minutes));
  const adhere = adherence(state, today.date);
  const mastery = averageMastery(state);
  const least = leastStudied(state, today.date);
  const skipped = mostSkipped(state);
  const missed = missedCount(state, today.date);
  const until = !next
    ? ""
    : next.date === today.date
      ? (minutes(next.start) ?? 0) - today.minutes <= 0
        ? "حان وقتها"
        : `بعد ${formatDuration((minutes(next.start) ?? 0) - today.minutes)}`
      : formatLong(next.date);

  return (
    <>
      <section className="card stack">
        <p className="muted">{formatLong(today.date)}</p>
        <h1>{days >= 0 ? `${days} يومًا حتى البكالوريا` : "حدّث تاريخ البكالوريا من الإعدادات"}</h1>
        <p className="muted">شعبة رياضيات · الوادي. الجدول يحترم الصلاة والارتباطات قبل وضع أي حصة.</p>
      </section>

      {blocked ? (
        <section className="card stack">
          <h2>المغرب إلى العشاء</h2>
          <p>هذه الفترة محجوزة بالكامل. لا دراسة حتى {prayer?.isha}.</p>
        </section>
      ) : null}

      <section className="card stack">
        <div className="spread">
          <h2>الحصة القادمة</h2>
          <span className="muted">{until}</span>
        </div>
        {next ? (
          <>
            <strong>{subjectName(state, next.subjectId)}</strong>
            <p>{next.task}</p>
            <p className="muted">{next.start} – {next.end}</p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                const len = (minutes(next.end) ?? 0) - (minutes(next.start) ?? 0);
                startFocus({ sessionId: next.id, subjectId: next.subjectId, task: next.task, minutes: Math.max(15, len) });
              }}
            >
              ابدأ الدراسة
            </button>
          </>
        ) : (
          <p className="muted">لا حصة قادمة. ولّد الأسبوع من المخطط أو أضف حصة من جدولي.</p>
        )}
      </section>

      <section className="grid-3">
        <div className="stat"><b>{done}</b><span className="muted">مكتملة</span></div>
        <div className="stat"><b>{remaining}</b><span className="muted">متبقية</span></div>
        <div className="stat"><b>{formatDuration(actual)}</b><span className="muted">دراسة فعلية</span></div>
      </section>
      <section className="card stack">
        <div className="spread"><h2>تقدم اليوم</h2><span>{progress}%</span></div>
        <Bar value={progress} />
        <p className="muted">المهم الآن: {next ? next.task : "اختر مادة وابدأ حصة حرة من المؤقت."}</p>
      </section>

      <section className="card stack">
        <div className="spread">
          <h2>الصلاة</h2>
          <button type="button" className="btn btn-ghost" onClick={() => setTab("settings")}>تعديل</button>
        </div>
        {rows.length ? (
          <div className="row">
            {rows.map(([name, time]) => (
              <span key={name} className="chip" aria-pressed={(minutes(time) ?? 0) > today.minutes ? undefined : "false"}>
                {name} {time}
              </span>
            ))}
          </div>
        ) : (
          <p className="muted">لا مواقيت محفوظة لليوم. حدّثها من الإعدادات أو أدخلها يدويًا.</p>
        )}
        <p className="muted">الفترة من المغرب إلى العشاء ممنوعة، وحول كل صلاة هامش قصير. الجمعة لها فترة أوسع.</p>
      </section>

      {late.length ? (
        <section className="card stack">
          <h2><AlertTriangle size={18} aria-hidden="true" /> مواد تحتاج انتباهًا</h2>
          <p>{late.map((s) => s.name).join("، ")}</p>
          <p className="muted">لم تُدرس كفاية هذا الأسبوع أو مرّ عليها وقت طويل. المخطط المحلي يرفع أولويتها.</p>
        </section>
      ) : null}

      <section className="card stack">
        <h2>دروس للمراجعة</h2>
        {reviews.length ? reviews.slice(0, 5).map((lesson) => (
          <div key={lesson.id} className="spread">
            <span>{lesson.title}</span>
            <span className="muted">{lessonStatusLabel(lesson.status)} · {lesson.mastery}%</span>
          </div>
        )) : <p className="muted">لا مراجعة مستحقة. أضف درسًا من المكتبة ثم ابدأ الحفظ.</p>}
      </section>

      <section className="card stack">
        <h2>هذا الأسبوع</h2>
        <div className="grid-2">
          <div className="stat"><b>{adhere === null ? "—" : `${adhere}%`}</b><span className="muted">التزام</span></div>
          <div className="stat"><b>{mastery === null ? "—" : `${mastery}%`}</b><span className="muted">متوسط الإتقان</span></div>
          <div className="stat"><b>{missed}</b><span className="muted">حصص فاتت</span></div>
          <div className="stat"><b>{skipped?.name ?? least?.name ?? "—"}</b><span className="muted">{skipped ? "الأكثر تأجيلًا" : "الأقل دراسة"}</span></div>
        </div>
        <div className="row" style={{ alignItems: "flex-end" }}>
          {bars.map((bar) => (
            <div key={bar.label} className="stack" style={{ flex: 1, alignItems: "center" }}>
              <div className="bar" style={{ height: "4.5rem", width: "0.55rem", display: "flex", alignItems: "flex-end" }}>
                <span style={{ width: "100%", height: `${Math.round((bar.minutes / maxBar) * 100)}%` }} />
              </div>
              <span className="muted">{bar.label}</span>
            </div>
          ))}
        </div>
        <p className="muted">الأعمدة هي دقائق الدراسة الفعلية من السبت إلى الجمعة، لا زمنًا مخططًا.</p>
      </section>
    </>
  );
}
