// Хранилище раздела в Redis — те же ключи и тот же JSON, что у Python-версии (namaz/cloud.py):
//   namaz:users        множество — у кого есть настройки
//   namaz:user:<id>    {"s": настройки, "custom": загруженный календарь, "active": можно ли писать}
//   namaz:fsm:s:<чат>:<пользователь>   состояние диалога («Place:waiting» — бот ждёт город)
//   namaz:fsm:d:<чат>:<пользователь>   данные диалога (найденные города, расписание на подтверждении)
import { pipeline, redis } from "../lib/store.js";
import { User } from "./events.js";
import { settingsFromJson } from "./models.js";
import { isoDate } from "./time.js";

export const P = "namaz:"; // префикс всех ключей — база общая с ботом хадисов
const FSM_TTL = 24 * 3600;
// Пока активно ожидание города, текст человека уходит сюда, а не в поиск по хадисам, — держим недолго.
const STATE_TTL = 15 * 60;
const CUSTOM_KEEP_DAYS = 45; // сколько хранить прошедшие дни загруженного календаря

export function dump(user) {
  const oldest = isoDate(Math.floor(Date.now() / 86_400_000) - CUSTOM_KEEP_DAYS);
  const custom = Object.fromEntries(Object.entries(user.custom).filter(([day]) => day >= oldest));
  return JSON.stringify({ s: user.s, custom, active: user.active });
}

export function load(uid, raw) {
  const data = JSON.parse(raw);
  return new User(uid, settingsFromJson(data.s), data.custom || {}, data.active ?? true);
}

/** Пользователи на время одного запроса: изменённых flush() записывает обратно в Redis. */
export class Store {
  constructor() {
    this.users = new Map();
    this.dirty = new Set();
  }

  // Нового пользователя не записываем, пока он что-нибудь не настроит (save).
  put(uid, raw) {
    const user = raw ? load(uid, raw) : new User(uid);
    this.users.set(uid, user);
    return user;
  }

  get(uid) {
    return this.users.get(uid) || this.put(uid, null);
  }

  save(user) {
    user.changed();
    this.dirty.add(user.id);
  }

  setCustom(user, values) {
    Object.assign(user.custom, values);
    this.save(user);
  }

  clearCustom(user) {
    user.custom = {};
    this.save(user);
  }

  async loadAll() {
    const ids = (await redis("SMEMBERS", `${P}users`)) || [];
    if (!ids.length) return;
    const raws = await redis("MGET", ...ids.map((i) => `${P}user:${i}`));
    ids.forEach((id, i) => { if (raws[i]) this.put(Number(id), raws[i]); });
  }

  /** Записывает изменённых пользователей; true — если было что записывать. */
  async flush() {
    const commands = [];
    for (const uid of this.dirty) commands.push(["SET", `${P}user:${uid}`, dump(this.users.get(uid))], ["SADD", `${P}users`, String(uid)]);
    this.dirty.clear();
    if (commands.length) await pipeline(commands);
    return commands.length > 0;
  }
}

/** Состояние диалога одного человека в одном чате. */
export class Fsm {
  constructor(chatId, userId) {
    this.key = `${chatId}:${userId}`;
    this.state = undefined; // ещё не читали
  }

  async getState() {
    if (this.state === undefined) this.state = (await redis("GET", `${P}fsm:s:${this.key}`)) ?? null;
    return this.state;
  }

  async setState(value) {
    if (this.state === value) return;
    this.state = value;
    if (value === null) await redis("DEL", `${P}fsm:s:${this.key}`);
    else await redis("SET", `${P}fsm:s:${this.key}`, value, "EX", String(STATE_TTL));
  }

  async getData() {
    const raw = await redis("GET", `${P}fsm:d:${this.key}`);
    return raw ? JSON.parse(raw) : {};
  }

  async setData(data) {
    data = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null && v !== undefined));
    if (Object.keys(data).length) await redis("SET", `${P}fsm:d:${this.key}`, JSON.stringify(data), "EX", String(FSM_TTL));
    else await redis("DEL", `${P}fsm:d:${this.key}`);
  }

  async updateData(changes) {
    await this.setData({ ...(await this.getData()), ...changes });
  }

  async clear() {
    await this.setState(null);
    await this.setData({});
  }
}
