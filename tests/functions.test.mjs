import test from "node:test";
import assert from "node:assert/strict";
import { AUD, TEAM, goodConfig, makeEnv, makeKey, req, sign, MemKV } from "./helpers.mjs";
import { verifyJWT, roleFor, authenticate } from "../functions/_lib/auth.js";
import { validate, clean, diff, DEFAULTS, loadConfig } from "../functions/_lib/config.js";
import * as cfgApi from "../functions/admin/api/config.js";
import * as auditApi from "../functions/admin/api/audit.js";
import * as diagApi from "../functions/admin/api/diag.js";
import * as meApi from "../functions/admin/api/me.js";
import * as pub from "../functions/api/config.js";
import * as mw from "../functions/_middleware.js";

const key = await makeKey("k1"), other = await makeKey("k1"); // "other" usa o mesmo kid, mas outra chave privada
const dona = await sign(key, { email: "Dona@Exemplo.com" });
const dev = await sign(key, { email: "dev@exemplo.com" });
const intruso = await sign(key, { email: "intruso@exemplo.com" });

test("JWT válido: aceita e normaliza o e-mail", async () => {
  const r = await verifyJWT(dona, makeEnv(key));
  assert.equal(r.ok, true); assert.equal(r.email, "dona@exemplo.com");
});
test("JWT expirado é recusado", async () => assert.equal((await verifyJWT(await sign(key, { exp: Math.floor(Date.now() / 1000) - 600 }), makeEnv(key))).reason, "expirado"));
test("JWT com 'aud' de outro aplicativo é recusado", async () => assert.equal((await verifyJWT(await sign(key, { aud: ["outro"] }), makeEnv(key))).reason, "aud"));
test("JWT com emissor (iss) de outro time é recusado", async () => assert.equal((await verifyJWT(await sign(key, { iss: "https://evil.cloudflareaccess.com" }), makeEnv(key))).reason, "iss"));
test("JWT ainda não válido (nbf no futuro) é recusado", async () => assert.equal((await verifyJWT(await sign(key, { nbf: Math.floor(Date.now() / 1000) + 600 }), makeEnv(key))).reason, "nbf"));
test("payload adulterado (troca de e-mail) invalida a assinatura", async () => {
  const [h, , s] = dona.split(".");
  const p = Buffer.from(JSON.stringify({ iss: `https://${TEAM}`, aud: [AUD], email: "intruso@exemplo.com", exp: Math.floor(Date.now() / 1000) + 999 })).toString("base64url");
  assert.equal((await verifyJWT(`${h}.${p}.${s}`, makeEnv(key))).reason, "assinatura");
});
test("assinado por outra chave com o mesmo kid é recusado", async () => assert.equal((await verifyJWT(await sign(other, {}), makeEnv(key))).reason, "assinatura"));
test("alg 'none' e HS256 são recusados", async () => {
  for (const alg of ["none", "HS256"]) assert.equal((await verifyJWT(await sign(key, {}, { alg }), makeEnv(key))).reason, "cabecalho");
  const unsigned = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url") + "." + Buffer.from(JSON.stringify({ email: "dona@exemplo.com" })).toString("base64url") + ".";
  assert.equal((await verifyJWT(unsigned, makeEnv(key))).ok, false);
});
test("kid desconhecido é recusado", async () => assert.equal((await verifyJWT(await sign(await makeKey("zzz"), {}), makeEnv(key))).reason, "chave"));
test("lixo, vazio e token gigante são recusados", async () => {
  for (const t of ["", "abc", "a.b", "a.b.c", "x".repeat(5000), null, undefined, 42]) assert.equal((await verifyJWT(t, makeEnv(key))).ok, false);
});
test("sem TEAM_DOMAIN/POLICY_AUD ninguém entra (fecha por padrão)", async () => {
  const env = makeEnv(key, { TEAM_DOMAIN: "", POLICY_AUD: "" });
  assert.equal((await authenticate(req("/x", { token: dona }), env)).ok, false);
});
test("papéis: dona, dev e fora da lista", async () => {
  const env = makeEnv(key);
  assert.equal(roleFor("dona@exemplo.com", env), "owner"); assert.equal(roleFor("dev@exemplo.com", env), "dev"); assert.equal(roleFor("x@x.com", env), null);
  assert.equal((await authenticate(req("/x", { token: intruso }), env)).status, 403);
  assert.equal((await authenticate(req("/x"), env)).status, 401);
  const noLists = makeEnv(key, { OWNER_EMAILS: "", DEV_EMAILS: "" });
  assert.equal((await authenticate(req("/x", { token: dona }), noLists)).status, 403);
});
test("cookie CF_Authorization também vale", async () => assert.equal((await authenticate(req("/x", { cookie: dona }), makeEnv(key))).ok, true));

// ---------- validação ----------
test("validate: configuração boa passa e ignora chaves extras", () => {
  const v = validate({ ...goodConfig(), admin: true, __proto__: { x: 1 } });
  assert.equal(v.ok, true); assert.equal("admin" in v.value, false);
});
test("validate: números, @ e tipos", () => {
  const bad = (patch, path) => { const v = validate(goodConfig(patch)); assert.equal(v.ok, false, path); assert.ok(v.errors[path], path); };
  bad({ contacts: { wa: "abc", instagram: "anza.wedding", youtube: "@anzaaudiovisual" } }, "contacts.wa");
  bad({ contacts: { wa: "123", instagram: "anza.wedding", youtube: "@anzaaudiovisual" } }, "contacts.wa");
  bad({ contacts: { wa: "5564981025380", instagram: "a b/c", youtube: "@anzaaudiovisual" } }, "contacts.instagram");
  bad({ contacts: { wa: "5564981025380", instagram: "anza.wedding", youtube: "@a b" } }, "contacts.youtube");
  bad({ maintenance: { on: "sim", title: "ok ok", message: "" } }, "maintenance.on");
  bad({ maintenance: { on: false, title: "x".repeat(61), message: "" } }, "maintenance.title");
  bad({ maintenance: { on: false, title: "ok ok", message: "x".repeat(301) } }, "maintenance.message");
  bad({ banner: { on: true, text: "" } }, "banner.text");
  bad({ banner: { on: true, text: "x".repeat(141) } }, "banner.text");
  bad({ photos: { hidden: ["ok", "Maiúscula"] } }, "photos.hidden");
  bad({ photos: { hidden: ["a/../b"] } }, "photos.hidden");
  bad({ photos: { hidden: Array.from({ length: 201 }, (_, i) => "f" + i) } }, "photos.hidden");
  bad({ photos: { hidden: "festa-1" } }, "photos.hidden");
  assert.equal(validate(null).ok, false); assert.equal(validate("x").ok, false); assert.equal(validate([]).ok, false);
});
test("validate: normaliza telefone, @ do Instagram e do YouTube e remove duplicadas", () => {
  const v = validate(goodConfig({ contacts: { wa: "+55 (64) 98102-5380", instagram: "@anza.wedding", youtube: "anzaaudiovisual" }, photos: { hidden: ["b-1", "a-1", "b-1"] } }));
  assert.equal(v.ok, true);
  assert.deepEqual(v.value.contacts, { wa: "5564981025380", instagram: "anza.wedding", youtube: "@anzaaudiovisual" });
  assert.deepEqual(v.value.photos.hidden, ["a-1", "b-1"]);
});
test("validate: links e HTML nos textos", () => {
  for (const t of ["veja https://golpe.example", "acesse www.golpe.net", "oferta golpe.xyz", "fale em t.me/golpe", "bit.ly/x"]) {
    assert.equal(validate(goodConfig({ banner: { on: true, text: t } })).ok, false, t);
  }
  const v = validate(goodConfig({ banner: { on: true, text: "Aviso <script>alert(1)</script> importante" } }));
  assert.equal(v.ok, true); assert.equal(/[<>]/.test(v.value.banner.text), false);
});
test("clean: invisíveis, bidi, controle e largura total", () => {
  const sujo = ["a", String.fromCodePoint(0x200b), "b", String.fromCodePoint(0x202e), "c", String.fromCodePoint(0x1), "d", String.fromCodePoint(0xff1c), "script", String.fromCodePoint(0xff1e), "e", String.fromCodePoint(0xfeff)].join("");
  const r = clean(sujo);
  assert.equal(/[<>]/.test(r), false);
  for (const c of r) { const n = c.codePointAt(0); assert.ok(n >= 32 && !(n >= 0x200b && n <= 0x200f) && n !== 0x202e && n !== 0xfeff, n.toString(16)); }
});
test("diff descreve o que mudou", () => {
  const a = structuredClone(DEFAULTS), b = structuredClone(DEFAULTS);
  b.maintenance.on = true; b.banner.on = true; b.banner.text = "Olá"; b.contacts.wa = "5511999999999"; b.photos.hidden = ["x-1"];
  const d = diff(a, b).join(" | ");
  for (const s of ["Modo manutenção: não → sim", "Aviso no topo", "Contato wa", "Fotos ocultadas: x-1"]) assert.ok(d.includes(s), s);
  assert.deepEqual(diff(a, structuredClone(a)), []);
});
test("loadConfig: dado corrompido no KV volta ao padrão e não chega ao site", async () => {
  const env = makeEnv(key);
  await env.ANZA_KV.put("config", JSON.stringify({ rev: 7, maintenance: { on: true, title: "<img src=x onerror=alert(1)>", message: "" }, contacts: { wa: "evil" } }));
  const c = await loadConfig(env);
  assert.equal(c.maintenance.on, false); assert.equal(c.contacts.wa, DEFAULTS.contacts.wa); assert.equal(c.rev, 7);
});

// ---------- API do painel ----------
const put = (env, token, body, opts = {}) => cfgApi.onRequestPut({ request: req("/admin/api/config", { method: "PUT", token, body, csrf: true, ...opts }), env });

test("API do painel exige login e papel", async () => {
  const env = makeEnv(key);
  for (const api of [cfgApi, auditApi, diagApi, meApi]) {
    assert.equal((await api.onRequestGet({ request: req("/x"), env })).status, 401);
    assert.equal((await api.onRequestGet({ request: req("/x", { token: intruso }), env })).status, 403);
    assert.equal((await api.onRequestGet({ request: req("/x", { token: "lixo" }), env })).status, 401);
  }
  assert.equal((await put(env, undefined, goodConfig())).status, 401);
  assert.equal((await put(env, intruso, goodConfig())).status, 403);
});
test("GET /admin/api/me devolve e-mail e papel", async () => {
  const env = makeEnv(key);
  assert.deepEqual(await (await meApi.onRequestGet({ request: req("/x", { token: dona }), env })).json(), { email: "dona@exemplo.com", role: "owner" });
});
test("diagnóstico: só dev; a dona (logada) recebe 403", async () => {
  const env = makeEnv(key);
  assert.equal((await diagApi.onRequestGet({ request: req("/x", { token: dona }), env })).status, 403);
  const r = await diagApi.onRequestGet({ request: req("/x", { token: dev }), env });
  assert.equal(r.status, 200); const j = await r.json(); assert.equal(j.kv, true); assert.equal(j.audTail, AUD.slice(-6));
  assert.ok(!JSON.stringify(j).includes("exemplo.com"), "diagnóstico não lista e-mails");
});
test("PUT salva, incrementa rev e registra no histórico", async () => {
  const env = makeEnv(key);
  const body = goodConfig({ banner: { on: true, text: "Estamos de portas abertas" } });
  const r = await put(env, dona, body); assert.equal(r.status, 200);
  const j = await r.json(); assert.equal(j.config.rev, 1); assert.equal(j.config.updatedBy, "dona@exemplo.com"); assert.ok(j.changes[0].startsWith("Aviso"));
  const a = await (await auditApi.onRequestGet({ request: req("/x", { token: dev }), env })).json();
  assert.equal(a.entries.length, 1); assert.equal(a.entries[0].by, "dona@exemplo.com"); assert.equal(a.entries[0].role, "owner");
  const g = await (await cfgApi.onRequestGet({ request: req("/x", { token: dev }), env })).json();
  assert.equal(g.config.banner.text, "Estamos de portas abertas");
});
test("PUT sem mudanças não gera histórico nem muda rev", async () => {
  const env = makeEnv(key); const r = await put(env, dona, goodConfig()); const j = await r.json();
  assert.equal(j.config.rev, 0); assert.deepEqual(j.changes, []); assert.equal((await env.ANZA_KV.get("audit")), null);
});
test("PUT com rev velho dá 409 (duas pessoas editando)", async () => {
  const env = makeEnv(key);
  assert.equal((await put(env, dona, goodConfig({ banner: { on: true, text: "primeiro" } }))).status, 200);
  const r = await put(env, dev, goodConfig({ banner: { on: true, text: "segundo" }, rev: 0 })); assert.equal(r.status, 409);
  assert.equal((await put(env, dev, goodConfig({ banner: { on: true, text: "segundo" }, rev: 1 }))).status, 200);
});
test("PUT recusa CSRF: sem Origin, outra origem, sem cabeçalho próprio, sem JSON, Sec-Fetch-Site cruzado", async () => {
  const env = makeEnv(key);
  const base = { method: "PUT", token: dona, body: goodConfig() };
  const call = (headers, csrf) => cfgApi.onRequestPut({ request: req("/admin/api/config", { ...base, csrf, headers }), env });
  assert.equal((await call({}, false)).status, 403);
  assert.equal((await call({ Origin: "https://evil.example", "X-Requested-With": "anza-admin", "Content-Type": "application/json" }, false)).status, 403);
  assert.equal((await call({ Origin: "https://site.exemplo.com", "Content-Type": "application/json" }, false)).status, 403);
  assert.equal((await call({ Origin: "https://site.exemplo.com", "X-Requested-With": "anza-admin", "Content-Type": "text/plain" }, false)).status, 403);
  assert.equal((await call({ "Sec-Fetch-Site": "cross-site" }, true)).status, 403);
  assert.equal((await call({}, true)).status, 200);
});
test("PUT recusa corpo grande, JSON ruim e dados inválidos", async () => {
  const env = makeEnv(key);
  assert.equal((await put(env, dona, "x".repeat(25000))).status, 413);
  assert.equal((await put(env, dona, "{ruim")).status, 400);
  const r = await put(env, dona, goodConfig({ contacts: { wa: "javascript:1", instagram: "a", youtube: "@abc" } }));
  assert.equal(r.status, 400); assert.ok((await r.json()).fields["contacts.wa"]);
  assert.equal(await env.ANZA_KV.get("config"), null, "nada foi salvo");
});
test("métodos não permitidos retornam 405", async () => {
  const env = makeEnv(key);
  for (const api of [cfgApi, auditApi, diagApi, meApi, pub]) assert.equal((await api.onRequest({ request: req("/x", { method: "DELETE" }), env })).status, 405);
});

// ---------- API pública ----------
test("GET /api/config: sem sessão não é admin e não vaza e-mail, histórico nem texto de manutenção", async () => {
  const env = makeEnv(key);
  await put(env, dona, goodConfig({ banner: { on: true, text: "Olá" }, photos: { hidden: ["festa-1"] } }));
  const j = await (await pub.onRequestGet({ request: req("/api/config"), env })).json();
  assert.equal(j.admin, false); assert.deepEqual(j.photos.hidden, ["festa-1"]); assert.equal(j.banner.text, "Olá");
  const raw = JSON.stringify(j);
  for (const s of ["exemplo.com", "updatedBy", "message", "title"]) assert.ok(!raw.includes(s), s);
});
test("GET /api/config: admin=true só com sessão válida de administrador", async () => {
  const env = makeEnv(key);
  assert.equal((await (await pub.onRequestGet({ request: req("/api/config", { cookie: dona }), env })).json()).admin, true);
  assert.equal((await (await pub.onRequestGet({ request: req("/api/config", { cookie: intruso }), env })).json()).admin, false);
  assert.equal((await (await pub.onRequestGet({ request: req("/api/config", { cookie: "lixo" }), env })).json()).admin, false);
});
test("GET /api/config: se o KV cair, devolve os padrões", async () => {
  const env = makeEnv(key); env.ANZA_KV.fail = true;
  const r = await pub.onRequestGet({ request: req("/api/config"), env }); assert.equal(r.status, 200);
  assert.equal((await r.json()).contacts.wa, DEFAULTS.contacts.wa);
});

// ---------- modo manutenção ----------
const run = (env, path, opts) => mw.onRequest({ request: req(path, opts), env, next: async () => new Response("SITE", { status: 200 }) });
const setMaintenance = async (env, on) => put(env, dona, goodConfig({ rev: (await loadConfig(env)).rev, maintenance: { on, title: "Voltamos já", message: "Já já." } }));
test("manutenção desligada: o site passa direto", async () => assert.equal(await (await run(makeEnv(key), "/")).text(), "SITE"));
test("manutenção ligada: visitante recebe 503 com CSP por nonce e sem indexação", async () => {
  const env = makeEnv(key); await setMaintenance(env, true);
  const r = await run(env, "/"); assert.equal(r.status, 503);
  assert.equal(r.headers.get("Retry-After"), "3600"); assert.equal(r.headers.get("X-Robots-Tag"), "noindex"); assert.equal(r.headers.get("Cache-Control"), "no-store");
  const csp = r.headers.get("Content-Security-Policy"), html = await r.text();
  const nonce = csp.match(/nonce-([^']+)/)[1]; assert.ok(html.includes(`nonce="${nonce}"`)); assert.ok(!csp.includes("script-src") && csp.includes("default-src 'none'"));
  assert.ok(html.includes("https://wa.me/5564981025380")); assert.ok(!html.includes("<script"));
  assert.equal((await run(env, "/index.html")).status, 503);
});
test("manutenção: administrador com sessão vê o site; sessão de intruso e token ruim não", async () => {
  const env = makeEnv(key); await setMaintenance(env, true);
  assert.equal(await (await run(env, "/", { cookie: dona })).text(), "SITE");
  assert.equal(await (await run(env, "/", { token: dev })).text(), "SITE");
  assert.equal((await run(env, "/", { cookie: intruso })).status, 503);
  assert.equal((await run(env, "/", { cookie: "lixo" })).status, 503);
});
test("manutenção: outras rotas, POST e arquivos não são interceptados", async () => {
  const env = makeEnv(key); await setMaintenance(env, true);
  for (const p of ["/img/festa-1-480.webp", "/admin/", "/api/config", "/admin/api/me"]) assert.equal(await (await run(env, p)).text(), "SITE", p);
  assert.equal(await (await run(env, "/", { method: "POST", body: "{}" })).text(), "SITE");
});
test("manutenção: título/mensagem com HTML vindos de dado corrompido são escapados", async () => {
  const env = makeEnv(key);
  const bad = goodConfig({ maintenance: { on: true, title: "Oi", message: "ok" } });
  await env.ANZA_KV.put("config", JSON.stringify({ ...bad, rev: 1 }));
  assert.equal((await run(env, "/")).status, 503);
  const html = mw.maintenancePage({ maintenance: { title: `<img src=x onerror=alert(1)>"'&`, message: "<script>1</script>" }, contacts: { wa: "javascript:1" } });
  const t = await html.text(); assert.ok(!t.includes("<img") && !t.includes("<script") && t.includes("&lt;img") && !t.includes("javascript:"));
});
test("manutenção: se o KV falhar, o site continua no ar", async () => {
  const env = makeEnv(key); env.ANZA_KV.fail = true;
  assert.equal(await (await run(env, "/")).text(), "SITE");
});
