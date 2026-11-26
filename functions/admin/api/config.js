// GET /admin/api/config: configuração completa. PUT /admin/api/config: salva (com rev, para duas pessoas não se sobrescreverem).
import { authenticate } from "../../_lib/auth.js";
import { diff, loadConfig, saveConfig, validate } from "../../_lib/config.js";
import { csrfOk, fail, json, MAX_BODY } from "../../_lib/http.js";

export async function onRequestGet({ request, env }) {
  const a = await authenticate(request, env);
  if (!a.ok) return fail(a.status, a.status === 401 ? "Faça login." : "Sem permissão.");
  return json({ config: await loadConfig(env), me: { email: a.email, role: a.role } });
}

export async function onRequestPut({ request, env }) {
  const a = await authenticate(request, env);
  if (!a.ok) return fail(a.status, a.status === 401 ? "Faça login." : "Sem permissão.");
  if (!csrfOk(request)) return fail(403, "Pedido recusado.");
  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) return fail(415, "Envie JSON.");
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > MAX_BODY) return fail(413, "Pedido grande demais.");
  const body = await request.text();
  if (body.length > MAX_BODY) return fail(413, "Pedido grande demais.");
  let input;
  try { input = JSON.parse(body); } catch (_) { return fail(400, "JSON inválido."); }
  const v = validate(input);
  if (!v.ok) return json({ error: "Dados inválidos.", fields: v.errors }, 400);
  const current = await loadConfig(env);
  if (!input || input.rev !== current.rev) return json({ error: "Outra pessoa salvou antes. Recarregue a página.", rev: current.rev }, 409);
  const changes = diff(current, v.value);
  if (!changes.length) return json({ config: current, changes: [] });
  const saved = await saveConfig(env, { ...v.value, rev: current.rev }, a, changes);
  return json({ config: saved, changes });
}

export const onRequest = () => fail(405, "Método não permitido.", { Allow: "GET, PUT" });
