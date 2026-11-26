// GET /admin/api/diag: diagnóstico técnico. Só o papel "dev" (a dona recebe 403 mesmo estando logada).
import { authenticate, teamBase } from "../../_lib/auth.js";
import { loadAudit, loadConfig } from "../../_lib/config.js";
import { fail, json } from "../../_lib/http.js";

export async function onRequestGet({ request, env }) {
  const a = await authenticate(request, env);
  if (!a.ok) return fail(a.status, a.status === 401 ? "Faça login." : "Sem permissão.");
  if (a.role !== "dev") return fail(403, "Somente o desenvolvedor.");
  let kv = false, rev = null, audit = null;
  try { const c = await loadConfig(env); kv = true; rev = c.rev; audit = (await loadAudit(env)).length; } catch (_) {}
  return json({
    team: teamBase(env), audTail: String(env.POLICY_AUD || "").slice(-6), kv, rev, auditEntries: audit,
    owners: String(env.OWNER_EMAILS || "").split(/[,;\s]+/).filter(Boolean).length,
    devs: String(env.DEV_EMAILS || "").split(/[,;\s]+/).filter(Boolean).length,
    now: new Date().toISOString(),
  });
}
export const onRequest = () => fail(405, "Método não permitido.", { Allow: "GET" });
