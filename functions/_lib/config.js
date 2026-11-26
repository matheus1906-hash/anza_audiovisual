// Configuração do site: valores padrão, validação estrita, histórico e armazenamento no KV (binding ANZA_KV).
export const DEFAULTS = Object.freeze({
  rev: 0, updatedAt: null, updatedBy: null,
  maintenance: { on: false, title: "Voltamos já", message: "Estamos fazendo uma manutenção rápida no site. Para falar com a ANZA agora, chame no WhatsApp." },
  banner: { on: false, text: "" },
  contacts: { wa: "5564981025380", instagram: "anza.wedding", youtube: "@anzaaudiovisual" },
  photos: { hidden: [] },
});

const LINK = /(https?:|www\.|\b[\w-]+\.(com|net|org|ru|xyz|top|click|link|info|biz|site|online|shop|app)\b|bit\.ly|t\.me|wa\.me)/i;
const SLUG = /^[a-z0-9-]{1,40}$/;

// Normaliza (NFKC) e troca por espaço: controle, invisíveis, bidi e símbolos de marcação. Só números, sem escapes.
export function clean(value) {
  let out = "";
  for (const ch of String(value).normalize("NFKC")) {
    const c = ch.codePointAt(0);
    const ruim = c < 32 || (c >= 127 && c <= 159) || (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) ||
      (c >= 0x2060 && c <= 0x206f) || c === 0xfeff || "<>`{}\\|".includes(ch);
    out += ruim ? " " : ch;
  }
  return out.replace(/\s+/g, " ").trim();
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export function validate(input) {
  const errors = {};
  const e = (path, msg) => { errors[path] = msg; };
  const src = isObj(input) ? input : {};
  const m = isObj(src.maintenance) ? src.maintenance : {};
  const b = isObj(src.banner) ? src.banner : {};
  const c = isObj(src.contacts) ? src.contacts : {};
  const p = isObj(src.photos) ? src.photos : {};
  const out = {
    maintenance: { on: false, title: "", message: "" },
    banner: { on: false, text: "" },
    contacts: { wa: "", instagram: "", youtube: "" },
    photos: { hidden: [] },
  };

  const bool = (v, path) => { if (typeof v !== "boolean") { e(path, "Valor inválido."); return false; } return v; };
  const text = (v, path, min, max) => {
    if (typeof v !== "string") { e(path, "Texto inválido."); return ""; }
    const t = clean(v);
    if (t.length < min || t.length > max) e(path, min ? `Use de ${min} a ${max} caracteres.` : `Use até ${max} caracteres.`);
    else if (LINK.test(t)) e(path, "Por segurança, não coloque links aqui.");
    return t;
  };

  out.maintenance.on = bool(m.on, "maintenance.on");
  out.maintenance.title = text(m.title, "maintenance.title", 2, 60);
  out.maintenance.message = text(m.message, "maintenance.message", 0, 300);
  out.banner.on = bool(b.on, "banner.on");
  out.banner.text = text(b.text, "banner.text", out.banner.on ? 3 : 0, 140);

  const wa = typeof c.wa === "string" && /^[\d\s()+-]{8,24}$/.test(c.wa) ? c.wa.replace(/\D/g, "") : "";
  if (!/^\d{10,15}$/.test(wa)) e("contacts.wa", "Informe o número com DDI e DDD, só números (ex.: 5564981025380).");
  out.contacts.wa = wa;
  const ig = typeof c.instagram === "string" ? c.instagram.trim().replace(/^@/, "") : "";
  if (!/^[A-Za-z0-9._]{1,30}$/.test(ig)) e("contacts.instagram", "Use só letras, números, ponto e sublinhado (até 30).");
  out.contacts.instagram = ig;
  let yt = typeof c.youtube === "string" ? c.youtube.trim() : "";
  if (yt && yt[0] !== "@") yt = "@" + yt;
  if (!/^@[A-Za-z0-9._-]{3,50}$/.test(yt)) e("contacts.youtube", "Use o @ do canal, com 3 a 50 letras, números, ponto, hífen ou sublinhado.");
  out.contacts.youtube = yt;

  if (!Array.isArray(p.hidden) || p.hidden.length > 200) e("photos.hidden", "Lista de fotos inválida.");
  else if (!p.hidden.every((s) => typeof s === "string" && SLUG.test(s))) e("photos.hidden", "Identificador de foto inválido.");
  else out.photos.hidden = [...new Set(p.hidden)].sort();

  return { ok: Object.keys(errors).length === 0, errors, value: out };
}

export function publicView(cfg) {
  return {
    rev: cfg.rev,
    maintenance: { on: cfg.maintenance.on },
    banner: { on: cfg.banner.on, text: cfg.banner.on ? cfg.banner.text : "" },
    contacts: { ...cfg.contacts },
    photos: { hidden: [...cfg.photos.hidden] },
  };
}

const short = (v) => { const s = String(v); return s.length > 40 ? s.slice(0, 37) + "..." : s; };
const yn = (v) => (v ? "sim" : "não");
export function diff(a, b) {
  const out = [];
  if (a.maintenance.on !== b.maintenance.on) out.push(`Modo manutenção: ${yn(a.maintenance.on)} → ${yn(b.maintenance.on)}`);
  if (a.maintenance.title !== b.maintenance.title) out.push(`Título da manutenção: "${short(b.maintenance.title)}"`);
  if (a.maintenance.message !== b.maintenance.message) out.push("Mensagem da manutenção alterada");
  if (a.banner.on !== b.banner.on) out.push(`Aviso no topo: ${yn(a.banner.on)} → ${yn(b.banner.on)}`);
  if (a.banner.text !== b.banner.text) out.push(`Texto do aviso: "${short(b.banner.text)}"`);
  for (const k of ["wa", "instagram", "youtube"]) if (a.contacts[k] !== b.contacts[k]) out.push(`Contato ${k}: ${short(a.contacts[k])} → ${short(b.contacts[k])}`);
  const add = b.photos.hidden.filter((s) => !a.photos.hidden.includes(s));
  const del = a.photos.hidden.filter((s) => !b.photos.hidden.includes(s));
  if (add.length) out.push(`Fotos ocultadas: ${add.join(", ")}`);
  if (del.length) out.push(`Fotos reexibidas: ${del.join(", ")}`);
  return out;
}

// ---- armazenamento (KV) ----
export async function loadConfig(env) {
  const raw = await env.ANZA_KV.get("config", "json");
  if (!raw) return structuredClone(DEFAULTS);
  const v = validate(raw);
  const rev = Number.isInteger(raw.rev) && raw.rev >= 0 ? raw.rev : 0;
  const base = v.ok ? v.value : structuredClone(DEFAULTS); // dado corrompido nunca chega ao site
  return { ...base, rev, updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt.slice(0, 40) : null, updatedBy: typeof raw.updatedBy === "string" ? raw.updatedBy.slice(0, 120) : null };
}

export async function loadAudit(env) {
  const raw = await env.ANZA_KV.get("audit", "json");
  return Array.isArray(raw) ? raw.slice(0, 100) : [];
}

export async function saveConfig(env, next, who, changes) {
  const now = new Date().toISOString();
  const cfg = { ...next, rev: next.rev + 1, updatedAt: now, updatedBy: who.email };
  await env.ANZA_KV.put("config", JSON.stringify(cfg));
  const audit = await loadAudit(env);
  audit.unshift({ t: now, by: who.email, role: who.role, changes });
  await env.ANZA_KV.put("audit", JSON.stringify(audit.slice(0, 100)));
  return cfg;
}
