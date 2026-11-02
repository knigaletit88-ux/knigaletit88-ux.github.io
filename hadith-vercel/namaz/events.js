// Пользователь раздела и какие уведомления ему положены (перенос namaz/storage.py: User и namaz/events.py).
import * as hijri from "./hijri.js";
import { ASR_ALT, asrName, defaultSettings, PRAYERS } from "./models.js";
import { Schedule } from "./schedule.js";
import * as texts from "./texts.js";
import { parseHm, toWall, wallDay, wallOf, weekday } from "./time.js";

export class User {
  constructor(id, s = defaultSettings(), custom = {}, active = true) {
    this.id = id;
    this.s = s;
    this.custom = custom; // загруженный календарь: 'ГГГГ-ММ-ДД' → {ключ: 'ЧЧ:ММ'}
    this.active = active;
    this.sched = null;
    this.events = new Map(); // кэш уведомлений по датам
  }

  schedule() {
    if (!this.sched || this.sched.days.size > 500) this.sched = new Schedule(this.s, this.custom);
    return this.sched;
  }

  changed() {
    this.sched = null;
    this.events.clear();
  }
}

/** Уведомления, относящиеся к дню d (ночные могут прийтись на следующую календарную дату). */
export function buildEvents(user, d) {
  const s = user.s;
  const sched = user.schedule();
  const day = sched.day(d);
  const night = sched.night(d);
  const out = [];
  const add = (at, kind, text) => out.push({ at, kind, text });

  // Аср в уведомлениях всегда с пометкой, по какой тени; второй Аср включается отдельно.
  const other = 3 - s.asr_factor;
  const list = PRAYERS.map((p) => [p, day.t[p], p === "asr" ? asrName(s.asr_factor) : ""]);
  list.push([ASR_ALT, day.asr[other], asrName(other)]);
  for (const [p, t, name] of list) {
    if (s.at[p]) add(t, `at:${p}`, texts.atPrayer(p, t, name));
    if (s.pre[p] && s.pre_minutes > 0) add(t - s.pre_minutes, `pre:${p}`, texts.beforePrayer(p, t, s.pre_minutes, name));
  }

  const x = s.extra;
  if (x.duha) {
    const start = day.t.sunrise + s.duha_delay;
    const end = day.noon - texts.DUHA_END_BEFORE_NOON;
    if (start < end) add(start, "duha", texts.duha(start, end, d));
  }
  if (x.wed && weekday(d) === 2) {
    const t = day.t.zuhr + texts.WED_DELAY;
    if (t < day.t.asr) add(t, "wed", texts.wednesday(day.t.zuhr, day.t.asr));
  }
  if (x.third) add(night.third3, "third", texts.lastThird(night));
  if (x.midnight) add(night.midnight, "midnight", texts.midnight(night));

  // О посте напоминаем накануне вечером.
  const tomorrow = d + 1;
  const reasons = hijri.fastingReasons(tomorrow, s.hijri_offset).filter((r) => x[texts.FAST_TOGGLE[r]]);
  if (reasons.length) {
    const nxt = sched.day(tomorrow);
    add(wallOf(d, parseHm(s.fast_time)), "fast", texts.fast(tomorrow, reasons, nxt.t.imsak, nxt.t.maghrib, s.hijri_offset));
  }
  return out;
}

function eventsFor(user, d) {
  if (!user.events.has(d)) {
    for (const old of user.events.keys()) if (old < d - 2) user.events.delete(old);
    user.events.set(d, buildEvents(user, d));
  }
  return user.events.get(d);
}

/** События пользователя в интервале (after, until] — моменты UTC в миллисекундах. */
export function dueEvents(user, afterMs, untilMs) {
  const tz = user.schedule().tz;
  const lo = toWall(tz, afterMs);
  const hi = toWall(tz, untilMs);
  const out = [];
  for (let d = wallDay(lo) - 1; d <= wallDay(hi); d++) out.push(...eventsFor(user, d).filter((e) => lo < e.at && e.at <= hi));
  return out.sort((a, b) => a.at - b.at);
}

/** Настенное время ближайшего уведомления строго после момента afterMs (null — все выключены). */
export function nextEventTime(user, afterMs) {
  const lo = toWall(user.schedule().tz, afterMs);
  let best = null;
  for (const d of [wallDay(lo) - 1, wallDay(lo), wallDay(lo) + 1]) {
    for (const e of eventsFor(user, d)) if (e.at > lo && (best === null || e.at < best)) best = e.at;
  }
  return best;
}
