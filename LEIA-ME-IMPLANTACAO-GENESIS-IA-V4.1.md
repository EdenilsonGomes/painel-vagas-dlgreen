# Genesis IA V4.1 — implantação das alterações

## O que mudou

1. Reprovação automática durante a conversa:
   - falta de experiência declarada;
   - reprovação após análise da CTPS;
   - o chatbot chama o workflow 07 imediatamente;
   - o candidato recebe uma única mensagem com a reprovação e o link atual do grupo.

2. Reprovação pelo recrutador:
   - o botão `Reprovar após entrevista` salva a decisão;
   - o site chama o webhook do workflow 07 naquele momento;
   - não existe mais busca agendada de reprovados ao longo do dia.

3. Indicadores por período:
   - Visão geral: mensagens recebidas, candidatos no período e vaga mais escolhida;
   - Vagas: escolhas, pessoas no funil, aprovados e vaga mais escolhida;
   - filtros de 1D, 7D e 30D.

4. Reagendamento:
   - a API exibe por padrão somente entrevistas `AGENDADA`;
   - o workflow marca agendamentos anteriores como `REAGENDADA` antes de salvar o novo;
   - a migração corrige duplicidades antigas e cria uma proteção para existir apenas uma entrevista agendada por candidato.

## Arquivos que precisam ser substituídos

- `server.js`
- `.env.example` apenas como referência
- `package.json`
- `public/index.html`
- `public/app.js`
- `public/styles.css`

## SQL

Execute:

`sql/05_GENESIS_IA_V4_1_CONVITE_PONTUAL_INDICADORES_ENTREVISTAS.sql`

## Workflows

Importe:

- `01_GENESIS_IA_CHATBOT_OPERACIONAL_V4_1.json`
- `02_GENESIS_IA_ENTREVISTAS_REAGENDAMENTO_V4_1.json`
- `07_GENESIS_IA_REPROVACAO_PONTUAL_GRUPO_V4_1.json`

Os workflows 03, 04, 05 e 06 permanecem iguais aos da V4 e também estão incluídos no pacote completo.

## Configuração do workflow 07

Abra o node `Normalizar entrada e configurar grupo` e altere:

- `WEBHOOK_TOKEN`
- `GRUPO_ID`

Mantenha `SESSAO_WAHA = 'whats_junior'`.

## Variáveis novas no EasyPanel

```env
REPROVACAO_WEBHOOK_URL=https://projeto-n8n.d7lmap.easypanel.host/webhook/genesis-reprovacao-grupo-v4-1
REPROVACAO_WEBHOOK_TOKEN=USE_O_MESMO_TOKEN_DO_WORKFLOW_07
REPROVACAO_WEBHOOK_TIMEOUT_MS=20000
```

## Reconexões obrigatórias no n8n

No workflow 01 V4.1:

1. Abra `Executar agenda de entrevistas` e selecione o workflow 02 V4.1.
2. Abra `Executar reprovação e convite do grupo` e selecione o workflow 07 V4.1.

## Ordem segura

1. Faça backup.
2. Execute o SQL 05.
3. Importe e configure o workflow 07.
4. Importe o workflow 02 V4.1.
5. Importe o workflow 01 V4.1 e reconecte os dois subworkflows.
6. Atualize o site e as variáveis.
7. Faça redeploy.
8. Teste com um candidato de teste.
9. Desative os workflows 01, 02 e 07 antigos antes de ativar os V4.1.

## Testes mínimos

- Responder que não possui a experiência mínima: uma única mensagem deve chegar com o grupo.
- Reprovar pela CTPS: uma única mensagem deve chegar com o grupo.
- Reprovar após entrevista no painel: a mensagem deve ser enviada imediatamente.
- Clicar novamente em reprovar: o link do grupo não deve ser repetido.
- Reagendar entrevista: somente o último horário deve aparecer no painel.
- Alternar 1D, 7D e 30D na Visão geral e em Vagas.
