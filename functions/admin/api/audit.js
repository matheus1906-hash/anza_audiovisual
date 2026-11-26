// GET /admin/api/audit: últimas 100 alterações (quem, quando, o quê).
import { authenticate } from "../../_lib/auth.js";
import { loadAudit } from "../../_lib/config.js";
import { fail, json } from "../../_lib/http.js";

export async function onRequestGet({ request, env }) {
  const a = await authenticate(request, env);
  if (!a.ok) return fail(a.status, a.status === 401 ? "Faça login." : "Sem permissão.");
  return json({ entries: await loadAudit(env) });
}
export const onRequest = () => fail(405, "Método não permitido.", { Allow: "GET" });
