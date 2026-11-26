// Valida o login do Cloudflare Access dentro da própria função (segunda trava, além do Access na frente).
// Variáveis de ambiente: TEAM_DOMAIN (ex.: anza.cloudflareaccess.com), POLICY_AUD (AUD tag do aplicativo Access),
// OWNER_EMAILS (dona) e DEV_EMAILS (desenvolvedor), separados por vírgula. Sem elas, ninguém entra.
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64u(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const parse = (bytes) => JSON.parse(dec.decode(bytes));
const norm = (d) => String(d || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
export const teamBase = (env) => "https://" + norm(env.TEAM_DOMAIN);
const bad = (reason) => ({ ok: false, reason });

let cache = { at: 0, keys: null };
async function getKeys(env, force = false) {
  // env.__JWKS é um objeto e só existe nos testes: variáveis do painel do Cloudflare são sempre texto.
  if (env.__JWKS && typeof env.__JWKS === "object") return env.__JWKS.keys;
  const now = Date.now();
  if (cache.keys && !force && now - cache.at < 10 * 60e3) return cache.keys;
  if (cache.keys && force && now - cache.at < 30e3) return cache.keys;
  const r = await fetch(teamBase(env) + "/cdn-cgi/access/certs", { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error("certs " + r.status);
  const j = await r.json();
  if (!Array.isArray(j.keys)) throw new Error("certs formato");
  cache = { at: now, keys: j.keys };
  return j.keys;
}

export async function verifyJWT(token, env, nowSec = Math.floor(Date.now() / 1000)) {
  try {
    if (typeof token !== "string" || token.length > 4096) return bad("formato");
    const parts = token.split(".");
    if (parts.length !== 3) return bad("formato");
    const header = parse(b64u(parts[0])), claims = parse(b64u(parts[1]));
    if (header.alg !== "RS256" || typeof header.kid !== "string") return bad("cabecalho");
    if (!env.TEAM_DOMAIN || !env.POLICY_AUD) return bad("configuracao");
    let jwk = (await getKeys(env)).find((k) => k.kid === header.kid);
    if (!jwk) jwk = (await getKeys(env, true)).find((k) => k.kid === header.kid);
    if (!jwk || jwk.kty !== "RSA") return bad("chave");
    const key = await crypto.subtle.importKey(
      "jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const okSig = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64u(parts[2]), enc.encode(parts[0] + "." + parts[1]));
    if (!okSig) return bad("assinatura");
    const leeway = 30;
    if (claims.iss !== teamBase(env)) return bad("iss");
    if (!(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes(env.POLICY_AUD)) return bad("aud");
    if (typeof claims.exp !== "number" || claims.exp + leeway < nowSec) return bad("expirado");
    if (typeof claims.nbf === "number" && claims.nbf - leeway > nowSec) return bad("nbf");
    if (typeof claims.email !== "string" || !claims.email) return bad("email");
    return { ok: true, email: claims.email.trim().toLowerCase(), claims };
  } catch (_) {
    return bad("erro");
  }
}

const list = (s) => String(s || "").split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
export function roleFor(email, env) {
  if (list(env.DEV_EMAILS).includes(email)) return "dev";
  if (list(env.OWNER_EMAILS).includes(email)) return "owner";
  return null;
}

export function tokenFrom(request, { cookie = true } = {}) {
  const h = request.headers.get("Cf-Access-Jwt-Assertion");
  if (h) return h;
  if (!cookie) return null;
  const m = (request.headers.get("Cookie") || "").match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return m ? m[1] : null;
}

// 401 = sem login válido; 403 = login válido, mas e-mail fora da lista de administradores.
export async function authenticate(request, env, opts) {
  const token = tokenFrom(request, opts);
  if (!token) return { ok: false, status: 401, reason: "sem login" };
  const v = await verifyJWT(token, env);
  if (!v.ok) return { ok: false, status: 401, reason: v.reason };
  const role = roleFor(v.email, env);
  if (!role) return { ok: false, status: 403, reason: "sem permissão" };
  return { ok: true, email: v.email, role };
}
