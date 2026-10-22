# Maputo Blue — Facturação e pagamentos

Este documento explica como funcionam as facturas e os pagamentos no painel de gestão, as regras que o sistema aplica e o que ainda tem de ser confirmado antes de usar estes documentos como facturas fiscais.

> **Importante:** antes de apresentar estes documentos aos clientes como facturas fiscais, confirme com o contabilista os requisitos legais aplicáveis em Moçambique. Isso inclui os campos obrigatórios, o regime e a taxa de IVA, a numeração por série e a eventual certificação do software de facturação. O sistema não declara conformidade fiscal.

## 1. Fluxo de trabalho

1. O cliente faz o pedido de reserva e recebe uma referência (`MB-XXXXXX`).
2. O cliente paga pelo método combinado (transferência, M-Pesa, e-Mola, cartão ou numerário). **O site não cobra online.**
3. A equipa verifica que o dinheiro entrou, por exemplo no extracto bancário ou na conta M-Pesa/e-Mola.
4. No painel, a equipa abre **Facturas → Emitir factura** e escreve a referência da reserva.
5. O sistema vai buscar a reserva à base de dados e mostra a factura tal como vai ser impressa: linhas, descontos, total, pagamentos já registados e saldo.
6. A equipa revê os dados de facturação (nome, e-mail, NUIT e morada do cliente, se este os pedir) e escolhe uma de três opções:
   - **Emitir:** o número é atribuído nesse momento.
   - **Guardar rascunho:** fica sem número e não é visível para o cliente.
   - **Emitir com pagamento:** se o dinheiro já foi verificado, o pagamento é registado na mesma operação.
7. Quando a factura fica totalmente paga, o estado passa automaticamente a **PAGO**. O cliente recebe um e-mail com a factura actualizada em PDF.
8. O cliente vê a factura na sua conta (separador «Facturas» e em cada reserva). Quem reservou sem conta vê-a na página «Estado da reserva», com a referência e o link do e-mail.

**Emitir uma factura e registar um pagamento são operações separadas.** Uma factura emitida sem pagamento fica «Por pagar». Nada passa a pago só porque a reserva foi criada, porque a factura foi emitida ou porque o cliente escolheu um método de pagamento.

## 2. Estados

| Campo | Valores | O que significa |
|---|---|---|
| `bookings.status` | pendente, confirmada, concluída, cancelada, rejeitada | Estado **operacional** da viagem |
| `invoices.doc_status` | rascunho, emitida, anulada | Estado do **documento** |
| `invoices.pay_status` | por pagar, parcialmente paga, paga, reembolsada | Estado **financeiro**, calculado a partir dos pagamentos verificados |
| «Vencida» | — | Não é guardado. É calculado ao ler a factura: emitida, não paga e com data de vencimento já passada |

Nos ecrãs aparece um único estado, escolhido por esta ordem: rascunho → anulada → paga/reembolsada → vencida → parcialmente paga/por pagar.

Os dois eixos são independentes. Uma reserva pode estar confirmada com a factura por pagar, ou paga com a viagem ainda no futuro. Se a reserva for cancelada, a factura não muda sozinha. O painel mostra um aviso para a equipa registar o reembolso e/ou anular a factura.

## 3. Regras de cálculo

```
Saldo em dívida = Total da factura − Soma dos movimentos verificados
                 (pagamentos positivos; reembolsos e estornos negativos)
```

- A soma é feita pelo PostgreSQL em `NUMERIC(12,2)`, com valores exactos. As comparações em JavaScript usam cêntimos inteiros, sem erros de arredondamento.
- **Pago:** saldo = 0. **Parcialmente paga:** pago > 0 e saldo > 0. **Por pagar:** nada pago. **Reembolsada:** nada pago depois de um reembolso.
- O IVA está **desligado** por omissão. Pode ser ligado em Definições → Facturação, com a designação e a taxa confirmadas pelo contabilista. Os preços do site são preços finais, por isso o imposto é mostrado como «incluído», calculado como `total × taxa / (100 + taxa)`.
- Se o total acordado da reserva for diferente da soma das linhas (por exemplo, um preço ajustado à mão pela equipa), a diferença aparece numa linha «Ajuste de preço acordado».
- Não se pode facturar reservas canceladas ou rejeitadas. Também não se pode facturar enquanto houver preços «sob consulta» sem total acordado.

## 4. Numeração

- Formato: `<série> <ano>/<sequência>`, por exemplo `FT 2026/0001`. A série é configurável e a sequência recomeça em cada ano.
- O número é atribuído **no servidor**, dentro da transacção que emite a factura. A tabela `invoice_sequences` tem uma linha por série e ano, incrementada com `INSERT … ON CONFLICT DO UPDATE`.
- Esse incremento bloqueia a linha do contador até ao fim da transacção. Por isso, emissões simultâneas ficam em fila e nunca recebem o mesmo número.
- **Sem saltos:** se a emissão falhar (por exemplo, a reserva foi cancelada entretanto), a transacção é revertida, o contador volta atrás e o número não se perde. Os testes verificam isto com emissões em paralelo e uma falha a meio.
- Os rascunhos não consomem números.
- Uma factura anulada **mantém o seu número**, que nunca é reutilizado.

## 5. Integridade do documento

- Ao emitir, ficam guardados na própria factura, sem mudar depois: as linhas, os descontos, os totais, o imposto, os dados do emitente, os dados de facturação do cliente e o resumo da reserva. Alterar o preço do pacote, o perfil do cliente ou os dados da empresa não muda facturas já emitidas.
- O PDF exactamente como foi emitido fica arquivado em `invoice_documents`, com o hash SHA-256, e pode ser descarregado («Descarregar original»).
- O PDF «actual» usa o mesmo conteúdo congelado e acrescenta a situação de pagamento do dia, com a lista de pagamentos.
- Facturas emitidas não podem ser editadas nem apagadas. Para corrigir uma, use **Anular / corrigir**:
  - indique o motivo (obrigatório);
  - a factura fica anulada com o motivo registado;
  - opcionalmente, é emitida de imediato uma nova factura com os dados actuais da reserva e um novo número, que referencia a anterior;
  - os pagamentos ficam ligados à reserva e passam para a nova factura.
- **Notas de crédito:** não estão implementadas como documento próprio. Use a anulação com motivo e/ou registe o reembolso. Se o contabilista exigir notas de crédito, é uma extensão a fazer.

## 6. Pagamentos, reembolsos e estornos

Cada movimento guarda o valor, a moeda, o método, a data do pagamento, a referência externa, a nota, quem o registou e quando foi verificado.

| Tipo | Regra |
|---|---|
| Pagamento | Exige que a equipa marque **«Confirmo que verifiquei que o dinheiro foi recebido»**. Não pode ultrapassar o saldo em dívida: o sistema não suporta pagamentos a mais. |
| Reembolso | Dinheiro devolvido ao cliente. Não pode ultrapassar o valor já pago. |
| Estorno | Anula um pagamento concreto, por exemplo uma transferência devolvida ou um registo feito por engano. O registo original fica no histórico, marcado como «Estornado». Cada pagamento só pode ser estornado uma vez. |

- **Duplicados:**
  - cada formulário aberto leva uma chave de idempotência, por isso um duplo clique ou uma ligação repetida registam o pagamento uma só vez;
  - a mesma referência de transacção, com o mesmo método e na mesma reserva, é recusada.
- **Atomicidade:** o registo do pagamento e a actualização do estado da reserva e da factura acontecem na mesma transacção, com a reserva e a factura bloqueadas (`FOR UPDATE`).
- Nada é apagado: o histórico de movimentos é o próprio registo de auditoria.
- Não existe integração com gateways de pagamento. Se vier a existir uma, o estado deve vir da confirmação verificada no servidor (webhook assinado), nunca de um redireccionamento do navegador.

## 7. Permissões e auditoria

- Emitir, anular, registar pagamentos, reembolsos e estornos, ver relatórios e exportar só é possível em `/api/admin/*`, com sessão de **administrador**. A função é sempre lida da base de dados.
- Os clientes só vêem facturas **emitidas ou anuladas** das suas próprias reservas. Os rascunhos nunca aparecem aos clientes.
- Os convidados (sem conta) acedem com referência + token do e-mail, ou referência + e-mail, sempre por POST. Não existe nenhum URL público adivinhável para facturas.
- Ficam registados no `audit_log` (entidade `invoice` e entidade `booking`), com autor, data, valores antes/depois e motivo, quando existe:
  - criação de rascunho, edição e eliminação de rascunho;
  - emissão e arquivo do PDF;
  - pagamentos, reembolsos e estornos;
  - mudanças automáticas de estado;
  - anulação e envio por e-mail;
  - descarga do PDF pela equipa;
  - exportação CSV.

## 8. Relatórios

**Facturas → Resumo financeiro**, por período (7/30/90 dias ou 12 meses):
- **Facturado:** soma das facturas emitidas no período.
- **Recebido:** soma dos pagamentos verificados com data no período, menos os reembolsos e estornos.
- **Em dívida (hoje)** e **Vencido (hoje):** saldos actuais. **Não são receita.**
- Contagens de facturas pagas, parcialmente pagas, por pagar e vencidas, e um gráfico de facturado e recebido por dia ou por mês.
- A lista tem filtros por estado, método de pagamento e datas, pesquisa por número, referência, nome ou e-mail, e paginação.
- O CSV exporta exactamente os registos filtrados.

## 9. Configuração (Definições → Facturação)

| Campo | Valor inicial | Origem |
|---|---|---|
| Emitente | Maputo Blue · Maputo Marina / 10 de Novembro Nr.74, Maputo Cidade, Moçambique · +258 (84) 712 1666 · maputoblue.info@gmail.com · NUIT 154 559 620 | Dados fornecidos pelo cliente |
| Denominação legal | vazio | Por confirmar (não é impressa enquanto estiver vazia) |
| Série | `FT` | Ajustável |
| Vencimento | 7 dias | Ajustável; também se pode definir em cada factura |
| IVA | desligado | Por confirmar com o contabilista |
| Instruções de pagamento | vazio | Introduzir os dados bancários e de M-Pesa **confirmados** |

**Nota:** a morada do emitente nas facturas (10 de Novembro Nr.74) é diferente da morada mostrada no site e nos tickets (Marina de Maputo, Av. 25 de Setembro). Confirme qual é a morada correcta para cada uso.

## 10. Onde está o código

| Parte | Ficheiro |
|---|---|
| Migração (tabelas, colunas, definições) | `server/migrations/003_invoices.sql` |
| Pagamentos e estado financeiro | `server/src/lib/payments.js` |
| Facturas, numeração, PDF e anexos de e-mail | `server/src/lib/invoices.js` |
| API de administração | `server/src/routes/admin/invoices.js` |
| Pagamentos a partir da reserva | `POST /api/admin/bookings/:id/payments` |
| Acesso dos clientes | `server/src/routes/account.js` (`/api/account/invoices`) e `server/src/routes/tickets.js` (`/api/bookings/invoice`, `/api/bookings/invoice.pdf`) |
| Painel | `admin/js/views/invoices.js`, `invoice-new.js`, `invoice-detail.js`, `admin/js/payments-ui.js`, `admin/js/invoice-doc.js` |
| Testes | `server/test/invoices.test.js` (17 cenários) e `server/e2e/admin.e2e.js` (fluxo completo no browser) |

## 11. Implantação e reversão

- A migração `003` só **acrescenta**: tabelas novas, colunas novas em `payments` e a definição `invoicing`. Os pagamentos já existentes ficam marcados como verificados na data em que foram registados, porque foram introduzidos por administradores.
- Faça backup antes de actualizar: `npm --prefix server run backup -- pre-invoices` e um `pg_dump`. O backup JSON inclui as novas tabelas.
- **Reverter o código para uma versão anterior a esta funcionalidade:** tudo continua a funcionar com a base de dados nova (reservas, tickets, catálogo, contas), **excepto registar pagamentos no painel**. O código antigo não preenche as colunas obrigatórias `currency` e `payment_date`, nem o campo `kind` dos reembolsos. Se precisar de reverter e de continuar a registar pagamentos com o código antigo, execute primeiro:

  ```sql
  alter table payments alter column currency drop not null;
  alter table payments alter column payment_date set default ((now() at time zone 'Africa/Maputo')::date);
  alter table payments drop constraint payments_sign_ck;
  ```

  As facturas e os pagamentos já registados mantêm-se. Ao voltar ao código novo, os registos feitos entretanto com o código antigo aparecem sem verificação, mas continuam a contar no saldo, porque o saldo soma todos os movimentos. Antes de reactivar a restrição (`alter table payments add constraint payments_sign_ck check ((kind = 'payment') = (amount > 0));`), corrija o `kind` dos reembolsos registados nesse período.
- Não há custos adicionais: o PDF é gerado localmente (pdfkit) e os e-mails seguem pelo Resend, já configurado.
