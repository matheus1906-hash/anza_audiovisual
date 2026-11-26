// Utilitários de teste: chaves RSA, tokens do Access assinados, KV em memória e ambiente falso.
export const TEAM = "anza.cloudflareaccess.com", AUD = "aud-teste-123";
const b64u = (buf) => Buffer.from(buf).toString("base64url");
const enc = (o) => b64u(JSON.stringify(o));

export async function makeKey(kid = "k1") {
  const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  return { priv: kp.privateKey, jwk: { ...jwk, kid, use: "sig", alg: "RS256" }, kid };
}

export async function sign(key, claims = {}, header = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = { alg: "RS256", kid: key.kid, typ: "JWT", ...header };
  const p = { iss: `https://${TEAM}`, aud: [AUD], email: "dona@exemplo.com", iat: now, nbf: now - 5, exp: now + 3600, ...claims };
  const data = enc(h) + "." + enc(p);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.priv, new TextEncoder().encode(data));
  return data + "." + b64u(sig);
}

export class MemKV {
  constructor() { this.m = new Map(); this.fail = false; }
  async get(k, type) { if (this.fail) throw new Error("kv fora"); const v = this.m.get(k); if (v === undefined) return null; return type === "json" ? JSON.parse(v) : v; }
  async put(k, v) { if (this.fail) throw new Error("kv fora"); this.m.set(k, String(v)); }
}

export function makeEnv(key, extra = {}) {
  return { TEAM_DOMAIN: TEAM, POLICY_AUD: AUD, OWNER_EMAILS: "dona@exemplo.com", DEV_EMAILS: "dev@exemplo.com", ANZA_KV: new MemKV(), __JWKS: { keys: [key.jwk] }, ...extra };
}

export const ORIGIN = "https://site.exemplo.com";
export function req(path, { method = "GET", token, cookie, body, headers = {}, csrf = false } = {}) {
  const h = new Headers(headers);
  if (token) h.set("Cf-Access-Jwt-Assertion", token);
  if (cookie) h.set("Cookie", `CF_Authorization=${cookie}`);
  if (csrf) { h.set("Origin", ORIGIN); h.set("X-Requested-With", "anza-admin"); h.set("Content-Type", "application/json"); }
  const init = { method, headers: h };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  return new Request(ORIGIN + path, init);
}

export const goodConfig = (over = {}) => ({
  rev: 0,
  maintenance: { on: false, title: "Voltamos já", message: "Estamos fazendo uma manutenção rápida no site. Para falar com a ANZA agora, chame no WhatsApp." },
  banner: { on: false, text: "" },
  contacts: { wa: "5564981025380", instagram: "anza.wedding", youtube: "@anzaaudiovisual" },
  photos: { hidden: [] },
  ...over,
});
