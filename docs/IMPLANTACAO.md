# Maputo Blue — Instalação no Windows Server, operação e reversão

Este guia é para quem vai instalar e manter a plataforma no servidor próprio (Windows Server).
**Nenhum valor secreto deve ser escrito neste repositório.** As credenciais vão só para `server\.env`, que o Git ignora.

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
git checkout Automation
cd server
npm ci --omit=dev
copy .env.example .env
notepad .env
```

Preencha o `.env`:

| Variável | Valor |
|---|---|
| `DATABASE_URL` | `postgres://maputoblue:SENHA@127.0.0.1:5432/maputoblue` |
| `PUBLIC_BASE_URL` | `https://www.maputoblue.com`, sem barra no fim. Usado nos links dos e-mails e na protecção CSRF |
| `PORT` / `HOST` | `3000` / `127.0.0.1` |
| `TRUST_PROXY` | `true` atrás de IIS ou Caddy |
| `COOKIE_SECURE` | `true`, porque o site serve só HTTPS |
| `RESEND_API_KEY` | ver a secção 6 |
| `MAIL_FROM` | ex.: `Maputo Blue <reservas@maputoblue.com>`, num domínio verificado no Resend |
| `MAIL_REPLY_TO` | caixa que recebe as respostas dos clientes |
| `IP_HASH_SALT` | texto aleatório longo: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `TICKET_SECRET` | **obrigatório em produção** (sem ele o servidor não arranca). Texto aleatório longo, gerado da mesma forma. Assina os QR codes dos tickets. **Nunca o altere depois de emitir tickets**, porque todos os QR já emitidos deixariam de ser válidos |
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
npm run create-admin -- admin@maputoblue.com "Nome do Administrador"
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

## 5. Serviço Windows (NSSM)

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

**Opção A — Caddy (mais simples, certificado automático).** `Caddyfile`:

```
www.maputoblue.com, maputoblue.com {
    encode gzip
    reverse_proxy 127.0.0.1:3000
}
```

Instale o Caddy também como serviço com NSSM: `caddy run --config Caddyfile`.

**Opção B — IIS:**
1. Instale URL Rewrite e Application Request Routing, e active «Enable proxy» no ARR.
2. Crie uma regra de *reverse proxy* para `http://127.0.0.1:3000`, com preservação do cabeçalho Host.
3. Configure o certificado com win-acme (Let's Encrypt).

**Firewall:** abra apenas as portas 80 e 443. A porta 3000 e a do PostgreSQL (5432) **não** devem ficar acessíveis de fora.

## 7. E-mail (Resend)

1. Crie uma conta em resend.com. O plano gratuito permite 3.000 e-mails por mês, com um máximo de 100 por dia; ao atingir o limite, o envio pára, sem cobrança.
2. Em Domains, adicione `maputoblue.com` e crie os registos DNS indicados (SPF, DKIM e, opcionalmente, DMARC) no fornecedor de DNS. Espere que o domínio fique «Verified».
3. Em API Keys, crie uma chave **só de envio** e coloque-a em `RESEND_API_KEY` no `.env`.
4. Reinicie o serviço: `nssm restart MaputoBlue`.
5. No painel, em **E-mails**, reenvie os que estão como «Falhou».

**Comportamento da fila:**
- Os e-mails nunca bloqueiam nem anulam uma reserva. Ficam na fila (`mail_outbox`) e são enviados a cada 20 s.
- Se o envio falhar, há até 6 tentativas com espera crescente.
- A chave de idempotência evita e-mails duplicados quando há repetições.
- Se o volume ultrapassar 100 e-mails por dia, mude para o plano pago do Resend (Pro) ou para o SMTP da empresa (ver `server/src/lib/mailer.js`, função `resendTransport`).

## 8. Backups

**Backup completo diário (recomendado).** Crie uma tarefa agendada:

```powershell
$d = Get-Date -Format yyyyMMdd
& "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe" -U maputoblue -h 127.0.0.1 -F c -f "E:\backups\maputoblue-$d.dump" maputoblue
```

- Guarde a palavra-passe em `%APPDATA%\postgresql\pgpass.conf` da conta que corre a tarefa.
- Copie os backups para fora do servidor e mantenha pelo menos 30 dias.

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
npm --prefix server run backup -- pre-update
git fetch
git checkout <commit-ou-tag-novo>
cd server
npm ci --omit=dev
nssm restart MaputoBlue
```

As migrações aplicam-se no arranque.

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
- [ ] PostgreSQL com palavra-passe forte e porta 5432 fechada ao exterior
- [ ] `.env` preenchido, com `COOKIE_SECURE=true`, `TRUST_PROXY=true` e o `PUBLIC_BASE_URL` correcto
- [ ] Serviço NSSM com arranque automático e `/api/health` a responder
- [ ] HTTPS activo, com o HTTP a redireccionar para HTTPS

**Dados e acesso:**
- [ ] `import:json` e `import:reviews` executados e relatórios revistos
- [ ] Preços com avisos revistos no painel (Dia de Praia, Kruger, Machangulo Transfer, Eswatini Hlane, Maputo City Transfer)
- [ ] Capacidades definidas nos pacotes onde se quer controlo automático
- [ ] Administrador criado e conta de teste removida
- [ ] E-mails da equipa configurados em Definições

**E-mail:**
- [ ] Domínio verificado no Resend, `RESEND_API_KEY` definido e e-mail de teste recebido (faça uma reserva de teste)

**Backups:**
- [ ] Tarefa diária de `pg_dump` criada e **um restauro testado**
- [ ] `assets\images` incluído no backup de ficheiros

**SEO:**
- [ ] Sitemap submetido no Google Search Console: `https://www.maputoblue.com/sitemap.xml`

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
