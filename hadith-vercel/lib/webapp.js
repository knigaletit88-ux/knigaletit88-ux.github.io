// Проверка данных мини-приложения (Telegram.WebApp.initData): запрос действительно от Telegram
// и от этого пользователя. https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
import { createHmac, timingSafeEqual } from "node:crypto";

// → пользователь {id, first_name, …} или null
export function checkInitData(initData, token, maxAgeSec = 24 * 3600, now = Date.now()) {
  if (!initData || !token) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash") || "";
  params.delete("hash");
  const dataCheck = [...params].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const expected = createHmac("sha256", secret).update(dataCheck).digest("hex");
  if (hash.length !== expected.length || !timingSafeEqual(Buffer.from(hash), Buffer.from(expected))) return null;
  if (now / 1000 - Number(params.get("auth_date") || 0) > maxAgeSec) return null;
  try {
    const user = JSON.parse(params.get("user") || "null");
    return user?.id ? user : null;
  } catch {
    return null;
  }
}

// Для тестов: подписать данные так же, как это делает Telegram
export function signInitData(fields, token) {
  const params = new URLSearchParams(fields);
  const dataCheck = [...params].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", createHmac("sha256", secret).update(dataCheck).digest("hex"));
  return params.toString();
}
