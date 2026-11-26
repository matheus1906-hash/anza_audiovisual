# Painel de manutenção (`/admin`)

Área restrita para **a dona da ANZA** e **o desenvolvedor**. Quem visita o site não vê link, botão nem menu: o atalho "Painel" só aparece para quem está logado como administrador.

## O que dá para fazer

| Aba | Quem vê | Para que serve |
|---|---|---|
| Visão geral | os dois | resumo: site no ar ou em manutenção, aviso, fotos ocultas, última mudança |
| Manutenção | os dois | liga a página "Voltamos já" no lugar do site (título e mensagem editáveis). Administradores logados continuam vendo o site normal |
| Aviso no topo | os dois | faixa fina no topo do site (feriado, agenda fechada, promoção) |
| Contatos | os dois | WhatsApp, Instagram e YouTube: atualiza botões, links e números do site inteiro |
| Fotos | os dois | oculta ou mostra fotos do portfólio (some da galeria, do visualizador e do topo) |
| Histórico | os dois | últimas 100 mudanças: quando, quem e o quê |
| Avançado | **só o desenvolvedor** | diagnóstico (Access, KV, variáveis) e backup/restauração da configuração em JSON |

Mudanças só valem depois de **Salvar alterações** e chegam aos visitantes em até 1 minuto.

## Como a proteção funciona (duas trancas)

1. **Cloudflare Access** fica na frente de `/admin`. Só entra quem digitar o código de 6 dígitos enviado para um dos dois e-mails da lista. Nenhuma senha é guardada por nós.
2. **Dentro de cada função do painel**, o servidor confere de novo a assinatura do login do Access (emissor, público, validade) e se o e-mail é da dona ou do desenvolvedor. Se o Access for desligado ou configurado errado por engano, o painel continua fechado. Sem as variáveis de ambiente, ninguém entra.

Outras proteções: pedidos de alteração só valem vindos do próprio painel (anti-CSRF), tudo é validado e higienizado no servidor (sem HTML, sem links, tamanhos limitados), duas pessoas editando ao mesmo tempo recebem aviso em vez de uma sobrescrever a outra, tudo fica no histórico, e a CSP do painel só aceita arquivos do próprio site.

A dona nunca recebe os dados técnicos: `/admin/api/diag` responde 403 para ela, mesmo logada.

## Colocar no ar (Cloudflare, plano gratuito)

O painel precisa do **Cloudflare Pages**. No GitHub Pages ou na Vercel o site público funciona normalmente, mas o painel não existe (não há onde rodar o servidor).

**1. Conta.** Crie a conta em cloudflare.com e ative a verificação em duas etapas.

**2. Projeto Pages.** *Workers & Pages → Create → Pages → Connect to Git* e escolha o repositório `anza_audiovisual`. Em *Build settings*:
- Framework preset: **None**
- Build command: `node tools/build-pages.mjs`
- Build output directory: `dist`
- Production branch: `main`

O `build-pages` monta `dist/` só com o que deve ser público (site, fotos, painel). O código das funções, os testes e os documentos não ficam acessíveis pela internet.

**3. Armazenamento (KV).** *Storage & databases → KV → Create* um namespace chamado `anza-config`. Depois, no projeto Pages: *Settings → Bindings → Add → KV namespace*, com o nome da variável exatamente **`ANZA_KV`** e o namespace `anza-config`. Faça para *Production* e, se quiser testar, *Preview*.

**4. Cloudflare Access.** Abra o *Zero Trust* (na primeira vez ele pede um "team name", por exemplo `anza`; o endereço fica `anza.cloudflareaccess.com`, plano gratuito para até 50 pessoas). Depois: *Access controls → Applications → Add an application → Self-hosted*:
- Application name: `Painel ANZA`
- Destinos (*Public hostname*): o endereço do site, com o caminho **`admin`**, e outro destino com o caminho **`admin/*`** (os dois). Se o site tiver domínio próprio e também o endereço `.pages.dev`, cadastre os dois endereços.
- Política: *Action* **Allow**, *Include* → **Emails** → o e-mail da dona e o e-mail do desenvolvedor (só esses dois).
- Métodos de login: **One-time PIN**.
- Duração da sessão: por exemplo 8 horas.

Salve e copie o **Application Audience (AUD) Tag** da aplicação.

**5. Variáveis do projeto.** No Pages: *Settings → Variables and Secrets → Add*, para *Production* (e *Preview*, se usar):

| Nome | Valor |
|---|---|
| `TEAM_DOMAIN` | `anza.cloudflareaccess.com` (o seu) |
| `POLICY_AUD` | o AUD Tag copiado |
| `OWNER_EMAILS` | e-mail da dona (mais de um: separe por vírgula) |
| `DEV_EMAILS` | e-mail do desenvolvedor |

Os e-mails daqui precisam ser **os mesmos** da política do Access. Quem não está nas duas listas não entra. Depois de salvar as variáveis, faça um novo deploy (*Deployments → Retry deployment*).

**6. Conferir.**
- Janela anônima em `https://seu-site/admin`: deve pedir o e-mail e enviar o código.
- Entrando como dona: aparecem as abas, **sem** "Avançado". Como desenvolvedor: aparece "Avançado" e o diagnóstico mostra tudo verde.
- Em outra janela anônima, o site normal abre sem nenhum atalho para o painel.
- Ligue a manutenção, abra o site em janela anônima (deve mostrar a página de aviso) e desligue.

**Opcional, recomendado:** no projeto Pages, *Settings → General → Access policy → Enable* para proteger também os endereços de pré-visualização (`*.pages.dev`).

## Uso no dia a dia

- Entrar: `https://seu-site/admin` → e-mail → código de 6 dígitos que chega no e-mail → painel. Sair: botão **Sair**.
- Manutenção: aba *Manutenção* → ligar → **Salvar alterações**. Para voltar, desligue e salve. Enquanto você estiver logada, o site aparece normal para você, com o atalho "Painel · manutenção ligada".
- Esconder uma foto: aba *Fotos* → toque na foto → **Salvar alterações**. A foto continua guardada no repositório; para apagar de vez, remova os arquivos em `img/`.
- Backup (desenvolvedor): aba *Avançado → Baixar JSON*.

## Tirar o acesso de alguém

1. No Zero Trust, remova o e-mail da política do aplicativo `Painel ANZA` e, em *Users*, revogue as sessões ativas.
2. Remova o e-mail de `OWNER_EMAILS` / `DEV_EMAILS` e faça novo deploy. Esse passo fecha a segunda tranca.

## Se algo der errado

- **"Seu e-mail não tem permissão"**: o e-mail está na política do Access, mas não em `OWNER_EMAILS`/`DEV_EMAILS` (ou há diferença de digitação). Corrija e faça novo deploy.
- **Painel não carrega os dados / "Sem conexão ou a sessão expirou"**: recarregue; se continuar, confira `TEAM_DOMAIN` e `POLICY_AUD` (aba Avançado, "Verificar agora").
- **Ficou em manutenção e não consigo entrar**: remova o namespace KV ou apague a chave `config` em *Storage → KV → anza-config*. Sem configuração, o site volta ao padrão.
- **O KV caiu**: o site público continua no ar com a configuração padrão (nunca fica fora do ar por causa do painel).
- **O servidor do painel não responde (Functions fora do ar)**: o site estático continua servido; só o painel e a configuração ficam indisponíveis.

## Testar no computador (sem Cloudflare)

```bash
npm test          # 38 testes das funções (login, permissões, validação, auditoria)
npm run dev       # monta dist/ e abre http://127.0.0.1:8788 com um "Access" de mentira
```

No servidor local, entre por `http://127.0.0.1:8788/__login?as=dona` (ou `as=dev`, `as=intruso`) e abra `/admin/`. Para provar que as funções recusam sozinhas mesmo sem o Access, use `node tools/dev-server.mjs --no-access`. O servidor local só escuta em `127.0.0.1` e **não** é o Access de verdade: serve para desenvolver, não para publicar.

## Limites que vale conhecer

- Não foi possível testar contra o Cloudflare Access real neste ambiente. O servidor local imita o Access e todo o resto foi testado (fluxos, permissões, ataques simulados), mas **faça o passo 6** logo depois do primeiro deploy.
- A segurança do painel depende da segurança dos e-mails da dona e do desenvolvedor, porque o código de login chega por e-mail. Ative verificação em duas etapas nessas contas.
- O atalho para ver o site durante a manutenção depende de o navegador enviar o cookie do Access ao site (`/`). Se por algum motivo a dona ver a página de manutenção mesmo logada, use a aba *Visão geral → Ver o site* depois de abrir o painel, ou desligue a manutenção para conferir.
- Ocultar uma foto não apaga o arquivo: quem souber o endereço direto da imagem ainda a acessa.
- O telefone no dado estruturado para o Google (JSON-LD) e nos textos de SEO não muda pelo painel; o resto do site muda.
- Limites gratuitos do Cloudflare: 100 mil requisições de funções por dia e 100 mil leituras de KV por dia. Cada visita consome cerca de 2 de cada, ou seja, algo perto de 50 mil visitas por dia antes de o plano pago ser necessário. Fotos e páginas estáticas não contam.
- O KV é "eventualmente consistente": duas pessoas salvando no mesmo segundo podem, raramente, não receber o aviso de conflito.
