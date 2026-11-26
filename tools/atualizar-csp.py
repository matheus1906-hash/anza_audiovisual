#!/usr/bin/env python3
"""Recalcula os hashes da Content-Security-Policy depois que você editar o JS ou o CSS que está dentro do index.html.

Uso (na pasta do projeto):  python3 tools/atualizar-csp.py

Por que existe: a CSP deste site não aceita scripts/estilos inline "soltos". Ela só executa os blocos <script> e <style>
cujo hash SHA-256 está listado. Mudou uma vírgula no bloco? O hash muda e o navegador bloqueia o bloco até você rodar isto.
Atualiza o index.html (meta CSP), o _headers (Netlify/Cloudflare Pages) e o vercel.json.
"""
import base64, hashlib, pathlib, re, sys

raiz = pathlib.Path(__file__).resolve().parent.parent
html = (raiz / "index.html").read_text(encoding="utf-8")

def h(texto):
    return "'sha256-" + base64.b64encode(hashlib.sha256(texto.encode("utf-8")).digest()).decode() + "'"

scripts = " ".join(h(t) for t in re.findall(r"<script>(.*?)</script>", html, re.S))
estilos = " ".join(h(t) for t in re.findall(r"<style>(.*?)</style>", html, re.S))
if not scripts or not estilos:
    sys.exit("Não encontrei <script> ou <style> inline no index.html.")

mudou = False
for nome in ("index.html", "_headers", "vercel.json"):
    f = raiz / nome
    if not f.exists():
        continue
    antes = f.read_text(encoding="utf-8")
    troca = lambda novo: (lambda m: m.group(1) + novo + (" " if m.group(2).endswith(" ") else ""))
    depois = re.sub(r"(script-src )((?:'sha256-[^']+' ?)+)", troca(scripts), antes, count=1)
    depois = re.sub(r"(style-src-elem )((?:'sha256-[^']+' ?)+)", troca(estilos), depois, count=1)
    if depois != antes:
        f.write_text(depois, encoding="utf-8"); mudou = True
        print("atualizado:", nome)
print("hashes em dia." if not mudou else "pronto: hashes atualizados.")
