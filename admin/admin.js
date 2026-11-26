// Painel ANZA. Sem innerHTML: todo texto entra por textContent (a CSP ainda exige Trusted Types).
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const ROLE = { owner: "Dona", dev: "Desenvolvedor" };
  const TABS = ["home", "manutencao", "aviso", "contatos", "fotos", "historico", "avancado"];
  const state = { cfg: null, draft: null, me: null, photos: null, filter: "todas", onlyHidden: false, audit: null, saving: false };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const editable = (c) => ({ maintenance: c.maintenance, banner: c.banner, contacts: c.contacts, photos: c.photos });
  const getp = (o, p) => p.split(".").reduce((a, k) => a[k], o);
  const setp = (o, p, v) => { const k = p.split("."); const last = k.pop(); k.reduce((a, x) => a[x], o)[last] = v; };
  const fmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
  const when = (iso) => { const d = new Date(iso); return isNaN(d) ? "-" : fmt.format(d); };

  // ---- rede ----
  class ApiError extends Error { constructor(msg, status, extra) { super(msg); this.status = status; Object.assign(this, extra); } }
  async function api(path, { method = "GET", body } = {}) {
    const opt = { method, credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } };
    if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers["Content-Type"] = "application/json"; opt.headers["X-Requested-With"] = "anza-admin"; }
    let r;
    try { r = await fetch(path, opt); } catch (_) { throw new ApiError("Sem conexão ou a sessão expirou. Recarregue a página.", 0); }
    let j = null;
    if ((r.headers.get("content-type") || "").includes("application/json")) { try { j = await r.json(); } catch (_) {} }
    if (!r.ok) throw new ApiError((j && j.error) || "Não foi possível concluir. Recarregue a página.", r.status, j ? { fields: j.fields } : {});
    if (!j) throw new ApiError("Resposta inesperada. Recarregue a página para entrar de novo.", r.status);
    return j;
  }

  // ---- utilidades de tela ----
  let toastTimer = 0;
  function toast(msg, err) {
    const t = $("#toast"); t.textContent = msg; t.classList.toggle("err", !!err); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
  }
  const changes = () => {
    const out = [], a = editable(state.cfg), b = editable(state.draft);
    for (const el of $$("[data-bind]")) { const p = el.dataset.bind; if (getp(a, p) !== getp(b, p)) out.push(p); }
    const x = a.photos.hidden, y = b.photos.hidden;
    for (const s of y) if (!x.includes(s)) out.push("photos+" + s);
    for (const s of x) if (!y.includes(s)) out.push("photos-" + s);
    return out;
  };

  // ---- abas ----
  function show(tab) {
    if (!TABS.includes(tab) || (tab === "avancado" && state.me.role !== "dev")) tab = "home";
    for (const b of $$("[role=tab]")) { const on = b.dataset.tab === tab; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; }
    for (const p of $$(".panel")) p.hidden = p.id !== "p-" + tab;
    if (location.hash !== "#" + tab) history.replaceState(null, "", "#" + tab);
    if (tab === "historico") loadAudit();
  }

  // ---- renderização ----
  function setText(id, text, cls) { const el = $(id); el.textContent = text; if (cls !== undefined) el.className = el.className.replace(/\b(on|off|warn)\b/g, "").trim() + (cls ? " " + cls : ""); }
  function render() {
    const c = state.cfg, d = state.draft;
    for (const el of $$("[data-bind]")) {
      const v = getp(d, el.dataset.bind);
      if (el.type === "checkbox") { if (el.checked !== v) el.checked = v; } else if (el.value !== v) el.value = v;
    }
    for (const el of $$("[data-count]")) { const n = getp(d, el.dataset.count).length; el.textContent = `${n} de ${el.dataset.max}`; }
    setText("#pv-m-title", d.maintenance.title || "Título"); setText("#pv-m-msg", d.maintenance.message);
    setText("#pv-banner", d.banner.text || "Seu aviso aparece aqui");
    setText("#pv-wa", /^\d{10,15}$/.test(d.contacts.wa.replace(/\D/g, "")) ? `Abre: wa.me/${d.contacts.wa.replace(/\D/g, "")}` : "");
    setText("#pv-ig", d.contacts.instagram ? `Abre: instagram.com/${d.contacts.instagram.replace(/^@/, "")}` : "");
    setText("#pv-yt", d.contacts.youtube ? `Abre: youtube.com/${d.contacts.youtube.startsWith("@") ? d.contacts.youtube : "@" + d.contacts.youtube}` : "");
    // visão geral (sempre reflete o que está salvo no servidor)
    setText("#h-site", c.maintenance.on ? "Em manutenção" : "No ar", c.maintenance.on ? "warn" : "on");
    setText("#h-site-sub", c.maintenance.on ? "Visitantes veem a página de aviso." : "Visitantes veem o site normal.");
    setText("#h-banner", c.banner.on ? "Ativo" : "Desativado", c.banner.on ? "on" : "off");
    setText("#h-banner-sub", c.banner.on ? c.banner.text : "Nenhum aviso aparece no topo.");
    setText("#h-photos", String(c.photos.hidden.length), c.photos.hidden.length ? "warn" : "off");
    setText("#h-photos-sub", c.photos.hidden.length ? "foto(s) fora do site" : "Todas as fotos estão visíveis.");
    setText("#h-last", c.updatedAt ? when(c.updatedAt) : "Nenhuma ainda");
    setText("#h-last-sub", c.updatedBy ? `por ${c.updatedBy}` : "A configuração é a original.");
    renderPhotos(); renderSavebar();
  }

  function renderSavebar() {
    const n = changes().length, bar = $("#savebar");
    bar.hidden = n === 0;
    $("#sb-text").textContent = n === 1 ? "1 alteração não salva" : `${n} alterações não salvas`;
    $("#sb-save").disabled = state.saving;
  }

  function renderPhotos() {
    const P = state.photos; if (!P) return;
    const hidden = new Set(state.draft.photos.hidden);
    const box = $("#f-niches");
    if (!box.children.length) {
      const mk = (slug, label) => { const b = document.createElement("button"); b.type = "button"; b.dataset.n = slug; b.textContent = label; return b; };
      box.append(mk("todas", "Todas"), ...P.niches.map(([s, n]) => mk(s, n)));
    }
    for (const b of $$("button", box)) b.setAttribute("aria-pressed", String(b.dataset.n === state.filter));
    const grid = $("#f-grid"); grid.replaceChildren();
    let shown = 0;
    for (const p of P.photos) {
      if (state.filter !== "todas" && p.n !== state.filter) continue;
      if (state.onlyHidden && !hidden.has(p.s)) continue;
      const b = document.createElement("button"); b.type = "button"; b.className = "ph"; b.dataset.s = p.s;
      b.setAttribute("aria-pressed", String(hidden.has(p.s)));
      b.setAttribute("aria-label", `${p.t}. ${hidden.has(p.s) ? "Oculta. Toque para mostrar." : "Visível. Toque para ocultar."}`);
      const img = document.createElement("img"); img.src = `/img/${p.s}-480.webp`; img.alt = ""; img.loading = "lazy"; img.decoding = "async"; img.width = 160; img.height = 200;
      const tag = document.createElement("span"); tag.className = "tag"; tag.textContent = hidden.has(p.s) ? "Oculta" : "Visível";
      b.append(img, tag); grid.append(b); shown++;
    }
    $("#f-count").textContent = `${shown} foto(s) na lista · ${hidden.size} oculta(s) no total`;
  }

  // ---- histórico e avançado ----
  async function loadAudit() {
    if (state.audit) return paintAudit();
    try { state.audit = (await api("/admin/api/audit")).entries; paintAudit(); } catch (e) { toast(e.message, true); }
  }
  function paintAudit() {
    const body = $("#a-rows"); body.replaceChildren();
    $("#a-empty").hidden = state.audit.length > 0;
    for (const a of state.audit) {
      const tr = document.createElement("tr");
      const t = document.createElement("td"); t.textContent = when(a.t);
      const w = document.createElement("td"); w.textContent = a.by; const sm = document.createElement("div"); sm.className = "by"; sm.textContent = ROLE[a.role] || a.role; w.append(sm);
      const c = document.createElement("td"), ul = document.createElement("ul");
      for (const x of a.changes) { const li = document.createElement("li"); li.textContent = x; ul.append(li); }
      c.append(ul); tr.append(t, w, c); body.append(tr);
    }
  }
  async function runDiag() {
    const out = $("#d-out"); out.replaceChildren();
    try {
      const d = await api("/admin/api/diag");
      const rows = [["Time do Access", d.team], ["AUD (final)", "…" + d.audTail], ["Armazenamento (KV)", d.kv ? "ok" : "com erro"], ["Revisão da configuração", String(d.rev)],
        ["Itens no histórico", String(d.auditEntries)], ["Donas cadastradas", String(d.owners)], ["Desenvolvedores cadastrados", String(d.devs)], ["Hora do servidor", when(d.now)]];
      for (const [k, v] of rows) { const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = k; dd.textContent = v; out.append(dt, dd); }
    } catch (e) { toast(e.message, true); }
  }
  function exportJson() {
    const blob = new Blob([JSON.stringify(editable(state.cfg), null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "anza-config.json"; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  function importJson() {
    const err = $("#x-err"); err.textContent = "";
    try {
      const j = JSON.parse($("#x-json").value), cur = editable(state.draft);
      if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error("O JSON precisa ser um objeto.");
      // só copia campos que já existem, com o mesmo tipo (ignora o resto, inclusive __proto__); o servidor valida de novo ao salvar
      for (const k of Object.keys(cur)) if (j[k] && typeof j[k] === "object" && !Array.isArray(j[k]))
        for (const f of Object.keys(cur[k])) if (Object.hasOwn(j[k], f) && typeof j[k][f] === typeof cur[k][f] && Array.isArray(j[k][f]) === Array.isArray(cur[k][f])) cur[k][f] = clone(j[k][f]);
      state.draft = { ...state.draft, ...cur }; render(); toast("Carregado no formulário. Revise e salve.");
    } catch (e) { err.textContent = "JSON inválido: " + e.message; }
  }

  // ---- salvar ----
  function showFieldErrors(fields) {
    for (const el of $$("[data-err]")) el.textContent = "";
    for (const el of $$("[data-bind]")) el.removeAttribute("aria-invalid");
    for (const [p, m] of Object.entries(fields || {})) {
      const e = $(`[data-err="${CSS.escape(p)}"]`); if (e) e.textContent = m;
      const i = $(`[data-bind="${CSS.escape(p)}"]`); if (i) i.setAttribute("aria-invalid", "true");
    }
    const first = Object.keys(fields || {})[0]; if (first) { const t = TABS.find((x) => (first.startsWith("maintenance") && x === "manutencao") || (first.startsWith("banner") && x === "aviso") || (first.startsWith("contacts") && x === "contatos") || (first.startsWith("photos") && x === "fotos")); if (t) show(t); }
  }
  async function save() {
    if (state.saving || !changes().length) return;
    state.saving = true; renderSavebar(); showFieldErrors({});
    try {
      const r = await api("/admin/api/config", { method: "PUT", body: { ...clone(editable(state.draft)), rev: state.cfg.rev } });
      state.cfg = r.config; state.draft = clone(r.config); state.audit = null;
      toast(r.changes.length ? "Alterações salvas. Valem para os visitantes em até 1 minuto." : "Nada mudou.");
    } catch (e) {
      if (e.status === 409) $("#conflict").hidden = false;
      else if (e.fields) { showFieldErrors(e.fields); toast("Corrija os campos indicados.", true); }
      else toast(e.message, true);
    } finally { state.saving = false; render(); }
  }

  // ---- eventos ----
  function wire() {
    $("#tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) show(b.dataset.tab); });
    $("#tabs").addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const tabs = $$("[role=tab]").filter((b) => !b.hidden), i = tabs.findIndex((b) => b.getAttribute("aria-selected") === "true");
      const n = tabs[(i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1) + tabs.length) % tabs.length]; n.focus(); show(n.dataset.tab); e.preventDefault();
    });
    for (const b of $$("[data-go]")) b.addEventListener("click", () => show(b.dataset.go));
    for (const el of $$("[data-bind]")) el.addEventListener("input", () => { setp(state.draft, el.dataset.bind, el.type === "checkbox" ? el.checked : el.value); render(); });
    $("#f-niches").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { state.filter = b.dataset.n; renderPhotos(); } });
    $("#f-hidden").addEventListener("change", (e) => { state.onlyHidden = e.target.checked; renderPhotos(); });
    $("#f-grid").addEventListener("click", (e) => {
      const b = e.target.closest(".ph"); if (!b) return;
      const h = state.draft.photos.hidden, i = h.indexOf(b.dataset.s);
      if (i >= 0) h.splice(i, 1); else h.push(b.dataset.s);
      render();
    });
    $("#sb-save").addEventListener("click", save);
    $("#sb-discard").addEventListener("click", () => { state.draft = clone(state.cfg); showFieldErrors({}); render(); toast("Alterações descartadas."); });
    $("#reload").addEventListener("click", () => location.reload());
    $("#d-run").addEventListener("click", runDiag);
    $("#x-export").addEventListener("click", exportJson);
    $("#x-import").addEventListener("click", importJson);
    addEventListener("beforeunload", (e) => { if (changes().length) { e.preventDefault(); e.returnValue = ""; } });
    addEventListener("hashchange", () => show(location.hash.slice(1)));
  }

  async function boot() {
    try {
      const [c, p] = await Promise.all([api("/admin/api/config"), fetch("/admin/photos.json", { credentials: "same-origin" }).then((r) => r.json())]);
      state.cfg = c.config; state.draft = clone(c.config); state.me = c.me; state.photos = p;
    } catch (e) {
      $("#boot").textContent = e.status === 403 ? "Seu e-mail não tem permissão para usar o painel." : e.message || "Não foi possível carregar o painel.";
      return;
    }
    $("#who-email").textContent = state.me.email; $("#who-role").textContent = ROLE[state.me.role] || state.me.role;
    $("#t-avancado").hidden = state.me.role !== "dev";
    $("#boot").hidden = true; $("#app").hidden = false;
    wire(); render(); show(location.hash.slice(1) || "home");
  }
  boot();
})();
