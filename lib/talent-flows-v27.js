'use strict';
const safeId=(value)=>/^\d+$/.test(String(value))?Number(value):null;
const sameToken=(req,expected)=>Boolean(expected)&&String(req.get('authorization')||'').replace(/^Bearer\s+/i,'')===expected;

function registerTalentFlowsV27({app,pool,requireLogin,requireAdmin,currentUserName}){
  const talentToken=String(process.env.TALENT_WEBHOOK_TOKEN||'').trim();
  const flowToken=String(process.env.WHATSAPP_FLOW_TEST_TOKEN||'').trim();
  const flowEnabled=String(process.env.WHATSAPP_FLOW_LAB_ENABLED||'false').toLowerCase()==='true';

  async function saveTalentDecision({candidateId,accepted,origin,userId,userName}){
    const client=await pool.connect();
    try{await client.query('BEGIN');
      const current=(await client.query('SELECT banco_talentos_aceite,banco_talentos_decidido_em FROM candidatos WHERE id=$1 FOR UPDATE',[candidateId])).rows[0];
      if(!current){await client.query('ROLLBACK');return {notFound:true};}
      if(current.banco_talentos_decidido_em&&userId===null){await client.query('ROLLBACK');return {alreadyDecided:true,accepted:current.banco_talentos_aceite};}
      await client.query(`UPDATE candidatos SET banco_talentos_aceite=$2,banco_talentos_decidido_em=NOW(),banco_talentos_origem=$3,banco_talentos_optout_em=CASE WHEN $2 IS FALSE THEN NOW() ELSE NULL END,updated_at=NOW() WHERE id=$1`,[candidateId,accepted,origin]);
      await client.query(`INSERT INTO candidato_talento_auditoria(candidato_id,aceite,origem,alterado_por,alterado_por_nome) VALUES($1,$2,$3,$4,$5)`,[candidateId,accepted,origin,userId,userName]);
      await client.query('COMMIT');return {saved:true};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }

  app.patch('/api/admin/candidatos/:id/banco-talentos',requireLogin,requireAdmin,async(req,res,next)=>{try{
    const candidateId=safeId(req.params.id);if(!candidateId||typeof req.body?.aceite!=='boolean')return res.status(400).json({sucesso:false,erro:'Decisão inválida.'});
    const result=await saveTalentDecision({candidateId,accepted:req.body.aceite,origin:'PAINEL_ADMIN',userId:req.user?.id||null,userName:currentUserName(req)});
    if(result.notFound)return res.status(404).json({sucesso:false,erro:'Candidato não encontrado.'});res.json({sucesso:true});
  }catch(error){next(error);}});

  app.post('/api/public/candidatos/:id/banco-talentos',async(req,res,next)=>{try{
    if(!sameToken(req,talentToken))return res.status(401).json({sucesso:false,erro:'Token inválido.'});
    const candidateId=safeId(req.params.id);if(!candidateId||typeof req.body?.aceite!=='boolean')return res.status(400).json({sucesso:false,erro:'Decisão inválida.'});
    const result=await saveTalentDecision({candidateId,accepted:req.body.aceite,origin:String(req.body?.origem||'EVELYN_WHATSAPP').slice(0,80),userId:null,userName:'Evelyn'});
    if(result.notFound)return res.status(404).json({sucesso:false,erro:'Candidato não encontrado.'});
    res.json({sucesso:true,ja_decidido:Boolean(result.alreadyDecided),aceite:result.accepted});
  }catch(error){next(error);}});

  app.get('/api/admin/whatsapp-flow-lab',requireLogin,requireAdmin,async(_req,res,next)=>{try{
    const results=await pool.query('SELECT id,flow_id,destinatario,status,horario_escolhido,created_at FROM whatsapp_flow_testes ORDER BY created_at DESC LIMIT 30');
    res.json({sucesso:true,habilitado:flowEnabled,flow_id_configurado:Boolean(process.env.WHATSAPP_FLOW_TEST_ID),resultados:results.rows});
  }catch(error){next(error);}});

  app.get('/api/admin/whatsapp-flow-lab/payload',requireLogin,requireAdmin,(req,res)=>{
    if(!flowEnabled)return res.status(404).json({sucesso:false,erro:'Laboratório desabilitado.'});
    const flowId=String(process.env.WHATSAPP_FLOW_TEST_ID||'').trim();if(!flowId)return res.status(409).json({sucesso:false,erro:'Configure WHATSAPP_FLOW_TEST_ID após publicar o Flow na Meta.'});
    res.json({sucesso:true,payload:{type:'interactive',interactive:{type:'flow',body:{text:'Escolha um horário para o teste de agendamento.'},action:{name:'flow',parameters:{flow_message_version:'3',flow_token:`genesis-test-${Date.now()}`,flow_id:flowId,flow_cta:'Escolher horário',flow_action:'navigate',flow_action_payload:{screen:'SCHEDULE',data:{}}}}}}});
  });

  app.post('/api/public/whatsapp-flow-lab/resultado',async(req,res,next)=>{try{
    if(!sameToken(req,flowToken))return res.status(401).json({sucesso:false,erro:'Token inválido.'});
    const payload=req.body&&typeof req.body==='object'?req.body:{};const answer=payload.horario||payload.horario_escolhido||payload.flow_response?.horario||null;
    const result=await pool.query(`INSERT INTO whatsapp_flow_testes(flow_id,destinatario,status,horario_escolhido,payload) VALUES($1,$2,'RECEBIDO',$3,$4::JSONB) RETURNING id`,[String(payload.flow_id||process.env.WHATSAPP_FLOW_TEST_ID||'').slice(0,120),String(payload.destinatario||'').slice(0,40),answer?String(answer).slice(0,120):null,JSON.stringify(payload)]);
    res.json({sucesso:true,id:result.rows[0].id});
  }catch(error){next(error);}});
}
module.exports={registerTalentFlowsV27};
