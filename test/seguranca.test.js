// Validação do JWT do Cloudflare Access com assinatura RS256 real (chaves geradas no teste).
// Simulado: só a origem das chaves (JWKS local em vez de https://<equipe>.cloudflareaccess.com/cdn-cgi/access/certs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { accessMode, accessIdentity, readJson, cspFor, MAX_BODY } from "../worker/seguranca.js";

const TEAM = "https://casapratica.cloudflareaccess.com";
const AUD = "aud-do-aplicativo-teste";
const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ACCESS_EMAILS: "dono@exemplo.com.br" };

const { publicKey, privateKey } = await generateKeyPair("RS256");
const outra = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
const keys = createLocalJWKSet({ keys: [jwk] });

async function jwt({ email = "dono@exemplo.com.br", aud = AUD, iss = TEAM, exp = "10m", key = privateKey, kid = "k1" } = {}) {
  return new SignJWT({ email }).setProtectedHeader({ alg: "RS256", kid }).setIssuer(iss).setAudience(aud)
    .setIssuedAt().setExpirationTime(exp).sign(key);
}
const req = (token) => new Request("https://app.exemplo/painel", { headers: token ? { "Cf-Access-Jwt-Assertion": token } : {} });

test("modo do Access: desligado, parcial (falha fechada) e ligado", () => {
  assert.equal(accessMode({}), "off");
  assert.equal(accessMode({ ACCESS_AUD: AUD }), "partial");
  assert.equal(accessMode({ ...env, ACCESS_TEAM_DOMAIN: "https://evil.example.com" }), "partial");
  assert.equal(accessMode(env), "on");
});

test("JWT válido do e-mail autorizado passa", async () => {
  assert.deepEqual(await accessIdentity(req(await jwt()), env, keys), { email: "dono@exemplo.com.br" });
  assert.deepEqual(await accessIdentity(req(await jwt({ email: "DONO@Exemplo.com.br" })), env, keys), { email: "dono@exemplo.com.br" });
});

test("sem token, e-mail fora da lista, audiência/emissor errados, expirado ou outra chave: negado", async () => {
  assert.equal(await accessIdentity(req(""), env, keys), null);
  assert.equal(await accessIdentity(req(await jwt({ email: "intruso@exemplo.com" })), env, keys), null);
  assert.equal(await accessIdentity(req(await jwt({ aud: "outro-app" })), env, keys), null);
  assert.equal(await accessIdentity(req(await jwt({ iss: "https://outra.cloudflareaccess.com" })), env, keys), null);
  assert.equal(await accessIdentity(req(await jwt({ exp: Math.floor(Date.now() / 1000) - 60 })), env, keys), null);
  assert.equal(await accessIdentity(req(await jwt({ key: outra.privateKey })), env, keys), null);
  assert.equal(await accessIdentity(req("a.b.c"), env, keys), null);
  assert.equal(await accessIdentity(req("x".repeat(9000)), env, keys), null);
});

test("algoritmo trocado (HS256 com a chave pública) é recusado", async () => {
  const hs = await new SignJWT({ email: "dono@exemplo.com.br" }).setProtectedHeader({ alg: "HS256", kid: "k1" })
    .setIssuer(TEAM).setAudience(AUD).setExpirationTime("10m").sign(new TextEncoder().encode(JSON.stringify(jwk)));
  assert.equal(await accessIdentity(req(hs), env, keys), null);
});

test("corpo JSON acima do limite é recusado", async () => {
  const grande = new Request("https://x/", { method: "POST", body: JSON.stringify({ a: "x".repeat(MAX_BODY) }) });
  await assert.rejects(readJson(grande), RangeError);
  assert.deepEqual(await readJson(new Request("https://x/", { method: "POST", body: '{"ok":1}' })), { ok: 1 });
});

test("CSP do painel usa hash do script, sem unsafe-inline para script", async () => {
  const csp = await cspFor("<p>x</p><script>alert(1)</script><script src=\"a.js\"></script>");
  assert.match(csp, /script-src 'sha256-[A-Za-z0-9+/=]{44}';/);
  assert.doesNotMatch(csp.split("script-src")[1].split(";")[0], /unsafe-inline/);
  assert.match(csp, /frame-ancestors 'none'/);
});
