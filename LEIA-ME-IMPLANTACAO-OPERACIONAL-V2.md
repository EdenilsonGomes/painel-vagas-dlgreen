# Genesis IA — Implantação Operacional V2

Este pacote atualiza o chatbot, o agendamento, o assistente de vagas e o painel web.

## O que foi implementado

### Chatbot

- Registro bruto de cada acionamento antes da criação do candidato.
- Extração de telefone mais segura, ignorando identificadores `@lid`.
- Validação do telefone antes de acessar o cadastro.
- Diferenciação entre CTPS, currículo e PDF não reconhecido.
- Currículo opcional, armazenado para download.
- CTPS Digital em PDF obrigatória para seguir na triagem.
- Fotos, prints, áudios e outros tipos recebem orientação automática para enviar texto ou PDF.
- Confirmações como `ok` após agendamento não repetem horário e link.
- Pedido explícito de detalhes continua exibindo horário e Google Meet.
- Pedido de reagendamento é identificado e encaminhado à agenda.

### Agenda

- Horários somente em dias úteis.
- Primeiro horário às 08:00.
- Último horário termina até 18:00.
- Duração de 20 minutos.
- Três novas opções quando as primeiras não servirem.
- Reagendamento com remoção do evento anterior no Google Calendar.
- Atualização do banco e criação do novo Google Meet após nova escolha.

### Painel

- Nova página inicial `Visão geral`.
- Alertas operacionais.
- Entradas recebidas sem candidato vinculado.
- PDFs parados em classificação.
- Candidatos parados em etapas críticas.
- Últimos candidatos adicionados, alterados e removidos.
- Próximas entrevistas.
- Contadores de CTPS, currículos e documentos para revisar.
- Motivo e análise de reprovação nos detalhes do candidato.
- Identificação visual do tipo de documento e download de currículo/CTPS.
- Nova arte de divulgação adaptada ao tema da vaga.
- Melhorias de responsividade, hierarquia visual e usabilidade.

### Assistente de vagas

- Método mais rígido para sugerir cargos compatíveis.
- CBO acompanhado de título, confiança e justificativa.
- Sugestões de baixa confiança são descartadas.
- Link para validação na consulta oficial do Ministério do Trabalho.

---

# Ordem correta de implantação

## 1. Faça backup

Antes de alterar o ambiente:

1. Exporte os workflows atuais do n8n.
2. Faça uma cópia do repositório atual do site.
3. Faça backup do PostgreSQL, se possível.

## 2. Execute a migração SQL

Arquivo:

```text
sql/01_MIGRACAO_MONITORAMENTO_DOCUMENTOS_REAGENDAMENTO.sql
```

No terminal do PostgreSQL conectado ao `recrutamento-db`:

```bash
psql -U admin -d recrutamento-db
```

Depois execute o conteúdo completo do arquivo SQL.

A execução precisa terminar com:

```text
COMMIT
```

Conferência:

```sql
SELECT TO_REGCLASS('public.atendimento_logs');
SELECT TO_REGCLASS('public.auditoria_candidatos');
SELECT TO_REGCLASS('public.alertas_resolvidos');
```

As três consultas precisam retornar o nome da tabela.

## 3. Importe o workflow de agendamento

Arquivo:

```text
workflows/02_GENESIS_IA_ENTREVISTAS_REAGENDAMENTO_V2.json
```

No n8n:

1. Importe o arquivo.
2. Confirme a credencial `Postgres account`.
3. Confirme a credencial `Google Calendar account`.
4. Confirme a credencial `WAHA account`.
5. Salve o workflow.
6. Faça um teste manual somente depois de importar o workflow principal.

As referências de credenciais foram preservadas, mas o n8n pode solicitar confirmação após a importação.

## 4. Importe o workflow principal

Arquivo:

```text
workflows/01_GENESIS_IA_CHATBOT_OPERACIONAL_V2.json
```

Confirme as credenciais:

```text
WAHA account
Postgres account
OpenAI account
```

O Webhook continua usando o caminho:

```text
5c2ff67c-0a5e-4f44-ac86-1f8789409309
```

### Conexão obrigatória com o subworkflow

Abra o node:

```text
Executar agenda de entrevistas
```

No campo de workflow, selecione o workflow recém-importado:

```text
[GENESIS IA] Entrevistas Google Meet - Reagendamento V2
```

Essa seleção é necessária porque o ID interno muda quando um workflow é importado como novo.

## 5. Importe o assistente de vagas

Arquivo:

```text
site/genesis-ia/n8n/01_GENESIS_IA_ASSISTENTE_VAGAS.json
```

Confirme a credencial:

```text
OpenAI account
```

Ative o workflow e atualize `AI_VAGAS_WEBHOOK_URL` no EasyPanel somente se a URL de produção mudar.

## 6. Atualize o site

Você pode substituir o projeto inteiro usando:

```text
site/genesis-ia
```

Ou substituir estes arquivos principais:

```text
server.js
public/index.html
public/app.js
public/styles.css
```

Também mantenha no repositório:

```text
sql/02_MIGRACAO_MONITORAMENTO_DOCUMENTOS_REAGENDAMENTO.sql
n8n/01_GENESIS_IA_CHATBOT_OPERACIONAL_V2.json
n8n/02_GENESIS_IA_ENTREVISTAS_REAGENDAMENTO_V2.json
n8n/01_GENESIS_IA_ASSISTENTE_VAGAS.json
```

No GitHub, faça um commit como:

```text
Adicionar monitoramento, documentos e reagendamento
```

No EasyPanel:

1. Abra o serviço do site.
2. Clique em `Redeploy`.
3. Aguarde o serviço ficar ativo.
4. Abra o painel.
5. Pressione `Ctrl + F5`.

---

# Testes obrigatórios antes de liberar

## Teste 1 — Texto

Envie:

```text
Olá, quero ver as vagas
```

Confirme:

- candidato criado;
- entrada presente em `atendimento_logs`;
- candidato exibido no painel;
- registro `ADICIONADO` na auditoria.

## Teste 2 — Currículo

Envie um currículo como documento PDF.

Resultado esperado:

- documento salvo como `CURRICULO`;
- candidato informado de que o currículo é opcional;
- CTPS solicitada como obrigatória;
- currículo disponível para download no painel.

## Teste 3 — CTPS

Envie a CTPS Digital em PDF.

Resultado esperado:

- documento classificado como `CTPS`;
- análise executada;
- candidato aprovado ou reprovado conforme vaga;
- CTPS disponível para download.

## Teste 4 — PDF desconhecido

Envie um PDF que não seja currículo nem CTPS.

Resultado esperado:

- documento salvo como `OUTRO`;
- CTPS solicitada novamente;
- o PDF não é usado para aprovar o candidato.

## Teste 5 — Foto

Envie uma foto ou print.

Resultado esperado:

```text
No momento não aceitamos fotos, prints ou imagens. Por favor, envie sua mensagem em texto. Para continuar a análise, a CTPS Digital deve ser enviada como Documento PDF.
```

## Teste 6 — Áudio

Envie um áudio.

Resultado esperado:

```text
No momento não conseguimos processar áudios. Por favor, escreva sua mensagem em texto. Para documentos, envie a CTPS Digital como Documento PDF.
```

## Teste 7 — Horários

Gere opções de entrevista.

Confirme que:

- nenhum horário começa antes das 08:00;
- nenhum horário termina depois das 18:00;
- não existem opções em sábado ou domingo;
- os horários ocupados no Calendar não aparecem.

## Teste 8 — Outras opções

Responda:

```text
Nenhum desses horários serve. Tem outras opções?
```

Resultado esperado:

- opções antigas canceladas;
- três novas opções geradas;
- nenhuma opção fora de 08h–18h.

## Teste 9 — Confirmação após agendamento

Depois que o Meet for criado, envie:

```text
ok
```

Resultado esperado:

```text
Combinado! Até a entrevista. 😊
```

O link e o horário não devem ser repetidos.

## Teste 10 — Reagendamento

Depois de agendado, envie:

```text
Preciso reagendar para outro dia
```

Resultado esperado:

- evento anterior removido do Google Calendar;
- entrevista anterior marcada como `REAGENDADA` no banco;
- três novas opções enviadas;
- após escolha, novo evento e novo Meet criados.

## Teste 11 — Alertas e logs

Abra `Visão geral` no painel.

Confirme:

- métricas carregadas;
- alertas exibidos;
- candidatos recentes;
- auditoria de adições, alterações e remoções;
- próximas entrevistas;
- botão `Resolver` remove o alerta da lista.

---

# Consultas de suporte

## Últimas entradas recebidas

```sql
SELECT
    id,
    mensagem_id,
    candidato_id,
    telefone_extraido,
    raw_from,
    raw_sender_alt,
    tipo_mensagem,
    status,
    detalhe,
    created_at
FROM atendimento_logs
ORDER BY created_at DESC
LIMIT 100;
```

## Entradas sem candidato

```sql
SELECT *
FROM atendimento_logs
WHERE candidato_id IS NULL
ORDER BY created_at DESC;
```

## Últimas alterações dos candidatos

```sql
SELECT
    id,
    candidato_id,
    acao,
    nome,
    telefone,
    campos_alterados,
    created_at
FROM auditoria_candidatos
ORDER BY created_at DESC
LIMIT 100;
```

## Documentos recebidos

```sql
SELECT
    id,
    candidato_id,
    tipo,
    titulo,
    nome_arquivo,
    tamanho_bytes,
    conteudo IS NOT NULL AS possui_download,
    created_at
FROM documentos
ORDER BY created_at DESC
LIMIT 100;
```

---

# Observação de segurança operacional

A classificação de PDF e a sugestão de CBO possuem revisão humana prevista. Não use uma sugestão de CBO ou motivo de reprovação sem conferir o contexto da vaga e os dados apresentados no painel.
