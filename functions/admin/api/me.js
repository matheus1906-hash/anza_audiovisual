// GET /admin/api/me: quem está logado e com qual papel.
import { authenticate } from "../../_lib/auth.js";
import { fail, json } from "../../_lib/http.js";

export async function onRequestGet({ request, env }) {
  const a = await authenticate(request, env);
  if (!a.ok) return fail(a.status, a.status === 401 ? "Faça login." : "Sem permissão.");
  return json({ email: a.email, role: a.role });
}
export const onRequest = () => fail(405, "Método não permitido.", { Allow: "GET" });
