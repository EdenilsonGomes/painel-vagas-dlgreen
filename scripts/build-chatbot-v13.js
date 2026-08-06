'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const inputFile = path.join(root, 'n8n', 'Genesis-IA-Chatbot-Estatico-V1-Credenciais-Preservadas.json');
const outputFile = path.join(root, 'n8n', 'Genesis-IA-Chatbot-Hibrido-V13-Credenciais-Preservadas.json');
const workflow = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

const postgresCredential = workflow.nodes.find((node) => node.credentials?.postgres)?.credentials;
const openAiCredential = workflow.nodes.find((node) => node.credentials?.openAiApi)?.credentials;
const downloadPdfNode = workflow.nodes.find((node) => node.name === 'Baixar PDF do WAHA');

if (!postgresCredential?.postgres || !openAiCredential?.openAiApi || !downloadPdfNode) {
  throw new Error('As credenciais preservadas do workflow V1 não foram encontradas.');
}

function node(name) {
  const found = workflow.nodes.find((item) => item.name === name);
  if (!found) throw new Error(`Node não encontrado: ${name}`);
  return found;
}

function addNode(definition) {
  if (workflow.nodes.some((item) => item.name === definition.name)) throw new Error(`Node duplicado: ${definition.name}`);
  workflow.nodes.push({ id: crypto.randomUUID(), ...definition });
}

function renameNode(from, to) {
  const target = node(from);
  target.name = to;
  if (workflow.connections[from]) {
    workflow.connections[to] = workflow.connections[from];
    delete workflow.connections[from];
  }
  for (const connection of Object.values(workflow.connections)) {
    for (const outputs of Object.values(connection)) {
      for (const branch of outputs) {
        for (const item of branch || []) if (item.node === from) item.node = to;
      }
    }
  }
}

function ensureMain(name, outputs = 1) {
  workflow.connections[name] ||= {};
  workflow.connections[name].main ||= [];
  while (workflow.connections[name].main.length < outputs) workflow.connections[name].main.push([]);
}

function setMain(name, branches) {
  workflow.connections[name] = { ...(workflow.connections[name] || {}), main: branches };
}

function link(target) {
  return { node: target, type: 'main', index: 0 };
}

workflow.name = 'Genesis IA - Chatbot Híbrido V13 - Áudio, perguntas por vaga e demos - Credenciais Preservadas';
workflow.active = false;

const normalizer = node('Normalizar entrada');
normalizer.parameters.jsCode = `
const root = $input.first().json ?? {};
const body = root.body && typeof root.body === 'object' ? root.body : root;
const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
const manual = body.manual_force_reply === true;

function normalizePhone(value) {
  const original = String(value ?? '').trim().replace(/:\\d+(?=@)/, '');
  if (!original || /@lid$/i.test(original) || /@g\\.us$/i.test(original)) return '';
  let digits = original.replace(/@.+$/, '').replace(/\\D/g, '');
  if (digits.length === 10 || digits.length === 11) digits = \`55\${digits}\`;
  if (!/^55\\d{10,11}$/.test(digits)) return '';
  return digits;
}

const candidates = [payload?._data?.Info?.SenderAlt, payload?.from, payload?._data?.Info?.Sender, payload?.participant];
const telefone = candidates.map(normalizePhone).find(Boolean) || '';
const rawFrom = String(payload?.from ?? payload?._data?.Info?.Chat ?? '');
const fromMe = payload?.fromMe === true || payload?._data?.Info?.IsFromMe === true;
const isGroup = /@g\\.us$/i.test(rawFrom);
const hasMedia = payload?.hasMedia === true || Boolean(payload?.media?.url);
const mime = String(payload?.media?.mimetype ?? payload?.media?.mimeType ?? '').toLowerCase();
const filename = String(payload?.media?.filename ?? payload?.media?.fileName ?? '');
const text = String(payload?.body ?? '').trim();
const session = String(body.session ?? payload?.session ?? 'whats_junior');
const demoSession = /^demo-/i.test(session);
const audioByMime = /^audio\\//i.test(mime);
const audioByName = /\\.(ogg|opus|mp3|m4a|mp4|mpeg|mpga|wav|webm|flac)$/i.test(filename);
let inputType = 'VAZIA';
if (hasMedia && (audioByMime || audioByName)) inputType = 'AUDIO';
else if (hasMedia && !demoSession && (mime === 'application/pdf' || filename.toLowerCase().endsWith('.pdf'))) inputType = 'PDF';
else if (hasMedia) inputType = 'MIDIA_NAO_SUPORTADA';
else if (text) inputType = 'TEXTO';

return [{ json: {
  entrada_valida: manual || (!fromMe && !isGroup && Boolean(telefone)),
  manual,
  telefone,
  mensagem: text,
  mensagem_id: String(payload?.id ?? payload?._data?.Info?.ID ?? body.manual_message_id ?? ''),
  session,
  origem: inputType === 'AUDIO' ? 'AUDIO' : 'TEXTO',
  tipo_entrada: manual ? 'MANUAL' : inputType,
  mime_type: mime,
  nome_arquivo: filename || (inputType === 'AUDIO' ? 'audio.ogg' : 'documento.pdf'),
  media_url: String(payload?.media?.url ?? '').replace('http://localhost:3000', 'https://projeto-waha.d7lmap.easypanel.host'),
  manual_action: String(body.manual_action ?? '').trim().toUpperCase(),
  manual_candidate_id: Number(body.manual_candidate_id ?? 0),
  manual_review_id: Number(body.manual_review_id ?? 0) || null,
  manual_rescue_id: Number(body.manual_rescue_id ?? 0) || null,
  manual_message: String(body.manual_message ?? '').trim(),
  manual_origin: String(body.manual_origin ?? ''),
  payload_bruto: payload
}}];
`;

renameNode('Processar etapa estática', 'Processar conversa V13');
const processNode = node('Processar conversa V13');
processNode.position = [4560, 520];
processNode.parameters.query = 'SELECT * FROM genesis_chatbot_v13_processar_texto($1,$2,$3,$4,$5,$6::JSONB);';
processNode.parameters.options.queryReplacement = `={{ [
  String($json.telefone || $('Preparar interpretação V13').first().json.telefone || ''),
  String($json.mensagem || $('Preparar interpretação V13').first().json.mensagem || ''),
  String($('Consumir última mensagem').first().json.mensagem_id || ''),
  String($json.session || $('Preparar interpretação V13').first().json.session || 'whats_junior'),
  String($json.origem || $('Preparar interpretação V13').first().json.origem || 'TEXTO'),
  JSON.stringify($json.interpretacao || {})
] }}`;

const mediaNode = node('Responder mídia não suportada');
mediaNode.position = [1920, 760];
mediaNode.parameters.query = 'SELECT * FROM genesis_chatbot_v13_midia_nao_suportada($1,$2,$3,$4);';

renameNode('Registrar buffer determinístico', 'Registrar buffer V13');
const registerBuffer = node('Registrar buffer V13');
registerBuffer.position = [2640, 520];
registerBuffer.parameters.query = 'SELECT * FROM genesis_chatbot_v13_buffer_registrar($1,$2,$3,$4,$5);';
registerBuffer.parameters.options.queryReplacement = `={{ [ $json.telefone, $json.mensagem, $json.mensagem_id, $json.session, $json.origem || 'TEXTO' ] }}`;

const waitNode = node('Aguardar mensagens fragmentadas');
waitNode.position = [2880, 520];
const consumeNode = node('Consumir última mensagem');
consumeNode.position = [3120, 520];
consumeNode.parameters.query = 'SELECT * FROM genesis_chatbot_v13_buffer_consumir($1,$2,$3);';
consumeNode.parameters.options.queryReplacement = `={{ [ $json.telefone, $json.session, $json.buffer_token ] }}`;
node('É a mensagem mais recente?').position = [3360, 520];

node('É texto?').position = [1440, 660];

addNode({
  name: 'É áudio?', type: 'n8n-nodes-base.if', typeVersion: 2.3, position: [1200, 520],
  parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 }, conditions: [{ id: crypto.randomUUID(), leftValue: `={{ $json.tipo_entrada === 'AUDIO' }}`, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} },
});

addNode({
  name: 'Baixar áudio do WAHA', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [1440, 460], onError: 'continueRegularOutput',
  parameters: {
    url: `={{ $('Normalizar entrada').first().json.media_url }}`,
    sendHeaders: true,
    headerParameters: downloadPdfNode.parameters.headerParameters,
    options: { response: { response: { responseFormat: 'file', outputPropertyName: 'audio' } } },
  },
});

addNode({
  name: 'Validar áudio recebido', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1680, 460],
  parameters: { jsCode: `
const item=$input.first();
const entrada=$('Normalizar entrada').first().json??{};
const arquivo=item.binary?.audio;
if(!arquivo) return [{json:{...entrada,tipo_entrada:'AUDIO_INVALIDO',audio_valido:false,motivo_audio:'download'}}];
let tamanho=0;
try { tamanho=(await this.helpers.getBinaryDataBuffer(0,'audio')).length; } catch {}
const mime=String(arquivo.mimeType??entrada.mime_type??'').toLowerCase();
const permitido=/^(audio\\/|video\\/(mp4|webm))/.test(mime)||/\\.(ogg|opus|mp3|m4a|mp4|mpeg|mpga|wav|webm|flac)$/i.test(String(arquivo.fileName??entrada.nome_arquivo??''));
const valido=permitido&&tamanho>0&&tamanho<=25*1024*1024;
return [{json:{...entrada,tipo_entrada:valido?'AUDIO':'AUDIO_INVALIDO',origem:'AUDIO',audio_valido:valido,tamanho_audio:tamanho,motivo_audio:valido?'':tamanho>25*1024*1024?'arquivo_maior_25mb':'formato'},binary:item.binary}];
` },
});

addNode({
  name: 'Áudio válido?', type: 'n8n-nodes-base.if', typeVersion: 2.3, position: [1920, 460],
  parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 }, conditions: [{ id: crypto.randomUUID(), leftValue: `={{ $json.audio_valido === true }}`, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} },
});

addNode({
  name: 'Transcrever áudio em português', type: '@n8n/n8n-nodes-langchain.openAi', typeVersion: 1.8, position: [2160, 420], onError: 'continueRegularOutput',
  parameters: { resource: 'audio', operation: 'transcribe', binaryPropertyName: 'audio', options: { language: 'pt', temperature: 0 } },
  credentials: JSON.parse(JSON.stringify(openAiCredential)),
});

addNode({
  name: 'Normalizar transcrição', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2400, 420],
  parameters: { jsCode: `
const d=$input.first().json??{};
const entrada=$('Normalizar entrada').first().json??{};
const mensagem=String(d.text??d.transcript??d.output?.text??'').trim();
return [{json:{...entrada,mensagem,origem:'AUDIO',tipo_entrada:mensagem?'TEXTO':'AUDIO_INVALIDO',transcricao_valida:Boolean(mensagem)}}];
` },
});

addNode({
  name: 'Transcrição válida?', type: 'n8n-nodes-base.if', typeVersion: 2.3, position: [2640, 400],
  parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 }, conditions: [{ id: crypto.randomUUID(), leftValue: `={{ $json.transcricao_valida === true }}`, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} },
});

addNode({
  name: 'Preparar interpretação V13', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [3600, 520],
  parameters: { operation: 'executeQuery', query: 'SELECT * FROM genesis_chatbot_v13_preparar_interpretacao($1,$2,$3,$4);', options: { queryReplacement: `={{ [ $json.telefone, $json.mensagem, $json.session, $json.origem || 'TEXTO' ] }}` } },
  credentials: JSON.parse(JSON.stringify(postgresCredential)),
});

addNode({
  name: 'Precisa interpretação da IA?', type: 'n8n-nodes-base.if', typeVersion: 2.3, position: [3840, 520],
  parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 }, conditions: [{ id: crypto.randomUUID(), leftValue: `={{ $json.precisa_ia === true }}`, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} },
});

addNode({
  name: 'Interpretar resposta dentro das opções', type: '@n8n/n8n-nodes-langchain.informationExtractor', typeVersion: 1.2, position: [4080, 440], onError: 'continueRegularOutput',
  parameters: {
    text: `={{ 'CONTEXTO CONTROLADO:\n' + String($json.contexto || '') + '\n\nMENSAGEM DO CANDIDATO:\n' + String($json.mensagem || '') }}`,
    schemaType: 'manual',
    inputSchema: JSON.stringify({ type: 'object', properties: { intent: { type: 'string' }, resposta_canonica: { type: 'string' }, confidence: { type: 'number' }, resumo: { type: 'string' } }, required: ['intent', 'resposta_canonica', 'confidence', 'resumo'], additionalProperties: false }, null, 2),
    options: { systemPromptTemplate: `Você interpreta uma mensagem de candidato apenas dentro do CONTEXTO CONTROLADO recebido.\n\nRegras obrigatórias:\n- Nunca aprove, reprove, altere etapa ou crie regra.\n- Não invente dados e não complete respostas ausentes.\n- resposta_canonica deve conter somente a opção/código permitido pelo contexto; se não houver segurança, use string vazia.\n- confidence deve estar entre 0 e 1. Use menos de 0.82 quando houver ambiguidade.\n- intent deve ser OPCAO, RESPOSTA_ABERTA, PEDIR_HUMANO ou INDEFINIDO.\n- resumo deve ter no máximo 300 caracteres, ser factual e não conter julgamento. Para perguntas objetivas, pode ser vazio.\n- Um pedido explícito por humano deve usar intent PEDIR_HUMANO e resposta_canonica 7.\nRetorne somente o JSON do schema.` },
  },
});

addNode({
  name: 'Normalizar interpretação segura', type: 'n8n-nodes-base.code', typeVersion: 2, position: [4320, 520],
  parameters: { jsCode: `
const entrada=$input.first().json??{};
const prep=$('Preparar interpretação V13').first().json??{};
const out=entrada.output&&typeof entrada.output==='object'?entrada.output:{};
const confidence=Math.max(0,Math.min(1,Number(out.confidence??0)||0));
const canonical=confidence>=0.82?String(out.resposta_canonica??'').trim().slice(0,200):'';
const intent=['OPCAO','RESPOSTA_ABERTA','PEDIR_HUMANO','INDEFINIDO'].includes(String(out.intent??'').toUpperCase())?String(out.intent).toUpperCase():'INDEFINIDO';
const summary=confidence>=0.82?String(out.resumo??'').trim().slice(0,300):'';
return [{json:{...prep,mensagem_id:String($('Consumir última mensagem').first().json.mensagem_id??''),interpretacao:{intent,resposta_canonica:canonical,confidence,resumo:summary}}}];
` },
});

const model = node('Modelo OpenAI somente para documentos');
renameNode('Modelo OpenAI somente para documentos', 'Modelo OpenAI controlado');
node('Modelo OpenAI controlado').position = [4080, -400];

const note = node('Nota - Arquitetura estática V1');
note.name = 'Nota - Arquitetura híbrida V13';
note.parameters.content = `## Chatbot Híbrido V13 — controle primeiro\nA máquina de estados e todas as decisões continuam no PostgreSQL. A IA só interpreta linguagem ambígua dentro das opções permitidas e resume respostas abertas. Confiança abaixo de 82% não avança.\n\n**Áudio:** transcrito em português e submetido às mesmas regras do texto.\n**Documentos:** CTPS e currículo continuam aceitos somente em PDF. Imagens não são interpretadas.\n**Demos:** sessões demo-* usam tabelas isoladas e nunca entram no funil real.`;
note.parameters.height = 310;
note.parameters.width = 540;
if (workflow.connections['Nota - Arquitetura estática V1']) {
  workflow.connections['Nota - Arquitetura híbrida V13'] = workflow.connections['Nota - Arquitetura estática V1'];
  delete workflow.connections['Nota - Arquitetura estática V1'];
}

setMain('É PDF?', [[link('Baixar PDF do WAHA')], [link('É áudio?')]]);
setMain('É áudio?', [[link('Baixar áudio do WAHA')], [link('É texto?')]]);
setMain('É texto?', [[link('Registrar buffer V13')], [link('Responder mídia não suportada')]]);
setMain('Baixar áudio do WAHA', [[link('Validar áudio recebido')]]);
setMain('Validar áudio recebido', [[link('Áudio válido?')]]);
setMain('Áudio válido?', [[link('Transcrever áudio em português')], [link('Responder mídia não suportada')]]);
setMain('Transcrever áudio em português', [[link('Normalizar transcrição')]]);
setMain('Normalizar transcrição', [[link('Transcrição válida?')]]);
setMain('Transcrição válida?', [[link('Registrar buffer V13')], [link('Responder mídia não suportada')]]);
setMain('Registrar buffer V13', [[link('Aguardar mensagens fragmentadas')]]);
setMain('Aguardar mensagens fragmentadas', [[link('Consumir última mensagem')]]);
setMain('Consumir última mensagem', [[link('É a mensagem mais recente?')]]);
setMain('É a mensagem mais recente?', [[link('Preparar interpretação V13')], []]);
setMain('Preparar interpretação V13', [[link('Precisa interpretação da IA?')]]);
setMain('Precisa interpretação da IA?', [[link('Interpretar resposta dentro das opções')], [link('Normalizar interpretação segura')]]);
setMain('Interpretar resposta dentro das opções', [[link('Normalizar interpretação segura')]]);
setMain('Normalizar interpretação segura', [[link('Processar conversa V13')]]);
ensureMain('Processar conversa V13');

workflow.connections['Modelo OpenAI controlado'] ||= {};
workflow.connections['Modelo OpenAI controlado'].ai_languageModel ||= [[]];
workflow.connections['Modelo OpenAI controlado'].ai_languageModel[0].push({ node: 'Interpretar resposta dentro das opções', type: 'ai_languageModel', index: 0 });

for (const [source, connection] of Object.entries(workflow.connections)) {
  for (const outputs of Object.values(connection)) {
    for (const branch of outputs) {
      for (const item of branch || []) {
        if (!workflow.nodes.some((candidate) => candidate.name === item.node)) {
          throw new Error(`Conexão inválida: ${source} -> ${item.node}`);
        }
      }
    }
  }
}

const credentialSnapshot = workflow.nodes.flatMap((item) => Object.values(item.credentials || {}).map((credential) => credential.id)).filter(Boolean);
for (const requiredId of ['tZw9XBnM0uOBRBeF', 'p3G9VOeOuySczl72', 'gGxdW1e4d63T5T9U']) {
  if (!credentialSnapshot.includes(requiredId)) throw new Error(`A credencial ${requiredId} deixou de ser referenciada.`);
}

fs.writeFileSync(outputFile, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(`Workflow V13 criado: ${path.basename(outputFile)} (${workflow.nodes.length} nodes).`);
