// Node Code do n8n: "Extrair código da vaga"
// Execute em modo: Run Once for Each Item
//
// Ajuste a primeira linha caso o texto da mensagem esteja em outro campo.
// O código tenta alguns caminhos comuns usados por WAHA/WhatsApp.

const texto =
  $json.mensagem ??
  $json.texto ??
  $json.body?.payload?.body ??
  $json.body?.payload?.text ??
  $json.body?.body ??
  $json.body?.text ??
  '';

const mensagem = String(texto).trim();

// Reconhece: VAGA-001, VAGA 001, VAGA001 e vaga-001.
const encontrou = mensagem.toUpperCase().match(/\bVAGA[\s-]?(\d{1,10})\b/);

return {
  ...$json,
  mensagem_recebida: mensagem,
  codigo_vaga_informado: encontrou ? `VAGA-${encontrou[1]}` : null,
  informou_codigo_vaga: Boolean(encontrou),
};
