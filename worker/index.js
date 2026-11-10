// Painel do celular da Casa Prática Studio.
// Tudo fora de /painel continua sendo o site estático (binding ASSETS).
// Dados: bucket R2 (binding BUCKET), escrito pelo executor local (python -m app.growth sync).
// Segredos (wrangler secret ou painel da Cloudflare): PAINEL_SENHA (obrigatório) e SESSAO_SEGREDO (opcional).
// Nada disso vai para o navegador.
import { PAGE, LOGIN } from "./ui.js";
import { parseRange } from "./range.js";

const P = "painel/";
const COOKIE = "cp_sessao";
const SESSION_DAYS = 30;
const OFFLINE_MIN = 25;
const FILES = {
  "video.mp4": "video/mp4",
  "caption.txt": "text/plain; charset=utf-8",
  "subtitles.srt": "application/x-subrip; charset=utf-8",
};
const TIPOS = new Set(["aprovar", "recusar", "nova_versao", "publicado", "seguidores", "metricas", "pausar", "retomar"]);
const SEM_VIDEO = new Set(["seguidores", "pausar", "retomar"]);
const enc = new TextEncoder();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/painel" && !url.pathname.startsWith("/painel/")) {
      return env.ASSETS.fetch(request);
    }
    try {
      return await route(request, env, url);
    } catch (e) {
      console.error("painel", e && e.message);
      return json({ erro: "Erro interno. Tente de novo em instantes." }, 500);
    }
  },
};

async function route(request, env, url) {
  const path = url.pathname.replace(/\/+$/, "") || "/painel";
  if (!env.PAINEL_SENHA || !env.BUCKET) {
    return html("<h1>Painel ainda não configurado</h1><p>Falta o segredo PAINEL_SENHA ou o bucket.</p>", 503);
  }
  // SESSAO_SEGREDO é opcional: sem ele, a chave de sessão deriva da senha (trocar a senha encerra as sessões)
  if (!env.SESSAO_SEGREDO) env = { ...env, SESSAO_SEGREDO: await hmac(env.PAINEL_SENHA, "casa-pratica:sessao:v1") };
  if (request.method === "POST" && !sameOrigin(request, url)) {
    return json({ erro: "Origem não permitida." }, 403);
  }
  if (path === "/painel/manifest.webmanifest") return manifest();
  if (path === "/painel/icone.svg") return icon();
  if (path === "/painel/api/login" && request.method === "POST") return login(request, env);

  const ok = await session(request, env);
  if (path === "/painel") return ok ? html(PAGE) : html(LOGIN);
  if (!ok) return json({ erro: "Sessão expirada. Entre de novo." }, 401);

  if (path === "/painel/api/sair" && request.method === "POST") {
    return json({ ok: true }, 200, { "Set-Cookie": `${COOKIE}=; Path=/painel; Max-Age=0; HttpOnly; Secure; SameSite=Strict` });
  }
  if (path === "/painel/api/estado" && request.method === "GET") return estado(env);
  if (path === "/painel/api/acao" && request.method === "POST") return acao(request, env);
  const m = path.match(/^\/painel\/api\/video\/(\d{1,6})\/(video\.mp4|caption\.txt|subtitles\.srt)$/);
  if (m && (request.method === "GET" || request.method === "HEAD")) return arquivo(request, env, m[1], m[2], url);
  return json({ erro: "Não encontrado." }, 404);
}

// ------------------------------------------------------------------ sessão
function sameOrigin(request, url) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return false;
  return request.headers.get("X-Painel") === "1";
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function safeEqual(a, b, secret) {
  // compara HMACs dos dois lados: tempo constante e sem vazar tamanho
  const [x, y] = await Promise.all([hmac(secret, "cmp:" + a), hmac(secret, "cmp:" + b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

async function session(request, env) {
  const raw = (request.headers.get("Cookie") || "").split(/;\s*/).find((c) => c.startsWith(COOKIE + "="));
  if (!raw) return false;
  const [exp, sig] = raw.slice(COOKIE.length + 1).split(".");
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(sig, await hmac(env.SESSAO_SEGREDO, "sessao:" + exp), env.SESSAO_SEGREDO);
}

async function login(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const hour = new Date().toISOString().slice(0, 13);
  const rlKey = `${P}limite/${hour}-${(await hmac(env.SESSAO_SEGREDO, ip)).slice(0, 16)}`;
  const tries = Number((await (await env.BUCKET.get(rlKey))?.text()) || 0);
  if (tries >= 8) return json({ erro: "Muitas tentativas. Espere uma hora." }, 429);
  let body = {};
  try { body = await request.json(); } catch { /* corpo inválido */ }
  const senha = String(body.senha || "");
  if (!senha || !(await safeEqual(senha, env.PAINEL_SENHA, env.SESSAO_SEGREDO))) {
    await env.BUCKET.put(rlKey, String(tries + 1));
    await new Promise((r) => setTimeout(r, 600));
    return json({ erro: "Senha incorreta." }, 401);
  }
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const sig = await hmac(env.SESSAO_SEGREDO, "sessao:" + exp);
  return json({ ok: true }, 200, {
    "Set-Cookie": `${COOKIE}=${exp}.${sig}; Path=/painel; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Strict`,
  });
}

// ------------------------------------------------------------------ dados
async function estado(env) {
  const obj = await env.BUCKET.get(P + "state.json");
  const state = obj ? await obj.json() : null;
  const pend = [];
  const list = await env.BUCKET.list({ prefix: P + "inbox/", limit: 200 });
  for (const o of list.objects) {
    const ev = await (await env.BUCKET.get(o.key))?.json().catch(() => null);
    if (ev) pend.push({ id: ev.id, tipo: ev.tipo, video_id: ev.video_id, em: ev.at });
  }
  const gen = state && Date.parse(state.gerado_em);
  const minutos = gen ? Math.round((Date.now() - gen) / 60000) : null;
  return json({
    estado: state,
    pendentes: pend,
    executor: { online: minutos !== null && minutos <= OFFLINE_MIN, minutos_desde_envio: minutos },
    agora: new Date().toISOString(),
  });
}

function cleanNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

async function acao(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ erro: "Pedido inválido." }, 400); }
  const tipo = String(body.tipo || "");
  if (!TIPOS.has(tipo)) return json({ erro: "Ação desconhecida." }, 400);
  const vid = body.video_id === undefined || body.video_id === null ? null : Number(body.video_id);
  if (!SEM_VIDEO.has(tipo) && !(Number.isInteger(vid) && vid > 0)) return json({ erro: "Vídeo inválido." }, 400);
  const d = body.dados || {};
  const dados = {};
  if (d.nota) dados.nota = String(d.nota).slice(0, 500);
  if (tipo === "publicado") {
    const u = String(d.url || "").trim();
    if (u && !/^https:\/\/(www\.|vm\.|m\.)?tiktok\.com\/\S{1,300}$/.test(u)) {
      return json({ erro: "O link precisa ser do tiktok.com (ou deixe vazio)." }, 400);
    }
    dados.url = u;
  }
  if (tipo === "seguidores") {
    const n = cleanNum(d.seguidores);
    if (!Number.isInteger(n) || n > 1e8) return json({ erro: "Número de seguidores inválido." }, 400);
    dados.seguidores = n;
  }
  if (tipo === "metricas") {
    if (!["24h", "48h", "7d"].includes(d.janela)) return json({ erro: "Escolha 24 h, 48 h ou 7 dias." }, 400);
    dados.janela = d.janela;
    for (const k of ["views", "avg_watch_s", "completion_pct", "shares", "saves", "profile_visits", "followers_attributed"]) {
      const n = cleanNum(d[k]);
      if (Number.isNaN(n)) return json({ erro: `Valor inválido em ${k}.` }, 400);
      dados[k] = n;
    }
    if (dados.completion_pct !== null && dados.completion_pct > 100) return json({ erro: "Conclusão acima de 100%." }, 400);
  }
  // limite simples contra cliques repetidos: 60 ações por hora
  const pend = await env.BUCKET.list({ prefix: P + "inbox/", limit: 100 });
  if (pend.objects.length >= 60) return json({ erro: "Muitas ações aguardando o computador. Espere a sincronização." }, 429);
  const id = crypto.randomUUID();
  const at = new Date().toISOString();
  const ev = { id, tipo, video_id: SEM_VIDEO.has(tipo) ? null : vid, at, dados };
  await env.BUCKET.put(`${P}inbox/${at.replace(/[:.]/g, "-")}-${id}.json`, JSON.stringify(ev), {
    httpMetadata: { contentType: "application/json" },
  });
  return json({ ok: true, id, mensagem: "Registrado. O computador aplica na próxima sincronização." });
}

async function arquivo(request, env, vid, name, url) {
  const key = `${P}videos/${vid}/${name}`;
  const range = request.headers.get("Range");
  const head = await env.BUCKET.head(key);
  if (!head) return json({ erro: "Arquivo ainda não enviado pelo computador." }, 404);
  const size = head.size;
  const headers = new Headers({
    "Content-Type": FILES[name],
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    ETag: head.httpEtag,
  });
  if (url.searchParams.get("baixar") === "1") {
    headers.set("Content-Disposition", `attachment; filename="casa-pratica-${vid}-${name}"`);
  } else {
    headers.set("Content-Disposition", `inline; filename="casa-pratica-${vid}-${name}"`);
  }
  if (request.method === "HEAD") {
    headers.set("Content-Length", String(size));
    return new Response(null, { headers });
  }
  const r = range && parseRange(range, size);
  if (range && !r) {
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  const obj = await env.BUCKET.get(key, r ? { range: { offset: r.start, length: r.end - r.start + 1 } } : {});
  if (!obj) return json({ erro: "Arquivo não encontrado." }, 404);
  if (r) {
    headers.set("Content-Range", `bytes ${r.start}-${r.end}/${size}`);
    headers.set("Content-Length", String(r.end - r.start + 1));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(size));
  return new Response(obj.body, { headers });
}

// ------------------------------------------------------------------ respostas
const SEC = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cache-Control": "no-store",
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...SEC, ...extra },
  });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...SEC,
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    },
  });
}

function manifest() {
  return new Response(JSON.stringify({
    name: "Casa Prática — Painel",
    short_name: "Casa Prática",
    start_url: "/painel",
    scope: "/painel",
    display: "standalone",
    background_color: "#F7F5F0",
    theme_color: "#0F766E",
    lang: "pt-BR",
    icons: [{ src: "/painel/icone.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
  }), { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" } });
}

function icon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#0F766E"/>` +
    `<path d="M256 112 112 232v168h104V296h80v104h104V232z" fill="#F7F5F0"/></svg>`;
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" } });
}
