# Genesis IA — Assistente de vagas e indicadores por vaga

Esta atualização adiciona duas funcionalidades ao painel:

1. Assistente de IA para gerar ou melhorar:
   - descrição da vaga;
   - cargos compatíveis para análise da CTPS;
   - CBOs compatíveis;
   - requisitos obrigatórios;
   - requisitos desejáveis.

2. Indicadores em cada vaga:
   - interessados;
   - em processo;
   - aprovados;
   - reprovados.

## Arquivos alterados

- `server.js`
- `public/index.html`
- `public/styles.css`
- `public/app.js`
- `.env.example`

## Novo workflow

- `n8n/01_GENESIS_IA_ASSISTENTE_VAGAS.json`

Não é necessário executar migração SQL.

---

## 1. Importar o workflow no n8n

Importe:

`01_GENESIS_IA_ASSISTENTE_VAGAS.json`

O workflow utiliza a mesma referência de credencial OpenAI já usada nos fluxos atuais:

- Nome: `OpenAI account`

Depois de importar:

1. Abra o node `OpenAI Chat Model`.
2. Confirme que a credencial está selecionada.
3. Salve.
4. Ative o workflow.
5. Abra o node `Webhook do painel`.
6. Copie a **Production URL**.

O caminho esperado do Webhook termina em:

`/webhook/genesis-vagas-ia-4e9264d6b0e14975`

---

## 2. Configurar o EasyPanel

No serviço do site, adicione:

```env
AI_VAGAS_WEBHOOK_URL=https://SEU-N8N/webhook/genesis-vagas-ia-4e9264d6b0e14975
AI_VAGAS_TIMEOUT_MS=60000
```

Use a Production URL copiada do n8n.

Salve as variáveis e faça o redeploy do site.

---

## 3. Atualizar o GitHub

Substitua:

- `server.js`
- `public/index.html`
- `public/styles.css`
- `public/app.js`

A `.env.example` serve somente como referência. As variáveis reais continuam configuradas no EasyPanel.

Depois faça commit e redeploy.

---

## 4. Como usar o assistente

No formulário da vaga existem:

- botão geral `Preencher com IA`;
- botão ao lado da descrição;
- botão ao lado dos cargos compatíveis;
- botão ao lado dos CBOs;
- botão ao lado dos requisitos obrigatórios;
- botão ao lado dos requisitos desejáveis.

Preencha pelo menos:

- título da vaga; ou
- cargo oficial.

A IA mostrará uma prévia editável. Nada é salvo automaticamente.

O usuário pode:

- editar a sugestão;
- desmarcar campos;
- aplicar somente o que desejar;
- revisar tudo antes de salvar a vaga.

Os CBOs são sugestões da IA e devem ser revisados por uma pessoa.

---

## 5. Indicadores das vagas

A API calcula os indicadores diretamente da tabela `candidatos`, usando `candidatos.vaga_id`.

Regras:

- `Interessados`: todos os candidatos vinculados à vaga;
- `Em processo`: status `NOVO` ou `EM_PROCESSO`;
- `Aprovados`: status `APROVADO` ou `CONTRATADO`;
- `Reprovados`: status `REPROVADO`.

Candidatos antigos com `vaga_id = null` não entram nos números até serem vinculados a uma vaga.

---

## 6. Testes

### Assistente de IA

1. Abra uma vaga.
2. Preencha título e cargo.
3. Clique em `Preencher com IA`.
4. Aguarde a prévia.
5. Edite alguma sugestão.
6. Desmarque um campo.
7. Clique em `Aplicar sugestões selecionadas`.
8. Confirme que somente os campos selecionados foram alterados.
9. Salve a vaga.

### Indicadores

1. Vincule candidatos à mesma vaga.
2. Deixe um em `EM_PROCESSO`.
3. Deixe um como `APROVADO`.
4. Deixe um como `REPROVADO`.
5. Atualize a aba de vagas.
6. Confira os quatro indicadores abaixo do nome da vaga.

---

## 7. Observações

- Não foi criado catálogo oficial de CBOs.
- O workflow sugere CBOs com IA.
- A IA é orientada a deixar a lista vazia quando não tiver segurança.
- Nenhuma sugestão é aplicada sem revisão.
- Nenhum dado da vaga é salvo pelo workflow de IA.
