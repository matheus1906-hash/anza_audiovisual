// Modo manutenção: quando ligado, visitantes recebem a página 503; administradores com sessão veem o site normal.
import { authenticate, tokenFrom } from "./_lib/auth.js";
import { loadConfig } from "./_lib/config.js";
import { SEC } from "./_lib/http.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function maintenancePage(cfg) {
  const nonce = btoa(crypto.randomUUID());
  const wa = /^\d{10,15}$/.test(cfg.contacts.wa) ? cfg.contacts.wa : "";
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>ANZA Wedding</title>
<style nonce="${nonce}">html{background:#141312}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box;color:#efe9de;font:300 17px/1.7 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:center}
main{max-width:34rem}.m{letter-spacing:.4em;font-size:.8rem;color:#d3b27a;margin:0 0 2rem}h1{font:400 clamp(2.4rem,9vw,3.6rem)/1.05 Georgia,"Times New Roman",serif;margin:0 0 1rem}
p{margin:0 0 2rem;color:#a8a195}a{display:inline-block;padding:.85rem 1.7rem;border:1px solid #efe9de;border-radius:99px;color:#efe9de;text-decoration:none}a:focus-visible,a:hover{background:#efe9de;color:#141312}</style></head>
<body><main><p class="m">ANZA WEDDING</p><h1>${esc(cfg.maintenance.title)}</h1><p>${esc(cfg.maintenance.message)}</p>${wa ? `<a href="https://wa.me/${wa}" rel="noopener noreferrer">Chamar no WhatsApp</a>` : ""}</main></body></html>`;
  return new Response(html, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "3600", "X-Robots-Tag": "noindex",
      "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      "X-Frame-Options": "DENY", ...SEC,
    },
  });
}

export async function onRequest({ request, env, next }) {
  const path = new URL(request.url).pathname;
  if ((request.method !== "GET" && request.method !== "HEAD") || (path !== "/" && path !== "/index.html")) return next();
  let cfg;
  try { cfg = await loadConfig(env); } catch (_) { return next(); } // se o KV falhar, o site continua no ar
  if (!cfg.maintenance.on) return next();
  if (tokenFrom(request) && (await authenticate(request, env)).ok) return next();
  return maintenancePage(cfg);
}
