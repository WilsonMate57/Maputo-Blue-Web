# Maputo Blue — Instalação no Windows Server, operação e reversão

Este guia é para quem vai instalar e manter a plataforma no servidor próprio (Windows Server).
**O alojamento actual (`maputoblue.co.mz`) é Plesk em Linux: siga [PLESK.md](PLESK.md).** Este guia continua válido para as secções de facturação, e-mail e lista de verificação.
**Nenhum valor secreto deve ser escrito neste repositório.** As credenciais vão só para `server\.env`, que o Git ignora.

**Resumo da instalação** (cada passo está detalhado abaixo):

| # | Passo | Comando / ficheiro |
|---|---|---|
| 1 | Instalar Node 22+, PostgreSQL 17, Git, NSSM e Caddy (ou IIS) | secção 1 |
| 2 | Criar a base de dados UTF-8 | secção 2 |
| 3 | Clonar o repositório e instalar | `deploy\windows\install.ps1 -Domain maputoblue.co.mz` |
| 4 | Migrar os dados e criar o administrador | secção 4 |
| 5 | Verificar tudo | `npm run check` (em `server\`) |
| 6 | Arrancar o serviço | `nssm start MaputoBlue` |
| 7 | HTTPS | `deploy\windows\Caddyfile` ou `deploy\windows\web.config` |
| 8 | Backups diários | `deploy\windows\backup.ps1 -Register` |
| 9 | Actualizações seguintes | `deploy\windows\update.ps1` |

Os scripts estão em `deploy\windows\` e correm numa PowerShell **como Administrador**. Se a política de execução os bloquear, use `powershell -ExecutionPolicy Bypass -File deploy\windows\install.ps1 ...`.

---

## 1. Pré-requisitos

| Software | Versão | Notas |
|---|---|---|
| Node.js | 22 LTS ou superior | Use o instalador MSI de nodejs.org e marque «Add to PATH» |
| PostgreSQL | 17 | Instalador da EDB, ou o arquivo ZIP de binários. Se o download der erro 403, descarregue-o noutra rede e copie-o para o servidor |
| Git | qualquer | Para clonar o repositório e trocar de versão |
| NSSM | 2.24 | Instala o Node como serviço Windows (nssm.cc) |
| Proxy HTTPS | IIS com URL Rewrite e ARR, **ou** Caddy | Trata do certificado TLS. O Node escuta só em `127.0.0.1` |

## 2. Base de dados

No pgAdmin ou no `psql`, ligado como `postgres`:

```sql
CREATE ROLE maputoblue LOGIN PASSWORD 'UMA-PALAVRA-PASSE-FORTE';
CREATE DATABASE maputoblue OWNER maputoblue ENCODING 'UTF8' TEMPLATE template0;
```

A base tem de estar em **UTF-8**. O script de migração recusa-se a correr noutra codificação.

## 3. Aplicação

```powershell
cd D:\sites
git clone https://github.com/WilsonMate57/Maputo-Blue-Web.git maputoblue
cd maputoblue
git checkout main
.\deploy\windows\install.ps1 -Domain maputoblue.co.mz
```

Use a branch ou tag aprovada para produção (por exemplo, `main` depois de juntar a `UI/UX-improvements`).

O `install.ps1`:
- confirma que o Node 22+ e o NSSM estão instalados;
- instala as dependências (`npm ci --omit=dev`);
- cria `server\.env` a partir de `.env.example`, **só se ainda não existir**, com `NODE_ENV=production`, o domínio em `PUBLIC_BASE_URL` e `TICKET_SECRET` e `IP_HASH_SALT` aleatórios, e restringe o acesso ao ficheiro a Administradores e SYSTEM;
- pára e pede para preencher o `DATABASE_URL` enquanto houver valores `CHANGE_ME`. Edite com `notepad server\.env` e volte a correr o script;
- corre `npm run check` e regista o serviço Windows `MaputoBlue` (secção 5), sem o arrancar.

Variáveis do `.env`:

| Variável | Valor |
|---|---|
| `DATABASE_URL` | `postgres://maputoblue:SENHA@127.0.0.1:5432/maputoblue` |
| `PUBLIC_BASE_URL` | `https://maputoblue.co.mz`, sem barra no fim. Usado nos links dos e-mails e na protecção CSRF |
| `PORT` / `HOST` | `3000` / `127.0.0.1` |
| `TRUST_PROXY` | `true` atrás de IIS ou Caddy |
| `COOKIE_SECURE` | `true`, porque o site serve só HTTPS |
| `RESEND_API_KEY` | ver a secção 6 |
| `MAIL_FROM` | ex.: `Maputo Blue <reservas@maputoblue.co.mz>`, num domínio verificado no Resend |
| `MAIL_REPLY_TO` | caixa que recebe as respostas dos clientes |
| `IP_HASH_SALT` | texto aleatório longo: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `TICKET_SECRET` | **obrigatório em produção**, com pelo menos 32 caracteres (sem ele o servidor não arranca). Texto aleatório longo, gerado da mesma forma. Assina os QR codes dos tickets. **Nunca o altere depois de emitir tickets**, porque todos os QR já emitidos deixariam de ser válidos |
| `SERVE_STATIC` | `true`: o Node serve também o site. Use `false` se o IIS servir os ficheiros estáticos |
| `RUN_JOBS` | `true` numa única instância. Pode haver mais, porque a fila de e-mails usa `SKIP LOCKED` |

## 4. Migração inicial dos dados (uma só vez)

```powershell
cd D:\sites\maputoblue\server
npm run migrate
npm run import:json -- --dry-run
npm run import:json
npm run import:reviews -- --dry-run
npm run import:reviews
$env:ADMIN_PASSWORD = 'palavra-passe-forte-com-10+-caracteres'
npm run create-admin -- admin@maputoblue.co.mz "Nome do Administrador"
Remove-Item Env:ADMIN_PASSWORD
```

O que cada comando faz:
1. `npm run migrate` cria as tabelas.
2. `npm run import:json -- --dry-run` só valida e mostra o relatório, sem escrever nada.
3. `npm run import:json` faz primeiro um backup em `backups\` e depois importa os 21 pacotes, guardando o registo JSON original na versão 1.
4. `npm run import:reviews -- --dry-run` mostra quantas avaliações do Firestore serão importadas.
5. `npm run import:reviews` importa-as. Um documento vazio no Firestore é ignorado e indicado no relatório.
6. `npm run create-admin` cria o primeiro administrador. É a **única** forma de o fazer.

Sobre a importação:
- Pode repetir `import:json` sem risco: os pacotes que já existem são ignorados, e só `--force` os substitui.
- **Leia os avisos do relatório.** Alguns pacotes têm um bloco `pricing` antigo que contradiz o preço usado no site, por exemplo o Dia de Praia com e sem almoço, o Kruger com veículo normal e aberto, ou o Machangulo Transfer. A importação mantém os preços que o site cobra hoje. Reveja-os no painel, em Pacotes → Preços (opções e regras).
- **Capacidade:** nenhum pacote tem capacidade definida, porque o valor real não era conhecido. Defina-a em Pacotes → Disponibilidade ou no calendário. Sem capacidade, os pedidos são aceites e a equipa confirma manualmente.

Depois de entrar em `https://SEU-DOMINIO/admin/`, abra **Definições** e configure:
- os e-mails da equipa, que recebem os avisos de novos pedidos;
- a política de reservas (bloqueio de 48 h por defeito, antecedência mínima de 24 h);
- o programa de fidelização, que vem desactivado.

### Verificação antes de arrancar

```powershell
cd D:\sites\maputoblue\server
npm run check
```

Não altera nada. Confirma a versão do Node, o `.env` de produção, a ligação e a codificação do PostgreSQL, as migrações, as permissões de escrita (`assets\images`, `server\.cache`, `backups`), as fontes dos PDF, se existem administrador e catálogo, e avisa sobre contas de teste. Termina com código 1 enquanto houver problemas.

Em produção (`NODE_ENV=production`) o servidor **recusa-se a arrancar** se o `DATABASE_URL` ou o `PUBLIC_BASE_URL` (tem de ser `https://`) estiverem por preencher, se `COOKIE_SECURE` não for `true`, ou se `TICKET_SECRET`/`IP_HASH_SALT` forem curtos ou `CHANGE_ME`. A mensagem, em `logs\server-error.log`, diz o que falta.

## 5. Serviço Windows (NSSM)

O `install.ps1` já cria o serviço (reinício automático 5 s depois se o processo cair, registos rodados em `logs\`). Para o arrancar:

```powershell
nssm start MaputoBlue
curl http://127.0.0.1:3000/api/health
```

Configuração manual equivalente, se preferir não usar o script:

```powershell
nssm install MaputoBlue "C:\Program Files\nodejs\node.exe" "--env-file=.env src\index.js"
nssm set MaputoBlue AppDirectory D:\sites\maputoblue\server
nssm set MaputoBlue AppStdout D:\sites\maputoblue\logs\server.log
nssm set MaputoBlue AppStderr D:\sites\maputoblue\logs\server-error.log
nssm set MaputoBlue AppRotateFiles 1
nssm set MaputoBlue AppRotateBytes 10485760
nssm set MaputoBlue Start SERVICE_AUTO_START
nssm start MaputoBlue
```

As migrações pendentes correm automaticamente sempre que o serviço arranca.
Para confirmar que está a funcionar: `curl http://127.0.0.1:3000/api/health`.

## 6. HTTPS (proxy reverso)

**Opção A — Caddy (mais simples, certificado automático).** Use `deploy\windows\Caddyfile`: redirecciona `www.maputoblue.co.mz` para `maputoblue.co.mz`, faz o proxy para o Node e guarda o registo de acessos. Copie-o para `C:\caddy\` e instale o Caddy como serviço:

```powershell
nssm install Caddy C:\caddy\caddy.exe run --config C:\caddy\Caddyfile
nssm start Caddy
```

O certificado é emitido automaticamente quando o DNS dos dois nomes apontar para o servidor e as portas 80 e 443 estiverem abertas.

**Opção B — IIS.** Use `deploy\windows\web.config`:
1. Instale URL Rewrite e Application Request Routing, e active «Enable proxy» no ARR.
2. Corra os dois comandos `appcmd` indicados no topo do `web.config` (preservar o cabeçalho Host e permitir `X-Forwarded-Proto`).
3. Crie um site IIS para `www.maputoblue.co.mz` e `maputoblue.co.mz` numa pasta vazia e copie para lá o `web.config`. Ele redirecciona HTTP → HTTPS e o `www` para o domínio sem `www`, e envia o resto para o Node.
4. Configure o certificado com win-acme (Let's Encrypt).

Se o domínio final não for `maputoblue.co.mz`, altere-o no `Caddyfile`/`web.config` e no `PUBLIC_BASE_URL`.

Com `NODE_ENV=production` o site envia o cabeçalho HSTS: depois de o abrirem em HTTPS, os navegadores recusam HTTP durante um ano. Arranque em produção só com o certificado a funcionar.

**Firewall:** abra apenas as portas 80 e 443. A porta 3000 e a do PostgreSQL (5432) **não** devem ficar acessíveis de fora.

## 7. E-mail (Resend)

1. Crie uma conta em resend.com. O plano gratuito permite 3.000 e-mails por mês, com um máximo de 100 por dia; ao atingir o limite, o envio pára, sem cobrança.
2. Em Domains, adicione `maputoblue.co.mz` e crie os registos DNS indicados (SPF, DKIM e, opcionalmente, DMARC) no fornecedor de DNS. Espere que o domínio fique «Verified».
3. Em API Keys, crie uma chave **só de envio** e coloque-a em `RESEND_API_KEY` no `.env`.
4. Reinicie o serviço: `nssm restart MaputoBlue`.
5. No painel, em **E-mails**, reenvie os que estão como «Falhou».

**Comportamento da fila:**
- Os e-mails nunca bloqueiam nem anulam uma reserva. Ficam na fila (`mail_outbox`) e são enviados a cada 20 s.
- Se o envio falhar, há até 6 tentativas com espera crescente.
- A chave de idempotência evita e-mails duplicados quando há repetições.
- Se o volume ultrapassar 100 e-mails por dia, mude para o plano pago do Resend (Pro) ou para o SMTP da empresa (ver `server/src/lib/mailer.js`, função `resendTransport`).

## 8. Backups

**Backup completo diário (recomendado).** O script `deploy\windows\backup.ps1` faz o `pg_dump` (formato custom) da base indicada no `.env`, uma cópia espelhada de `assets\images`, e apaga dumps com mais de 30 dias:

```powershell
.\deploy\windows\backup.ps1 -BackupDir E:\backups\maputoblue            # um backup agora
.\deploy\windows\backup.ps1 -BackupDir E:\backups\maputoblue -Register  # tarefa diária às 02:30
```

- Guarde a palavra-passe da base em `%APPDATA%\postgresql\pgpass.conf` da conta que corre a tarefa (linha `127.0.0.1:5432:maputoblue:maputoblue:SENHA`). O script nunca contém nem mostra a senha.
- O `update.ps1` usa a pasta por defeito (`D:\backups\maputoblue`); se usar outra, altere o valor de `$BackupDir` no `backup.ps1`.
- Copie a pasta de backups para fora do servidor (disco externo ou armazenamento na nuvem).

**Backup lógico rápido.** Usado automaticamente antes da importação, mas também pode ser corrido à mão:

```powershell
npm run backup -- antes-de-alteracao
```

Grava em `backups\<data>-<nome>\` um JSON por tabela e uma cópia de `data\*.json`.

**Imagens carregadas no painel:** ficam em `assets\images\…`. Inclua a pasta `assets\images` no backup de ficheiros do servidor.

**Restaurar o backup completo:**

```powershell
& "C:\Program Files\PostgreSQL\17\bin\pg_restore.exe" -U postgres -h 127.0.0.1 -d maputoblue --clean --if-exists "E:\backups\maputoblue-AAAAMMDD.dump"
```

## 9. Actualizações e reversão (rollback)

**Para actualizar o código:**

```powershell
cd D:\sites\maputoblue
.\deploy\windows\update.ps1                 # último commit da branch actual
.\deploy\windows\update.ps1 -Ref v1.2.0     # uma tag ou commit concreto
```

O `update.ps1`:
1. recusa avançar se houver ficheiros do repositório alterados à mão no servidor;
2. faz backup (`backup.ps1 -Label pre-update`) e cancela se falhar;
3. obtém a nova versão, corre `npm ci --omit=dev` e reinicia o serviço (as migrações aplicam-se no arranque);
4. espera até 60 s por `/api/health`. **Se não responder, volta sozinho à versão anterior** e reinicia-a.

Antes de cada actualização, corra `npm test` e `npm run test:e2e` numa máquina de testes.

**Para reverter:**
1. **Código:** `git checkout <commit-anterior>` e depois `nssm restart MaputoBlue`. As migrações deste projecto só acrescentam tabelas e colunas, por isso o código anterior continua a funcionar com a base de dados mais recente.
2. **Dados:** restaure o último `pg_dump` (secção 8). Faça-o apenas se uma alteração de dados tiver corrompido informação, porque as reservas feitas depois do backup perdem-se.
3. **Catálogo:** no painel, em Pacotes → Revisões, cada pacote pode ser restaurado a qualquer versão anterior, incluindo a versão importada.
4. **Voltar ao site antigo, só estático:**
   - mude para a branch `main`, ou sirva a pasta com `SERVE_STATIC` noutro servidor;
   - o site antigo continua a funcionar com o WhatsApp;
   - **atenção:** as avaliações do site antigo voltam a ser lidas do Firestore, que continua intacto.

## 10. Lista de verificação para produção

**Facturação** (ver [FACTURACAO.md](FACTURACAO.md)):
- [ ] O contabilista confirmou os requisitos das facturas em Moçambique: campos obrigatórios, regime e taxa de IVA, numeração e certificação do software
- [ ] Em Definições → Facturação estão preenchidos a denominação legal, a morada correcta do emitente e as instruções de pagamento (dados bancários e M-Pesa confirmados)
- [ ] O IVA está ligado **apenas** com a taxa confirmada
- [ ] O fluxo completo (emitir, pagamento parcial, pagamento total, anular/corrigir) foi ensaiado numa cópia de teste da base de dados e **não** em produção, porque cada factura emitida consome um número real da série

**Infra-estrutura:**
- [ ] `npm run check` termina sem problemas (✗)
- [ ] PostgreSQL com palavra-passe forte e porta 5432 fechada ao exterior
- [ ] `.env` preenchido, com `COOKIE_SECURE=true`, `TRUST_PROXY=true` e o `PUBLIC_BASE_URL` correcto
- [ ] Serviço NSSM com arranque automático e `/api/health` a responder
- [ ] HTTPS activo, com o HTTP a redireccionar para HTTPS

**Dados e acesso:**
- [ ] `import:json` e `import:reviews` executados e relatórios revistos
- [ ] Preços com avisos revistos no painel (Dia de Praia, Kruger, Machangulo Transfer, Eswatini Hlane, Maputo City Transfer)
- [ ] Capacidades definidas nos pacotes onde se quer controlo automático
- [ ] Administrador criado e contas de teste removidas (o `npm run check` indica quantas há)
- [ ] E-mails da equipa configurados em Definições

**E-mail:**
- [ ] Domínio verificado no Resend, `RESEND_API_KEY` definido e e-mail de teste recebido (faça uma reserva de teste)

**Backups:**
- [ ] Tarefa diária criada (`backup.ps1 -Register`) e **um restauro testado**
- [ ] `assets\images` incluído no backup de ficheiros

**SEO:**
- [ ] Sitemap submetido no Google Search Console: `https://maputoblue.co.mz/sitemap.xml`

**Tickets:**
- [ ] `TICKET_SECRET` definido e guardado num local seguro, porque é preciso para os QR continuarem válidos após uma reinstalação
- [ ] Dados da empresa revistos em Definições → «Dados da empresa». A denominação legal, o NUIT e o alvará só aparecem no ticket depois de configurados
- [ ] Um ticket de teste descarregado, impresso e com o QR lido num telemóvel. A página de verificação deve abrir com o domínio real

**Cache de imagens:**
- [ ] A pasta `server\.cache\img` pode ser apagada a qualquer momento, porque é regenerada automaticamente. Não precisa de backup

**Testes:**
- [ ] `npm test` e `npm run test:e2e` executados num ambiente de testes antes de cada actualização

## 11. Custos recorrentes e limites

| Serviço | Custo | Limites |
|---|---|---|
| Servidor (Windows Server do cliente) | já existente | — |
| Node.js, PostgreSQL, Caddy, NSSM | gratuito (open source) | — |
| Resend, plano gratuito | 0 USD | 3.000 e-mails por mês, 100 por dia, 1 domínio. Acima disso, o plano Pro começa nos 20 USD por mês para 50.000 e-mails (confirme os valores em resend.com/pricing) |
| Certificado TLS (Let's Encrypt) | 0 USD | renovação automática |
| Firebase | deixou de ser usado pela branch `Automation` | o projecto continua activo até o site antigo ser desligado |

Uma estimativa grosseira de volume: com cerca de 3 a 5 e-mails por reserva (pedido, aviso à equipa, confirmação e lembrete), o plano gratuito chega para aproximadamente 20 a 30 reservas por dia.

## 12. Desenvolvimento local

```powershell
cd server
npm install
npm run db:dev
npm start
npm test
npm run test:e2e
npm run screenshot -- http://localhost:3100/pages/tours.html
```

- `npm install` instala também o PostgreSQL portátil.
- `npm run db:dev` arranca o PostgreSQL de desenvolvimento em `127.0.0.1:5433`; deixe-o a correr.
- O `.env` local deve ter `PORT=3100` e `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/maputoblue`.
- `npm test` usa a base `maputoblue_test`, que é recriada em cada execução.
- `npm run test:e2e` precisa do servidor a correr e de um administrador `admin@maputoblue.local`.
- Os testes de login no navegador estão sujeitos ao limite de 10 tentativas a cada 15 minutos. Se executar muitas vezes seguidas, reinicie o servidor.
