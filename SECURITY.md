# Segurança

O site da ANZA Wedding é estático: não tem servidor próprio, banco de dados, login nem painel de administração. Isso reduz muito a superfície de ataque, e as camadas abaixo cobrem o que sobra.

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
- Content-Security-Policy estrita: `default-src 'none'`, scripts e estilos só por hash SHA-256 (sem `unsafe-inline` nem `unsafe-eval`), `connect-src 'none'`, `form-action 'none'`, `base-uri 'none'`, `object-src 'none'`, `frame-src 'none'`, `frame-ancestors 'none'` e Trusted Types.
- Anti-clickjacking: `X-Frame-Options: DENY` e, onde não há cabeçalhos, um script que tira o site de dentro de quadros.
- `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` (câmera, microfone, localização e outros desligados), HSTS, `Cross-Origin-Opener-Policy` e `Cross-Origin-Resource-Policy: same-origin` (impede outros sites de usar as fotos diretamente).

## Limites que vale conhecer

- **Travas no navegador não substituem um servidor.** Um atacante pode ignorar o JavaScript do site. Hoje isso não causa dano, porque o formulário só monta uma mensagem de WhatsApp e não envia nem guarda nada. Se um dia houver back-end (e-mail, planilha, banco), valide tudo de novo no servidor, use Cloudflare Turnstile (ou similar), limite a taxa de requisições e guarde o mínimo de dados (LGPD).
- **GitHub Pages não aplica `_headers`.** Para ter todos os cabeçalhos, publique em Cloudflare Pages, Netlify ou Vercel (gratuitos). No GitHub Pages continuam valendo a meta CSP e o script anti-frame do `index.html`, mas `frame-ancestors`, HSTS e os demais cabeçalhos ficam de fora.
- **Fontes do Google** são a única origem externa permitida. Para eliminar até essa dependência, hospede as fontes no próprio projeto e remova `fonts.googleapis.com` e `fonts.gstatic.com` da CSP.

## Ao editar o site

A CSP só executa os blocos `<script>` e `<style>` cujo hash está listado. Se você mudar o JS ou o CSS dentro do `index.html`, rode:

```bash
python3 tools/atualizar-csp.py
```

Ele atualiza o `index.html`, o `_headers` e o `vercel.json`. Sem isso, o navegador bloqueia o bloco alterado.

## Checklist de quem administra (fora do código)

1. Ative verificação em duas etapas (de preferência chave de acesso/passkey) no GitHub, na hospedagem e no registro do domínio.
2. No GitHub, em *Settings → Branches*, proteja a `main` (bloquear force push e exigir pull request). Em *Settings → Code security*, ative secret scanning e push protection.
3. Não coloque senhas, chaves ou tokens no repositório. O site não precisa de nenhum.
4. No domínio: bloqueio de transferência, DNSSEC e renovação automática, para evitar sequestro.
5. Se usar Cloudflare na frente: ative Bot Fight Mode, regras de limite de requisições e o WAF gerenciado.
6. Revise quem tem acesso ao repositório e à hospedagem de tempos em tempos.

## Como avisar sobre uma falha

Abra um [relato privado de vulnerabilidade](https://github.com/matheus1906-hash/anza_audiovisual/security/advisories/new) neste repositório. Não publique detalhes antes da correção.
