# Design QA — Gênesis V26 + Sales V27

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

## Sales V27 — 21/08/2026

- Fonte visual: `C:\Users\User\AppData\Local\Temp\codex-clipboard-ded0c59b-5c09-4d92-9a85-ad8f9aa0dda7.png` (970 × 328).
- Implementação: `public/genesis-v27.js` e `public/genesis-v27.css`, renderizados com dados representativos e os estilos reais do painel.
- Evidência desktop: `..\work\qa-sales-desktop.png`, viewport padrão do navegador, densidade 1.
- Evidência mobile: `..\work\qa-sales-mobile.png`, viewport 390 × 844, densidade 1.
- Comparação conjunta: `..\work\qa-sales-comparison.png`.
- Estado: dark, Kanban principal, filtros, alternância Pipeline e cartões com ação de WhatsApp.

### Comparação e interações

- P1 do cabeçalho duplicado corrigido: a área interna redundante foi removida.
- P1 do filtro superdimensionado corrigido: status limitado a 180 px no desktop e compacto no mobile.
- P1 de navegação corrigido: Kanban/Pipeline permanece visível e Kanban inicia selecionado.
- P2 mobile corrigido: colunas usam 82% da largura da tela, scroll horizontal e encaixe por coluna.
- Modal, cópia, enriquecimento e link WhatsApp foram cobertos por testes de estrutura/comportamento; o preview visual confirmou hierarquia, espaçamento, tokens, tipografia e conteúdo.
- Sem erros de console no preview. Não há imagens raster ou ativos novos nesta tela; ícones reutilizam o sistema existente.

## Resultado

Nenhuma divergência P0, P1 ou P2 restante. A densidade, os espaçamentos, as superfícies, os estados e as funções principais estão coerentes com o preview e adequados para desktop, tablet e mobile.

## Mobile transversal V28 — 21/08/2026

- Escopo combinado de UX e acessibilidade responsiva: Visão geral, Vagas, Candidatos, Agenda, Documentos, Conversas, Revisões, Sales, Divulgação, Portal de Vagas, Empresas e marcas, Monitoramento, Auditoria, Equipe e acessos, drawers e modais.
- Viewport visual: 390 × 844, tema dark, componentes e folhas de estilo reais do painel com dados representativos.
- Evidências: `..\work\qa-v28\{dashboard,vacancies,candidates,agenda,documents,audit,sales,modal}-final.png`.
- A Visão geral ficou somente com KPIs e Movimento do dia; Agenda, Funil atual e Ações pendentes foram removidos do HTML, estado, carregamento, renderização e eventos.
- Agenda inicia em Lista no celular e mantém Mês/Dia/Semana disponíveis.
- KPIs, abas, Kanbans e grupos de filtros usam rolagem horizontal local; a página não cria overflow horizontal global.
- Modais longos e drawer do candidato ocupam o viewport, mantêm cabeçalho/rodapé controlados e rolam somente o conteúdo central.
- Conversas e Revisões preservam a altura útil e a rolagem interna de cada workspace.
- Formulários, ações, filtros e áreas administrativas refluem para uma coluna; alvos principais têm pelo menos 44 px.
- Medição automatizada das oito telas representativas: `scrollWidth === clientWidth` no documento e no conteúdo principal.
- Limite de evidência: APIs foram simuladas somente na prévia visual; contratos e fluxos reais foram cobertos pelos testes de regressão existentes.

final result: passed
