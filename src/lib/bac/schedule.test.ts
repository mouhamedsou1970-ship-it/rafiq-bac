import assert from "node:assert/strict";
import test from "node:test";
import { createState } from "./defaults.ts";
import { busyBlocks, generateLocalPlan, validateIncoming } from "./schedule.ts";
import type { PrayerDay } from "./types.ts";

const prayer: PrayerDay = {
  fajr: "05:16",
  sunrise: "06:39",
  dhuhr: "12:18",
  asr: "15:31",
  maghrib: "17:57",
  isha: "19:15",
  source: "manual",
};

const saturday = createState({
  commitments: [],
  prayerBufferBefore: 10,
  prayerBufferAfter: 15,
  prayerByDate: { "2026-10-17": prayer, "2026-10-16": prayer },
  days: [
    { enabled: false, start: "14:00", end: "22:00", maxMinutes: 60 },
    { enabled: false, start: "14:00", end: "22:00", maxMinutes: 60 },
    { enabled: false, start: "14:00", end: "22:00", maxMinutes: 60 },
    { enabled: false, start: "14:00", end: "22:00", maxMinutes: 60 },
    { enabled: false, start: "14:00", end: "22:00", maxMinutes: 60 },
    { enabled: true, start: "15:30", end: "21:30", maxMinutes: 90 },
    { enabled: true, start: "08:30", end: "21:30", maxMinutes: 120 },
  ],
  subjects: [
    { id: "sub-math", name: "الرياضيات", coefficient: 7, weakness: 4, weeklyGoalMin: 200, core: true },
    { id: "sub-phys", name: "العلوم الفيزيائية", coefficient: 5, weakness: 4, weeklyGoalMin: 120, core: true },
    { id: "sub-ar", name: "اللغة العربية", coefficient: 3, weakness: 2, weeklyGoalMin: 60, core: false },
  ],
});

test("maghrib through isha is one blocked span", () => {
  const blocks = busyBlocks(saturday, "2026-10-17");
  const span = blocks.find((b) => b.reason === "المغرب إلى العشاء");
  assert.ok(span);
  assert.equal(span.start, 17 * 60 + 57);
  assert.equal(span.end, 19 * 60 + 15);
});

test("local plan never overlaps prayer, maghrib-isha, or the daily cap", () => {
  const plan = generateLocalPlan(saturday, ["2026-10-17"]);
  assert.ok(plan.sessions.length > 0);
  let total = 0;
  for (const session of plan.sessions) {
    const [sh, sm] = session.start.split(":").map(Number);
    const [eh, em] = session.end.split(":").map(Number);
    const a = sh * 60 + sm;
    const b = eh * 60 + em;
    total += b - a;
    for (const block of busyBlocks(saturday, session.date)) {
      assert.equal(a < block.end && block.start < b, false, `${session.start}-${session.end} hits ${block.reason}`);
    }
    assert.ok(session.subjectId);
  }
  assert.ok(total <= 120);
});

test("a session during maghrib-isha is rejected", () => {
  const result = validateIncoming(saturday, [
    { date: "2026-10-17", start: "18:00", end: "18:40", subject: "الرياضيات", task: "حل مسائل" },
  ]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errors[0] ?? "", /المغرب إلى العشاء/);
});

test("review-like subject names are rejected", () => {
  const result = validateIncoming(saturday, [
    { date: "2026-10-17", start: "09:00", end: "09:50", subject: "مراجعة ليلية", task: "حفظ" },
  ]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errors[0] ?? "", /مراجعة ليلية/);
});

test("friday uses its own window and jumuah label", () => {
  const blocks = busyBlocks(saturday, "2026-10-16");
  assert.ok(blocks.some((b) => b.reason === "صلاة الجمعة"));
  const plan = generateLocalPlan(saturday, ["2026-10-16"]);
  for (const session of plan.sessions) {
    assert.equal(session.date, "2026-10-16");
    assert.ok(session.start >= "15:30");
    assert.ok(session.end <= "21:30");
  }
});
