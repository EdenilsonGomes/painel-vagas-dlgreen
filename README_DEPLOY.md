# Genesis Recruiting OS V13 — implantação no EasyPanel

Esta entrega adiciona a triagem conversacional híbrida sem transformar a IA em decisora. As regras objetivas continuam no PostgreSQL; a IA serve somente para transcrever áudio, interpretar uma resposta dentro das opções permitidas e resumir respostas abertas.

CTPS e currículo continuam aceitos **somente como Documento PDF**. Imagens e capturas de tela não são interpretadas.

## Conteúdo do pacote

- painel V13 completo, preservando as correções visuais e de moderação da V12;
- migração `18_GENESIS_IA_V13_TRIAGEM_CONVERSACIONAL_DEMOS.sql`;
- construtor visual de perguntas por vaga;
- resultados da triagem no perfil do candidato;
- chatbot V13 para texto, áudio e PDF;
- demonstrações isoladas por sete dias com conexão por QR Code do WAHA;
- workflow V1 original mantido para rollback;
- workflow V13 com as referências às credenciais atuais preservadas.

## Comportamento de segurança

- perguntas abertas nunca eliminam automaticamente;
- somente critérios objetivos configurados na vaga podem eliminar;
- uma interpretação da IA só é usada com confiança mínima de 82%;
- respostas ambíguas são perguntadas novamente;
- após três tentativas sem compreensão, a candidatura é preservada e encaminhada para atendimento humano;
- mensagens repetidas do WAHA são ignoradas por ID;
- cada versão de perguntas fica congelada para quem já iniciou a candidatura;
- dados das demonstrações ficam em tabelas próprias e não entram no funil real;
- o link da demonstração contém um token aleatório; apenas o hash é armazenado;
- a chave do WAHA nunca é enviada ao navegador.

## 1. Antes do deploy

Faça um backup pelo recurso de backup do EasyPanel ou, dentro do contêiner PostgreSQL, execute:

```bash
pg_dump -U SEU_USUARIO -d recrutamento-db -Fc -f /tmp/genesis-antes-v13.dump
```

O arquivo criado em `/tmp` permanece dentro do contêiner e não aparece automaticamente no seu computador. Isso explica por que um comando pode concluir sem gerar um download no EasyPanel.

## 2. Variáveis no serviço do painel

Preserve todas as variáveis e credenciais atuais. Não apague nem recrie `PG*`, `ADMIN_*`, `WAHA_API_KEY`, tokens ou secrets.

Como `WAHA_BASE_URL`, `WAHA_API_KEY` e `PANEL_URL` já existem na instalação, normalmente basta adicionar estas linhas:

```env
DEMO_CHATBOT_WEBHOOK_URL=https://projeto-n8n.d7lmap.easypanel.host/webhook/5c2ff67c-0a5e-4f44-ac86-1f8789409309
DEMO_TRIAL_DAYS=7
DEMO_MAX_ACTIVE=5
DEMO_EXPIRY_CHECK_MINUTES=15
```

Confira também se o endereço interno do WAHA continua igual ao atual:

```env
WAHA_BASE_URL=http://projeto_waha:3000
```

Não copie o valor de exemplo de `WAHA_API_KEY` sobre a chave real. O painel reutiliza a chave que já está no EasyPanel.

## 3. Publicar o painel e migrar o banco

1. Substitua os arquivos do repositório do painel pelo conteúdo deste pacote.
2. Faça o deploy/redeploy do serviço.
3. Abra o terminal do serviço do painel e execute, nesta ordem:

```bash
npm run migrate:panel
npm run preflight
npm test
```

Resultados esperados:

```text
Migração do painel concluída. { moderacaoGrupos: 'ok', triagemConversacional: 'ok', demosSeteDias: 'ok' }
Pré-checagem do painel concluída.
Validação V13 concluída: painel, triagem, demonstrações, PDF, áudio e workflow estão consistentes.
```

A migração é aditiva e idempotente: pode ser executada novamente sem duplicar perguntas ou apagar candidatos.

## 4. Trocar o workflow no n8n

O arquivo novo é:

```text
n8n/Genesis-IA-Chatbot-Hibrido-V13-Credenciais-Preservadas.json
```

1. Importe o JSON no mesmo n8n usado atualmente.
2. Mantenha o workflow V13 **inativo** enquanto confere os nós.
3. Abra um nó PostgreSQL, um nó WAHA e o nó OpenAI e confirme que as credenciais existentes aparecem selecionadas. As referências do arquivo atual foram preservadas.
4. Confirme que o webhook mostra o caminho `5c2ff67c-0a5e-4f44-ac86-1f8789409309`.
5. Desative o workflow antigo `Chatbot Estático V1`.
6. Ative o workflow `Chatbot Híbrido V13`.

Os dois workflows não devem ficar ativos ao mesmo tempo porque usam o mesmo caminho de webhook. Não exclua o V1: ele é o rollback rápido.

## 5. Configurar perguntas em uma vaga

1. Entre no painel e abra **Vagas**.
2. Crie ou edite uma vaga.
3. Na seção **Perguntas da vaga**, use o modelo sugerido ou adicione perguntas individualmente.
4. Para uma pergunta eliminatória, escolha um tipo objetivo e informe a resposta necessária.
5. Salve a vaga.

Tipos disponíveis:

- Sim ou não;
- escolha única;
- múltipla escolha;
- número;
- resposta curta;
- resposta aberta.

Resposta curta e resposta aberta são sempre informativas e ficam disponíveis ao recrutador com um resumo factual.

## 6. Criar uma demonstração de sete dias

1. Entre como administrador.
2. Abra **Demonstrações**.
3. Informe empresa e contato; opcionalmente escolha uma vaga já configurada.
4. Clique em **Criar link seguro de demonstração**.
5. Envie o link ao cliente.
6. O cliente abre o guia, clica em **Gerar QR Code seguro** e lê o QR em **WhatsApp → Aparelhos conectados → Conectar aparelho**.
7. De outro número, ele envia `quero me candidatar` ao WhatsApp conectado e testa texto ou áudio.

Use um número dedicado ao teste. Ao encerrar ou expirar o prazo, o painel faz logout e remove a sessão do WAHA. A verificação automática roda a cada 15 minutos.

O módulo usa a API atual do WAHA e possui fallback para a rota legada de criação de sessão. Referência: [sessões do WAHA](https://waha.devlike.pro/docs/how-to/sessions/) e [webhooks por sessão](https://waha.devlike.pro/docs/how-to/events/).

## 7. Roteiro mínimo de homologação

### Chatbot real

1. Responda uma pergunta Sim/Não com `sim, consigo`.
2. Envie uma frase ambígua como `não entendi` e confirme que ela não é tratada como “não”.
3. Responda por áudio e confira no perfil do candidato o marcador **Áudio transcrito**.
4. Responda uma pergunta aberta e confira o resumo no painel.
5. Falhe de propósito três vezes em uma pergunta e confirme o encaminhamento humano.
6. Envie a mesma mensagem novamente e confirme que não há resposta duplicada.
7. Envie CTPS ou currículo como PDF e valide o fluxo documental atual.
8. Envie uma imagem e confirme a orientação para usar PDF, sem análise da imagem.

### Demonstração

1. Conecte o QR.
2. Confirme o status **Automação ligada**.
3. Faça uma conversa de teste de outro telefone.
4. Abra **Resultados** no painel e confira respostas e pontuação.
5. Confirme que o telefone de teste não apareceu em **Candidatos**.
6. Clique em **Encerrar** e confirme que a sessão saiu do WAHA.

### Regressão do portal

1. Aprove um grupo pendente.
2. Publique uma vaga enviada pelo portal.
3. Abra o portal público em aba anônima.

## 8. Diagnóstico rápido

- **QR não aparece:** confira `WAHA_BASE_URL`, `WAHA_API_KEY`, `DEMO_CHATBOT_WEBHOOK_URL` e os logs do WAHA.
- **QR expirou:** clique em atualizar; após várias expirações, use **Tentar conectar novamente**.
- **Áudio não é transcrito:** confira a credencial OpenAI, se o WAHA disponibilizou `media.url` e se o arquivo tem até 25 MB.
- **Demo conecta, mas não responde:** confirme que o V13 está ativo no n8n e que o V1 está inativo.
- **Função V13 não existe:** execute novamente `npm run migrate:panel`.
- **Aprovação de grupo falha:** execute `npm run preflight`; a correção de compatibilidade da V12 continua incluída.

Nunca envie em atendimento: senha do banco, chave WAHA, chave OpenAI, secrets de sessão, token de webhook ou documento de candidato.

## 9. Rollback

1. Desative o workflow V13.
2. Reative o workflow V1 preservado.
3. No EasyPanel, volte o serviço do painel ao deployment anterior se necessário.
4. Não remova a migração V13 e não execute `DROP TABLE`: as estruturas novas são aditivas e não interferem no workflow V1.

