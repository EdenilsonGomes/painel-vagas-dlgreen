# Hotfix V15.1 — acesso do recrutador ao candidato

O perfil `RECRUTADOR` deve visualizar `Resumo`, `Conversa`/Chat UI e `Documentos`. `Histórico` e `Administração` continuam exclusivos do `ADMIN`. Não há migration SQL para este hotfix. Após o redeploy, use `Ctrl+F5` e execute `npm run test:roles`.

---

# Gênesis Recruiting OS V14.1 + Chatbot Híbrido V13.4

## Objetivo desta entrega

Esta versão aplica somente os ajustes combinados, mantendo o desenho atual do sistema:

- PostgreSQL continua controlando etapas, status, aprovação e reprovação;
- a IA continua limitada à interpretação de respostas ambíguas dentro das opções permitidas;
- números, códigos de vaga, CEP, dúvidas frequentes, nomes e documentos usam regras determinísticas;
- nenhuma tabela nova foi criada;
- nenhuma credencial foi trocada;
- o workflow de entrevistas não foi alterado.

## Arquivos principais

### Chatbot

- `Genesis-IA-Chatbot-Hibrido-V13_4-Fluxo-Maleavel-Seguro-Credenciais-Preservadas.json`
- `Genesis-IA-Aplicar-V13_4-Fluxo-Maleavel-Seguro-Credencial-Preservada.json`
- `24_GENESIS_IA_V13_4_FLUXO_MALEAVEL_SEGURO.sql`

### Rollback

- `Genesis-IA-Rollback-V13_4-Para-V13_3-Credencial-Preservada.json`
- `24_ROLLBACK_GENESIS_IA_V13_4.sql`

### Painel

- `Genesis-Recruiting-OS-V14_1-Painel-EasyPanel-Completo.zip`
- `Genesis-Recruiting-OS-V14_1-Arquivos-Substituir.zip`

## Alterações do chatbot V13.4

1. Aceita respostas como `2 não`, `1 quero seguir` e `3 não tenho certeza` usando o primeiro número.
2. Código `VAGA-XXX` tem prioridade e atualiza a vaga antes da interpretação da mensagem.
3. Ao trocar de vaga, limpa somente respostas específicas da vaga anterior e reaplica a CTPS armazenada aos requisitos da nova vaga.
4. Valida o primeiro nome e impede frases como `tem horário 12x36` ou `sim pode` de serem gravadas como nome.
5. Responde dúvidas sobre salário, benefícios, horário, escala, endereço, requisitos e entrevista usando dados reais da vaga, sem perder a etapa atual.
6. Trata frases de frustração como `já respondi` e `não estou entendendo`, explicando a pendência atual e oferecendo atendimento humano.
7. Trata `não tenho CTPS` com orientação específica, sem repetir silenciosamente o mesmo pedido.
8. Confirma claramente o recebimento do currículo e explica que ele não substitui a CTPS.
9. Currículos com OCR legível, nenhum sinal de CTPS e pontuação de currículo a partir de 4 passam a ser aceitos com confiança média.
10. Áudio fica temporariamente desativado. Os nodes foram preservados, mas a entrada é direcionada para uma mensagem orientando o uso de texto.
11. Imagens continuam sem interpretação; o candidato é orientado a enviar CTPS ou currículo como PDF.
12. Confiança mínima da interpretação por IA alterada de 82% para 88%.
13. Mostra progresso simples em quatro passos.

## Alterações visuais do painel V14.1

### Visão geral

- remove o card `Críticos` da área do recrutador;
- mantém informações críticas nas áreas administrativas;
- coloca `Funil atual` e `Movimento do dia` no topo;
- transforma o antigo card do Google Calendar em uma agenda mensal compacta de entrevistas;
- mantém a guia completa `Agenda` sem alterações;
- torna `Ações pendentes` explícita, mostrando o que o recrutador precisa fazer;
- reorganiza os cards para caberem em uma única tela em monitores desktop comuns.

### Vagas

- status, empresa, local, período e busca ficam na mesma fileira no desktop;
- os KPIs passam a ser:
  - Total de vagas ativas;
  - Total de candidatos;
  - Candidatos novos;
  - Taxa de conversão.

### Candidatos e prospecção

- filtros detalhados foram movidos para os títulos das colunas, no estilo Excel;
- ao abrir `Vaga`, `Etapa`, `Documentos`, `Empresa`, `Contato`, `Local` ou `Qualidade`, aparece o seletor correspondente;
- colunas com filtro ativo recebem um indicador visual;
- os filtros continuam usando as mesmas APIs e os mesmos dados do painel.

# Implantação segura

## A. Painel V14.1

1. Faça backup do código atual do painel.
2. Substitua o projeto pelo conteúdo de `Genesis-Recruiting-OS-V14_1-Painel-EasyPanel-Completo.zip`.
3. Não execute `sql/genesis-estrutura.sql`. Ele é apenas a fotografia da estrutura real usada para compatibilidade.
4. Não altere as variáveis do EasyPanel.
5. Faça o redeploy.
6. Abra o painel em uma janela anônima ou force a atualização com `Ctrl + F5`.

O painel não depende da aplicação do SQL V13.4 para exibir as mudanças visuais.

## B. Chatbot V13.4

1. Importe o workflow `Genesis-IA-Chatbot-Hibrido-V13_4-Fluxo-Maleavel-Seguro-Credenciais-Preservadas.json`.
2. Confirme que as credenciais PostgreSQL, OpenAI, WAHA e Mistral aparecem vinculadas.
3. Mantenha o V13.4 inativo neste momento.
4. Importe `Genesis-IA-Aplicar-V13_4-Fluxo-Maleavel-Seguro-Credencial-Preservada.json`.
5. Desative o workflow V13.3 que usa o mesmo webhook.
6. Execute manualmente o aplicador V13.4 uma vez.
7. O resultado esperado é:

```json
{
  "status": "OK",
  "nome_valido_ativo": true,
  "duvidas_vaga_ativas": true,
  "progresso_ativo": true,
  "confianca_088_ativa": true,
  "processador_v13_4_ativo": true
}
```

8. Ative somente o workflow V13.4.
9. Não deixe V13.3 e V13.4 ativos ao mesmo tempo.

# Testes obrigatórios antes de liberar tráfego

Use um número de teste e uma vaga ativa.

1. Enviar `VAGA-XXX` e confirmar que aparece a vaga correta.
2. Responder `1 quero seguir` e confirmar avanço.
3. Na etapa de nome, enviar `tem horário 12x36`; o sistema deve responder à dúvida e continuar pedindo o nome.
4. Informar um primeiro nome válido.
5. Responder `2 não` em uma pergunta numérica; o sistema deve aceitar a opção 2.
6. Perguntar `qual é o horário?`; o sistema deve responder com a vaga real e voltar à pergunta pendente.
7. Escrever `não tenho CTPS`; deve aparecer orientação específica.
8. Enviar um currículo em PDF; deve confirmar recebimento e preservar a etapa.
9. Enviar uma imagem; deve orientar o envio por texto ou PDF.
10. Enviar um áudio; deve orientar a responder por texto, sem transcrição.
11. Em candidato já reprovado, enviar outro código de vaga; deve selecionar a nova vaga e reaplicar a CTPS, sem loop.
12. Agendar uma entrevista e confirmar que a guia Agenda continua funcionando.

# Rollback

## Chatbot

1. Desative o workflow V13.4.
2. Importe e execute `Genesis-IA-Rollback-V13_4-Para-V13_3-Credencial-Preservada.json`.
3. Confirme o resultado `status: OK`.
4. Reative o workflow V13.3 anterior.

O rollback restaura as funções exatamente como estavam no SQL estrutural fornecido e remove apenas os dois helpers criados pela V13.4.

## Painel

Restaure o ZIP do painel anterior no EasyPanel e faça novo deploy. A alteração visual não modifica dados do banco.

# Observações de segurança

- O pacote preserva referências de credenciais do n8n.
- Não publique os workflows em repositório público, porque exports do n8n podem conter configurações sensíveis.
- A senha do PostgreSQL exibida anteriormente na conversa deve ser trocada após a implantação e atualizada nos serviços que usam o banco.
