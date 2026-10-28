# Avisos à equipa por WhatsApp (Meta WhatsApp Cloud API)

Os avisos que a equipa recebe por e-mail passam também a chegar por WhatsApp:
- nova reserva;
- novo pedido de cotação;
- cotação aceite;
- pedido de cancelamento.

A mensagem tem este aspecto:

> Aviso do site Maputo Blue: **Nova reserva MB-7KQ2X**.
> Manico Camp · 27/10/2026 → 30/10/2026 · 2 adultos · MZN 59,700 · Cliente: Ana Silva, +258 84 123 4567.
> Abrir no painel: https://maputoblue.co.mz/admin/#/bookings/…
> Mensagem automática para a equipa.

## Como funciona

- O envio usa a **API oficial da Meta** (WhatsApp Cloud API), sem intermediários.
- A Meta só deixa uma empresa **iniciar** uma conversa com um **modelo de mensagem aprovado**. Usa-se **um único modelo** com 3 campos variáveis (título, resumo e link), que serve para todos os avisos.
- Os avisos ficam numa fila e são enviados a cada 20 s, com até 6 tentativas. Uma falha no WhatsApp **nunca** bloqueia uma reserva nem os e-mails.
- No painel, em **Definições**:
  - **Notificações → WhatsApp da equipa:** os números que recebem os avisos (até 5);
  - **cartão WhatsApp:** estado da configuração, botão **Enviar mensagem de teste** e os últimos 20 avisos, com o motivo de qualquer falha e um botão para reenviar.

## Antes de começar: dois pontos importantes

**1. O número que envia.** O número ligado à API **deixa de poder ser usado na aplicação WhatsApp / WhatsApp Business do telemóvel**. Por isso:
- use **um número próprio para os avisos** (um cartão SIM novo serve);
- **não use** o número de atendimento da empresa (+258 84 712 1666), a não ser que aceite tirá-lo da aplicação;
- os números da equipa que **recebem** os avisos podem ser quaisquer números de WhatsApp normais.

**2. Custos.** A Meta cobra **por mensagem de modelo entregue**, com preço por categoria (aqui «Utilidade») e por país do destinatário. Para Moçambique é um valor pequeno por mensagem. Confirme o preço actual em *developers.facebook.com → WhatsApp → Pricing*.
- Para enviar com um número real, a conta WhatsApp Business precisa de um **método de pagamento**.
- O **número de teste** que a Meta oferece envia gratuitamente para até 5 números registados. Serve para experimentar antes de decidir.

## Passo a passo

### 1. Conta Meta Business e aplicação
1. Em **business.facebook.com**, crie ou escolha o portefólio empresarial da Maputo Blue. A verificação da empresa é recomendada e aumenta os limites de envio.
2. Em **developers.facebook.com → My Apps → Create App**, escolha o tipo **Business** e associe ao portefólio.
3. Na aplicação, acrescente o produto **WhatsApp**. A Meta cria uma conta WhatsApp Business de teste com um **número de teste**.

### 2. Número que envia
- **Para experimentar:** use o número de teste. Em **WhatsApp → API Setup → To**, registe os números da equipa que vão receber, até 5. Cada um confirma com um código.
- **Para produção:** em **WhatsApp Manager → Phone numbers → Add phone number**, acrescente o número dedicado e confirme-o por SMS ou chamada. Defina o nome a mostrar («Maputo Blue»), que a Meta aprova. Depois adicione um **método de pagamento** em WhatsApp Manager → Payment settings.

Anote o **Phone number ID**, que aparece em API Setup. Não é o número de telefone: é um código longo de algarismos.

### 3. Modelo de mensagem
1. Abra **WhatsApp Manager → Message templates → Create template**:
   - **Categoria:** Utility (Utilidade);
   - **Nome:** `alerta_equipa`;
   - **Idioma:** Portuguese (POR), que corresponde ao código `pt_PT`.
2. **Body (corpo):** copie exactamente:

   ```
   Aviso do site Maputo Blue: {{1}}.
   {{2}}.
   Abrir no painel: {{3}}
   Mensagem automática para a equipa.
   ```

3. **Exemplos** pedidos pela Meta:
   - {{1}}: `Nova reserva MB-7KQ2X`
   - {{2}}: `Manico Camp · 27/10/2026 → 30/10/2026 · 2 adultos · MZN 59,700 · Cliente: Ana Silva, +258 84 123 4567`
   - {{3}}: `https://maputoblue.co.mz/admin/#/bookings/123`
4. Submeta e espere pela aprovação, que leva de minutos a algumas horas. O estado tem de ficar **Active / Approved**.

Se usar outro nome ou idioma, indique-os nas variáveis `WHATSAPP_TEMPLATE` e `WHATSAPP_TEMPLATE_LANG`. O modelo tem de ter **exactamente 3 variáveis no corpo**.

### 4. Token permanente
O token temporário de API Setup expira em 24 h. Para produção:
1. Em **business.facebook.com → Settings → Users → System users → Add**, crie um utilizador de sistema com a função Admin.
2. Em **Assign assets**, atribua-lhe a **aplicação** e a **conta WhatsApp** com controlo total.
3. Carregue em **Generate new token** e preencha:
   - **aplicação:** a sua;
   - **validade:** *Never*;
   - **permissões:** `whatsapp_business_messaging` e `whatsapp_business_management`.
4. Copie o token. Ele só é mostrado uma vez. **Não o envie por e-mail nem por chat.**

### 5. Configurar o servidor
No Plesk, abra o **File Manager**, edite `maputoblue-app/server/.env` e acrescente:

```
WHATSAPP_TOKEN=o_token_permanente
WHATSAPP_PHONE_NUMBER_ID=o_phone_number_id
WHATSAPP_TEMPLATE=alerta_equipa
WHATSAPP_TEMPLATE_LANG=pt_PT
```

Depois:
1. **Node.js → Restart App.**
2. **Run Node.js commands →** `run check` deve mostrar «✓ WhatsApp configurado».

### 6. Activar no painel e testar
1. Em `/admin/` → **Definições → Notificações → WhatsApp da equipa**, escreva os números que recebem os avisos, um por linha, em formato internacional (`+258 84 123 4567`). Carregue em **Guardar**.
2. No cartão **WhatsApp**, carregue em **Enviar mensagem de teste**. Deve chegar em cerca de 20 segundos.
3. Faça uma reserva de teste. O aviso deve chegar por e-mail e por WhatsApp. No fim, cancele a reserva.

## Problemas frequentes

O motivo aparece no cartão WhatsApp das Definições, com o código da Meta entre parênteses.

| Código | Significado | O que fazer |
|---|---|---|
| `132001` | O modelo não existe nesse idioma | Confirmar o nome e o idioma, e que o modelo está aprovado |
| `132000` | O número de variáveis não corresponde | O corpo do modelo tem de ter exactamente {{1}}, {{2}} e {{3}} |
| `131030` | Destinatário não autorizado | Com o número de teste, registar o destinatário em API Setup → To |
| `131026` | Mensagem não entregue | Confirmar que o número da equipa tem WhatsApp e está bem escrito |
| `190` | Token inválido ou expirado | Gerar o token permanente (passo 4) e reiniciar a aplicação |
| `131042` | Problema de pagamento | Rever o método de pagamento no WhatsApp Manager |
| `130429` / `131056` | Limite de envio | Automático: o sistema tenta de novo |

Depois de corrigir, use **Tentar de novo** na linha do aviso.

## Desligar

Apague `WHATSAPP_TOKEN` do `.env` e reinicie a aplicação, ou retire os números em Definições. Os e-mails continuam a funcionar normalmente.
