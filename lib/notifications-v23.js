'use strict';

class NotificationV23Error extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'NotificationV23Error';
    this.statusCode = statusCode;
  }
}

function registerNotificationsV23({ app, pool, requireLogin }) {
  const parseLimit = (value) => Math.min(Math.max(Number(value || 50), 10), 100);
  const userId = (req) => {
    const id = Number(req.user?.id || 0);
    if (!Number.isInteger(id) || id < 1) throw new NotificationV23Error('A Central de Notificações exige uma conta individual.', 409);
    return id;
  };

  app.get('/api/notificacoes', requireLogin, async (req, res, next) => {
    try {
      const id = userId(req);
      const limit = parseLimit(req.query.limite);
      const result = await pool.query(`
        SELECT n.id,n.tipo,n.candidato_id,n.entrevista_id,n.revisao_id,n.status,n.mensagem,n.created_at,
          COALESCE(c.nome,'Operação Gênesis') AS candidato_nome,
          COALESCE(v.titulo,c.vaga,'') AS vaga_nome,
          COALESCE(r.titulo,'') AS revisao_titulo,
          COALESCE(r.tipo,'') AS revisao_tipo,
          COALESCE(r.motivo,'') AS motivo,
          (l.notificacao_id IS NOT NULL) AS lida
        FROM notificacoes_operacionais n
        LEFT JOIN candidatos c ON c.id=n.candidato_id
        LEFT JOIN entrevistas e ON e.id=n.entrevista_id
        LEFT JOIN vagas v ON v.id=COALESCE(c.vaga_id,e.vaga_id)
        LEFT JOIN candidato_revisoes r ON r.id=n.revisao_id
        LEFT JOIN painel_notificacoes_lidas l ON l.notificacao_id=n.id AND l.usuario_id=$1
        WHERE n.destinatario_usuario_id=$1
          AND n.created_at >= NOW()-INTERVAL '90 days'
        ORDER BY (l.notificacao_id IS NULL) DESC,n.created_at DESC,n.id DESC
        LIMIT $2
      `, [id, limit]);
      const unread = result.rows.reduce((total, item) => total + (item.lida ? 0 : 1), 0);
      return res.json({ sucesso:true, notificacoes:result.rows, nao_lidas:unread });
    } catch (error) {
      if (error?.code === '42P01') {
        error.statusCode = 503;
        error.message = 'A Central de Notificações aguarda a migration V23.';
      }
      return next(error);
    }
  });

  app.post('/api/notificacoes/marcar-todas-lidas', requireLogin, async (req, res, next) => {
    try {
      const id = userId(req);
      const result = await pool.query(`
        INSERT INTO painel_notificacoes_lidas(notificacao_id,usuario_id,lida_em)
        SELECT n.id,$1,NOW()
        FROM notificacoes_operacionais n
        WHERE n.destinatario_usuario_id=$1
          AND n.created_at >= NOW()-INTERVAL '90 days'
        ON CONFLICT(notificacao_id,usuario_id) DO UPDATE SET lida_em=EXCLUDED.lida_em
        RETURNING notificacao_id
      `, [id]);
      return res.json({ sucesso:true, marcadas:result.rowCount });
    } catch (error) { return next(error); }
  });

  app.post('/api/notificacoes/:id/lida', requireLogin, async (req, res, next) => {
    try {
      const id = userId(req);
      const notificationId = Number(req.params.id);
      if (!Number.isInteger(notificationId) || notificationId < 1) throw new NotificationV23Error('Notificação inválida.');
      const result = await pool.query(`
        INSERT INTO painel_notificacoes_lidas(notificacao_id,usuario_id,lida_em)
        SELECT n.id,$1,NOW()
        FROM notificacoes_operacionais n
        WHERE n.id=$2 AND n.destinatario_usuario_id=$1
        ON CONFLICT(notificacao_id,usuario_id) DO UPDATE SET lida_em=EXCLUDED.lida_em
        RETURNING notificacao_id,lida_em
      `, [id, notificationId]);
      if (!result.rowCount) throw new NotificationV23Error('Notificação não encontrada para este usuário.', 404);
      return res.json({ sucesso:true, notificacao:result.rows[0] });
    } catch (error) { return next(error); }
  });
}

module.exports = { registerNotificationsV23, NotificationV23Error };
