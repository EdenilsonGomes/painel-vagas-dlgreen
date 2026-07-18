# Painel de Vagas — DL Green

Este projeto cria um painel leve para cadastrar, editar, ativar, pausar e encerrar vagas. O painel grava diretamente no PostgreSQL, e o n8n passa a consultar essas informações antes de enviar o contexto para a Evelyn.

## Arquitetura usada

```text
Navegador
   ↓ HTTPS + senha única
Painel Node.js/Express no EasyPanel
   ↓ rede interna da VPS
PostgreSQL
   ↑
n8n consulta as vagas e monta o contexto da Evelyn
```

Nesta primeira versão não existe cadastro de usuários. Há apenas um usuário e uma senha administrativos definidos nas variáveis do EasyPanel. Isso impede que o formulário fique totalmente aberto na internet sem adicionar a complexidade de um sistema de contas.

---

# ETAPA 0 — Não mexa no workflow principal ainda

A ordem mais segura é:

1. Fazer backup do PostgreSQL.
2. Criar as tabelas.
3. Cadastrar uma vaga manualmente para testar o banco.
4. Publicar o painel.
5. Testar cadastro e edição pelo painel.
6. Somente depois alterar o workflow principal do WhatsApp.

---

# ETAPA 1 — Fazer backup do PostgreSQL

Acesse a VPS por SSH ou pelo terminal da Hostinger.

Liste os containers:

```bash
docker ps --format "table {{.ID}}\t{{.Names}}\t{{.Image}}"
```

Procure a linha do PostgreSQL e copie o valor da coluna `NAMES`.

Crie a pasta de backup:

```bash
mkdir -p /root/backups
```

Troque `NOME_DO_CONTAINER_POSTGRES` pelo nome copiado e execute:

```bash
docker exec -t NOME_DO_CONTAINER_POSTGRES sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "recrutamento-db" -Fc' > /root/backups/recrutamento_antes_vagas_$(date +%F_%H%M).dump
```

Confira se o arquivo foi criado:

```bash
ls -lh /root/backups
```

O backup deve aparecer com tamanho maior que zero.

> Caso o banco não se chame `recrutamento-db`, substitua pelo nome correto.

---

# ETAPA 2 — Criar as tabelas no PostgreSQL usando o n8n

O arquivo SQL está em:

```text
sql/01_criar_estrutura_vagas.sql
```

No n8n:

1. Crie um workflow novo.
2. Nomeie como `UTIL - Criar estrutura de vagas`.
3. Adicione um node `Manual Trigger`.
4. Adicione um node `Postgres`.
5. Conecte o Manual Trigger ao Postgres.
6. No node Postgres, selecione a mesma credencial que seu workflow principal já utiliza.
7. Em `Operation`, selecione `Execute Query`.
8. Abra o arquivo `sql/01_criar_estrutura_vagas.sql`.
9. Copie todo o conteúdo.
10. Cole no campo da consulta SQL.
11. Execute o workflow uma única vez.

O script faz o seguinte:

- Cria a tabela `empresas`.
- Cria a tabela `vagas`.
- Cadastra a empresa `DL Green Terceirização de Serviços`.
- Adiciona `vaga_id` na tabela `candidatos` sem remover o campo antigo `vaga`.
- Cria a ligação entre candidato e vaga.
- Cria índices para melhorar as consultas.

## Verificar se funcionou

Troque temporariamente a consulta do node Postgres por:

```sql
SELECT * FROM empresas ORDER BY id;
```

Execute. Deve aparecer a DL Green.

Depois teste:

```sql
SELECT * FROM vagas ORDER BY id;
```

No começo o resultado estará vazio, pois ainda não existe vaga cadastrada.

Por último:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'candidatos'
  AND column_name = 'vaga_id';
```

Deve retornar a coluna `vaga_id`.

Não execute novamente o script se a primeira execução terminou corretamente, embora ele tenha sido preparado para aceitar repetição na maior parte das situações.

---

# ETAPA 3 — Cadastrar uma vaga manualmente para validar o banco

No mesmo workflow de testes, use esta consulta:

```sql
INSERT INTO vagas (
    empresa_id,
    codigo,
    titulo,
    cargo,
    descricao,
    cidade,
    estado,
    bairro,
    tipo_contrato,
    modalidade,
    escala,
    horario,
    salario,
    beneficios,
    escolaridade_minima,
    experiencia_minima_meses,
    aceita_sem_experiencia,
    requisitos_obrigatorios,
    quantidade_vagas,
    formulario_url,
    status
)
VALUES (
    (SELECT id FROM empresas WHERE nome = 'DL Green Terceirização de Serviços' LIMIT 1),
    'VAGA-001',
    'Auxiliar de Limpeza',
    'Auxiliar de Limpeza',
    'Atuação com limpeza e conservação de ambiente corporativo.',
    'São Paulo',
    'SP',
    'Jabaquara',
    'CLT',
    'Presencial',
    '6x1',
    '13h40 às 22h',
    1717.20,
    'Vale-transporte, vale-refeição e cesta básica.',
    'Ensino fundamental',
    5,
    FALSE,
    'Disponibilidade para trabalhar na escala e no horário informados.',
    3,
    'https://projeto-n8n.d7lmap.easypanel.host/form/215d7115-349c-4ff2-b7fb-04fab8a05427',
    'ATIVA'
)
RETURNING *;
```

Execute uma vez.

Depois confirme:

```sql
SELECT id, codigo, titulo, cidade, bairro, salario, status
FROM vagas
ORDER BY id;
```

Se você já cadastrou `VAGA-001`, não execute o `INSERT` novamente. Use outro código ou apague o teste antes.

Para apagar somente a vaga de teste:

```sql
DELETE FROM vagas WHERE codigo = 'VAGA-001';
```

---

# ETAPA 4 — Colocar os arquivos no GitHub

1. Descompacte o arquivo ZIP deste projeto no seu computador.
2. Entre no GitHub.
3. Clique em `New repository`.
4. Nome sugerido: `painel-vagas-dlgreen`.
5. Escolha `Private`.
6. Não marque a criação automática de README, pois o projeto já possui um.
7. Crie o repositório.
8. Clique em `uploading an existing file` ou `Add file` → `Upload files`.
9. Arraste o conteúdo da pasta descompactada para a página.
10. Confirme o envio em `Commit changes`.

Não envie um arquivo chamado `.env`. O projeto contém apenas `.env.example`, que não possui sua senha real.

---

# ETAPA 5 — Criar o App no EasyPanel

Crie o App dentro do mesmo projeto do EasyPanel em que estão seu n8n e seu PostgreSQL. Isso facilita o acesso usando a rede interna.

1. Abra o EasyPanel.
2. Entre no projeto que contém o PostgreSQL.
3. Clique em `+ Service` ou `New`.
4. Selecione `App`.
5. Nome do serviço: `painel-vagas`.
6. Em `Source`, escolha GitHub.
7. Conecte sua conta GitHub, caso ainda não esteja conectada.
8. Escolha o repositório `painel-vagas-dlgreen`.
9. Branch: `main`.
10. O EasyPanel deve detectar o `Dockerfile` automaticamente.

## Variáveis de ambiente

Abra a área `Environment` e adicione uma linha para cada variável abaixo:

```text
PORT=3000
NODE_ENV=production
PGHOST=HOST_INTERNO_DO_POSTGRES
PGPORT=5432
PGDATABASE=recrutamento-db
PGUSER=admin
PGPASSWORD=SENHA_REAL_DO_POSTGRES
DB_SSL=false
ADMIN_USER=admin
ADMIN_PASSWORD=UMA_SENHA_FORTE_COM_PELO_MENOS_10_CARACTERES
```

Use os mesmos dados da credencial PostgreSQL que já funciona no n8n.

### Como descobrir o PGHOST

Abra no n8n:

1. `Credentials`.
2. A credencial PostgreSQL usada no workflow principal.
3. Veja o campo `Host`.
4. Use o mesmo valor em `PGHOST`.

Você também pode consultar a tela do serviço PostgreSQL no EasyPanel. Não use `localhost`, porque `localhost` dentro do container do painel apontaria para o próprio painel, e não para o container do PostgreSQL.

## Domínio e porta

1. Abra `Domains` ou `Domains & Proxy` no serviço `painel-vagas`.
2. Adicione um domínio gerado pelo EasyPanel ou seu domínio próprio.
3. Configure `Proxy Port` como `3000`.
4. Salve.
5. Clique em `Deploy`.

O primeiro build pode levar alguns minutos porque o EasyPanel instalará as dependências do projeto.

---

# ETAPA 6 — Corrigir erros de publicação

Abra `Logs` no serviço.

## Erro: `DATABASE_URL ou PGHOST... não configurado`

Falta alguma variável do PostgreSQL. Confira `PGHOST`, `PGDATABASE`, `PGUSER` e `PGPASSWORD`.

## Erro: `password authentication failed`

A senha ou o usuário do PostgreSQL está incorreto.

## Erro: `getaddrinfo ENOTFOUND`

O valor de `PGHOST` está incorreto ou o painel foi criado em outro projeto/rede do EasyPanel.

## Erro: `relation empresas does not exist`

O script da ETAPA 2 ainda não foi executado no mesmo banco configurado no painel.

## Serviço online, mas página não abre

Confira se o Proxy Port está em `3000` e se o domínio está associado ao serviço correto.

## Teste do health check

Abra no navegador:

```text
https://SEU-DOMINIO/health
```

O resultado esperado é:

```json
{"status":"ok"}
```

A rota `/health` não pede senha e serve apenas para dizer se o aplicativo e o banco estão acessíveis.

---

# ETAPA 7 — Entrar no painel e testar

Ao abrir o domínio principal, o navegador mostrará uma pequena janela solicitando usuário e senha.

Use:

```text
Usuário: valor de ADMIN_USER
Senha: valor de ADMIN_PASSWORD
```

No painel:

1. Clique em `+ Nova vaga`.
2. Preencha os campos obrigatórios.
3. Para o primeiro teste, use `VAGA-002` se a `VAGA-001` já foi criada manualmente.
4. Coloque o status como `RASCUNHO`.
5. Salve.
6. Confira se a vaga aparece na tabela.
7. Clique em `Editar` e altere um campo.
8. Salve novamente.
9. Clique em `Ativar`.
10. Atualize a página e confirme que a vaga continua salva.

No n8n, confirme diretamente no PostgreSQL:

```sql
SELECT
    id,
    empresa_id,
    codigo,
    titulo,
    salario,
    status,
    created_at,
    updated_at
FROM vagas
ORDER BY id DESC;
```

---

# ETAPA 8 — Preparar a mensagem de divulgação

Cada divulgação deve carregar o código da vaga.

Exemplo:

```text
Vaga: Auxiliar de Limpeza
Local: Jabaquara/SP
Para participar, envie VAGA-001 neste WhatsApp.
```

O painel possui o botão `Copiar código`, que copia a mensagem:

```text
Olá, tenho interesse na vaga VAGA-001.
```

---

# ETAPA 9 — Alterar o workflow principal do WhatsApp

Faça uma cópia do workflow funcional antes de alterar:

1. Abra o workflow principal.
2. Use `Duplicate`.
3. Nomeie a cópia como `BACKUP - Workflow WhatsApp antes das vagas`.
4. Deixe o backup inativo.

No workflow original, a ordem deve ficar parecida com:

```text
Webhook WAHA
→ Extrair telefone e mensagem
→ Buscar candidato
→ Extrair código da vaga               NOVO
→ Vincular vaga informada              NOVO
→ Buscar contexto de vagas             NOVO
→ Buscar últimas mensagens
→ Buscar documentos
→ Buscar eventos
→ Contexto IA
→ Agent IA Evelyn
→ restante do fluxo atual
```

A posição exata pode variar conforme seu workflow. O requisito é que `Buscar candidato` já tenha retornado o `id` do candidato antes do node `Vincular vaga informada`.

## Node novo 1: Extrair código da vaga

1. Adicione um node `Code`.
2. Nomeie como `Extrair código da vaga`.
3. Selecione `Run Once for Each Item`.
4. Copie o conteúdo do arquivo:

```text
n8n/01_extrair_codigo_vaga.js
```

5. Execute usando um dado de teste contendo:

```text
Olá, tenho interesse na VAGA-001
```

O resultado deve conter:

```json
{
  "codigo_vaga_informado": "VAGA-001",
  "informou_codigo_vaga": true
}
```

Se `mensagem_recebida` vier vazia, a mensagem do seu workflow está em outro campo. Abra o output do node anterior, encontre onde está o texto e ajuste a variável `texto` no começo do código.

## Node novo 2: Vincular vaga informada

1. Adicione um node `Postgres`.
2. Nomeie como `Vincular vaga informada`.
3. Use a credencial atual do PostgreSQL.
4. Operation: `Execute Query`.
5. Copie a `CONSULTA A` do arquivo:

```text
n8n/02_consultas_postgres.sql
```

6. Em `Options`, adicione `Query Parameters`.
7. Primeiro parâmetro `$1`:

```javascript
{{ $json.codigo_vaga_informado || '' }}
```

8. Segundo parâmetro `$2`: use o ID retornado pelo seu node `Buscar candidato`.

Exemplo, caso o campo seja `id`:

```javascript
{{ $('Buscar candidato').first().json.id }}
```

Não copie cegamente o exemplo. Abra o output de `Buscar candidato` e confirme o nome do campo que contém o ID.

O resultado deste node terá:

```json
{
  "codigo_informado": "VAGA-001",
  "vaga_id_encontrada": 1,
  "codigo_vaga_encontrada": "VAGA-001",
  "codigo_valido": true,
  "candidato_atualizado": true
}
```

Quando a mensagem não tiver código, o node ainda devolve uma linha, porém com `codigo_informado` e `vaga_id_encontrada` nulos. Por isso não é necessário ativar `Always Output Data` neste node.

## Node novo 3: Buscar contexto de vagas

1. Adicione outro node `Postgres`.
2. Nomeie como `Buscar contexto de vagas`.
3. Operation: `Execute Query`.
4. Copie a `CONSULTA B` do arquivo:

```text
n8n/02_consultas_postgres.sql
```

5. Adicione um único Query Parameter `$1` com o ID do candidato:

```javascript
{{ $('Buscar candidato').first().json.id }}
```

O resultado será parecido com:

```json
{
  "vaga_atual": {
    "id": 1,
    "codigo": "VAGA-001",
    "titulo": "Auxiliar de Limpeza",
    "salario": 1717.2,
    "status": "ATIVA"
  },
  "vagas_ativas": [
    {
      "id": 1,
      "codigo": "VAGA-001",
      "titulo": "Auxiliar de Limpeza"
    }
  ]
}
```

---

# ETAPA 10 — Adicionar as vagas ao node Contexto IA

No seu node `Contexto IA`, mantenha tudo que já existe e acrescente os campos abaixo.

Exemplo genérico:

```javascript
const contextoVagas = $('Buscar contexto de vagas').first().json;
const vinculacao = $('Vincular vaga informada').first().json;

return {
  json: {
    ...$json,

    // Mantenha aqui seus campos atuais de candidato, mensagens,
    // documentos e eventos.

    vaga_atual: contextoVagas.vaga_atual ?? null,
    vagas_ativas: contextoVagas.vagas_ativas ?? [],
    codigo_vaga_informado: vinculacao.codigo_informado ?? null,
    codigo_vaga_valido: vinculacao.codigo_informado
      ? Boolean(vinculacao.codigo_valido)
      : null,
  },
};
```

Seu node atual provavelmente já possui um código maior. Não apague o código anterior; incorpore somente esses quatro campos.

O contexto final enviado à Evelyn deve conter pelo menos:

```json
{
  "candidato": {},
  "vaga_atual": {},
  "vagas_ativas": [],
  "codigo_vaga_informado": null,
  "codigo_vaga_valido": null,
  "documentos": [],
  "eventos": [],
  "ultimas_mensagens": []
}
```

---

# ETAPA 11 — Alterar o prompt da Evelyn

1. Faça uma cópia do prompt atual em um arquivo de texto.
2. Remova somente os dados fixos das vagas, como salário fixo, horário fixo, benefícios fixos e endereço fixo.
3. Não remova as regras de etapas, documentos, aprovação, agendamento e JSON de saída.
4. Adicione o bloco do arquivo:

```text
n8n/03_regras_prompt_evelyn.txt
```

5. Confirme que o Prompt Message ainda recebe o contexto completo, por exemplo:

```javascript
{{ JSON.stringify($('Contexto IA').item.json, null, 2) }}
```

O link do formulário não deve mais ficar fixo no prompt. Ele deve vir de:

```text
vaga_atual.formulario_url
```

---

# ETAPA 12 — Testes obrigatórios antes de publicar

Execute cada cenário separadamente usando um número de teste.

## Cenário 1: código válido

Mensagem:

```text
Olá, tenho interesse na VAGA-001
```

Verifique:

- `codigo_valido = true`.
- `candidatos.vaga_id` foi preenchido.
- `vaga_atual` contém a `VAGA-001`.
- A Evelyn usa exatamente o salário e horário cadastrados.

## Cenário 2: código inexistente

Mensagem:

```text
Tenho interesse na VAGA-999
```

Verifique:

- `codigo_valido = false`.
- A vaga anterior do candidato não deve ser alterada por um código inexistente.
- A Evelyn informa que o código não está ativo e apresenta as vagas disponíveis.

## Cenário 3: pergunta geral

Mensagem:

```text
Quais vagas vocês têm?
```

Verifique:

- `vagas_ativas` contém apenas status `ATIVA`.
- A Evelyn mostra código, título e local.
- A Evelyn orienta a responder com o código.

## Cenário 4: vaga pausada

No painel, pause a vaga. Depois envie o código.

Verifique:

- O código não é considerado válido para nova vinculação.
- A vaga não aparece em `vagas_ativas`.

## Cenário 5: vaga sem salário

Deixe o campo salário vazio.

Verifique:

- A Evelyn não inventa valor.
- Ela informa que o salário ainda não foi disponibilizado.

## Cenário 6: edição no painel

Altere o horário pelo painel e faça uma nova pergunta no WhatsApp.

Verifique:

- A resposta utiliza o novo horário sem necessidade de alterar o prompt.

---

# ETAPA 13 — Publicação definitiva

Depois dos testes:

1. Ative o workflow principal atualizado.
2. Confirme que o webhook de produção continua correto.
3. Faça um teste real pelo WhatsApp.
4. Não apague imediatamente o backup do workflow antigo.
5. Mantenha o painel restrito pela senha única.

---

# Próxima evolução, depois que o piloto estiver estável

A estrutura já possui `empresa_id`, então poderá evoluir para:

- Login individual por cliente.
- Cada cliente vendo somente suas próprias vagas.
- Várias sessões WAHA.
- Vagas vinculadas à empresa correta.
- Dashboard de candidatos por vaga.
- Histórico de alterações.
- Usuários administradores e clientes.
- Relatórios de aprovados, reprovados e entrevistas.

Não implemente essa etapa antes do piloto funcionar de ponta a ponta.
