// Выкладывает бота «Энциклопедия хадисов» на Deno Deploy (бесплатный тариф) и подключает к нему Telegram.
// Запускается на ноутбуке: node deploy.mjs. Первый запуск создаёт приложение hadith, дальше — обновляет его.
//
// Настройки — в .env рядом (в репозиторий он не попадает, см. .gitignore):
//   DENO_DEPLOY_TOKEN=ddo_…      токен организации: console.deno.com → Settings → Organization tokens
//   BOT_TOKEN=…                  токен бота от @BotFather
//   ADMIN_IDS=…                  Telegram ID админов через запятую
//   KV_REST_API_URL=…, KV_REST_API_TOKEN=…   база Upstash Redis (каналы, пользователи, рассылки)
// Любая другая строка (NAMAZ_URL, BOT_USERNAME, …) тоже уходит в настройки приложения.
//
// На сервер уходит только код (api/, lib/, server.js, index.html): копия собирается во временной папке
// системы, поэтому .env остаётся на ноутбуке. (Не внутри репозитория: CLI пропускает всё, что
// перечислено в .gitignore.)
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const APP = "hadith";
const OUT = join(tmpdir(), `${APP}-deploy`);
// закреплённые версии; --node-modules-dir=none — чтобы Deno не искал пакеты CLI в node_modules
const CLI = "npx --yes deno@2.9.6 run -A --node-modules-dir=none jsr:@deno/deploy@0.0.9908";

const env = existsSync(`${HERE}.env`)
  ? Object.fromEntries(readFileSync(`${HERE}.env`, "utf8").split(/\r?\n/)
    .map((line) => line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]))
  : {};
for (const name of ["DENO_DEPLOY_TOKEN", "BOT_TOKEN"]) {
  if (!env[name]) {
    console.error(`В .env нет ${name} — см. начало этого файла.`);
    process.exit(1);
  }
}

/** Команда CLI; ответ — JSON из последней строки вывода. */
function deno(args, { cwd = HERE, allowFail = false } = {}) {
  const result = spawnSync(`${CLI} ${args.join(" ")} --json --non-interactive`, {
    cwd, encoding: "utf8", shell: true, env: { ...process.env, DENO_DEPLOY_TOKEN: env.DENO_DEPLOY_TOKEN, NO_COLOR: "1" },
  });
  let json = null;
  try { json = JSON.parse((result.stdout || "").trim().split(/\r?\n/).at(-1) || "null"); } catch { /* не JSON */ }
  if (result.status !== 0 && !allowFail) {
    console.error(`${result.stdout || ""}${result.stderr || ""}`.split(env.BOT_TOKEN).join("<токен>").slice(-2000));
    throw new Error(`deno deploy ${args[0] || ""}: ошибка (код ${result.status})`);
  }
  return { ok: result.status === 0, json };
}

const org = deno(["orgs", "list"]).json?.[0]?.slug;
if (!org) throw new Error("Токен Deno Deploy не видит ни одной организации");
console.log("Deno Deploy:", org);

function publish() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  for (const path of ["server.js", "index.html", "package.json", "api", "lib"]) cpSync(`${HERE}${path}`, `${OUT}/${path}`, { recursive: true });
  const apps = deno(["apps", "list", "--org", org], { allowFail: true }).json;
  const { json } = JSON.stringify(apps || "").includes(`"${APP}"`)
    ? deno(["--org", org, "--app", APP, "--prod", "."], { cwd: OUT })
    : deno(["create", "--org", org, "--app", APP, "--source", "local", "--runtime-mode", "dynamic",
            "--entrypoint", "server.js", "--region", "eu", "--do-not-use-detected-build-config", "."], { cwd: OUT });
  rmSync(OUT, { recursive: true, force: true });
  const url = json?.productionUrl || json?.timelines?.find((t) => /prod/i.test(t.partition))?.domains?.[0];
  if (!url) throw new Error(`Не нашёл постоянный адрес в ответе Deno Deploy:\n${JSON.stringify(json)}`);
  return String(url).replace(/^(?!https:\/\/)/, "https://").replace(/\/$/, "");
}

console.log("Выкладываю…");
publish();

// Настройки — файлом, а не в командной строке; файл сразу удаляется. Перевыкладка нужна, чтобы бот их увидел.
const vars = Object.entries(env).filter(([name]) => name !== "DENO_DEPLOY_TOKEN");
writeFileSync(`${HERE}.deploy.env`, vars.map(([k, v]) => `${k}=${v}`).join("\n") + "\n", "utf8");
try {
  deno(["env", "load", "--replace", "--org", org, "--app", APP, ".deploy.env"]);
} finally {
  rmSync(`${HERE}.deploy.env`, { force: true });
}
console.log("Настройки:", vars.map(([k]) => k).join(", "));
const url = publish();

// /api/setup ставит webhook на адрес, по которому его открыли, — открываем постоянный
const page = await fetch(`${url}/api/setup`).then((r) => r.text());
const done = page.includes("✅");
console.log(done ? `Готово: ${url} — бот подключён.` : `Выложено на ${url}, но /api/setup не подключил бота:\n${page.replace(/<[^>]+>/g, " ").slice(0, 500)}`);
writeFileSync(`${HERE}url.txt`, `${url}\n`, "utf8");
if (!done) process.exit(1);
