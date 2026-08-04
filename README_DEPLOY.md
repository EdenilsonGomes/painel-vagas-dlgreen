# Genesis Recruiting OS V12 — deploy no Easypanel

Esta versão corrige a aprovação de grupos, moderniza o painel inteiro e mantém os workflows atuais do n8n/Evelyn sem alterações.

## O que foi corrigido

- compatibilidade de `gg_groups.status` com `pending`, `approved`, `rejected`, `suspended` e `expired`;
- mensagem acionável quando uma regra legada do PostgreSQL bloqueia a moderação;
- imagens de grupos carregadas do domínio do portal sem bloqueio da política de segurança;
- placeholder local quando a imagem não existe ou falha;
- telas administrativas não aparecem simultaneamente ao entrar no painel;
- monitoramento técnico restrito a administradores no menu e no backend;
- navegação, dashboard, vagas, candidatos, agenda, revisões, documentos, portal, prospecção, auditoria, equipe e login repaginados;
- conversa do WhatsApp exibida no perfil do candidato usando somente mensagens já armazenadas.

## 1. Backup recomendado

No terminal do PostgreSQL:

```bash
pg_dump -U SEU_USUARIO -d recrutamento-db -Fc -f /tmp/genesis-antes-painel-v12.dump
```

O arquivo fica dentro do contêiner do PostgreSQL. Ele não aparece automaticamente como download no Easypanel. Isso não bloqueia o deploy, pois a migração V12 é aditiva e não apaga registros.

## 2. Variáveis do painel

Preserve todas as variáveis atuais de banco, login, n8n e webhooks. Confira também:

```env
NODE_ENV=production
PORT=3000
PORTAL_BASE_URL=https://SEU-DOMINIO-DO-PORTAL
PUBLIC_BASE_URL=https://SEU-DOMINIO-DO-PORTAL
DB_POOL_MAX=8
```

`PORTAL_BASE_URL` é preferida. Se ela estiver ausente, o painel usa `PUBLIC_BASE_URL` como compatibilidade.

Mantenha o login interno já configurado:

```env
APP_LOGIN_USER=...
APP_LOGIN_PASSWORD=...
APP_SESSION_SECRET=...
```

Use uma chave estável e longa em `APP_SESSION_SECRET`. Não reutilize a senha do administrador como chave.

## 3. Deploy

1. Substitua os arquivos do repositório do painel pelo conteúdo deste pacote.
2. Faça o deploy no serviço atual do painel.
3. No terminal do serviço do painel, execute:

```bash
npm run migrate:panel
npm run preflight
```

Resultados esperados:

```text
Migração do painel concluída. { moderacaoGrupos: 'ok' }
Pré-checagem do painel concluída.
```

4. Faça um restart/redeploy do painel para garantir que os assets V12 sejam servidos.

A migração é idempotente: pode ser executada novamente sem duplicar nem apagar dados.

## 4. Testes após o deploy

### Moderação de grupos

1. Entre como administrador.
2. Abra **Conteúdo do portal**.
3. Selecione um grupo pendente.
4. Clique em **Testar convite**.
5. Marque **Convite verificado**.
6. Clique em **Aprovar e publicar**.
7. Confirme que o grupo saiu da fila de pendentes.
8. Abra o portal em aba anônima e confirme a página pública.

### Operação

1. Confira os quatro indicadores da Visão geral.
2. Abra Vagas e teste os filtros Empresa, Local, Status e busca.
3. Abra um candidato e confira Resumo e Conversa.
4. Teste a Agenda, Revisões e Documentos.
5. Como recrutador, confirme que Monitoramento, Auditoria, Prospecção, Conteúdo do portal e Equipe não aparecem.

### Saúde

```bash
npm test
```

E abra:

```text
/health
/login
/
```

## 5. Se a aprovação ainda falhar

O painel agora retorna a causa específica. Se a mensagem pedir a migração, rode novamente:

```bash
npm run migrate:panel
npm run preflight
```

Se a pré-checagem falhar por tipo ou coluna diferente, copie apenas a mensagem da pré-checagem e o trecho correspondente do log. Não envie credenciais nem dados de candidatos.

## 6. Rollback

1. No Easypanel, selecione o deployment anterior do painel.
2. Faça rollback/redeploy.
3. Não reverta a migração V12: ela só amplia compatibilidade e as versões anteriores ignoram a regra nova.
4. Não execute `DROP TABLE` durante o incidente.
