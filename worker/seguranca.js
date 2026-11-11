// Peças de segurança do painel, sem dependência do runtime de assets (testáveis no Node).
import { jwtVerify, createRemoteJWKSet } from "jose";

export const MAX_BODY = 16 * 1024; // ações e login são JSON pequenos
const TEAM_RE = /^https:\/\/[a-z0-9-]{1,63}\.cloudflareaccess\.com$/;
const enc = new TextEncoder();

// ------------------------------------------------------------------ Cloudflare Access
// Validação conforme a documentação oficial: cabeçalho Cf-Access-Jwt-Assertion, RS256,
// emissor = https://<equipe>.cloudflareaccess.com, audiência = AUD do aplicativo, chaves em /cdn-cgi/access/certs
// (escolhidas pelo `kid`; o Access troca a chave a cada 6 semanas, por isso nada fica fixo no código).
let JWKS = null; // chaves públicas em cache por isolate (dado derivado, sem estado de requisição)
let JWKS_TEAM = "";

export function accessMode(env) {
  const vals = [env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD, env.ACCESS_EMAILS];
  if (vals.every((v) => !v)) return "off";
  if (vals.some((v) => !v) || !TEAM_RE.test(String(env.ACCESS_TEAM_DOMAIN))) return "partial";
  return "on";
}

/** Devolve {email} se o JWT do Access é válido e o e-mail está na lista; senão null. `keys` só em testes. */
export async function accessIdentity(request, env, keys = null) {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token || token.length > 8192) return null;
  const team = String(env.ACCESS_TEAM_DOMAIN);
  if (!keys && (!JWKS || JWKS_TEAM !== team)) {
    JWKS = createRemoteJWKSet(new URL(`${team}/cdn-cgi/access/certs`));
    JWKS_TEAM = team;
  }
  try {
    const { payload } = await jwtVerify(token, keys || JWKS, {
      issuer: team, audience: String(env.ACCESS_AUD), algorithms: ["RS256"],
    });
    const email = String(payload.email || "").trim().toLowerCase();
    const allowed = String(env.ACCESS_EMAILS).toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
    return email && allowed.includes(email) ? { email } : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ entrada
export async function readJson(request) {
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > MAX_BODY) throw new RangeError("grande");
  const txt = await request.text();
  if (txt.length > MAX_BODY) throw new RangeError("grande");
  return JSON.parse(txt);
}

// ------------------------------------------------------------------ CSP com hash dos scripts inline
const CSP = new Map();
export async function cspFor(body) {
  if (CSP.has(body)) return CSP.get(body);
  const hashes = [];
  for (const m of body.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    const d = await crypto.subtle.digest("SHA-256", enc.encode(m[1]));
    hashes.push(`'sha256-${btoa(String.fromCharCode(...new Uint8Array(d)))}'`);
  }
  const csp = `default-src 'none'; script-src ${hashes.join(" ") || "'none'"}; style-src 'self' 'unsafe-inline'; ` +
    "img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; manifest-src 'self'; " +
    "frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";
  CSP.set(body, csp);
  return csp;
}
