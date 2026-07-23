# Divulgação de vagas e grupo de WhatsApp

Este pacote adiciona o botão **Divulgar** no painel e um workflow n8n para publicar as vagas ativas no grupo.

## Arquivos alterados

- `server.js`
- `public/index.html`
- `public/app.js`
- `public/styles.css`
- `n8n/02_GENESIS_IA_DIVULGACAO_GRUPO_WHATSAPP.json`

## Site

Adicione no EasyPanel:

```env
PROMO_WHATSAPP_NUMBER=(11) 91302-2278
```

Depois faça o redeploy.

## Workflow

1. Importe `02_GENESIS_IA_DIVULGACAO_GRUPO_WHATSAPP.json`.
2. Abra `Configurar grupo`.
3. Troque `COLE_AQUI_O_ID_DO_GRUPO@g.us` pelo ID real.
4. Confirme as credenciais `Postgres account` e `WAHA account`.
5. Execute pelo node `Teste manual`.
6. Após confirmar o envio, ative o workflow.

Horários configurados: 09h, 13h e 17h, de segunda a sábado, no fuso `America/Sao_Paulo`.
