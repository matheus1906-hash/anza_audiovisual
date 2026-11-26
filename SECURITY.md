# Segurança

O site da ANZA Wedding é estático: as páginas e as fotos não dependem de servidor nem de banco de dados. A única parte dinâmica é o **painel de manutenção** (`/admin`, só para a dona e o desenvolvedor, descrito abaixo em [Painel de manutenção](#painel-de-manutenção)). Isso mantém a superfície de ataque pequena, e as camadas abaixo cobrem o que sobra.

## O que o código já faz

**No navegador (`index.html`)**
- Só aceita links para destinos conhecidos: o WhatsApp da ANZA, o Instagram, o YouTube, o GitHub do desenvolvedor e o Google Maps. Qualquer outro link (`javascript:`, `data:`, domínio parecido, outro número) é removido, mesmo que algo o insira depois.
- Links externos sempre abrem com `noopener noreferrer`.
- O site nunca usa `innerHTML`, `eval` ou `document.write`. Todo conteúdo é criado por nós do DOM.
- Formulário com várias travas contra robôs e abuso:
  - campo isca invisível (honeypot);
  - tempo mínimo de preenchimento e eventos de teclado/toque reais (um `submit` forjado por script é recusado);
  - recusa navegadores automatizados (`navigator.webdriver`);
  - limite de 5 envios por hora e intervalo mínimo entre envios;
  - limpeza forte do texto: Unicode normalizado, sem caracteres de controle, invisíveis ou de direção (bidi), sem `< > { } \ |`;
  - recusa links na mensagem e no nome.
- Fotos sem arrastar, sem menu de contexto e sem "salvar imagem" no toque longo. Isto só dificulta cópia em massa; quem vê a foto sempre consegue tirar um print.
- No celular, a página não arrasta para os lados nem tem efeito elástico (`overflow-x: clip`, `overscroll-behavior`, `touch-action`).

**Na hospedagem (`_headers`, `vercel.json` e a meta CSP do `index.html`)**
- Content-Security-Policy estrita: `default-src 'none'`, scripts e estilos só por hash SHA-256 (sem `unsafe-inline` nem `unsafe-eval`), `connect-src 'self'` (só para ler `/api/config`, a configuração pública do painel), `form-action 'none'`, `base-uri 'none'`, `object-src 'none'`, `frame-src 'none'`, `frame-ancestors 'none'` e Trusted Types.
- Anti-clickjacking: `X-Frame-Options: DENY` e, onde não há cabeçalhos, um script que tira o site de dentro de quadros.
- `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` (câmera, microfone, localização e outros desligados), HSTS, `Cross-Origin-Opener-Policy` e `Cross-Origin-Resource-Policy: same-origin` (impede outros sites de usar as fotos diretamente).

## Painel de manutenção

Detalhes de uso e instalação em [ADMIN.md](ADMIN.md). Resumo da segurança:

- **Duas trancas.** (1) Cloudflare Access na frente de `/admin`, com lista de dois e-mails e código de uso único. (2) Cada função do painel valida de novo o JWT do Access (assinatura RS256 pelas chaves públicas do Cloudflare, emissor, público/AUD, validade) e confere o e-mail contra `OWNER_EMAILS` e `DEV_EMAILS`. Sem as variáveis de ambiente, a resposta é "fechado" para todos.
- **Papéis.** `dev` vê tudo (inclusive diagnóstico e backup); `owner` (dona) não alcança as funções técnicas: o servidor responde 403, não só a tela esconde.
- **Alterações.** Só pelo painel: exigem origem igual à do site, cabeçalho próprio e JSON (anti-CSRF), corpo de até 20 KB, validação e higienização no servidor (sem HTML, sem links, tamanhos e formatos fixos, lista de fotos por nome permitido), controle de versão otimista (dois editores recebem aviso de conflito) e registro das últimas 100 mudanças com quem e quando.
- **Público.** `/api/config` nunca devolve e-mails nem dados internos. O site revalida o que recebe e mantém a trava de links, então um contato alterado só vale se tiver formato válido de WhatsApp, Instagram ou YouTube.
- **Falhas.** Se o KV ou as funções falharem, o site público continua no ar com o conteúdo padrão (o painel nunca derruba o site). Já o painel falha fechado: sem validação do login, ninguém entra.
- **Modo manutenção.** Visitantes recebem 503 (`Retry-After`, `noindex`, sem cache) com CSP própria; administradores logados continuam vendo o site.
- **Painel em si.** CSP própria (`default-src 'none'`, scripts e estilos só do próprio site, sem inline, Trusted Types), `no-store`, `noindex` e sem `innerHTML`.
- **Testado.** 38 testes das funções (assinatura adulterada, expirada, outro AUD, e-mail fora da lista, CSRF, corpo gigante, conflito, KV fora do ar) e 70 verificações de ponta a ponta no navegador, incluindo intruso, cabeçalho e cookie forjados, Access desligado e HTML malicioso no aviso.

## Limites que vale conhecer

- **Travas no navegador não substituem um servidor.** Um atacante pode ignorar o JavaScript do site. Hoje isso não causa dano, porque o formulário só monta uma mensagem de WhatsApp e não envia nem guarda nada. Se um dia houver back-end (e-mail, planilha, banco), valide tudo de novo no servidor, use Cloudflare Turnstile (ou similar), limite a taxa de requisições e guarde o mínimo de dados (LGPD).
- **O painel só funciona no Cloudflare Pages.** Em GitHub Pages ou Vercel o site público funciona, mas não há servidor para o painel. A proteção do painel depende da conta Cloudflare e dos e-mails da dona e do desenvolvedor (o código de login chega por e-mail): ative verificação em duas etapas neles.
- **GitHub Pages não aplica `_headers`.** Para ter todos os cabeçalhos, publique em Cloudflare Pages, Netlify ou Vercel (gratuitos). No GitHub Pages continuam valendo a meta CSP e o script anti-frame do `index.html`, mas `frame-ancestors`, HSTS e os demais cabeçalhos ficam de fora.
- **Fontes do Google** são a única origem externa permitida. Para eliminar até essa dependência, hospede as fontes no próprio projeto e remova `fonts.googleapis.com` e `fonts.gstatic.com` da CSP.

## Ao editar o site

A CSP só executa os blocos `<script>` e `<style>` cujo hash está listado. Se você mudar o JS ou o CSS dentro do `index.html`, rode:

```bash
python3 tools/atualizar-csp.py
```

Ele atualiza o `index.html`, o `_headers` e o `vercel.json`. Sem isso, o navegador bloqueia o bloco alterado. O painel (`/admin`) não usa hash: seus arquivos são externos e a CSP dele só aceita arquivos do próprio site.

## Checklist de quem administra (fora do código)

1. Ative verificação em duas etapas (de preferência chave de acesso/passkey) no GitHub, na hospedagem e no registro do domínio.
2. No GitHub, em *Settings → Branches*, proteja a `main` (bloquear force push e exigir pull request). Em *Settings → Code security*, ative secret scanning e push protection.
3. Não coloque senhas, chaves ou tokens no repositório. O site não precisa de nenhum.
4. No domínio: bloqueio de transferência, DNSSEC e renovação automática, para evitar sequestro.
5. Se usar Cloudflare na frente: ative Bot Fight Mode, regras de limite de requisições e o WAF gerenciado (inclua uma regra de limite para `/admin*`).
6. Painel: mantenha na política do Access somente os dois e-mails, ative verificação em duas etapas nessas contas de e-mail e confira *Zero Trust → Logs → Access* de vez em quando.
7. Revise quem tem acesso ao repositório, à hospedagem e ao Zero Trust de tempos em tempos.

## Como avisar sobre uma falha

Abra um [relato privado de vulnerabilidade](https://github.com/matheus1906-hash/anza_audiovisual/security/advisories/new) neste repositório. Não publique detalhes antes da correção.
