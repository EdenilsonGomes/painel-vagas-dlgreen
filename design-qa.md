# Design QA — Gênesis V26

- Fonte visual: `C:\Users\User\Downloads\Imagem do Codex 20 de ago. de 2026, 15_58_49.png` (1536 × 1024)
- Implementação validada: `public/index.html` com os estilos e scripts V24/V25/V26 reais e APIs simuladas apenas no teste de navegador
- Viewports: mobile 390 × 844, tablet 768 × 1024 e desktop 1536 × 1024; device scale factor 1
- Temas: dark e light
- Estados: Candidatos, seleção em massa/exportação ADMIN, filtros, drawer e Revisões com e sem mensagem

## Evidência visual

- Comparação completa: `..\work\mobile-qa-v26\qa-comparison-full.png`
- Comparação do drawer: `..\work\mobile-qa-v26\qa-comparison-drawer.png`
- Comparação de Revisões: `..\work\mobile-qa-v26\qa-comparison-reviews.png`
- Capturas individuais: `..\work\mobile-qa-v26\{mobile,tablet,desktop}-*`

As capturas foram feitas com a página de produção e comparadas lado a lado com o preview. A implementação preserva a hierarquia do painel de referência: navy neutro, teal restrito a ação/foco/seleção, tabela compacta, barra contextual, drawer lateral e decisão de revisão como foco.

## Interações verificadas

- Candidatos carregam nos três viewports sem overflow horizontal.
- Selecionar todos exibe a barra contextual; limpar seleção a remove.
- Exportação em massa abre com cinco candidatos selecionados e permanece restrita a ADMIN.
- Filtros abrem, aplicam e limpam sem duplicação de controles.
- Drawer abre Conversar, Documentos e Histórico; repetir a ação ativa retorna ao resumo.
- Agendar fecha o drawer e abre a Agenda.
- NÃO_APROVAR inicia com “Enviar mensagem” desmarcado e CTA “Salvar decisão”.
- Marcar mensagem troca o CTA para “Salvar e enviar mensagem”.
- Trocar para APROVAR volta a mensagem ao estado desmarcado e restaura o CTA correto.
- Temas dark/light renderizam sem erro de console.

## Histórico de correções da QA

- A captura inicial pelo navegador integrado foi bloqueada; a validação foi retomada com Playwright local autorizado.
- Mobile 390 px apresentava 20 px de overflow: tabela convertida em cartões compactos e topbar ajustada.
- Tablet apresentava 410 px de overflow em Revisões: workspace alterado para navegação de um painel abaixo de 900 px.
- Alvos de checkbox/ações estavam pequenos no mobile: áreas de toque ampliadas.
- A troca de NÃO_APROVAR para APROVAR podia manter o CTA de mensagem: sincronização corrigida.
- Drawer repetia navegação antiga e ações rápidas: abas legadas removidas e resumo tornou-se o estado base.
- Mudança de view preservava scroll anterior: cada view agora volta ao topo.

## Verificações técnicas

- Sintaxe JavaScript: `public/app.js`, `public/experience-v23.js`, `public/genesis-v25-admin.js`, `public/genesis-v26.js` e `server.js`.
- `scripts/test-ui-v26.js`.
- `scripts/test-v21-review-workspace.js`.
- `scripts/test-ui-v23.js`.
- Navegador funcional em 390 × 844, 768 × 1024 e 1536 × 1024, sem erros de console.
- O `npm test` completo continua bloqueado por duas pendências anteriores à V26: ausência de `scripts/migrate-v16.js` e expressão regular inválida em `scripts/test-v21-manual-message-delivery.js` no Node 24.

## Resultado

Nenhuma divergência P0, P1 ou P2 restante. A densidade, os espaçamentos, as superfícies, os estados e as funções principais estão coerentes com o preview e adequados para desktop, tablet e mobile.

final result: passed
