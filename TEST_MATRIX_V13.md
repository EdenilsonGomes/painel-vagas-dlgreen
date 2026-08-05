# Matriz de homologação V13

| Área | Cenário | Resultado esperado |
|---|---|---|
| Migração | Executar `npm run migrate:panel` duas vezes | Duas execuções concluídas sem perda ou duplicação |
| Perguntas | Criar, editar e duplicar uma vaga | Nova versão ativa e cópia independente |
| Objetiva | Responder `sim, consigo` | Resposta normalizada como Sim |
| Ambiguidade | Responder `não entendi` | Nova tentativa; nunca interpretar automaticamente como Não |
| Número | Responder com unidade em linguagem natural | IA converte somente dentro do contexto e com confiança mínima |
| Aberta | Enviar relato profissional | Texto original preservado e resumo factual exibido |
| Áudio | Enviar voz menor que 25 MB | Transcrição em português e mesmas regras do texto |
| Áudio inválido | Arquivo vazio, grande ou formato estranho | Orientação clara, sem travar a conversa |
| Documento | Enviar CTPS ou currículo em PDF | Fluxo documental existente preservado |
| Imagem | Enviar foto ou captura | Rejeição orientativa; nenhuma interpretação da imagem |
| Repetição | Reenviar o mesmo ID de mensagem | Processamento ignorado sem resposta duplicada |
| Humano | Pedir para falar com uma pessoa | Candidatura preservada e revisão criada |
| Limite | Falhar três vezes na mesma pergunta | Pausa segura e encaminhamento humano |
| Demo | Criar link e ler QR | Sessão individual passa a Automação ligada |
| Isolamento | Usar telefone também existente no funil real | Registro somente nas tabelas da demo |
| Expiração | Atingir sete dias ou encerrar manualmente | Logout e remoção da sessão WAHA |
| Segurança | Inspecionar respostas das APIs públicas | Nenhuma chave WAHA ou hash interno do token |
| Portal | Aprovar grupo e vaga recebida | Operação concluída sem erro PostgreSQL 42P08 |
| Rollback | Desativar V13 e reativar V1 | Atendimento antigo volta sem reverter o banco |
