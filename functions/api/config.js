// GET /api/config  (público): o que o site precisa para se montar. Nunca devolve e-mails nem dados internos.
import { authenticate, tokenFrom } from "../_lib/auth.js";
import { loadConfig, publicView, DEFAULTS } from "../_lib/config.js";
import { json } from "../_lib/http.js";

export async function onRequestGet({ request, env }) {
  let cfg;
  try { cfg = await loadConfig(env); } catch (_) { cfg = structuredClone(DEFAULTS); } // sem KV, o site segue com os padrões
  let admin = false;
  if (tokenFrom(request)) admin = (await authenticate(request, env)).ok; // só quem tem sessão válida de administrador
  return json({ ...publicView(cfg), admin }, 200, { "Cache-Control": "private, max-age=10", Vary: "Cookie" });
}

export const onRequest = () => json({ error: "Método não permitido." }, 405, { Allow: "GET" });
