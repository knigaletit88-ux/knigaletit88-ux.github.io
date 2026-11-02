// Расписание на день: расчёт + поправки пользователя + загруженный календарь (перенос namaz/schedule.py).
import { isReady, settingsParams } from "./models.js";
import { minutes, sunTimes } from "./praytimes.js";
import { isoDate, parseHm, roundMinute, tzHoursAtNoon, wallOf } from "./time.js";

// Ключи загруженного календаря → ключи расписания. "dawn" — начало времени Фаджра,
// "fajr_m" — утренний намаз в мечети (за N минут до восхода).
const CUSTOM_KEYS = { dawn: "imsak", sunrise: "sunrise", zuhr: "zuhr", asr: "asr", maghrib: "maghrib", isha: "isha" };
const ORDER = ["imsak", "sunrise", "zuhr", "asr", "maghrib", "isha"];

/** Ночь от start (Магриб) до end (рассвет следующего дня): трети и середина. */
export function nightParts(start, end) {
  // в секундах всё делится нацело — округление то же, что у timedelta в Python
  const dur = (end - start) * 60;
  const at = (k, n) => roundMinute(start + Math.floor((dur * k) / n) / 60);
  return { start, end, third1: at(1, 3), midnight: at(1, 2), third3: at(2, 3) };
}

/** Расписание одного пользователя; дни кэшируются внутри объекта. */
export class Schedule {
  constructor(s, custom = {}) {
    if (!isReady(s)) throw new Error("не задано место");
    this.s = s;
    this.custom = custom || {};
    this.tz = s.tz;
    this.days = new Map();
  }

  day(d) {
    if (!this.days.has(d)) this.days.set(d, this.compute(d));
    return this.days.get(d);
  }

  compute(d) {
    const s = this.s;
    const base = wallOf(d);
    const tzHours = tzHoursAtNoon(this.tz, d);
    const st = sunTimes(d, s.lat, s.lon, tzHours, settingsParams(s));
    const m = minutes(st);
    const at = (mins, key = "") => base + mins + Math.trunc(Number(s.offsets?.[key] || 0));

    const t = {
      imsak: at(m.dawn, "fajr"),
      sunrise: at(m.sunrise, "sunrise"),
      zuhr: at(m.noon, "zuhr"),
      asr: at(m.asr, "asr"),
      maghrib: at(m.sunset, "maghrib"),
      isha: at(m.dusk, "isha"),
    };
    // фиксированный Зухр не может быть раньше зенита
    if (s.zuhr_fixed) t.zuhr = Math.max(base + parseHm(s.zuhr_fixed), at(m.noon));

    // При очень коротком дне (север зимой) расчётные времена могут слиться — разводим на минуту.
    for (let i = 1; i < ORDER.length; i++) t[ORDER[i]] = Math.max(t[ORDER[i]], t[ORDER[i - 1]] + 1);

    const ov = s.use_custom ? this.custom[isoDate(d)] || {} : {};
    const custom = new Set();
    for (const [src, key] of Object.entries(CUSTOM_KEYS)) {
      if (src in ov) {
        t[key] = base + parseHm(ov[src]);
        custom.add(key);
      }
    }
    if (s.fajr_before) {
      if ("fajr_m" in ov) {
        t.fajr = base + parseHm(ov.fajr_m);
        custom.add("fajr");
      } else {
        t.fajr = t.sunrise - s.fajr_before;
      }
    } else {
      t.fajr = t.imsak;
      if (custom.has("imsak")) custom.add("fajr");
    }
    const noon = base + Math.floor(st.noon * 60);
    const other = 3 - s.asr_factor;
    const otherSt = sunTimes(d, s.lat, s.lon, tzHours, { ...settingsParams(s), asrFactor: other });
    const asr = { [s.asr_factor]: t.asr, [other]: Math.max(at(minutes(otherSt).asr, "asr"), t.zuhr + 1) };
    return { date: d, t, noon, custom, calcLat: st.lat !== s.lat ? st.lat : null, asr };
  }

  /** Ночь, которая начинается с Магриба дня d. */
  night(d) {
    return nightParts(this.day(d).t.maghrib, this.day(d + 1).t.imsak);
  }
}
