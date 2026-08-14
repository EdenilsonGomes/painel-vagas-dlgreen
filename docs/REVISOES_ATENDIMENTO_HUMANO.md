# Revisões e atendimento humano

## Estados operacionais

| Estado | `ia_atendimento_ativo` | `atendimento_humano_ativo` | Responsável | Revisão pendente |
|---|---:|---:|---|---|
| IA atendendo | `true` | `false` | vazio | independente |
| Atendimento humano ativo | `false` | `true` | usuário atual | independente |
| Aguardando atendimento humano | `false` | `false` | vazio | preservada |
| Revisão humana pendente | independente | independente | independente | registro `candidato_revisoes.status=PENDENTE` |
| Revisão encerrada | sem alteração | sem alteração | sem alteração | registro `status=CONCLUIDO` |

## Ações da tela

| Ação | WhatsApp | Aprovado/status/etapa/vaga | IA | Responsável | Revisão/evento |
|---|---|---|---|---|---|
| Manter no processo | pode acionar o chatbot estático com a mensagem retornada por `genesis_resolver_revisao_v1` | executa a decisão `APROVAR` definida na função SQL; portanto pode alterar aprovação/etapa/status | segue a decisão SQL | não é ação de atendimento | conclui a revisão e registra a decisão |
| Não aprovar nesta vaga | pode acionar o chatbot estático | executa `NAO_APROVAR` e pode alterar status/etapa/vaga conforme a função SQL | segue a decisão SQL | não é ação de atendimento | conclui a revisão e registra a decisão |
| Reprocessar | pode acionar o fluxo técnico de documento | não é encerramento neutro | conforme pipeline documental | sem alteração direta | decisão técnica na revisão |
| Solicitar novo PDF | pode enviar a solicitação retornada pela função SQL | pode mover a etapa documental | conforme fluxo | sem alteração direta | decisão registrada |
| Já revisado | não | nenhuma alteração | nenhuma alteração | nenhuma alteração | só conclui a pendência com usuário/data/motivo; sem workflow |
| Continuar atendimento | não | nenhuma alteração | permanece pausada | preservado | nenhuma alteração |
| Salvar e liberar para atendimento humano | não | dados confirmados podem ser salvos; status/etapa/vaga não mudam | permanece pausada | removido | revisão pendente preservada; evento de liberação e histórico de handoff |
| Salvar e devolver para IA | não envia mensagem administrativa | salva dados confirmados, retoma a etapa calculada e preserva os demais dados | ativa | removido | conclui `SUPORTE_FLUXO`, registra histórico/evento; sem criar nova revisão |
| + Documento | não envia WhatsApp; preserva o PDF e mantém o reprocessamento técnico já existente | não altera aprovação/status/vaga diretamente | sem alteração direta | exige atendimento assumido (ADMIN ou responsável) | registra documento e evento de upload |

## Causa do HTTP 502

O endpoint confirmava a transação de handoff e depois chamava `triggerManualCandidateMessage`. Uma indisponibilidade do webhook/WAHA ocorria depois do commit, retornava HTTP 502 ao frontend, repausava a IA e recriava `SUPORTE_FLUXO`. O fluxo corrigido não envia mensagem administrativa ao devolver: o banco é a fonte de verdade e a IA retoma no próximo evento normal da conversa.
