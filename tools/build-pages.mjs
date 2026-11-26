#!/usr/bin/env node
// Monta a pasta dist/ só com o que deve ficar público no Cloudflare Pages.
// (Código das Functions, testes, ferramentas e documentos NÃO vão para dist/: ficam só no repositório.)
// No Cloudflare Pages: Build command = node tools/build-pages.mjs | Build output directory = dist
import { cp, rm, mkdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "dist");
const ITEMS = ["index.html", "thumb.jpg", "_headers", "_routes.json", "img", "admin", ".well-known"];

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
for (const it of ITEMS) {
  const from = path.join(ROOT, it);
  try { await access(from); } catch { console.warn("faltando (ignorado):", it); continue; }
  await cp(from, path.join(OUT, it), { recursive: true, dereference: true });
}
console.log("dist/ pronto:", ITEMS.join(", "));
