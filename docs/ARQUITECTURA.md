# Maputo Blue — Arquitectura da plataforma de reservas

Branch: `Automation`. Este documento descreve o sistema que existia, o que foi construído e porquê.

## 1. Ponto de partida (branch `main`)

| Área | Situação original |
|---|---|
| Frontend | HTML + Bootstrap 5 + JavaScript simples, PT (`/pages/`) e EN (`/en/`), navbar/footer injectados por `components.js` |
| Catálogo | `data/tours.json` (17) e `data/accommodations.json` (4), renderizados por `data-loader.js` |
| Reservas | O formulário calculava o total no navegador e abria o WhatsApp. Não havia registo, referência nem disponibilidade |
| Avaliações | Firestore (projecto `maputo-blue-web`), lidas e escritas directamente pelo navegador |
| Contas, painel, e-mail | Não existiam |

## 2. Arquitectura implementada

```
Navegador ──HTTPS──► Proxy (IIS ou Caddy, certificado TLS)
                         │
                         ▼
                 Node.js (Fastify) — server/src/index.js
                   ├── ficheiros do site (lista restrita de pastas)
                   ├── /api/*          API pública, conta de cliente
                   ├── /api/admin/*    painel (exige role=admin)
                   └── tarefas: envio de e-mails, conclusão automática, lembretes
                         │
                         ▼
                 PostgreSQL 17 (base de dados única)
                         │
                 Resend (envio de e-mail, chamado só pelo servidor)
```

**Porque esta solução:**
- **Servidor próprio:** o cliente tem um Windows Server e não quer subscrições pagas. Node.js e PostgreSQL são gratuitos e correm bem em Windows.
- **Sem framework de frontend:** o site existente continua igual, e apenas foram acrescentados scripts que o melhoram progressivamente (`booking.js`, `portal-*.js`). Se a API estiver em baixo, o site volta ao comportamento antigo: JSON estáticos e reserva por WhatsApp.
- **PostgreSQL:** tem transacções reais e bloqueios consultivos (`pg_advisory_xact_lock`), o que impede dois pedidos simultâneos de ocuparem o mesmo último lugar.
- **Fonte única de verdade:** o catálogo, os preços e a disponibilidade vivem na base de dados. A API devolve os pacotes no mesmo formato dos JSON antigos, por isso as páginas existentes não precisaram de ser reescritas.

## 3. Estrutura de ficheiros nova ou alterada

| Caminho | Conteúdo |
|---|---|
| `server/src/app.js`, `index.js`, `config.js`, `db.js`, `migrate.js` | Aplicação, arranque, configuração, ligação à base de dados e migrações |
| `server/src/lib/` | Regras de negócio: `pricing.js`, `pricing-model.js`, `availability.js`, `bookings.js`, `loyalty.js`, `catalog.js`, `importer.js`, `mailer.js`, `mail-templates.js`, `auth.js`, `security.js`, `audit.js`, `backup.js`, `dates.js` |
| `server/src/routes/` | `public.js`, `auth.js`, `account.js`, `seo.js`, `admin/*.js` |
| `server/migrations/001_init.sql` | Schema completo |
| `server/scripts/` | `dev-db.js`, `migrate.js`, `import-json.js`, `import-firestore-reviews.js`, `create-admin.js`, `backup.js`, `screenshot.js` |
| `server/test/`, `server/e2e/` | Testes de integração (base de dados real) e testes no navegador (Chrome) |
| `admin/` | Painel de administração (`index.html`, `admin.css`, `js/app.js`, `js/core.js`, `js/views/*`) |
| `assets/js/api.js`, `booking.js`, `portal-*.js` | Cliente da API, melhoria do cartão de reserva e páginas do cliente |
| `pages/` e `en/`: `account.html`, `booking-status.html`, `quote.html`, `custom-tour.html`, `privacy.html` | Páginas novas, com o mesmo nome de ficheiro em PT e EN |
| `assets/js/data-loader.js`, `reviews.js`, `card-ratings.js`, `components.js` | Passam a usar a API, com *fallback* para os JSON |
| Removidos | `assets/js/firebase.js`, `assets/js/ratings-cache.js`, `firestore.rules` |

## 4. Modelo de dados

| Tabela | Função |
|---|---|
| `packages` | `id` (os mesmos IDs do JSON), `kind`, `category`, `status` (draft/published/archived), `content` (todos os campos de apresentação PT/EN, no formato original), `pricing`, `availability`, `seo`, `version` |
| `package_revisions` | Cópia completa de cada versão gravada, que pode ser restaurada no painel. A versão 1 inclui o registo JSON original |
| `price_rules` | Preços por dia da semana, época ou datas, e por opção. Ganha a regra de maior prioridade e, em empate, a mais específica |
| `availability_days` | Capacidade ou fecho de um dia, por pacote e por recurso (`*` ou uma opção, por exemplo um barco) |
| `bookings` | Reserva com `price_snapshot` **imutável** (linhas, regras, descontos, total), `status`, `payment_status`, `hold_expires_at`, `idempotency_key` e um *hash* do token de acompanhamento |
| `booking_allocations` | Capacidade consumida pela reserva em cada dia |
| `payments` | Pagamentos e reembolsos registados manualmente |
| `promotions` | Promoções automáticas ou com código: percentagem ou valor fixo, máximo, datas, condições, limite de utilizações |
| `users`, `sessions`, `auth_tokens` | Contas (palavra-passe com scrypt), sessões em cookie e tokens de verificação e recuperação |
| `loyalty_adjustments` | Ajustes manuais de fidelização, registados na auditoria |
| `custom_requests`, `quotes` | Pedidos personalizados e cotações (rascunho, enviada, aceite, recusada, expirada, retirada) |
| `reviews` | Avaliações (incluindo as 2 migradas do Firestore) e moderação |
| `media` | Metadados das imagens (texto alternativo, legendas, quem carregou) |
| `mail_outbox` | Fila de e-mails com idempotência, tentativas e erros |
| `internal_notes`, `audit_log`, `settings` | Notas internas, registo de auditoria e definições (reservas, fidelização, notificações) |

### Modelos de preço (`packages.pricing`)
- `per_person`: adultos × preço + crianças × preço de criança. A criança pode ter preço próprio, pagar como adulto, ou ficar «sob consulta» (o pedido é aceite e o preço confirmado pela equipa).
- `per_group`: preço fixo por barco ou viatura. As `options` (por exemplo, os barcos) substituem o preço base e têm um máximo de pessoas.
- `per_night`: preço por noite e por unidade.
- `extras` (por pessoa, por reserva ou por noite) e `transfers` (por pessoa ou por reserva).

### Modelos de disponibilidade (`packages.availability`)
- `unit`: o que cada reserva ocupa. `pax` conta pessoas (passeios), `unit` conta 1 por reserva (barco ou viatura privada) e `room` conta pessoas ÷ ocupação, arredondado para cima (alojamentos).
- `per_option`: capacidade separada para cada opção, por exemplo para cada barco.
- `default_capacity`: `null` significa sem limite online, e a equipa confirma manualmente. **Os pacotes foram importados sem limite, porque a capacidade real não era conhecida.**
- `weekdays`, `seasons` (MM-DD), antecedência mínima e horizonte máximo de reserva.

## 5. Fluxos principais

### Pedido de reserva
1. O browser pede `/api/availability/:id` (calendário) e `/api/quote` (preço). Os valores que mostra são apenas uma pré-visualização.
2. `POST /api/bookings`:
   - o schema remove qualquer campo de preço ou de estado enviado pelo browser;
   - o servidor recalcula o preço com os valores da base de dados;
   - numa transacção, bloqueia os dias afectados, verifica a capacidade, grava a reserva com referência `MB-XXXXXX`, as alocações e o snapshot, e coloca os e-mails na fila.
3. A reserva fica `pending`. Se `pending_holds_capacity` estiver activo (por defeito, 48 h), o lugar fica reservado durante esse tempo. Depois liberta-se, mas o pedido continua pendente.
4. O administrador confirma, e a capacidade é verificada de novo, excluindo o próprio pedido. Também pode rejeitar ou cancelar. A transição para `completed` é automática depois da data, e pode ser desligada nas definições.
5. Repetir o mesmo `idempotency_key` devolve a reserva original, sem criar outra.

### Estados
- Reserva: `pending → confirmed | rejected | cancelled`, `confirmed → completed | cancelled`.
- O pagamento tem estado próprio: `unpaid / partial / paid / refunded`.
- O cliente pode cancelar sozinho um pedido pendente. Para uma reserva confirmada, só pode **pedir** o cancelamento, e a decisão é da equipa.

### Fidelização
- Conta as reservas `completed` da conta, e as feitas com o e-mail verificado da conta, dentro da janela definida, somando os ajustes manuais.
- Não conta para convidados nem para contas com e-mail por confirmar (opção ligada por defeito).
- O programa vem **desactivado** e os valores são editáveis em Definições.

### Pedidos personalizados
- Seguem o fluxo `new → under_review → quote_sent → accepted | rejected → closed`.
- A cotação é enviada por e-mail com um link (token) que permite aceitar ou recusar até à data de validade.
- Aceitar uma cotação **não cria** automaticamente uma reserva.

## 6. Segurança

- **Papéis:** os papéis existem só na base de dados. O registo no site cria sempre um cliente. A equipa tem três níveis:
  - **Superadministrador:** criado por `npm run create-admin` (a migração 010 promoveu o administrador mais antigo). É o único que vê **Equipa** (`/api/admin/team`), onde cria contas, muda níveis, desactiva ou retira acesso. Cada pessoa nova recebe um e-mail com um link (válido 72 h) para escolher a própria palavra-passe em `/admin/?invite=…`. Se o e-mail já tiver conta de cliente, a conta é promovida e mantém a palavra-passe.
  - **Administrador:** tudo, menos a gestão da equipa.
  - **Gestor:** só as rotas de `MANAGER_ROUTES` em `routes/admin/index.js`: reservas, disponibilidade, pedidos de cotação e cotações, pacotes (e as imagens desses pacotes), facturas, clientes (consulta e notas), Live Chat e estatísticas do site. Qualquer rota que não esteja nessa lista é recusada, por isso as funcionalidades novas ficam fechadas aos gestores até serem acrescentadas.
  - Mudar o nível ou desactivar uma conta termina as sessões dessa pessoa. Ninguém altera o próprio nível, e a conta do superadministrador não se altera no painel. Tudo fica no registo de actividade.
- **Sessões:** o cookie `mb_session` é `HttpOnly` e `SameSite=Lax`, e `Secure` em produção. Na base de dados guarda-se só o SHA-256 do token. Repor a palavra-passe, ou desactivar ou mudar o papel de um utilizador, termina as sessões abertas.
- **CSRF:** pedidos de escrita com um `Origin` diferente são recusados, e só se aceita JSON ou multipart. Assim, um formulário de outro site recebe 415.
- **Isolamento entre clientes:** todas as consultas da conta usam o `user_id` da sessão, por isso mudar um ID no URL devolve 404. Os convidados acompanham a reserva com um token secreto (enviado por e-mail) ou com referência + e-mail, com limite de tentativas.
- **Validação e preços:** todos os pedidos são validados com JSON Schema e os campos desconhecidos são removidos. Preço, total, estado e desconto são sempre calculados no servidor.
- **Abuso:**
  - limites por IP: reservas 8 a cada 10 minutos, login 10 a cada 15 minutos, avaliações e pedidos personalizados 5 a cada 10 minutos;
  - campo escondido (*honeypot*) nos formulários;
  - consentimento obrigatório nos pedidos.
- **Imagens:**
  - o sharp descodifica a imagem, por isso o tipo real é verificado e não apenas a extensão;
  - limite de 12 MB, conversão para WebP e redimensionamento para 2000 px;
  - um ficheiro existente nunca é substituído;
  - só se apagam ficheiros carregados pelo painel que não estejam em uso, e nunca as imagens originais do site.
- **XSS e texto do catálogo:** o servidor remove `<` e `>` dos conteúdos do catálogo, os caminhos de imagem são validados e os e-mails escapam todos os valores.
- **Ficheiros estáticos:** só são servidos `index.html`, `logo.webp`, `assets/`, `components/`, `data/`, `pages/`, `en/` e `admin/`. Ficam inacessíveis `server/`, `.env`, `backups/`, `.git` e os `.zip`.
- **Cabeçalhos:** `X-Content-Type-Options`, `Referrer-Policy` e `X-Frame-Options`. As áreas privadas levam também `X-Robots-Tag: noindex` e `Cache-Control: no-store`.
- **Auditoria:** a tabela `audit_log` regista estados, edições (com o snapshot anterior), preços, disponibilidade, promoções, papéis, exportações CSV e definições.

## 7. API (resumo)

**Pública:**
- `GET /api/health`
- `GET /api/catalog/tours|accommodations|packages/:id`
- `GET /api/ratings`
- `GET /api/availability/:id`
- `POST /api/quote`
- `POST /api/bookings`
- `POST /api/bookings/lookup`
- `GET|POST /api/reviews`
- `POST /api/custom-requests`
- `GET /api/quotes/:token` e `POST /api/quotes/:token/respond`
- `GET /robots.txt` e `GET /sitemap.xml`

**Autenticação e conta:**
- `/api/auth/register|login|logout|me|verify-email|resend-verification|request-password-reset|reset-password`
- `/api/account/bookings[/:id[/cancel]]|requests|loyalty|profile|password`

**Administração** (`/api/admin`):
- `dashboard`
- `bookings` (lista, `.csv`, detalhe, `status`, `PATCH`, `notes`, `payments`, `resend`)
- `availability/:id` e `availability/:id/days`
- `categories` e `packages` (CRUD, `public`, `restore/:v`, `pricing-preview`, `rules`); `rules/:id`
- `promotions`
- `requests` (`status`, `notes`, `quotes`) e `quotes/:id/send|withdraw`
- `customers` (`loyalty-adjustments`, `notes`, `PATCH`) e `reviews`
- `media` (`folders`, `upload`, `PATCH`, `replace`, `DELETE`)
- `settings/:key`, `mail` (`retry`) e `audit`

## 8. Testes

- `npm test`: 58 testes de integração contra PostgreSQL real. Cobrem preços, reservas, concorrência, bloqueios que expiram, validação, falha de e-mail, segurança (os 7 cenários pedidos), administração, contas, fidelização, cotações, SEO e e-mails.
- `npm run test:e2e`: 17 testes no Chrome real (incluindo ticket, PDF e verificação por QR).
  - **Público:** calendário, preço, pedido, estado, tour personalizado, conta, e ausência de scroll horizontal em telemóvel.
  - **Painel:** login, todas as secções, confirmar, nota e pagamento, editar preço com pré-visualização e restauro, calendário, promoção, upload, e layout em telemóvel.

## 9. Tickets de reserva e verificação por QR code

| Peça | Implementação |
|---|---|
| Dados | Gerados sempre a partir da reserva gravada (`price_snapshot`). Uma alteração de preço posterior não muda o ticket. |
| Título do documento | Depende do estado real. *Pendente*: «Comprovativo de pedido de reserva», com aviso de que **não** é confirmação. *Confirmada*: «Confirmação de reserva». *Cancelada* ou *rejeitada*: aviso de que não é válida. O pagamento aparece separado («Por pagar», «Pago parcialmente», «Pago»). O rodapé diz sempre que o documento **não é recibo nem documento fiscal**. |
| PDF | `server/src/lib/tickets.js` gera um A4 com pdfkit. O texto é seleccionável, o logótipo vem do disco (não de um URL remoto) e o QR é desenhado em vector, sem imagem. |
| HTML | `pages/ticket.html` e `en/ticket.html`, com `assets/js/ticket-view.js`. Inclui CSS de impressão que esconde menus e botões. |
| QR | Contém só `…/pages/verify.html?r=<referência>&k=<assinatura>`. A assinatura é um HMAC-SHA256 de `referência\|ticket_version` com o `TICKET_SECRET`, truncado a 128 bits. O QR não contém dados pessoais. |
| Verificação pública | `GET /api/tickets/verify`. É só de leitura e devolve referência, experiência, data, nº de pessoas, estado e pagamento. Não mostra o nome nem os contactos do cliente. Cada leitura fica registada em `ticket_scans`. |
| Vista da equipa | Se quem lê o QR tiver sessão de administrador, vê também o nome e o telefone do cliente e um botão de check-in. O check-in passa pela API de administração (`POST /api/admin/bookings/:id/check-in`), só funciona em reservas confirmadas e só uma vez. |
| Revogação | No painel, «Invalidar QR» incrementa `ticket_version`. Os QR antigos passam a dar «Ticket substituído». |
| Acesso ao ticket | **Convidado:** referência + token do e-mail, ou referência + e-mail, sempre por POST e nunca no URL. **Cliente com conta:** pela sessão, e só às suas próprias reservas. **Administrador:** download, reenvio por e-mail, invalidação e check-in. |
| E-mails | O PDF vai em anexo no «pedido recebido» e na «confirmação», gerado no momento do envio. O ticket pode ser reenviado a pedido, no máximo uma vez a cada 10 minutos, sem duplicar mensagens. |
| Dados da empresa | Em Definições → «Dados da empresa» (`settings.company`). Os campos vazios não são impressos. A denominação legal, o NUIT e o alvará ficam por configurar e nunca são inventados. |

Migração `002_tickets.sql` (só acrescenta, sem apagar nada): `bookings.ticket_version`, `checked_in_at`, `checked_in_by`, a tabela `ticket_scans` e a definição `company`.

## 10. Desempenho

- **Variantes de imagem:** `/img/<400|800|1200|1600>/<caminho>` gera WebP redimensionados com o sharp e guarda-os em `server/.cache/img`. Os originais ficam intactos. O frontend usa `srcset` e, se a rota não existir, carrega o original.
- **Compressão:** gzip/brotli para HTML, CSS, JS e JSON (`@fastify/compress`).
- **Carregamento:** scripts com `defer` e CSS dos ícones sem bloquear a renderização. O preloader deixou de forçar 3 s.
- **Estabilidade visual:** altura da navbar reservada e imagens com `width`/`height`, para não haver deslocamentos.
- **SEO:** as páginas de pacote recebem do servidor o título, a descrição, o canonical, o hreflang, o Open Graph e o JSON-LD `TouristTrip`. A classificação só aparece no JSON-LD quando há avaliações reais.

## 11. Facturação e pagamentos verificados

Ver [FACTURACAO.md](FACTURACAO.md): fluxo de emissão a partir da referência da reserva, numeração sem saltos (`invoice_sequences`), conteúdo congelado na emissão com o PDF original arquivado (SHA-256), pagamentos, reembolsos e estornos verificados com idempotência, estados financeiros separados do estado da reserva, permissões, auditoria e relatórios. Migração `003_invoices.sql` (só acrescenta).

## 12. Sistema visual (redesign)

- **Tokens** em `assets/css/main.css` §1: escala tipográfica, espaçamentos, raios, sombras, anel de foco, transições e paleta da marca (navy, turquesa e coral, sem cores novas).
- **Composições** em `assets/css/main.css`:
  - área de cliente com coluna de perfil, cartões de reserva com linha do tempo, pagamento e factura (§27);
  - página de experiência com cabeçalho editorial, navegação de secções e reserva em passos (§29);
  - navbar fixa ao fazer scroll, com conta e «Reservar», e redes sociais na barra superior (§30);
  - equipa em cartões-retrato (§31);
  - contacto com cartões clicáveis e mapa enquadrado (§9);
  - rodapé em grelha com a faixa de pagamentos (§32).
- **Revertido a pedido do cliente:** a homepage e as listagens de tours e alojamentos mantêm o layout anterior (commit `ce3e90b`).
- **Painel de gestão:** `admin/admin.css` tem o mesmo sistema de tokens, com navegação clara agrupada, barra superior com pesquisa rápida por referência e acção «Emitir factura», KPIs com ícones, controlos segmentados, tabelas que viram cartões no telemóvel, documento de factura no ecrã e diálogos com rodapé.
- **Verificação:**
  - `server/scripts/baseline-shots.js <pasta>` guarda capturas comparáveis (1440×900 e 390×844, primeiro ecrã e página inteira);
  - `server/scripts/overflow-check.js <url> <largura>` detecta scroll horizontal;
  - `server/scripts/audit.js` faz a auditoria de acessibilidade e SEO.

## 13. Cotações e propostas

Secção **Cotações e propostas** do painel. Uma cotação pode nascer de um pedido do site ou directamente da equipa, para quem nunca passou pelo site.

### Ciclo de vida

```
draft ──► issued ──► sent ──► viewed ──► accepted ──► converted (reserva)
                                 ├─► declined
                                 └─► revision_requested ──► nova versão
```

- `expired`: passa-se de forma automática (tarefa de hora a hora) em `issued`, `sent`, `viewed` e `revision_requested`. Cotações aceites mantêm a resposta.
- `withdrawn`: cancelada pela equipa; o link deixa de funcionar.
- `superseded`: substituída por uma versão emitida depois. O link antigo avisa disso.

### Regras

- **Número:** `COT-AAAA-NNNN`, partilhado pelas versões (`group_id`); `v2`, `v3` na mesma cotação. **Duplicar** cria número novo.
- **Só os rascunhos mudam.** Ao emitir, os dados da empresa ficam fixos em `quotes.issuer` e o PDF em `quote_documents`. Qualquer alteração passa por nova versão, mesmo numa cotação aceite: a aceitação só deixa de valer quando a nova versão é emitida.
- **Valores:** `lib/quote-totals.js`, em cêntimos inteiros, sempre recalculados no servidor. O painel só mostra uma pré-visualização.
- **Moedas:** MZN, USD, ZAR e EUR, sem conversão. Os indicadores nunca somam moedas diferentes.
- **Clientes:** `quotes.customer` guarda os dados da cotação; `contacts` guarda quem não tem conta, por e-mail. A conta só fica ligada se o e-mail estiver confirmado.
- **Link público:** derivado por HMAC de `TICKET_SECRET`, o id e `token_nonce`, com só o hash guardado. A equipa pode copiar o mesmo link as vezes que precisar, e enviar de novo não o muda. Para desactivar um link, cancele a cotação e duplique-a. Mudar `TICKET_SECRET` faz o botão «Copiar link» mostrar um link que já não abre.
- **Página pública:** `publicQuote()` define o que o cliente vê. Observações internas, contactos, tokens e equipa ficam de fora.
- **Respostas:** aceitar, recusar (motivo opcional) e pedir alterações (mensagem obrigatória). A equipa recebe e-mail e WhatsApp pelo modelo `alerta_equipa`, sem novo modelo na Meta, e pode registar respostas dadas por telefone.
- **Visualizações:** contam quando a página abre no browser; contas da equipa não contam. Não prova quem abriu.

### Conversão em reserva (`lib/quote-conversion.js`)

- Só de `accepted`, e a equipa confirma depois de ver a disponibilidade de cada serviço.
- Cria **uma** reserva `confirmed`, ligada ao pacote interno `proposta-personalizada` (arquivado, escondido do painel e do site), com todas as linhas em `price_snapshot`. Bilhete e factura lêem daí, por isso uma cotação dá uma factura.
- A capacidade é verificada e ocupada em cada serviço do catálogo com data. Serviços personalizados e privados não têm capacidade: a equipa confirma-os à mão.
- `bookings.quote_id` é único: não há duas reservas da mesma cotação.
- Datas e grupo destas reservas não se editam na reserva (`booking_from_quote`), porque a capacidade e o preço vêm das linhas da cotação.
- Uma cotação nunca é pagamento, factura ou receita. A receita só aparece com a reserva, e pelos pagamentos verificados.

### Definições

**Definições → Cotações** guarda validade, depósito e textos sugeridos (PT/EN). Vêm vazios de propósito: são dados comerciais da empresa.

### Pedidos de cotação

#### Fluxo

1. **Pedido do cliente** (`pages/custom-tour.html`, botão «Pedir cotação» da navbar). O cliente:
   - escolhe passeios, alojamentos e serviços privados num catálogo com filtros e pesquisa;
   - indica a data preferida de cada item, as datas da viagem, o grupo e as preferências;
   - pode pré-seleccionar um pacote com `?package=<id>`.
   O servidor valida os itens (só pacotes publicados e serviços conhecidos) e guarda um snapshot dos títulos em `custom_requests.items`.
2. **Gerar a cotação no painel** (Pedidos de cotação → «Gerar cotação» abre o construtor, já preenchido). As linhas vêm de `GET /api/admin/requests/:id/quote-suggestion`:
   - cada pacote é calculado com as regras de preço actuais, para a data e o grupo pedidos;
   - os serviços sem preço de catálogo e as opções por escolher ficam assinalados para a equipa preencher;
   - tudo pode ser editado antes de enviar.
3. **Envio pelos canais escolhidos:**
   - **e-mail**;
   - **WhatsApp** — abre `wa.me` com a mensagem e o link prontos;
   - **link** — para copiar e partilhar noutro canal.
   Os canais usados ficam em `quotes.channels` e no histórico.
4. **Resposta do cliente:** pelo link ou na **conta** (separador «Cotações»).

#### Quem vê a cotação na conta

A cotação aparece na conta quando o pedido foi feito com sessão iniciada, ou com o mesmo e-mail depois de esse e-mail ter sido **confirmado**. O mesmo vale para cotações feitas sem pedido. Outros clientes recebem 404.

### Referências

- **Código:** `server/src/lib/quotes.js`, `quote-totals.js`, `quote-pdf.js`, `quote-conversion.js`, `server/src/routes/admin/quotations.js`, `requests.js`, `server/src/routes/account.js` e `public.js`; `admin/js/views/quotations.js`, `quotation-edit.js`, `quotation-detail.js`; `assets/js/portal-quote.js`.
- **Migrações:** `004_quote_requests.sql` e `011_proposals.sql` (só acrescentam; as cotações antigas recebem número e dados do pedido).
- **Testes:** `server/test/quotes.test.js`, `server/test/proposals.test.js` e os e2e do formulário e do painel.

## 14. Avisos por WhatsApp e estatísticas do site

**Avisos à equipa por WhatsApp** (`server/src/lib/whatsapp.js`, guia em [WHATSAPP.md](WHATSAPP.md)):
- Os avisos à equipa passam por `notifyTeam`, que envia o e-mail e, se houver números configurados em Definições, coloca o aviso na fila `whatsapp_outbox`.
- O envio usa a WhatsApp Cloud API da Meta, com modelos aprovados: `alerta_equipa` e `alerta_reserva`. O `alerta_reserva` tem o botão «Conversar com o cliente», que abre `/wa/<número>` no próprio site; o site reencaminha para `wa.me`.

**Estatísticas do site** (aba «Estatísticas do site» no painel):
- **Recolha:** `assets/js/analytics.js`, carregado pelo `main.js`, envia para `POST /api/t` as páginas vistas, o tempo com a página visível, a rolagem e os cliques (posição e texto do botão).
- **Privacidade:**
  - não usa cookies;
  - o visitante é um hash diário de (sal, dia, IP, navegador), por isso não é seguido entre dias;
  - a sessão é um identificador aleatório guardado só no separador;
  - nada do que é escrito nos formulários é lido;
  - respeita Do Not Track / GPC.
- **Exclusões:** robôs, o próprio `/admin` e contas da equipa com sessão iniciada não contam.
- **Armazenamento:** tabelas `analytics_pageviews` e `analytics_clicks`. A manutenção horária apaga os cliques com mais de 6 meses e as visitas com mais de 25 meses.
- **Mapa de cliques:**
  - as posições são guardadas como fracção da largura da página e píxeis desde o topo;
  - são agrupadas por largura do ecrã (telemóvel < 768 px, tablet < 1200 px, computador);
  - o painel desenha-as sobre a página real, carregada num iframe com `?mb_noanalytics=1`.

## 15. Live Chat

Conversas em tempo real entre visitantes do site e a equipa, sem conta e sem serviços externos. Usa PostgreSQL e o servidor actual; o Firebase não é usado.

**Peças:**
- **Site:** `assets/js/chat.js` e `assets/css/chat.css`, carregados pelo `main.js` em todas as páginas públicas. Rotas em `server/src/routes/chat.js`.
- **Painel:** `admin/js/views/chat.js` (lista, conversa, informações) e `admin/js/chat-hub.js` (ligação, presença e notificações em qualquer página). Rotas em `server/src/routes/admin/chat.js`.
- **Regras:** `server/src/lib/chat.js`. **Tempo real:** `server/src/lib/chat-bus.js`. **Migração:** `012_live_chat.sql`.

**Tempo real:**
- O browser recebe por Server-Sent Events e envia por `POST`.
- Os eventos passam por `NOTIFY` do PostgreSQL, por isso chegam a todos os processos Node. Só dizem o que mudou; as mensagens são lidas da base.
- Se o evento `ready` não chegar em 6 s (por exemplo, um proxy que retém a resposta), o cliente passa a consultar a cada 4 ou 5 s.
- Ao voltar a ligar, o `Last-Event-ID` recupera o que ficou para trás. O `client_id` de cada mensagem impede duplicados.

**Visitantes:** o cookie `mb_chat` (`HttpOnly`, 30 dias) guarda um token aleatório, e só o hash fica na base. O cookie só é criado ao iniciar uma conversa e dá acesso apenas a essa conversa. As notas internas nunca saem das rotas do painel.

**Estados:** `new` (nova), `active` (em atendimento), `waiting` (o visitante escreveu e aguarda resposta da equipa) e `closed`. Responder assume a conversa, se estiver livre. Dois agentes a assumir ao mesmo tempo: um consegue, o outro recebe `chat_taken`. Uma conversa encerrada só volta a aceitar mensagens se a equipa a reabrir; o visitante pode iniciar outra.

**Presença:** o estado é escolhido por cada pessoa no menu lateral e começa em offline. Só conta se o painel tiver enviado sinal nos últimos 90 s (envia a cada 30 s). Fora do horário em **Definições → Live Chat**, o site mostra sempre offline.

**Avisos:**
- No painel: cartão que abre a conversa, som opcional e contador no menu.
- E-mail e WhatsApp à equipa (`alerta_equipa`): conversa nova sem ninguém online, ou sem resposta ao fim dos minutos definidos. Um aviso por espera, não por mensagem.
- E-mail ao visitante: resposta que ficou por ler ao fim de 2 minutos, com o texto da resposta.

**Associações:** reserva, cotação, pacote e cliente são ligados pela equipa. Uma conta só se liga sozinha a partir da sua própria sessão, com o e-mail confirmado. O mesmo e-mail aparece apenas como sugestão, porque foi escrito pelo visitante.

**Retenção:** conversas sem actividade há 30 dias são encerradas; as encerradas são apagadas ao fim do prazo definido (12 meses por omissão).

**Testes:** `server/test/chat.test.js`.
