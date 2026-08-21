# Inventário de problemas mobile

Atualizado em: 2026-08-21  
Status geral: **implementado e validado na camada V29**

## Escopo de validação futuro

- Larguras: 320, 360, 375, 390 e 430 px.
- Alturas compactas e comuns: 568, 667, 800, 844 e 932 px.
- Temas dark e light.
- Confirmar ausência de rolagem horizontal no documento.
- Confirmar foco, teclado virtual, áreas seguras e navegação por toque.

## MOB-001 — Notificações cortadas no celular

- Prioridade: **P1 — alta**.
- Evidência: [01-notificacao-cortada.png](evidence/01-notificacao-cortada.png).
- Tela: Visão Geral / Central de notificações.
- Sintoma: o cartão aparece comprimido/cortado; textos longos e o limite direito não ficam legíveis com segurança.
- Causa provável: combinação de painel fixo, largura calculada e conteúdo da notificação com colunas rígidas/ellipsis, sem regra final específica para a menor largura útil.
- Correção esperada: painel respeitando `safe-area`, cartão com largura integral, coluna de texto flexível e conteúdo quebrando em até duas linhas sem corte lateral.
- Aceite: nenhuma parte do cartão sai da viewport entre 320–430 px; nome, motivo, horário e indicador de não lido continuam distinguíveis.

## MOB-002 — Criação de vaga sem rolagem funcional

- Prioridade: **P0 — bloqueia tarefa principal**.
- Evidência: [02-modal-vaga-sem-rolagem.png](evidence/02-modal-vaga-sem-rolagem.png).
- Tela: Vagas → Nova vaga.
- Sintoma: o formulário termina visualmente no meio de um campo; não fica claro se existem mais campos ou botões e não é possível alcançar o restante com segurança.
- Causa provável confirmada no código: o `#vacancyDialog` contém um `<form>` sem a estrutura `.modal-shell`; a camada V28 restringe o diálogo, mas não transforma esse formulário em grid com cabeçalho, etapas, corpo rolável e rodapé. O conteúdo acaba preso dentro de um contêiner com `overflow: hidden`.
- Correção esperada: formulário com linhas `header / etapas / conteúdo / footer`; somente `.modal-body` rola; rodapé permanece acessível e as etapas continuam navegáveis.
- Aceite: chegar ao último campo e aos botões Voltar/Continuar/Salvar em qualquer altura testada; gesto de rolagem funciona desde áreas vazias e campos; teclado virtual não esconde a ação atual.

## MOB-003 — Detalhes da vaga com rolagem lateral e ações sobrepostas

- Prioridade: **P1 — alta**.
- Evidência relacionada: [02-modal-vaga-sem-rolagem.png](evidence/02-modal-vaga-sem-rolagem.png); o relato também descreve o estado ao abrir uma vaga.
- Tela: Vagas → Abrir vaga.
- Sintoma: conteúdo mal redimensionado, rolagem horizontal e botão Fechar sobre o botão verde.
- Causa provável no código: o cabeçalho mobile mantém três ações em grid enquanto posiciona o botão Fechar de forma absoluta; a combinação não reserva espaço confiável para o `X`. Blocos internos ainda herdam larguras/grades de desktop.
- Correção esperada: layout de uma coluna, largura máxima de 100%, ações principais refluindo sem colisão e botão Fechar independente em área de toque de 44 px.
- Aceite: `scrollWidth === clientWidth`; nenhum botão se sobrepõe; Fechar, Editar, Divulgar e Ver candidatos permanecem acessíveis sem zoom.

## MOB-004 — Nome/telefone do candidato sobrepostos aos status

- Prioridade: **P1 — alta**.
- Evidência: [03-candidatos-sobrepostos.png](evidence/03-candidatos-sobrepostos.png).
- Tela: Candidatos.
- Sintoma: nome, telefone e vaga invadem os chips “Em processo” e “Aguardando documento”, dificultando leitura e toque.
- Causa provável confirmada no código: a linha mobile usa três colunas (`42px / conteúdo / auto`) e posiciona o status na terceira coluna ao lado do texto; em telas estreitas, os chips consomem o espaço que deveria pertencer ao nome.
- Correção esperada: cartão mobile com identidade ocupando a largura útil e status movidos para uma linha própria; textos com quebra/truncamento previsível, sem sobreposição.
- Aceite: nome, telefone, vaga, etapa e status legíveis em 320 px; nenhum elemento ocupa a área de outro; menu de ações continua com alvo de 44 px.

## MOB-005 — Checkbox de candidato visualmente exagerado

- Prioridade: **P2 — média**.
- Evidência: [03-candidatos-sobrepostos.png](evidence/03-candidatos-sobrepostos.png).
- Tela: Candidatos.
- Sintoma: checkbox domina a primeira coluna e desequilibra cada cartão.
- Causa confirmada no código: a regra mobile força o controle a `28 × 28 px` e ainda reserva uma coluna de 42 px.
- Correção esperada: indicador visual de 18–20 px dentro de uma área de toque invisível de pelo menos 44 px.
- Aceite: seleção confortável sem o quadrado competir com a identidade do candidato.

## MOB-006 — Risco de último candidato ficar atrás da navegação inferior

- Prioridade: **P2 — observar ao implementar**.
- Evidência: [03-candidatos-sobrepostos.png](evidence/03-candidatos-sobrepostos.png).
- Tela: Candidatos.
- Sintoma observado: o último cartão visível termina atrás da barra inferior fixa.
- Correção esperada: área rolável com `padding-bottom` equivalente à navegação e à `safe-area`.
- Aceite: o último item e seu menu podem ser totalmente exibidos acima da navegação inferior.

## MOB-007 — Lista de chats mantém uma coluna desktop vazia

- Prioridade: **P0 — bloqueia uso mobile**.
- Evidência: [04-chats-lista-faixa-lateral.png](evidence/04-chats-lista-faixa-lateral.png).
- Causa confirmada: uma regra V24 com maior especificidade reabria as duas colunas de desktop depois das regras mobile anteriores.
- Correção: grade forçada para uma coluna; lista com largura integral e sem borda lateral residual.
- Aceite: lista ocupa 100% da largura útil entre 320–430 px.

## MOB-008 — Conversa aberta estreita e com ações sobrepostas

- Prioridade: **P0 — bloqueia atendimento**.
- Evidência: [05-chat-aberto-faixa-lateral.png](evidence/05-chat-aberto-faixa-lateral.png).
- Correção: conversa em `100vw × 100dvh`, botão Voltar próprio, cabeçalho compacto, mensagens e compositor sem largura residual.
- Aceite: selecionar conversa abre tela cheia; Voltar retorna à lista; nenhuma faixa ou rolagem lateral.

## MOB-009 — Sales sem rolagem vertical e controle desproporcional

- Prioridade: **P0 — bloqueia prospecção**.
- Correção: colunas sem altura mínima de viewport, tabuleiro com rolagem horizontal sem capturar o gesto vertical, toolbar compacta e botão Atualizar com 44 px.
- Aceite: página rola verticalmente, Kanban rola horizontalmente e Pipeline permanece acessível.

## MOB-010 — Arrastar cards no Kanban

- Prioridade: **P1 — alta**.
- Correção: drag and drop nativo no desktop e toque prolongado no celular, com alvo visual, atualização do status e prevenção de abertura acidental do modal.
- Aceite: mover card para outra coluna persiste o novo status; toque simples continua abrindo a empresa.

## MOB-011 — Switch e controles do topo cortados

- Prioridade: **P1 — alta**.
- Evidência: [06-topbar-switch-cortado.png](evidence/06-topbar-switch-cortado.png).
- Correção: switch compacto de um ícone, controles de 36–40 px e título truncado antes de empurrar ações para fora da viewport.
- Aceite: tema, notificações, ação principal e perfil ficam integralmente tocáveis em 320 px.

## MOB-012 — Tipografia desproporcional em telas pequenas

- Prioridade: **P2 — média**.
- Correção: redução pontual de títulos, KPIs, cards de Sales e mensagens; inputs permanecem em 16 px para evitar zoom do navegador.
- Aceite: hierarquia legível sem títulos dominarem a área útil.

## Ordem aplicada

1. Fluxos bloqueadores: vaga, chats e Sales.
2. Candidatos, notificações e barra superior.
3. Tipografia e áreas seguras.

## Validação executada

- Regressão automatizada do painel: aprovada.
- Inspeção visual real em 320 × 568 e 390 × 844: sem rolagem horizontal do documento; topbar e lista de chats ocupando a largura correta.
- Temas: controle compacto e ícone visível nos estados mobile.
- Estados com dados dependentes do PostgreSQL continuam cobertos pelos testes de contrato; o ambiente local desta revisão não recebeu credenciais de produção.
