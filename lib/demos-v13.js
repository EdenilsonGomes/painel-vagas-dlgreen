'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

class WahaRequestError extends Error {
  constructor(message, status = 502, details = null) {
    super(message);
    this.name = 'WahaRequestError';
    this.status = status;
    this.details = details;
  }
}

function registerDemosV13({
  app,
  pool,
  z,
  requireLogin,
  requireAdmin,
  currentUserName,
  publicDir,
  wahaBaseUrl,
  wahaApiKey,
  chatbotWebhookUrl,
  panelBaseUrl,
  trialDays = 7,
  maxActive = 5,
  expiryCheckMinutes = 15,
}) {
  const baseUrl = String(wahaBaseUrl || '').trim().replace(/\/$/, '');
  const apiKey = String(wahaApiKey || '').trim();
  const webhookUrl = String(chatbotWebhookUrl || '').trim();
  const configuredPanelUrl = String(panelBaseUrl || '').trim().replace(/\/$/, '');
  const demoDays = Math.min(Math.max(Number(trialDays || 7), 1), 30);
  const demoLimit = Math.min(Math.max(Number(maxActive || 5), 1), 100);
  const checkMinutes = Math.min(Math.max(Number(expiryCheckMinutes || 15), 1), 120);

  const nullableText = (max) => z.union([z.string().trim().max(max), z.null(), z.undefined()])
    .transform((value) => value || null);
  const email = z.union([z.string().trim().email('Informe um e-mail válido.').max(254), z.literal(''), z.null(), z.undefined()])
    .transform((value) => value || null);
  const createSchema = z.object({
    empresa_nome: z.string().trim().min(2, 'Informe o nome da empresa.').max(180),
    contato_nome: z.string().trim().min(2, 'Informe o contato responsável.').max(150),
    contato_email: email,
    contato_whatsapp: nullableText(30),
    vaga_origem_id: z.union([z.coerce.number().int().positive(), z.literal(''), z.null(), z.undefined()])
      .transform((value) => value === '' || value === null || value === undefined ? null : value),
    vaga_titulo: nullableText(180),
  });

  function hashToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
  }

  function newToken() {
    return crypto.randomBytes(32).toString('base64url');
  }

  function requestBase(req) {
    return configuredPanelUrl || `${req.protocol}://${req.get('host')}`;
  }

  function publicDemo(demo) {
    return {
      id: demo.id,
      empresa_nome: demo.empresa_nome,
      contato_nome: demo.contato_nome,
      vaga_titulo: demo.vaga_titulo,
      status: demo.status,
      waha_status: demo.waha_status,
      inicio_em: demo.inicio_em,
      expira_em: demo.expira_em,
      conectado_em: demo.conectado_em,
      dias_restantes: Math.max(0, Number(demo.dias_restantes || 0)),
      configuracao_pronta: Boolean(baseUrl && apiKey && webhookUrl),
    };
  }

  function adminDemo(demo) {
    if (!demo) return demo;
    const { token_hash: _tokenHash, ...safeDemo } = demo;
    return safeDemo;
  }

  function mappedDemoStatus(rawStatus) {
    const status = String(rawStatus || '').trim().toUpperCase();
    if (['WORKING', 'CONNECTED', 'AUTHENTICATED'].includes(status)) return 'CONECTADA';
    if (['SCAN_QR_CODE', 'SCAN_QR', 'STARTING', 'STARTED'].includes(status)) return 'AGUARDANDO_QR';
    if (['FAILED', 'ERROR', 'PASSKEY_REQUIRED', 'PASSKEY_CONFIRMATION_REQUIRED'].includes(status)) return 'ERRO';
    return 'CRIADA';
  }

  async function wahaRequest(endpoint, { method = 'GET', body, allowNotFound = false } = {}) {
    if (!baseUrl || !apiKey) {
      throw new WahaRequestError('Configure WAHA_BASE_URL e WAHA_API_KEY no EasyPanel para ativar demonstrações.', 503);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method,
        headers: {
          'X-Api-Key': apiKey,
          Accept: 'application/json, image/png, image/jpeg',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      let json = null;
      if (contentType.includes('json') && buffer.length) {
        try { json = JSON.parse(buffer.toString('utf8')); } catch { json = null; }
      }
      if (allowNotFound && response.status === 404) return null;
      if (!response.ok) {
        const message = json?.message || json?.error || buffer.toString('utf8').slice(0, 400) || `HTTP ${response.status}`;
        throw new WahaRequestError(`O WAHA recusou a operação: ${message}`, response.status >= 500 ? 502 : 409, json);
      }
      return { response, buffer, contentType, json };
    } catch (error) {
      if (error instanceof WahaRequestError) throw error;
      if (error?.name === 'AbortError') throw new WahaRequestError('O WAHA demorou mais de 20 segundos para responder.', 504);
      throw new WahaRequestError(`Não foi possível acessar o WAHA: ${error.message}`, 502);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function sessionStatus(sessionName) {
    const result = await wahaRequest(`/api/sessions/${encodeURIComponent(sessionName)}`, { allowNotFound: true });
    return result?.json || null;
  }

  async function startSession(demo) {
    if (!webhookUrl) {
      throw new WahaRequestError('Configure DEMO_CHATBOT_WEBHOOK_URL (ou CHATBOT_WEBHOOK_URL) antes de conectar a demonstração.', 503);
    }
    const current = await sessionStatus(demo.session_name);
    const currentStatus = String(current?.status || '').toUpperCase();
    if (['WORKING', 'CONNECTED', 'AUTHENTICATED', 'SCAN_QR_CODE', 'SCAN_QR', 'STARTING'].includes(currentStatus)) {
      return current;
    }

    const config = {
      name: demo.session_name,
      start: true,
      config: {
        webhooks: [{
          url: webhookUrl,
          events: ['message'],
          retries: { policy: 'constant', delaySeconds: 2, attempts: 5 },
        }],
      },
    };

    if (!current) {
      try {
        const created = await wahaRequest('/api/sessions', { method: 'POST', body: config });
        return created.json || { status: 'STARTING' };
      } catch (currentApiError) {
        // Compatibilidade com versões antigas do WAHA que ainda criam e iniciam
        // a sessão pelo endpoint /api/sessions/start.
        try {
          const legacy = await wahaRequest('/api/sessions/start', { method: 'POST', body: config });
          return legacy.json || { status: 'STARTING' };
        } catch (legacyApiError) {
          legacyApiError.details = {
            ...(legacyApiError.details || {}),
            current_api_error: currentApiError.message,
          };
          throw legacyApiError;
        }
      }
    }

    try {
      const started = await wahaRequest(`/api/sessions/${encodeURIComponent(demo.session_name)}/start`, { method: 'POST', body: {} });
      return started.json || { status: 'STARTING' };
    } catch (error) {
      if (!(error instanceof WahaRequestError) || error.status >= 500) throw error;
      const restarted = await wahaRequest(`/api/sessions/${encodeURIComponent(demo.session_name)}/restart`, { method: 'POST', body: {} });
      return restarted.json || { status: 'STARTING' };
    }
  }

  async function stopSession(sessionName, { remove = false } = {}) {
    if (!baseUrl || !apiKey) return;
    try {
      await wahaRequest(`/api/sessions/${encodeURIComponent(sessionName)}/logout`, { method: 'POST', body: {} });
    } catch (error) {
      if (!(error instanceof WahaRequestError) || ![404, 409].includes(error.status)) {
        console.warn(`[DEMO V13] Falha ao desconectar ${sessionName}: ${error.message}`);
      }
    }
    if (remove) {
      try {
        await wahaRequest(`/api/sessions/${encodeURIComponent(sessionName)}`, { method: 'DELETE' });
      } catch (error) {
        if (!(error instanceof WahaRequestError) || ![404, 409].includes(error.status)) {
          console.warn(`[DEMO V13] Falha ao remover ${sessionName}: ${error.message}`);
        }
      }
    }
  }

  async function loadByToken(token, { lock = false, client = pool } = {}) {
    const normalized = String(token || '').trim();
    if (!/^[A-Za-z0-9_-]{32,100}$/.test(normalized)) return null;
    const result = await client.query(`
      SELECT d.*, GREATEST(0, CEIL(EXTRACT(EPOCH FROM (d.expira_em-NOW()))/86400.0))::INTEGER AS dias_restantes
      FROM genesis_demos d
      WHERE d.token_hash=$1
      LIMIT 1
      ${lock ? 'FOR UPDATE' : ''}
    `, [hashToken(normalized)]);
    return result.rows[0] || null;
  }

  async function expireIfNeeded(demo) {
    if (!demo || ['EXPIRADA', 'ENCERRADA'].includes(demo.status)) return demo;
    if (new Date(demo.expira_em).getTime() > Date.now()) return demo;
    await pool.query(`UPDATE genesis_demos SET status='EXPIRADA',encerrado_em=COALESCE(encerrado_em,NOW()),updated_at=NOW() WHERE id=$1`, [demo.id]);
    stopSession(demo.session_name, { remove: true }).catch((error) => console.warn(`[DEMO V13] ${error.message}`));
    return { ...demo, status: 'EXPIRADA', dias_restantes: 0 };
  }

  function demoTokenError(res) {
    return res.status(404).json({ sucesso: false, erro: 'Demonstração não encontrada ou link substituído.' });
  }

  function sendDemoAsset(res, fileName, contentType) {
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.sendFile(path.join(publicDir, fileName));
  }

  // Estes três recursos precisam permanecer públicos, pois são carregados antes
  // do middleware de autenticação do painel.
  app.get('/demo.css', (_req, res) => sendDemoAsset(res, 'demo.css', 'text/css; charset=utf-8'));
  app.get('/demo-client.js', (_req, res) => sendDemoAsset(res, 'demo-client.js', 'text/javascript; charset=utf-8'));
  app.get('/assets/brand/genesis-mark.svg', (_req, res) => sendDemoAsset(res, 'assets/brand/genesis-mark.svg', 'image/svg+xml'));

  app.get('/demo/:token', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(path.join(publicDir, 'demo.html'));
  });

  app.get('/api/demo/:token', async (req, res, next) => {
    try {
      let demo = await loadByToken(req.params.token);
      if (!demo) return demoTokenError(res);
      demo = await expireIfNeeded(demo);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ sucesso: true, demo: publicDemo(demo) });
    } catch (error) { return next(error); }
  });

  app.post('/api/demo/:token/conectar', async (req, res, next) => {
    try {
      let demo = await loadByToken(req.params.token);
      if (!demo) return demoTokenError(res);
      demo = await expireIfNeeded(demo);
      if (['EXPIRADA', 'ENCERRADA'].includes(demo.status)) {
        return res.status(410).json({ sucesso: false, erro: 'O período desta demonstração foi encerrado.' });
      }
      const session = await startSession(demo);
      const rawStatus = String(session?.status || 'STARTING');
      const status = mappedDemoStatus(rawStatus);
      await pool.query(`
        UPDATE genesis_demos
        SET status=$2,waha_status=$3,ultimo_status_em=NOW(),ultimo_erro=NULL,updated_at=NOW(),
            conectado_em=CASE WHEN $2='CONECTADA' THEN COALESCE(conectado_em,NOW()) ELSE conectado_em END
        WHERE id=$1
      `, [demo.id, status, rawStatus]);
      return res.json({ sucesso: true, status, waha_status: rawStatus });
    } catch (error) { return next(error); }
  });

  app.get('/api/demo/:token/status', async (req, res, next) => {
    try {
      let demo = await loadByToken(req.params.token);
      if (!demo) return demoTokenError(res);
      demo = await expireIfNeeded(demo);
      if (['EXPIRADA', 'ENCERRADA'].includes(demo.status)) {
        return res.json({ sucesso: true, demo: publicDemo(demo) });
      }
      let rawStatus = demo.waha_status;
      try {
        const session = await sessionStatus(demo.session_name);
        rawStatus = String(session?.status || rawStatus || 'STOPPED');
        const status = mappedDemoStatus(rawStatus);
        const connectedPhone = String(session?.me?.id || session?.me?.user || '').replace(/\D/g, '') || null;
        await pool.query(`
          UPDATE genesis_demos
          SET status=$2,waha_status=$3,whatsapp_conectado=COALESCE($4,whatsapp_conectado),
              ultimo_status_em=NOW(),ultimo_erro=NULL,updated_at=NOW(),
              conectado_em=CASE WHEN $2='CONECTADA' THEN COALESCE(conectado_em,NOW()) ELSE conectado_em END
          WHERE id=$1
        `, [demo.id, status, rawStatus, connectedPhone]);
        demo = { ...demo, status, waha_status: rawStatus };
      } catch (error) {
        await pool.query(`UPDATE genesis_demos SET ultimo_erro=$2,ultimo_status_em=NOW(),updated_at=NOW() WHERE id=$1`, [demo.id, error.message.slice(0, 1000)]);
        if (error.status === 503) throw error;
      }
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ sucesso: true, demo: publicDemo(demo) });
    } catch (error) { return next(error); }
  });

  app.get('/api/demo/:token/qr', async (req, res, next) => {
    try {
      let demo = await loadByToken(req.params.token);
      if (!demo) return demoTokenError(res);
      demo = await expireIfNeeded(demo);
      if (['EXPIRADA', 'ENCERRADA'].includes(demo.status)) return res.status(410).json({ sucesso: false, erro: 'Demonstração encerrada.' });
      const result = await wahaRequest(`/api/${encodeURIComponent(demo.session_name)}/auth/qr`);
      let imageBuffer = result.buffer;
      let imageType = result.contentType.includes('jpeg') ? 'image/jpeg' : 'image/png';
      if (result.json) {
        const dataUrl = String(result.json.data || result.json.value || result.json.qr || '');
        const match = dataUrl.match(/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/);
        const rawBase64 = !match && /^[A-Za-z0-9+/=]{100,}$/.test(dataUrl) ? dataUrl : null;
        if (!match && !rawBase64) return res.status(409).json({ sucesso: false, erro: 'O QR Code ainda não está disponível. Aguarde alguns segundos.' });
        imageType = match?.[1] || 'image/png';
        imageBuffer = Buffer.from(match?.[2] || rawBase64, 'base64');
      }
      if (!imageBuffer.length || imageBuffer.length > 2_000_000) {
        return res.status(502).json({ sucesso: false, erro: 'O WAHA devolveu um QR Code inválido.' });
      }
      res.setHeader('Content-Type', imageType);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      return res.send(imageBuffer);
    } catch (error) { return next(error); }
  });

  app.post('/api/demo/:token/desconectar', async (req, res, next) => {
    try {
      let demo = await loadByToken(req.params.token);
      if (!demo) return demoTokenError(res);
      demo = await expireIfNeeded(demo);
      if (['EXPIRADA', 'ENCERRADA'].includes(demo.status)) return res.status(410).json({ sucesso: false, erro: 'Demonstração encerrada.' });
      await stopSession(demo.session_name);
      await pool.query(`UPDATE genesis_demos SET status='CRIADA',waha_status='STOPPED',whatsapp_conectado=NULL,updated_at=NOW() WHERE id=$1`, [demo.id]);
      return res.json({ sucesso: true, mensagem: 'WhatsApp desconectado desta demonstração.' });
    } catch (error) { return next(error); }
  });

  app.get('/api/demos', requireLogin, requireAdmin, async (req, res, next) => {
    try {
      const result = await pool.query(`
        SELECT d.*,
          GREATEST(0,CEIL(EXTRACT(EPOCH FROM (d.expira_em-NOW()))/86400.0))::INTEGER AS dias_restantes,
          COUNT(DISTINCT c.id)::INTEGER AS contatos,
          COUNT(DISTINCT c.id) FILTER (WHERE c.status='CONCLUIDA')::INTEGER AS concluidas,
          COUNT(DISTINCT c.id) FILTER (WHERE c.status='NAO_ATENDEU')::INTEGER AS nao_atenderam
        FROM genesis_demos d
        LEFT JOIN genesis_demo_contatos c ON c.demo_id=d.id
        GROUP BY d.id
        ORDER BY CASE WHEN d.status IN ('CONECTADA','AGUARDANDO_QR','CRIADA') AND d.expira_em>NOW() THEN 0 ELSE 1 END,
                 d.created_at DESC
        LIMIT 200
      `);
      return res.json({
        sucesso: true,
        demos: result.rows.map(adminDemo),
        configuracao: {
          dias: demoDays,
          limite_ativas: demoLimit,
          waha_configurado: Boolean(baseUrl && apiKey),
          webhook_configurado: Boolean(webhookUrl),
        },
      });
    } catch (error) { return next(error); }
  });

  app.get('/api/demos/:id', requireLogin, requireAdmin, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ sucesso: false, erro: 'Demonstração inválida.' });
      const [demoResult, contactsResult] = await Promise.all([
        pool.query(`SELECT d.*,GREATEST(0,CEIL(EXTRACT(EPOCH FROM (d.expira_em-NOW()))/86400.0))::INTEGER AS dias_restantes FROM genesis_demos d WHERE id=$1`, [id]),
        pool.query(`
          SELECT c.*,
            COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
              'ordem',q.ordem,'pergunta',q.texto,'resposta',r.resposta_bruta,'resumo',r.resumo_ia,
              'origem',r.origem,'atendida',r.atendida,'pontos',r.pontos
            ) ORDER BY q.ordem) FILTER (WHERE r.id IS NOT NULL),'[]'::JSONB) AS respostas
          FROM genesis_demo_contatos c
          LEFT JOIN genesis_demo_respostas r ON r.contato_id=c.id
          LEFT JOIN genesis_demo_perguntas q ON q.id=r.pergunta_id
          WHERE c.demo_id=$1
          GROUP BY c.id
          ORDER BY c.updated_at DESC
        `, [id]),
      ]);
      if (!demoResult.rowCount) return res.status(404).json({ sucesso: false, erro: 'Demonstração não encontrada.' });
      return res.json({ sucesso: true, demo: adminDemo(demoResult.rows[0]), contatos: contactsResult.rows });
    } catch (error) { return next(error); }
  });

  app.post('/api/demos', requireLogin, requireAdmin, async (req, res, next) => {
    const client = await pool.connect();
    try {
      const parsed = createSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({
          sucesso: false,
          erro: 'Revise os dados da demonstração.',
          detalhes: parsed.error.issues.map((issue) => ({ campo: issue.path.join('.'), mensagem: issue.message })),
        });
      }
      const input = parsed.data;
      await client.query('BEGIN');
      await client.query(`SELECT PG_ADVISORY_XACT_LOCK(HASHTEXT('genesis_demo_limite_v13'))`);
      const active = await client.query(`
        SELECT COUNT(*)::INTEGER AS total FROM genesis_demos
        WHERE status IN ('CRIADA','AGUARDANDO_QR','CONECTADA','ERRO') AND expira_em>NOW()
      `);
      if (Number(active.rows[0]?.total || 0) >= demoLimit) {
        await client.query('ROLLBACK');
        return res.status(409).json({ sucesso: false, erro: `O limite de ${demoLimit} demonstrações simultâneas foi atingido.` });
      }

      let vacancy = null;
      if (input.vaga_origem_id) {
        const vacancyResult = await client.query('SELECT id,titulo FROM vagas WHERE id=$1', [input.vaga_origem_id]);
        if (!vacancyResult.rowCount) {
          await client.query('ROLLBACK');
          return res.status(400).json({ sucesso: false, erro: 'A vaga escolhida não existe.' });
        }
        vacancy = vacancyResult.rows[0];
      }

      const token = newToken();
      const sessionName = `demo-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`.slice(0, 80);
      const created = await client.query(`
        INSERT INTO genesis_demos(
          empresa_nome,contato_nome,contato_email,contato_whatsapp,vaga_origem_id,vaga_titulo,
          session_name,token_hash,status,criado_por,criado_por_nome,inicio_em,expira_em
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'CRIADA',$9,$10,NOW(),NOW()+($11::INTEGER*INTERVAL '1 day'))
        RETURNING *
      `, [
        input.empresa_nome, input.contato_nome, input.contato_email, input.contato_whatsapp,
        vacancy?.id || null, input.vaga_titulo || vacancy?.titulo || 'Vaga demonstrativa',
        sessionName, hashToken(token), req.user?.id || null, currentUserName(req), demoDays,
      ]);
      const demo = created.rows[0];

      if (vacancy) {
        await client.query(`
          INSERT INTO genesis_demo_perguntas(
            demo_id,ordem,texto,tipo,finalidade,obrigatoria,opcoes,regra_operador,regra_valor,pontos,mensagem_nao_atende
          )
          SELECT $1,p.ordem,p.texto,p.tipo,p.finalidade,p.obrigatoria,p.opcoes,p.regra_operador,p.regra_valor,p.pontos,p.mensagem_nao_atende
          FROM vaga_triagem_versoes tv
          JOIN vaga_perguntas p ON p.versao_id=tv.id AND p.ativa IS TRUE
          WHERE tv.vaga_id=$2 AND tv.status='ATIVA'
          ORDER BY p.ordem
        `, [demo.id, vacancy.id]);
      }
      const questions = await client.query('SELECT COUNT(*)::INTEGER AS total FROM genesis_demo_perguntas WHERE demo_id=$1', [demo.id]);
      if (Number(questions.rows[0]?.total || 0) === 0) {
        await client.query(`
          INSERT INTO genesis_demo_perguntas(demo_id,ordem,texto,tipo,finalidade,obrigatoria,opcoes,regra_operador,regra_valor,pontos,mensagem_nao_atende)
          VALUES
            ($1,1,'Você possui disponibilidade para trabalhar no horário informado?','SIM_NAO','ELIMINATORIA',TRUE,'["Sim","Não"]','IGUAL','"SIM"',0,'A disponibilidade de horário é um requisito desta oportunidade.'),
            ($1,2,'Quanto tempo de experiência você possui na função, em meses?','NUMERO','CLASSIFICATORIA',TRUE,'[]','MAIOR_IGUAL','6',10,NULL),
            ($1,3,'Conte brevemente uma experiência profissional que represente bem o seu trabalho.','TEXTO_LONGO','ABERTA',TRUE,'[]','SEMPRE',NULL,0,NULL)
        `, [demo.id]);
      }
      await client.query(`
        INSERT INTO app_auditoria(usuario_id,usuario_nome,acao,entidade,entidade_id,detalhes)
        VALUES($1,$2,'DEMO_CRIADA','genesis_demos',$3,$4::JSONB)
      `, [req.user?.id || null, currentUserName(req), String(demo.id), JSON.stringify({ empresa: demo.empresa_nome, expira_em: demo.expira_em })]);
      await client.query('COMMIT');
      return res.status(201).json({
        sucesso: true,
        mensagem: `Demonstração criada por ${demoDays} dias.`,
        demo: adminDemo(demo),
        link: `${requestBase(req)}/demo/${token}`,
      });
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      return next(error);
    } finally { client.release(); }
  });

  app.post('/api/demos/:id/renovar-link', requireLogin, requireAdmin, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ sucesso: false, erro: 'Demonstração inválida.' });
      const token = newToken();
      const result = await pool.query(`
        UPDATE genesis_demos SET token_hash=$2,updated_at=NOW()
        WHERE id=$1 AND status NOT IN ('EXPIRADA','ENCERRADA') AND expira_em>NOW()
        RETURNING id
      `, [id, hashToken(token)]);
      if (!result.rowCount) return res.status(409).json({ sucesso: false, erro: 'Esta demonstração já foi encerrada ou expirou.' });
      return res.json({ sucesso: true, mensagem: 'Novo link criado; o anterior deixou de funcionar.', link: `${requestBase(req)}/demo/${token}` });
    } catch (error) { return next(error); }
  });

  app.post('/api/demos/:id/encerrar', requireLogin, requireAdmin, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ sucesso: false, erro: 'Demonstração inválida.' });
      const result = await pool.query(`
        UPDATE genesis_demos SET status='ENCERRADA',encerrado_em=NOW(),updated_at=NOW()
        WHERE id=$1 AND status<>'ENCERRADA'
        RETURNING session_name
      `, [id]);
      if (!result.rowCount) return res.status(404).json({ sucesso: false, erro: 'Demonstração não encontrada ou já encerrada.' });
      await stopSession(result.rows[0].session_name, { remove: true });
      return res.json({ sucesso: true, mensagem: 'Demonstração encerrada e sessão WAHA removida.' });
    } catch (error) { return next(error); }
  });

  async function expireDemos() {
    try {
      const result = await pool.query(`
        UPDATE genesis_demos
        SET status='EXPIRADA',encerrado_em=COALESCE(encerrado_em,NOW()),updated_at=NOW()
        WHERE status IN ('CRIADA','AGUARDANDO_QR','CONECTADA','ERRO') AND expira_em<=NOW()
        RETURNING session_name
      `);
      await Promise.allSettled(result.rows.map((item) => stopSession(item.session_name, { remove: true })));
      if (result.rowCount) console.log(`[DEMO V13] ${result.rowCount} demonstração(ões) expirada(s).`);
    } catch (error) {
      if (String(error.code || '') !== '42P01') console.error('[DEMO V13] Falha ao expirar demonstrações:', error.message);
    }
  }

  const expiryTimer = setInterval(expireDemos, checkMinutes * 60_000);
  expiryTimer.unref();
  setTimeout(expireDemos, 10_000).unref();
}

module.exports = { registerDemosV13 };
