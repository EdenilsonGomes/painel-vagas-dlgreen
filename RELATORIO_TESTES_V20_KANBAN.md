# Relatório de testes — V20 Kanban

Data: 13/08/2026

## Aprovados

- Sintaxe: `lib/prospecting-v20.js`, `public/prospecting-v20.js` e `public/admin.js`.
- Teste V20 existente: aprovado (`665` IDs, `17` views).
- Teste específico Kanban: contratos das 9 etapas, persistência no CRM, histórico, fila, transação/rollback, ADMIN-only, toggle, modal, drag-and-drop e CSS mobile aprovados.
- Validador V16: aprovado.
- Regressão de permissões V15.1: aprovada; RECRUTADOR continua sem Administração/Histórico restritos.
- Verificação de patch: sem erros de whitespace (`git diff --check`).
- Nenhuma migration nova.

## Não executados integralmente neste ambiente

- `test-portal-moderation.js` e `test-operations-v14.js`: dependências npm (`zod`/`express`) não estão instaladas na cópia local; não houve falha funcional observada.
- `test-v16.js` e `test-v16_1.js`: a V20-base recuperada não contém alguns artefatos antigos esperados por esses testes (migration V16 e workflow n8n). Essa ausência já existia antes desta alteração.
- Teste com PostgreSQL/WAHA real: requer o ambiente implantado, credenciais e sessão dedicada. Deve ser feito com lead controlado antes de liberar produção.

## Arquivos de runtime alterados

- `admin-v6.js`
- `lib/prospecting-v20.js`
- `public/admin.js`
- `public/index.html`
- `public/prospecting-v20.css`
- `public/prospecting-v20.js`

E foi adicionado apenas o teste `scripts/test-v20-kanban.js`.
