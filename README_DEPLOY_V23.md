# Deploy da experiência Gênesis V23

Esta entrega é aditiva: preserva os endpoints, automações e regras de negócio atuais e adiciona apenas a persistência de leitura da Central de Notificações.

1. Aplique a migration com `npm run migrate:v23`.
2. Confirme a estrutura com `npm run preflight:v23`.
3. Execute `npm test`.
4. Faça o redeploy do serviço.

A migration cria somente `painel_notificacoes_lidas`, vinculada às notificações operacionais e aos usuários existentes. Ela não altera candidatos, vagas, conversas, entrevistas, PostgreSQL existente, Evelyn, WAHA, n8n ou Google Calendar.

Para rollback visual, volte o deployment anterior. A tabela de leitura pode permanecer sem afetar o sistema antigo.
