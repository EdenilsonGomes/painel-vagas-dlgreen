# Genesis IA — Duplicação de vagas e código automático

## Alterações implementadas

### Código da vaga automático

O usuário não precisa mais preencher `VAGA-001`, `VAGA-002` etc.

Ao criar uma vaga, o servidor:

1. trava temporariamente a geração de código para a empresa;
2. localiza o maior código numérico existente;
3. gera o próximo código disponível;
4. salva a vaga e o código na mesma transação.

Exemplos:

- `VAGA-001`
- `VAGA-002`
- `VAGA-003`

Duas criações simultâneas não devem receber o mesmo código.

Ao editar uma vaga existente, o código interno é preservado e não pode ser alterado pelo formulário.

### Botão Duplicar

A ação `Duplicar` copia os dados da vaga para um novo cadastro.

São copiados, entre outros:

- empresa;
- título e cargo;
- descrição;
- local;
- jornada;
- salário e benefícios;
- critérios de experiência;
- cargos e CBOs compatíveis;
- requisitos;
- quantidade e link do formulário.

Para segurança, a cópia abre como:

- `RASCUNHO`;
- sem data de início;
- sem data de encerramento;
- sem ID;
- sem reutilizar o código antigo.

O novo código é gerado automaticamente ao salvar.

### Remoção da ação Copiar código

O botão `Copiar código` foi removido. O código continua visível na tabela apenas como identificador administrativo interno.

## Arquivos alterados

- `server.js`
- `public/index.html`
- `public/app.js`

Não há alteração em:

- PostgreSQL;
- workflow do chatbot;
- workflow de entrevistas;
- workflow do assistente de IA;
- credenciais;
- variáveis do EasyPanel.

## Instalação

1. Substitua os três arquivos no GitHub.
2. Faça commit.
3. Faça redeploy no EasyPanel.
4. Atualize o navegador com `Ctrl + F5`.

## Testes

### Nova vaga

1. Clique em `Nova vaga`.
2. Observe que não existe campo para digitar o código.
3. Preencha título e cargo.
4. Salve.
5. Confira se o código foi criado automaticamente.

### Duplicação

1. Clique em `Duplicar` em uma vaga existente.
2. Confira se os campos foram preenchidos.
3. Altere endereço e horário.
4. Salve.
5. Confira:
   - novo ID;
   - novo código;
   - status inicial `RASCUNHO`;
   - vaga original intacta.
