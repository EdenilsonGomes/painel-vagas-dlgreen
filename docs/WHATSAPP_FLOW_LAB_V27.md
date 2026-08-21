# Laboratório de WhatsApp Flow V27

O laboratório é isolado e não substitui Agenda, Google Calendar, Meet ou o webhook atual.

1. No WhatsApp Manager, crie um Flow com uma tela `SCHEDULE`, categoria `APPOINTMENT_BOOKING`, e um campo de resposta `horario` com opções estáticas.
2. Publique o Flow e copie seu ID real. Não invente esse valor.
3. Configure no backend: `WHATSAPP_FLOW_LAB_ENABLED=true`, `WHATSAPP_FLOW_TEST_ID=<id publicado>` e um segredo forte em `WHATSAPP_FLOW_TEST_TOKEN`.
4. Obtenha em `GET /api/admin/whatsapp-flow-lab/payload` o objeto interativo pronto para ser entregue pelo conector Meta/n8n já existente.
5. No n8n, encaminhe a resposta estruturada para `POST /api/public/whatsapp-flow-lab/resultado` usando `Authorization: Bearer <WHATSAPP_FLOW_TEST_TOKEN>`.
6. Confira o resultado em Sales > Laboratório de WhatsApp Flow.

Para o opt-in do Banco de Talentos, configure `TALENT_WEBHOOK_TOKEN` e faça a Evelyn enviar uma única vez a pergunta aprovada. A resposta deve ser gravada em `POST /api/public/candidatos/:id/banco-talentos`, com `Authorization: Bearer <TALENT_WEBHOOK_TOKEN>` e corpo `{ "aceite": true|false, "origem": "EVELYN_WHATSAPP" }`. Se já existir decisão, o endpoint preserva a primeira resposta e retorna `ja_decidido: true`.
