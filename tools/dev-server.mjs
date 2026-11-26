#!/usr/bin/env node
// Servidor LOCAL que imita o Cloudflare Pages para testar o site e o painel sem deploy:
// arquivos estáticos + _headers + _routes.json + Functions + _middleware + KV em memória + um "Access" de mentira.
// Só para desenvolvimento: escuta apenas em 127.0.0.1 e NÃO é o Access de verdade.
//   node tools/dev-server.mjs [--site dist] [--functions functions] [--port 8788] [--no-access]
//   Entrar como: /__login?as=dona | dev | intruso   ·   Sair: /cdn-cgi/access/logout
//   --no-access desliga a "porta do Access" (para provar que as Functions recusam sozinhas).
import http from "node:http";
import { readFile, stat, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MemKV, makeKey, sign, TEAM, AUD } from "../tests/helpers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i > -1 ? process.argv[i + 1] : d; };
const SITE = path.resolve(ROOT, arg("site", "dist"));
const FUNCS = path.resolve(ROOT, arg("functions", "functions"));
const PORT = +arg("port", "8788");
const NO_ACCESS = process.argv.includes("--no-access");

const key = await makeKey("dev1");
const kv = new MemKV();
const EMAILS = { dona: "dona@exemplo.com", dev: "dev@exemplo.com", intruso: "intruso@exemplo.com" };
const env = { TEAM_DOMAIN: TEAM, POLICY_AUD: AUD, OWNER_EMAILS: EMAILS.dona, DEV_EMAILS: EMAILS.dev, ANZA_KV: kv, __JWKS: { keys: [key.jwk] } };
const { verifyJWT, roleFor } = await import(pathToFileURL(path.join(FUNCS, "_lib/auth.js")));

// ---- rotas das Functions (arquivo = rota)
const routes = new Map();
async function walk(dir, rel = "") {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith("_")) continue;
    if (e.isDirectory()) await walk(path.join(dir, e.name), rel + "/" + e.name);
    else if (e.name.endsWith(".js")) routes.set(e.name === "index.js" ? rel || "/" : rel + "/" + e.name.slice(0, -3), pathToFileURL(path.join(dir, e.name)).href);
  }
}
await walk(FUNCS);
let middleware = null;
try { middleware = (await import(pathToFileURL(path.join(FUNCS, "_middleware.js")))).onRequest; } catch { /* sem middleware */ }
let routesJson = { include: ["/*"], exclude: [] };
try { routesJson = JSON.parse(await readFile(path.join(SITE, "_routes.json"), "utf8")); } catch { /* padrão */ }
const globMatch = (p, url) => (p.endsWith("*") ? url.startsWith(p.slice(0, -1)) : url === p);
const runsFunctions = (url) => routesJson.include.some((p) => globMatch(p, url)) && !(routesJson.exclude || []).some((p) => globMatch(p, url));

// ---- _headers
let rules = [];
try {
  let cur = null;
  for (const raw of (await readFile(path.join(SITE, "_headers"), "utf8")).split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    if (!/^\s/.test(raw)) { cur = { re: new RegExp("^" + raw.trim().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"), h: [] }; rules.push(cur); }
    else if (cur) { const t = raw.trim(); if (t.startsWith("!")) cur.h.push([t.slice(1).trim(), null]); else { const i = t.indexOf(":"); cur.h.push([t.slice(0, i).trim(), t.slice(i + 1).trim()]); } }
  }
} catch { /* sem _headers */ }
function headersFor(url) {
  const out = new Map();
  for (const r of rules) if (r.re.test(url)) for (const [k, v] of r.h) {
    const kk = k.toLowerCase();
    if (v === null) out.delete(kk); else out.set(kk, out.has(kk) ? out.get(kk) + ", " + v : v);
  }
  return out;
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".webp": "image/webp", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8" };
async function serveStatic(pathname, method) {
  let p;
  try { p = decodeURIComponent(pathname); } catch { return new Response("Bad request", { status: 400 }); }
  if (p.includes("\0") || p.split("/").includes("..")) return new Response("Bad request", { status: 400 });
  let file = path.join(SITE, p);
  if (!file.startsWith(SITE)) return new Response("Bad request", { status: 400 });
  try {
    let st = await stat(file);
    if (st.isDirectory()) {
      if (!pathname.endsWith("/")) return new Response(null, { status: 308, headers: { Location: pathname + "/" } });
      file = path.join(file, "index.html"); st = await stat(file);
    }
    const body = await readFile(file);
    const h = new Headers({ "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Content-Length": String(body.length) });
    for (const [k, v] of headersFor(pathname)) h.set(k, v);
    return new Response(method === "HEAD" ? null : body, { status: 200, headers: h });
  } catch { return new Response("Não encontrado", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } }); }
}

const cookieOf = (req, name) => { const m = (req.headers.get("cookie") || "").match(new RegExp("(?:^|; )" + name + "=([^;]*)")); return m ? m[1] : ""; };
const html = (s, status = 200) => new Response(s, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

async function handle(req) {
  const url = new URL(req.url), p = url.pathname;
  // utilidades só de desenvolvimento
  if (p === "/__login") {
    const as = url.searchParams.get("as"), next = url.searchParams.get("next") || "/admin/";
    if (!EMAILS[as]) return html(`<!doctype html><meta charset="utf-8"><title>Entrar (teste)</title><body style="font:16px system-ui;padding:2rem"><h1>Login de teste (simula o Access)</h1><p><a href="/__login?as=dona&next=${encodeURIComponent(next)}">Dona</a> · <a href="/__login?as=dev&next=${encodeURIComponent(next)}">Desenvolvedor</a> · <a href="/__login?as=intruso&next=${encodeURIComponent(next)}">Intruso</a></p>`);
    const tok = await sign(key, { email: EMAILS[as] });
    const to = next.startsWith("/") && !next.startsWith("//") ? next : "/admin/";
    return new Response(null, { status: 302, headers: { Location: to, "Set-Cookie": `CF_Authorization=${tok}; Path=/; HttpOnly; SameSite=Lax` } });
  }
  if (p === "/__token") { const as = url.searchParams.get("as"); return EMAILS[as] ? Response.json({ token: await sign(key, { email: EMAILS[as] }) }) : new Response("?", { status: 400 }); }
  if (p === "/__kv/fail") { kv.fail = url.searchParams.get("on") === "1"; return Response.json({ fail: kv.fail }); }
  if (p === "/__kv/reset") { kv.m.clear(); kv.fail = false; return Response.json({ ok: true }); }
  if (p === "/cdn-cgi/access/logout") return new Response(null, { status: 302, headers: { Location: "/", "Set-Cookie": "CF_Authorization=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax" } });

  // "Access": protege /admin e /admin/*
  let request = req;
  if (!NO_ACCESS && (p === "/admin" || p.startsWith("/admin/"))) {
    const tok = cookieOf(req, "CF_Authorization");
    const v = tok ? await verifyJWT(tok, env) : { ok: false };
    if (!v.ok) return new Response(null, { status: 302, headers: { Location: "/__login?next=" + encodeURIComponent(p), "Cache-Control": "no-store" } });
    if (!roleFor(v.email, env)) return html("<!doctype html><meta charset=utf-8><title>Acesso negado</title><p>Access: você não está na lista.</p>", 403);
    const h = new Headers(req.headers); h.set("Cf-Access-Jwt-Assertion", tok);
    request = new Request(req, { headers: h });
  }

  const next = () => serveStatic(p, req.method);
  if (!runsFunctions(p)) return next();
  const ctx = { request, env, params: {}, data: {}, waitUntil() {}, next };
  const run = async () => {
    const mod = routes.get(p.replace(/\/$/, "") || "/");
    if (!mod) return next();
    const m = await import(mod);
    const h = m["onRequest" + req.method[0] + req.method.slice(1).toLowerCase()] || m.onRequest;
    return h ? h(ctx) : new Response("Method Not Allowed", { status: 405 });
  };
  if (middleware) return middleware({ ...ctx, next: run });
  return run();
}

http.createServer(async (nreq, nres) => {
  try {
    const chunks = []; let size = 0;
    for await (const c of nreq) { size += c.length; if (size > 1e6) { nres.writeHead(413).end(); return; } chunks.push(c); }
    const body = Buffer.concat(chunks);
    const host = nreq.headers.host || `127.0.0.1:${PORT}`;
    const init = { method: nreq.method, headers: nreq.headers };
    if (!["GET", "HEAD"].includes(nreq.method) && body.length) init.body = body;
    const res = await handle(new Request(`http://${host}${nreq.url}`, init));
    const heads = {}; res.headers.forEach((v, k) => { if (k !== "set-cookie") heads[k] = v; });
    const sc = res.headers.getSetCookie?.() || []; if (sc.length) heads["set-cookie"] = sc;
    nres.writeHead(res.status, heads);
    nres.end(Buffer.from(await res.arrayBuffer()));
  } catch (e) { console.error(e); nres.writeHead(500, { "Content-Type": "text/plain" }).end("Erro interno"); }
}).listen(PORT, "127.0.0.1", () => console.log(`dev: http://127.0.0.1:${PORT}  (site=${path.relative(ROOT, SITE)} · Access de mentira ${NO_ACCESS ? "DESLIGADO" : "ligado"})`));
