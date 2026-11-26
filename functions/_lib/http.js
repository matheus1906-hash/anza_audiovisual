// Respostas e proteções comuns das funções (Cloudflare Pages Functions).
export const SEC = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
};

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SEC, ...extra },
  });
}

export const fail = (status, message, extra) => json({ error: message }, status, extra);

// Proteção contra CSRF: o cookie do Access é enviado automaticamente pelo navegador, então toda
// alteração exige origem igual, cabeçalho próprio e JSON (isso força um preflight em outros sites).
export function csrfOk(request) {
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(request.url).origin) return false;
  if (request.headers.get("X-Requested-With") !== "anza-admin") return false;
  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) return false;
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin") return false;
  return true;
}

export const MAX_BODY = 20000;
