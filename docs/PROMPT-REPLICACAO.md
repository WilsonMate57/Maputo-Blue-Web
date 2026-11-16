# Prompt — Site de turismo com reservas, cotações e facturação

> **Como usar:** preencha o bloco «Dados da empresa» (deixe `[A CONFIRMAR]` onde não souber) e cole o documento inteiro como primeira mensagem numa sessão nova do Claude Code, aberta na pasta do novo projecto. Se já existir um site estático da empresa, coloque-o nessa pasta antes de começar.

---

## Papel e objectivo

És o programador principal de um site para uma empresa de turismo. O resultado é uma plataforma completa e pronta para produção: um site público bilingue (PT/EN) com catálogo, reservas online com calendário e preço exacto, pedidos de cotação, uma área de cliente, um painel de administração, bilhetes com QR verificável, facturas e pagamentos verificados, e e-mails transaccionais. Deves entregar também a instalação num alojamento Plesk (Linux) e a documentação de operação.

Trabalha por fases (ver «Plano de entrega»). No fim de cada fase, mostra o que foi feito, como foi testado e o que ficou pendente, e espera pela minha aprovação antes de fazer commit.

## Dados da empresa (preencher)

```
Nome comercial:            [EX.: Empresa X Tours]
Denominação legal:         [A CONFIRMAR]
NUIT / NIF:                [A CONFIRMAR]
Alvará / licença:          [A CONFIRMAR]
Morada:                    [ ]
Telefone / WhatsApp:       [ ]
E-mail principal:          [ ]
Domínio:                   [ex.: empresax.co.mz]
Moeda:                     [MZN]
Idiomas:                   PT (principal) e EN
Cores, fontes, logótipo:   [ou: «usar os do site actual»]
Fotografias:               [pasta com as fotos reais]
Catálogo inicial:          [JSON/planilha com tours, alojamentos, transfers e preços]
Alojamento:                [Plesk Linux com Node.js e PostgreSQL | outro]
Serviço de e-mail:         Resend (plano gratuito) [ou SMTP]
Regime de IVA:             [A CONFIRMAR com o contabilista]
```

## Regras que não podem ser quebradas

1. **Nunca inventes dados de negócio, fiscais ou legais**: NUIT, alvará, taxas de IVA, dados bancários, preços, capacidades, políticas. O que não for fornecido fica vazio, configurável no painel e assinalado como pendente. Não declares conformidade fiscal: o contabilista tem de a confirmar.
2. **Nunca exponhas segredos.** As credenciais ficam só em `server/.env` (no `.gitignore`) ou nas variáveis do alojamento. Não as escrevas no código, nos logs, nos documentos nem no chat.
3. **Não publiques em produção, não corras migrações destrutivas e não alteres dados reais** sem a minha autorização explícita. As migrações só acrescentam (tabelas e colunas novas), para que o código anterior continue a funcionar com a base mais recente.
4. **Mantém a identidade visual** da empresa: cores, fontes, logótipo e fotografias reais. Se eu rejeitar um redesenho, volta ao anterior em vez de insistir.
5. **Nenhum serviço pago obrigatório.** Prefere open source e planos gratuitos, e documenta os limites. Não acrescentes dependências desnecessárias.
6. **PT e EN sempre consistentes**: textos, e-mails, PDFs e mensagens de erro.
7. **O QR dos bilhetes não pode conter dados pessoais**, apenas um identificador assinado.
8. **Sê honesto nos relatórios:** não digas que testaste visualmente o que não testaste. Se um teste falhar, mostra o resultado. Commit e push só quando eu pedir.
9. Faz-me perguntas apenas sobre decisões que são minhas (negócio, preços, textos legais). Nas técnicas, escolhe a opção convencional e explica-a numa linha.

## Arquitectura

- **Front-end:** site estático em HTML, CSS e JS sem framework (Bootstrap, se já existir). As páginas PT ficam em `/pages/` e a raiz, as EN em `/en/`. A navbar e o rodapé são componentes partilhados em `/components/`. Os tokens de design (cores, tipografia, espaçamentos) ficam em CSS custom properties.
- **Back-end:** Node.js 22+ (ES modules) com **Fastify 5** e **PostgreSQL** (compatível com a versão 16 ou superior; não uses extensões, nem `pgcrypto`, porque `gen_random_uuid()` já é nativo). Usa o driver `pg` sem ORM. As migrações são ficheiros SQL numerados (`001_init.sql`, …), aplicados no arranque dentro de uma transacção e registados em `schema_migrations`. O servidor recusa bases que não estejam em UTF-8.
- **Dependências do servidor (mínimas):** `fastify`, `@fastify/static`, `@fastify/cookie`, `@fastify/compress`, `@fastify/rate-limit`, `@fastify/multipart`, `@fastify/formbody`, `pg`, `pdfkit` (PDFs com a fonte da marca em TTF e licença OFL incluída), `qrcode` e `sharp` (redimensionar imagens com cache em disco). Para desenvolvimento: `embedded-postgres` (PostgreSQL portátil para dev e testes), `puppeteer-core` (com o Chrome local) e `lighthouse`.
- **Um só processo serve o site e a API.** Os ficheiros estáticos saem de uma **allowlist** (raiz, `assets/`, `components/`, `data/`, `pages/`, `en/`, `admin/`, `robots.txt`, `sitemap.xml`). Nunca servem `server/`, `docs/`, `deploy/`, `.git` nem backups.
- **Admin:** SPA em JS puro dentro de `/admin/`, com um ficheiro por vista em `admin/js/views/`.
- **Configuração** por variáveis de ambiente, num `config.js` único. Em `NODE_ENV=production`, o servidor recusa arrancar se `DATABASE_URL` faltar, se `PUBLIC_BASE_URL` não for `https://`, se `COOKIE_SECURE` não for `true`, ou se `TICKET_SECRET` (≥32 caracteres) e `IP_HASH_SALT` forem fracos ou `CHANGE_ME`. A mensagem de erro diz o que falta, sem mostrar valores.
- **Tarefas em segundo plano** no mesmo processo (`RUN_JOBS=true`): fila de e-mails a cada 20 s e manutenção de hora a hora (expirar pedidos pendentes, apagar sessões e tokens expirados).

## Site público

1. **Páginas:** início, tours, alojamentos, destinos, serviços, galeria, página de pacote (`package.html?id=…&type=…`), pedido de cotação, reserva de carro e de charter (podem continuar por WhatsApp), privacidade, área de cliente, estado da reserva, cotação, bilhete e verificação de bilhete. Todas existem em PT e EN, com selector de idioma.
2. **Catálogo** vindo da API, com filtros por categoria, cartões com preço «desde» e avaliação média.
3. **Página de pacote:**
   - galeria, destaques, incluído e não incluído, itinerário, informações e avaliações, com navegação interna fixa;
   - **cartão de reserva** com calendário de disponibilidade por mês (disponível, poucos lugares, indisponível, preço do dia), adultos e crianças com idades configuráveis, opções (por exemplo barco ou veículo), extras, transfer, código promocional e resumo com o **preço exacto calculado pelo servidor**;
   - **alojamentos:** o cliente escolhe a **data de entrada e a data de saída** no calendário. Só aparecem como possíveis as saídas em que todas as noites intermédias estão disponíveis, dentro de um mínimo e máximo de noites por pacote (por defeito 1 a 30). O intervalo fica destacado, o cálculo pode passar para o mês seguinte e o resumo mostra «2 adultos × 3 noites».
   - o pedido de reserva é feito com ou sem conta, e o cliente aceita a política.
4. **Pedido de cotação:**
   - selector de vários pacotes ou serviços do catálogo (pesquisa e categorias), com datas e participantes por item, ou um pedido livre;
   - dados de contacto e canal preferido;
   - opção «pedido em nome de uma empresa», com denominação, NUIT (9 dígitos) e morada, que aparecem depois na cotação e na factura.
5. **Avaliações** guardadas na base de dados e moderadas no admin. Se houver avaliações antigas, há um script de importação.
6. **SEO e desempenho:**
   - `robots.txt` e `sitemap.xml` gerados a partir da base, com o domínio de `PUBLIC_BASE_URL`;
   - canonical, hreflang e Open Graph **com o domínio real** (confirma o domínio antes de o escrever);
   - `noindex` na área de cliente e nas páginas de bilhete e cotação;
   - imagens WebP redimensionadas por `/img/:largura/...`, `loading="lazy"`, compressão gzip/brotli e cache longa só para imagens;
   - acessibilidade: contraste, foco visível, `aria`, navegação por teclado no calendário.
7. **Responsivo:** sem scroll horizontal a 360 px. Nas grelhas usa `min-width:0` nos filhos.

## Motor de reservas

- **Modelo de preço por pacote** (validado num módulo próprio):
  - `unit`: `per_person`, `per_group` ou `per_night`;
  - preço de adulto e de criança (sem preço de criança, as crianças pagam como adulto, e isso fica registado como aviso);
  - opções com preço próprio, extras, transfers e mínimo de pessoas;
  - `nights` (mínimo de noites) e `max_nights` nos alojamentos.
- **Regras de preço** por intervalo de datas, dia da semana e prioridade (por exemplo época alta). Nas estadias, **cada noite usa a regra dessa noite**: as noites seguidas com o mesmo preço agrupam-se numa linha, e se a estadia atravessar épocas diferentes, aparece uma linha por intervalo.
- **O preço é sempre calculado no servidor** (`POST /api/quote`). Cada linha tem rótulos PT e EN. As linhas que já incluem a quantidade no texto («× 3 noites») levam `qty_in_label`, para não se repetir `× qty`.
- **Disponibilidade:**
  - capacidade por pacote, por opção ou recurso e por dia, com dias fechados;
  - a reserva cria **uma alocação por noite ou dia**, dentro de uma transacção com bloqueio de linhas (`SELECT … FOR UPDATE`), sem overbooking;
  - sem capacidade definida, o pedido é aceite e a equipa confirma à mão;
  - antecedência mínima configurável.
- **Estados:** `pending → confirmed | rejected | cancelled` e `confirmed → cancelled | completed`. Um pedido pendente fica bloqueado durante X horas (configurável, por defeito 48) e depois expira. Ao confirmar, a disponibilidade é verificada outra vez.
- **O admin pode editar** a data, as pessoas, a opção e as noites de uma reserva. O preço e as alocações são recalculados, e o cliente pode ser notificado ou não.
- **Promoções** (percentagem ou valor fixo, validade, limite de usos) e **programa de fidelização**, que vem desligado. A elegibilidade conta apenas reservas concluídas com e-mail verificado, e os ajustes manuais ficam auditados.

## Contas e área de cliente

- Registo com verificação de e-mail, login, recuperação e alteração de senha. A senha usa um hash forte com salt (scrypt nativo do Node).
- Sessões em cookie `HttpOnly`, `SameSite=Lax` e `Secure` em produção, guardadas na base.
- O cliente vê na área de cliente:
  - reservas e estado, com cancelamento quando permitido;
  - bilhetes (HTML e PDF, e envio por e-mail);
  - pedidos de cotação e as cotações recebidas, que pode **aceitar ou recusar** e descarregar em **PDF**;
  - facturas em PDF;
  - fidelização e perfil.
- **Posse dos documentos:** pertencem ao cliente se tiverem o seu `user_id` ou o seu **e-mail verificado**. Quem reservou sem conta consulta o estado por referência e e-mail.

## Cotações

- Fluxo: pedido → o admin vê os itens pedidos → **sugestão automática de linhas** a partir do catálogo, com datas e pessoas → o admin edita linhas, validade e notas → **envia**.
- Canais de envio escolhidos pelo admin: **e-mail**, **WhatsApp** (link `wa.me` com a mensagem pronta) e/ou **link** para copiar. A cotação aparece também na conta do cliente.
- O link público usa um token aleatório e a base guarda **só o hash** desse token. A página pública mostra a cotação e permite aceitar ou recusar.
- PDF da cotação com a marca e a fonte do site, os dados da empresa emissora e um bloco «A/c» com os dados da empresa cliente (NUIT formatado «400 123 456»).

## Facturação e pagamentos

- Facturas emitidas pelo admin a partir de reservas ou soltas.
- **Numeração sem falhas por série e ano.** O contador (`invoice_sequences`) é actualizado dentro da mesma transacção que emite a factura.
- Uma factura emitida **não se edita**: anula-se ou corrige-se com um novo documento. O PDF emitido é guardado.
- **Pagamentos registados só pelo admin**, e só depois de confirmar que o dinheiro entrou (`verified`). Suportam pagamentos parciais, reembolsos e estornos, com idempotência. O estado de pagamento da reserva e da factura é **calculado a partir dos pagamentos** e nunca marcado à mão.
- O IVA vem **desligado** até haver regime e taxa confirmados.
- Dados do emitente, instruções de pagamento e notas de rodapé (PT/EN) configuráveis em Definições.
- Documento `docs/FACTURACAO.md` com a lista do que o contabilista tem de confirmar.

## Bilhetes e QR

- Bilhete por reserva confirmada (HTML e PDF) com a referência, o pacote, as datas, as pessoas e os dados da empresa. Campos legais vazios não são impressos.
- O QR leva só a referência e uma assinatura HMAC com `TICKET_SECRET`. A página `verify.html` valida o código e mostra apenas o estado e o mínimo de dados. As leituras ficam registadas (com o IP em hash).
- **`TICKET_SECRET` nunca pode mudar depois de emitir bilhetes.** Documenta isto.

## E-mails

- **Fila na base de dados** (`mail_outbox`) com tentativas e espera crescente (até 6), uma chave de idempotência e `FOR UPDATE SKIP LOCKED`. Um e-mail nunca bloqueia nem desfaz uma reserva.
- Envio pelo **Resend** (API HTTP) com o remetente num domínio verificado (SPF e DKIM) e `Reply-To` para a caixa da empresa. O código deve ter um único ponto de transporte, para poder trocar por SMTP.
- Modelos PT e EN para: pedido recebido (cliente), aviso de novo pedido (e-mails da equipa configurados em Definições), confirmação com bilhete em anexo, rejeição, cancelamento, alteração, cotação enviada, factura emitida, pagamento recebido, verificação de e-mail e recuperação de senha.
- No admin: lista de e-mails com estado e motivo da falha, e botão para reenviar. As Definições mostram se o e-mail está configurado.

## Painel de administração (`/admin/`)

Vistas:
- **Dashboard:** pedidos novos, próximas partidas, receita verificada.
- **Reservas:** lista e detalhe, mudança de estado, edição, notas internas, bilhete e factura.
- **Calendário:** disponibilidade e capacidade, fechar dias.
- **Pedidos de cotação:** detalhe e construtor da cotação.
- **Clientes.**
- **Facturas:** nova, detalhe, pagamentos.
- **Pacotes:**
  - editor completo com textos PT e EN, fotos, preços, opções, regras, extras, mínimo e máximo de noites e disponibilidade;
  - **revisões** com restauro de qualquer versão.
- **Promoções.**
- **Avaliações:** moderação.
- **Media:** upload com redimensionamento.
- **E-mails.**
- **Auditoria:** quem fez o quê e quando.
- **Definições:**
  - dados da empresa;
  - facturação;
  - política de reservas;
  - fidelização;
  - e-mails da equipa;
  - estado do sistema.

Regras do painel:
- O primeiro administrador só é criado pelo script `npm run create-admin`. A senha vem de uma variável de ambiente ou de um prompt, e não existe registo público de admins.
- Toda a acção de admin fica na auditoria.

## Segurança

- **CSRF:** os pedidos à API que alteram dados têm de vir da própria origem (cabeçalho `Origin`) e ter corpo JSON ou multipart. O `text/plain` é recusado.
- **Validação estrita** com JSON Schema em todas as rotas, removendo campos desconhecidos (`removeAdditional`).
- **Rate limiting** no login, no registo, nos pedidos públicos e na verificação de bilhetes.
- **Honeypot** (campo `website` escondido) nos formulários públicos.
- **Cabeçalhos:**
  - `nosniff`, `Referrer-Policy` e `X-Frame-Options: SAMEORIGIN`;
  - `Cache-Control: no-store` na API e no admin;
  - HSTS em produção.
- **Privacidade:** os IPs só são guardados em hash com salt.
- **Uploads:** limite de tamanho e verificação de tipo. As fotos originais nunca são alteradas.

## Dados, scripts e backups

`npm run …`:
- `migrate`;
- `import:json` (com `--dry-run`, relatório de avisos e backup automático antes de importar; volta a correr sem duplicar);
- `import:reviews`;
- `create-admin`;
- `backup` (JSON por tabela);
- **`check`**: verificação antes de publicar, só de leitura. Confirma a versão do Node, as variáveis de produção, a ligação e o UTF-8 da base, as migrações, as pastas com permissão de escrita, as fontes dos PDFs, se existe administrador e catálogo, e se há contas de teste. Sai com código 1 se houver problemas.

## Testes

- **Unitários e de integração** com `node:test` sobre uma base de teste recriada em cada execução (embedded-postgres). Cobrem:
  - preços (épocas, noites, opções, promoções);
  - disponibilidade e concorrência;
  - estados das reservas;
  - posse dos documentos;
  - cotações;
  - numeração das facturas;
  - pagamentos;
  - bilhetes e QR;
  - CSRF e validação.
- **E2E** com puppeteer-core e o Chrome local: reserva completa, estadia de várias noites, pedido de cotação, área de cliente e admin (login, confirmar, emitir factura, registar pagamento). Inclui capturas em 1366 px e 375 px e um teste de overflow horizontal.
- Notas para o headless: os downloads com `Content-Disposition` dão 204 no `fetch` do navegador, por isso os PDFs validam-se por HTTP. Evita capturas `fullPage` de grelhas grandes. O rate limit obriga a reiniciar o servidor entre execuções de E2E.

## Instalação no Plesk (Linux) — lições já aprendidas

- **Ficheiro de arranque `server/app.cjs`** (CommonJS): carrega `server/.env` se existir, com `process.loadEnvFile`, e faz `import('./src/index.js')`. O Passenger e o iisnode carregam a aplicação com `require`. O `PORT` pode ser um *named pipe* (iisnode), por isso usa `listen({ path })` quando não for numérico.
- **Document root:** uma pasta **vazia** `server/public`. **Nunca** a raiz do repositório, que exporia o código e o `.env`. O Git do Plesk deve publicar **fora de `httpdocs`** (por exemplo `/app-name`).
- **Node.js no Plesk:**
  - Application Root `/app-name/server`;
  - Startup File `app.cjs`;
  - modo `production`;
  - Node 22 ou superior.
- **`server/.node-version`** com a versão escolhida (por exemplo `26`): sem ele, o nodenv do Plesk dá «node: command not found» nos `npm run`.
- **As variáveis do painel do Plesk podem não chegar aos comandos «Run Node.js commands».** Usa `server/.env` (permissões 600), que tanto a aplicação como os scripts lêem.
- **PostgreSQL:** confirma em Tools & Settings → Database Servers que existe um servidor PostgreSQL (o ecrã Add Database pode mostrar só MariaDB). Cria a base associada ao domínio, com «local connections only».
- **Administrador sem terminal:** acrescenta `ADMIN_PASSWORD=…` ao `.env` só por um momento, corre `run create-admin -- email "Nome"` e **apaga a linha logo a seguir**.
- **O Passenger pára a aplicação quando não há visitas.** Cria uma tarefa agendada «Fetch a URL» para `/api/health` a cada 5 minutos.
- **Depois de instalar:**
  - backups diários (bases de dados e ficheiros) para armazenamento remoto;
  - Git em modo **manual**;
  - registos SPF/DKIM do Resend no DNS;
  - sitemap submetido no Search Console.
- Escreve `docs/PLESK.md` com estes passos e com o procedimento de actualização (Pull → Deploy → NPM install → Restart App) e de reversão.
- Se o alojamento for outro (VPS ou Windows Server), fornece scripts de instalação, actualização com reversão automática e backup, e a configuração do proxy HTTPS (Caddy ou IIS).

## Plano de entrega

1. **Levantamento:** analisa o site existente, o catálogo e as fotos, e lista as dúvidas de negócio. Não escrevas código antes de eu responder às perguntas bloqueantes.
2. **Base:** servidor, configuração, migrações, catálogo, importação e site público a ler da API, sem alterar o visual.
3. **Reservas:** preços, disponibilidade, calendário (incluindo estadias), reserva, e-mails e estado.
4. **Contas** e área de cliente.
5. **Admin:** reservas, calendário, pacotes, definições, auditoria.
6. **Cotações:** pedido, construtor, canais e PDF.
7. **Bilhetes e QR, facturas e pagamentos.**
8. **SEO, desempenho e acessibilidade.** Revisão visual em desktop e mobile, com capturas.
9. **Produção:** `npm run check`, instalação, documentação (`ARQUITECTURA.md`, `PLESK.md`, `FACTURACAO.md`) e uma lista de verificação final com o que depende de mim, por exemplo preços a rever, capacidades, dados fiscais e domínio de e-mail.

**Critérios de aceitação de cada fase:**
- todos os testes passam;
- nenhum erro na consola do navegador;
- nenhum scroll horizontal a 360 px;
- PT e EN completos;
- nenhum segredo no repositório;
- relatório honesto do que foi e não foi verificado.
