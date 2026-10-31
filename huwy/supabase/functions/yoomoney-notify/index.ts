// Huwy Wallet — приём HTTP-уведомлений ЮMoney.
// Деплой БЕЗ терминала: Supabase Dashboard → Edge Functions → New Function →
// вставить этот файл → Deploy. Секрет задать в Secrets (см. README).
// Deno, стандартная библиотека + supabase-js с CDN. Node.js не нужен.
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SECRET = Deno.env.get("YOOMONEY_SECRET") || "";

async function hmacHex(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const s = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data));
  return [...new Uint8Array(s)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return new Response("bad body", { status: 200 });
  }
  const p: Record<string, string> = {};
  form.forEach((v, k) => { p[k] = String(v); });

  // тестовые пустые уведомления из кнопки «Протестировать» — просто подтверждаем
  if (!p["operation_id"]) return new Response("ok", { status: 200 });
  if (p["test_notification"] === "true") return new Response("ok", { status: 200 });

  // 1) проверка подписи HMAC-SHA256 (дока: yoomoney.ru/docs/payment-buttons/using-api/notifications)
  const sign = (p["sign"] || "").toLowerCase();
  const base = Object.keys(p).filter((k) => k !== "sign").sort()
    .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(p[k])).join("&");
  if (!SECRET || (await hmacHex(SECRET, base)) !== sign) {
    console.error("bad sign for operation " + p["operation_id"]);
    return new Response("bad sign", { status: 400 });
  }

  // 2) отсев нефинальных платежей
  if (p["unaccepted"] === "true") return new Response("unaccepted", { status: 200 });
  if (p["codepro"] === "true") return new Response("codepro", { status: 200 });

  const amount = parseFloat(p["amount"] || "0"); // пришло по факту, уже без комиссии
  const label = (p["label"] || "").toUpperCase(); // наш адрес HUWY
  if (!(amount > 0) || !label) return new Response("bad data", { status: 200 });

  // 3) начисление (идемпотентность по operation_id — внутри SQL-функции)
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { error } = await sb.rpc("huwy_credit_yoomoney", {
    p_address: label, p_amount: amount,
    p_op_id: p["operation_id"], p_sender: p["sender"] || "",
  });
  if (error) {
    console.error("credit error: " + error.message);
    return new Response("db error", { status: 200 });
  }
  return new Response("ok", { status: 200 });
});
