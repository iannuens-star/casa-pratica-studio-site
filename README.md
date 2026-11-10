# Site do Casa Prática Studio

Site estático (HTML, CSS e JS, sem build) usado como Website URL no TikTok for Developers.

## Ver localmente
Na raiz do projeto:

```bash
uv run python -m http.server 8770 --directory site
```

Abra <http://localhost:8770>.

## Antes de publicar
1. **Domínio:** registre o domínio, ou troque `https://casapraticastudio.com` pela URL real em `index.html`, `privacy.html` e `terms.html` (canonical, Open Graph, Twitter Card e JSON-LD).
2. **E-mail:** deixe `suporte@casapraticastudio.com` recebendo mensagens de verdade, ou troque o endereço nas três páginas.
3. **Revisão jurídica:** identifique o responsável pelos dados e revise `privacy.html` e `terms.html`. Os textos descrevem o app atual, mas não têm revisão de advogado.
4. **Atualização:** ajuste a data e o texto das páginas legais sempre que o app mudar.

## Publicar
Não há comando de build: publique o conteúdo da pasta `site/`.

- **Vercel:** New Project, importe o repositório, Root Directory `site`, Framework Preset `Other`, Build Command vazio. Sem Git: `npx vercel site --prod`.
- **Netlify:** Add new site, importe o repositório, Base directory `site`, Publish directory `site`, Build command vazio. Também é possível arrastar a pasta `site` em Netlify Drop.
- **Cloudflare Pages:** Create application, Pages, conecte o repositório, Root directory `site`, Framework preset `None`, Build command vazio. Sem Git: `npx wrangler pages deploy site`.
- **GitHub Pages:** publique a pasta `site` com um workflow do GitHub Actions, porque o modo simples só aceita a raiz ou `/docs`.

## Painel do celular (`/painel`)
O mesmo Worker serve o site estático e, em `/painel`, um painel protegido por senha (código em `worker/`). Os dados vêm do
bucket R2 `tiktokshop-2026`, preenchido pelo executor local (`python -m app.growth sync` no projeto principal).

- **Testar localmente:** `npm install`, crie `.dev.vars` com `PAINEL_SENHA=...` e `SESSAO_SEGREDO=...` (nunca versionado) e
  rode `npm run dev` (porta 8771, R2 simulado). Testes: `npm test`.
- **Publicar:** confira `name` em `wrangler.jsonc` (precisa ser o Worker atual), crie os segredos `PAINEL_SENHA` e
  `SESSAO_SEGREDO` na Cloudflare e faça o deploy (`npx wrangler deploy` ou push, se o Git estiver conectado).
- `.assetsignore` impede que `worker/`, `node_modules/` e arquivos de configuração virem páginas públicas.

## TikTok for Developers
- **Website URL:** a página inicial publicada.
- **Privacidade e termos:** `/privacy.html` e `/terms.html`.
- **Redirect URI:** o site estático não recebe o retorno do login. Cadastre `https://SEU-TUNEL/auth/tiktok/callback`, apontando para o Copilot em `http://localhost:8765`, e use o mesmo valor em `TIKTOK_REDIRECT_URI`.
