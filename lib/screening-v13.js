'use strict';

function registerScreeningV13({ app, pool, z, currentUserName }) {
  const booleanValue = z.union([z.boolean(), z.string(), z.number(), z.null(), z.undefined()])
    .transform((value) => value === true || value === 1 || value === '1' || value === 'true' || value === 'on');

  const questionSchema = z.object({
    texto: z.string().trim().min(5, 'Escreva uma pergunta com pelo menos 5 caracteres.').max(500),
    tipo: z.enum(['SIM_NAO', 'UNICA_ESCOLHA', 'MULTIPLA_ESCOLHA', 'NUMERO', 'TEXTO_CURTO', 'TEXTO_LONGO']),
    finalidade: z.enum(['ELIMINATORIA', 'CLASSIFICATORIA', 'ABERTA']).default('CLASSIFICATORIA'),
    obrigatoria: booleanValue.default(true),
    opcoes: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
    regra_operador: z.enum(['SEMPRE', 'IGUAL', 'DIFERENTE', 'MAIOR_IGUAL', 'MENOR_IGUAL', 'CONTEM_QUALQUER', 'CONTEM_TODOS']).default('SEMPRE'),
    regra_valor: z.unknown().nullable().optional(),
    pontos: z.coerce.number().int().min(0).max(1000).default(0),
    mensagem_nao_atende: z.union([z.string().trim().max(600), z.null(), z.undefined()])
      .transform((value) => value || null),
  }).superRefine((question, ctx) => {
    const isText = ['TEXTO_CURTO', 'TEXTO_LONGO'].includes(question.tipo);
    const isChoice = ['UNICA_ESCOLHA', 'MULTIPLA_ESCOLHA'].includes(question.tipo);
    if (question.finalidade === 'ELIMINATORIA' && isText) {
      ctx.addIssue({ code: 'custom', path: ['finalidade'], message: 'Perguntas abertas não podem eliminar automaticamente.' });
    }
    if (isChoice && question.opcoes.length < 2) {
      ctx.addIssue({ code: 'custom', path: ['opcoes'], message: 'Adicione pelo menos duas opções.' });
    }
    if (question.finalidade === 'ELIMINATORIA' && (question.regra_valor === null || question.regra_valor === undefined || question.regra_valor === '')) {
      ctx.addIssue({ code: 'custom', path: ['regra_valor'], message: 'Defina a resposta necessária para esta pergunta eliminatória.' });
    }
  });

  const payloadSchema = z.object({ perguntas: z.array(questionSchema).max(30, 'Uma vaga pode ter até 30 perguntas.').default([]) });

  function validationError(res, error) {
    return res.status(400).json({
      sucesso: false,
      erro: 'Revise as perguntas da triagem.',
      detalhes: error.issues.map((issue) => ({ campo: issue.path.join('.') || 'perguntas', mensagem: issue.message })),
    });
  }

  function normalizeQuestion(question, order) {
    const isText = ['TEXTO_CURTO', 'TEXTO_LONGO'].includes(question.tipo);
    const options = question.tipo === 'SIM_NAO' ? ['Sim', 'Não'] : question.opcoes;
    const purpose = isText ? 'ABERTA' : question.finalidade;
    return {
      ...question,
      ordem: order,
      codigo: `Q${String(order).padStart(3, '0')}`,
      finalidade: purpose,
      regra_operador: isText ? 'SEMPRE' : question.regra_operador,
      regra_valor: isText ? null : question.regra_valor,
      opcoes: options,
      pontos: purpose === 'CLASSIFICATORIA' ? question.pontos : 0,
    };
  }

  app.get('/api/vagas/:id/perguntas', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ sucesso: false, erro: 'Vaga inválida.' });
      const result = await pool.query(`
        SELECT
          tv.id AS versao_id,
          tv.numero AS versao,
          tv.created_at AS versao_criada_em,
          p.id,
          p.codigo,
          p.ordem,
          p.texto,
          p.tipo,
          p.finalidade,
          p.obrigatoria,
          p.opcoes,
          p.regra_operador,
          p.regra_valor,
          p.pontos,
          p.mensagem_nao_atende
        FROM vaga_triagem_versoes tv
        LEFT JOIN vaga_perguntas p ON p.versao_id=tv.id AND p.ativa IS TRUE
        WHERE tv.vaga_id=$1 AND tv.status='ATIVA'
        ORDER BY p.ordem NULLS LAST
      `, [id]);
      const first = result.rows[0] || null;
      return res.json({
        sucesso: true,
        versao: first?.versao || null,
        versao_id: first?.versao_id || null,
        perguntas: result.rows.filter((item) => item.id).map((item) => ({
          id: item.id,
          codigo: item.codigo,
          ordem: item.ordem,
          texto: item.texto,
          tipo: item.tipo,
          finalidade: item.finalidade,
          obrigatoria: item.obrigatoria,
          opcoes: item.opcoes || [],
          regra_operador: item.regra_operador,
          regra_valor: item.regra_valor,
          pontos: item.pontos,
          mensagem_nao_atende: item.mensagem_nao_atende,
        })),
      });
    } catch (error) { next(error); }
  });

  app.put('/api/vagas/:id/perguntas', async (req, res, next) => {
    const client = await pool.connect();
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ sucesso: false, erro: 'Vaga inválida.' });
      const parsed = payloadSchema.safeParse(req.body || {});
      if (!parsed.success) return validationError(res, parsed.error);
      const questions = parsed.data.perguntas.map((question, index) => normalizeQuestion(question, index + 1));
      await client.query('BEGIN');
      const vacancy = await client.query('SELECT id FROM vagas WHERE id=$1 FOR UPDATE', [id]);
      if (!vacancy.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ sucesso: false, erro: 'Vaga não encontrada.' });
      }
      const nextVersion = await client.query('SELECT COALESCE(MAX(numero),0)+1 AS numero FROM vaga_triagem_versoes WHERE vaga_id=$1', [id]);
      await client.query(`UPDATE vaga_triagem_versoes SET status='ARQUIVADA',arquivada_at=NOW() WHERE vaga_id=$1 AND status='ATIVA'`, [id]);
      const version = await client.query(`
        INSERT INTO vaga_triagem_versoes(vaga_id,numero,status,criado_por,criado_por_nome)
        VALUES($1,$2,'ATIVA',$3,$4)
        RETURNING id,numero
      `, [id, Number(nextVersion.rows[0]?.numero || 1), req.user?.id || null, currentUserName(req)]);
      for (const question of questions) {
        await client.query(`
          INSERT INTO vaga_perguntas(
            vaga_id,versao_id,codigo,ordem,texto,tipo,finalidade,obrigatoria,opcoes,
            regra_operador,regra_valor,pontos,mensagem_nao_atende,ativa
          ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::JSONB,$10,$11::JSONB,$12,$13,TRUE)
        `, [
          id, version.rows[0].id, question.codigo, question.ordem, question.texto,
          question.tipo, question.finalidade, question.obrigatoria, JSON.stringify(question.opcoes),
          question.regra_operador, question.regra_valor === null || question.regra_valor === undefined ? null : JSON.stringify(question.regra_valor),
          question.pontos, question.mensagem_nao_atende,
        ]);
      }
      await client.query(`
        INSERT INTO app_auditoria(usuario_id,usuario_nome,acao,entidade,entidade_id,detalhes)
        VALUES($1,$2,'PERGUNTAS_VAGA_ATUALIZADAS','vagas',$3,$4::JSONB)
      `, [req.user?.id || null, currentUserName(req), String(id), JSON.stringify({ versao: version.rows[0].numero, quantidade: questions.length })]);
      await client.query('COMMIT');
      return res.json({
        sucesso: true,
        mensagem: questions.length
          ? `${questions.length} pergunta(s) salvas na versão ${version.rows[0].numero}.`
          : 'As perguntas desta vaga foram desativadas para novas candidaturas.',
        versao: version.rows[0].numero,
        quantidade: questions.length,
      });
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      next(error);
    } finally { client.release(); }
  });

  app.get('/api/candidatos/:id/triagem', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ sucesso: false, erro: 'Candidato inválido.' });
      const result = await pool.query(`
        SELECT
          t.id AS triagem_id,t.status AS triagem_status,t.score,t.iniciado_at,t.concluido_at,
          tv.numero AS versao,q.id AS pergunta_id,q.ordem,q.texto,q.tipo,q.finalidade,q.obrigatoria,
          r.resposta_bruta,r.resposta_normalizada,r.resumo_ia,r.origem,r.confianca,r.atendida,r.pontos,r.precisa_revisao,r.created_at AS respondida_em
        FROM candidato_triagens t
        JOIN vaga_triagem_versoes tv ON tv.id=t.versao_id
        JOIN vaga_perguntas q ON q.versao_id=t.versao_id AND q.ativa IS TRUE
        LEFT JOIN candidato_respostas_triagem r ON r.triagem_id=t.id AND r.pergunta_id=q.id
        WHERE t.candidato_id=$1
          AND t.id=(SELECT id FROM candidato_triagens WHERE candidato_id=$1 ORDER BY iniciado_at DESC,id DESC LIMIT 1)
        ORDER BY q.ordem
      `, [id]);
      if (!result.rowCount) return res.json({ sucesso: true, triagem: null, respostas: [] });
      const first = result.rows[0];
      return res.json({
        sucesso: true,
        triagem: {
          id: first.triagem_id,
          status: first.triagem_status,
          score: first.score,
          versao: first.versao,
          iniciado_at: first.iniciado_at,
          concluido_at: first.concluido_at,
        },
        respostas: result.rows.map((item) => ({
          pergunta_id: item.pergunta_id,
          ordem: item.ordem,
          pergunta: item.texto,
          tipo: item.tipo,
          finalidade: item.finalidade,
          obrigatoria: item.obrigatoria,
          respondida: item.respondida_em !== null,
          resposta_bruta: item.resposta_bruta,
          resposta_normalizada: item.resposta_normalizada,
          resumo_ia: item.resumo_ia,
          origem: item.origem,
          confianca: item.confianca,
          atendida: item.atendida,
          pontos: item.pontos,
          precisa_revisao: item.precisa_revisao,
          respondida_em: item.respondida_em,
        })),
      });
    } catch (error) { next(error); }
  });
}

module.exports = { registerScreeningV13 };
