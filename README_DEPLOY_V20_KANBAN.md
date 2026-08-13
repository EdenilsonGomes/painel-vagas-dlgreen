# Gênesis V20 — Prospecção Enfileirada + Kanban

## Escopo

Atualização aditiva sobre a V20 mais recente. Mantém o modo Enfileirado e adiciona Kanban real com as etapas `Novo lead`, `Contatado`, `Respondeu`, `Qualificado`, `Demonstração`, `Proposta`, `Negociação`, `Ganho` e `Perdido`.

O movimento de cartão atualiza a oportunidade real em `crm_oportunidades`, sincroniza o status operacional do lead e registra a mudança em `crm_interacoes`. A abertura do cartão exibe dados enriquecidos, score, oferta, motivo, mensagem editável e histórico. Os botões usam a fila protegida V20 já existente.

## Deploy-only

1. Faça backup dos arquivos que serão substituídos.
2. Copie o conteúdo do ZIP para a raiz da aplicação, preservando as pastas.
3. Faça rebuild/redeploy do serviço.
4. Não há migration nova para esta atualização. Confirme que as migrations V20 existentes já foram aplicadas.
5. Execute:

```bash
node scripts/preflight-v20.js
node scripts/test-v20.js
node scripts/test-v20-kanban.js
```

6. Recarregue o navegador com `Ctrl + F5`.

## Validação funcional recomendada

Com usuário ADMIN: abra Prospecção, alterne Enfileirado/Kanban, arraste um lead entre duas etapas e confirme a mesma etapa no CRM e no histórico. Abra o lead, edite/copiei a mensagem e prepare um contato controlado. Teste `Enviar agora` primeiro com número próprio/controlado.

O envio real continua respeitando `PROSPECTING_OUTREACH_ENABLED`, sessão dedicada, opt-out, limites e fila V20.

## Rollback

O pacote completo inclui `rollback/`, com a versão V20-base dos seis arquivos substituídos. Para reverter, copie o conteúdo de `rollback/` sobre a raiz, faça rebuild/redeploy e `Ctrl + F5`. O arquivo novo `scripts/test-v20-kanban.js` pode permanecer ou ser removido; ele não participa do runtime.

Não há rollback de banco porque nenhuma migration foi criada.
