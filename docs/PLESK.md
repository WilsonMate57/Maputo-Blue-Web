# Maputo Blue — Instalação no Plesk (Linux)

Guia para o alojamento actual: **Plesk em Linux** (nginx + Phusion Passenger), domínio `maputoblue.co.mz`.
Para um Windows Server gerido à mão (sem Plesk), use [IMPLANTACAO.md](IMPLANTACAO.md). As secções de facturação, e-mail (Resend), lista de verificação e custos desse guia aplicam-se também aqui.

**Nenhuma senha deve ser escrita no repositório.** No Plesk, os valores secretos ficam nas variáveis de ambiente da aplicação Node.js (passo 4).

---

## Como funciona

```
navegador ──HTTPS──► nginx (Plesk) ──► Passenger ──► Node (server/app.cjs)
                                                       ├── site (páginas, CSS, imagens)
                                                       ├── API /api/...
                                                       └── PostgreSQL
```

O Node serve **tudo**: o site e a API. A pasta pública do domínio (*document root*) é `server/public`, que está vazia de propósito. Assim o nginx não tem ficheiros para entregar directamente, e o código do servidor, a documentação e o `.env` nunca ficam acessíveis pelo endereço.

> **Situação encontrada em 23/10/2026:** o repositório estava publicado dentro de `httpdocs`, a pasta pública. Por isso `https://maputoblue.co.mz/server/src/config.js` e `/docs/...` abriam para qualquer pessoa, e o Node não estava a correr (`/api/health` → 404). Os passos abaixo corrigem as duas coisas. **Não crie o `server/.env` dentro de `httpdocs`.**

## 1. Base de dados

Em **Websites & Domains → maputoblue.co.mz → Databases → Add Database**:
- Tipo: **PostgreSQL**
- Nome: `maputoblue`
- Utilizador: `maputoblue` e uma senha forte (gerada pelo Plesk)

Guarde o nome, o utilizador e a senha num local seguro. Vão para o `DATABASE_URL` do passo 4.
O servidor confirma no arranque que a base está em UTF-8 e recusa-se a continuar se não estiver.

## 2. Código (Git)

Em **Websites & Domains → Git**:
1. Se o repositório já estiver ligado a `httpdocs`, abra **Repository Settings** e mude o **Deployment path** para `maputoblue-app`, uma pasta **fora** de `httpdocs`.
   Se for adicionar de novo: **Add Repository** → `https://github.com/WilsonMate57/Maputo-Blue-Web.git` e o mesmo *deployment path*.
2. Carregue em **Pull Updates** para actualizar a lista de branches e escolha a branch aprovada (`UI/UX-improvements` ou `main`, depois de juntar).
3. **Deployment mode:** manual, para controlar quando cada versão entra no ar.
4. Carregue em **Deploy Now**.

O código fica em `/var/www/vhosts/maputoblue.co.mz/maputoblue-app/`.

## 3. Aplicação Node.js

Em **Websites & Domains → Node.js**, clique em **Enable Node.js** e preencha:

| Campo | Valor |
|---|---|
| Node.js Version | **22** ou superior (a mais recente disponível) |
| Package Manager | npm |
| Document Root | `/maputoblue-app/server/public` |
| Application Mode | `production` |
| Application Root | `/maputoblue-app/server` |
| Application Startup File | `app.cjs` |

Ao gravar, o Plesk passa a usar `server/public` como pasta pública do domínio.

Depois carregue em **NPM install**.

## 4. Variáveis de ambiente

No mesmo ecrã, em **Custom environment variables**, acrescente:

| Variável | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `postgres://maputoblue:SENHA@localhost:5432/maputoblue`. Se a senha tiver símbolos (`@`, `:`, `/`, `#`…), escreva-os codificados (`@` → `%40`) |
| `PUBLIC_BASE_URL` | `https://maputoblue.co.mz` (sem barra no fim; o endereço principal do site) |
| `TRUST_PROXY` | `true` |
| `COOKIE_SECURE` | `true` |
| `TICKET_SECRET` | texto aleatório com 64 caracteres (ver abaixo). **Nunca o altere depois de emitir tickets**, ou os QR deixam de ser válidos. Guarde uma cópia num cofre |
| `IP_HASH_SALT` | outro texto aleatório, gerado da mesma forma |
| `RESEND_API_KEY` | a chave de envio do Resend (ver IMPLANTACAO.md §7); pode ficar vazia até ter a conta |
| `MAIL_FROM` | ex.: `Maputo Blue <reservas@maputoblue.co.mz>`, num domínio verificado no Resend |
| `MAIL_REPLY_TO` | caixa que recebe as respostas dos clientes |
| `SERVE_STATIC` | `true` |
| `RUN_JOBS` | `true` |

**Não defina `PORT` nem `HOST`:** é o Passenger que trata da ligação.

Para gerar os textos aleatórios, em qualquer computador com Node:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Em alternativa, as mesmas variáveis podem ficar num ficheiro `server/.env` (formato de `server/.env.example`). Esse ficheiro fica fora da pasta pública, e as variáveis do painel têm prioridade sobre ele.

Carregue em **Restart App**.

## 5. Primeiros dados (uma só vez)

Com **SSH** (Plesk → **SSH Terminal**, ou um cliente SSH com o utilizador do domínio):

```bash
cd ~/maputoblue-app/server
# as variáveis do painel não chegam ao SSH: exporte o DATABASE_URL só nesta sessão
read -s -p "DATABASE_URL: " DATABASE_URL && export DATABASE_URL && echo
export NODE_ENV=production PUBLIC_BASE_URL=https://maputoblue.co.mz COOKIE_SECURE=true
read -s -p "TICKET_SECRET: " TICKET_SECRET && export TICKET_SECRET && echo
read -s -p "IP_HASH_SALT: " IP_HASH_SALT && export IP_HASH_SALT && echo

npm run migrate
npm run import:json -- --dry-run      # só mostra o relatório
npm run import:json
npm run import:reviews -- --dry-run
npm run import:reviews
npm run create-admin -- admin@maputoblue.co.mz "Nome do Administrador"   # pede a senha (10+ caracteres)
npm run check
```

O `read -s` não mostra o que escreve nem o guarda no histórico. Se o Node não estiver no PATH do SSH, use o caminho que o ecrã Node.js do Plesk indica (por exemplo `/opt/plesk/node/22/bin/npm`).

Sem SSH, use **Run script** no ecrã Node.js com `migrate`, `import:json`, `import:reviews` e `check`. Para o administrador, acrescente temporariamente a variável `ADMIN_PASSWORD`, corra `create-admin -- admin@maputoblue.co.mz "Nome"` e **apague a variável a seguir**.

Leia os avisos dos relatórios de importação (IMPLANTACAO.md §4) e depois configure no painel `/admin/` → **Definições**: e-mails da equipa, dados da empresa e facturação.

## 6. Verificar

- `https://maputoblue.co.mz/api/health` → `{"ok":true,...}`
- `https://maputoblue.co.mz/server/package.json` → **404** (o código deixou de estar exposto)
- A página de um pacote mostra o calendário com preços, e `/admin/` abre o login

Se algo falhar, o registo de erros está no ecrã Node.js (ou em `logs/` no domínio).

Por fim, **apague de `httpdocs` a cópia antiga do repositório**, para não ficar nenhum ficheiro de código esquecido no servidor.

## 7. Manter a aplicação acordada (e-mails e tarefas)

O Passenger pode parar o Node quando não há visitas. Enquanto está parado, os e-mails ficam na fila e as reservas pendentes não expiram até à próxima visita.
Em **Websites & Domains → Scheduled Tasks → Add Task**:
- Tipo: **Fetch a URL**: `https://maputoblue.co.mz/api/health`
- Frequência: a cada 5 minutos (`*/5 * * * *`)

## 8. Actualizações

1. **Backup** (Plesk → Backup Manager → Back Up), incluindo bases de dados e ficheiros.
2. **Git → Pull Updates → Deploy Now** (com a branch ou tag aprovada).
3. **Node.js → NPM install**, se o `package.json` tiver mudado.
4. **Node.js → Restart App**. As migrações correm sozinhas no arranque.
5. Confirmar `/api/health`.

**Reverter:** em Git, escolha o commit anterior e faça Deploy + Restart App. As migrações só acrescentam tabelas e colunas, por isso o código anterior continua a funcionar com a base actualizada.

## 9. Backups

Em **Backup Manager → Schedule**: backup diário com **bases de dados e ficheiros do domínio** e retenção de 30 dias, de preferência para armazenamento remoto (FTP ou nuvem).
As imagens carregadas no painel ficam em `maputoblue-app/assets/images/` e entram no backup de ficheiros.
**Teste um restauro** antes de abrir o site ao público.
