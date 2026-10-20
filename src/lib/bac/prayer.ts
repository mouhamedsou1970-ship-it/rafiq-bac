import type { PrayerDay } from "./types";

const LAT = 33.368;
const LNG = 6.867;

function clean(value: string): string {
  const m = String(value).match(/\d{1,2}:\d{2}/);
  if (!m) return "00:00";
  const [h, min] = m[0].split(":");
  return `${(h ?? "0").padStart(2, "0")}:${min}`;
}

export async function fetchPrayerMonth(year: number, month: number): Promise<Record<string, PrayerDay>> {
  const url = `https://api.aladhan.com/v1/calendar?latitude=${LAT}&longitude=${LNG}&method=3&school=0&month=${month}&year=${year}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("تعذّر جلب المواقيت. تحقق من الاتصال أو أدخل الأوقات يدويًا.");
  const json = (await res.json()) as {
    data?: {
      timings: Record<string, string>;
      date: { gregorian: { year: string; month: { number: number }; day: string } };
    }[];
  };
  if (!Array.isArray(json.data)) throw new Error("رد المواقيت غير مفهوم");
  const out: Record<string, PrayerDay> = {};
  for (const day of json.data) {
    const g = day.date.gregorian;
    const iso = `${g.year}-${String(g.month.number).padStart(2, "0")}-${g.day.padStart(2, "0")}`;
    out[iso] = {
      fajr: clean(day.timings.Fajr ?? ""),
      sunrise: clean(day.timings.Sunrise ?? ""),
      dhuhr: clean(day.timings.Dhuhr ?? ""),
      asr: clean(day.timings.Asr ?? ""),
      maghrib: clean(day.timings.Maghrib ?? ""),
      isha: clean(day.timings.Isha ?? ""),
      source: "api",
    };
  }
  return out;
}
