# Genesis Recruiting OS V13.0.0

## Triagem conversacional híbrida

- perguntas configuráveis e versionadas por vaga;
- critérios eliminatórios restritos a respostas objetivas;
- perguntas classificatórias com pontuação;
- respostas abertas com resumo factual para análise humana;
- interpretação de linguagem natural limitada ao contexto exibido;
- confiança mínima de 82% para aceitar interpretação da IA;
- três tentativas antes do encaminhamento humano;
- proteção contra mensagens duplicadas e contra colisão entre sessões.

## Áudio e documentos

- download e validação de áudio recebido pelo WAHA;
- limite de 25 MB;
- transcrição em português pela credencial OpenAI já existente;
- texto transcrito submetido às mesmas regras determinísticas;
- origem da resposta identificada no perfil do candidato;
- CTPS e currículo mantidos exclusivamente em PDF;
- imagens, fotos e capturas de tela não são interpretadas.

## Demonstrações comerciais

- nova área administrativa **Demonstrações**;
- link seguro e substituível por cliente;
- guia público responsivo para conexão por QR Code;
- sessão WAHA individual com webhook próprio;
- compatibilidade com as APIs atual e legada de criação de sessão;
- prazo padrão de sete dias;
- expiração, logout e remoção automática da sessão;
- limite configurável de demonstrações simultâneas;
- contatos, mensagens e respostas em tabelas isoladas;
- resultados da simulação visíveis no painel sem contaminar candidatos reais.

## Painel e usabilidade

- construtor visual com modelo inicial de três perguntas;
- validações claras antes de salvar;
- perguntas copiadas ao duplicar uma vaga;
- versão da triagem congelada para candidaturas iniciadas;
- progresso, pontuação, origem e confiança exibidos no perfil;
- guia do cliente com instruções Android e iPhone;
- estados de conexão, QR expirado, reconexão e encerramento.

## Segurança e compatibilidade

- nenhuma chave WAHA enviada ao cliente;
- somente hash do token da demonstração armazenado e hashes internos removidos das respostas da API;
- workflow V13 importado inativo para troca controlada;
- caminho de webhook e referências das credenciais existentes preservados;
- workflow V1 original incluído para rollback;
- migração aditiva, transacional e idempotente;
- correções V12 de moderação de grupos e tipagem PostgreSQL mantidas.

## Verificações executadas

- sintaxe de todos os arquivos JavaScript;
- IDs únicos e elementos obrigatórios nas duas interfaces;
- grafo e conexões dos 62 nós do workflow;
- preservação do webhook e das credenciais referenciadas;
- migração executada duas vezes no PostgreSQL embutido;
- respostas objetiva, classificatória, aberta, áudio, eliminação e encaminhamento humano;
- isolamento do mesmo telefone entre sessão oficial e demo;
- regressão da moderação de grupos e vagas;
- auditoria de dependências sem vulnerabilidades conhecidas.
