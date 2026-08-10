'use strict';
const assert = require('node:assert/strict');
const { registerGeoV1 } = require('../lib/geo-v1');
const { registerCrmV1 } = require('../lib/crm-v1');

class FakeApp {
  constructor(){ this.routes = new Map(); }
  add(method, path, handlers){ this.routes.set(`${method} ${path}`, handlers[handlers.length - 1]); }
  get(path, ...handlers){ this.add('GET', path, handlers); }
  post(path, ...handlers){ this.add('POST', path, handlers); }
  put(path, ...handlers){ this.add('PUT', path, handlers); }
  patch(path, ...handlers){ this.add('PATCH', path, handlers); }
  delete(path, ...handlers){ this.add('DELETE', path, handlers); }
}

function response(){
  return {
    statusCode:200, body:null,
    status(code){ this.statusCode=code; return this; },
    json(value){ this.body=value; return this; },
  };
}

function geoPool(){
  return {
    async query(sql){
      const q=String(sql);
      if(q.includes('FROM geo_vagas gv LEFT JOIN geo_ceps g')) return {rows:[{vaga_id:2,cep:'03132000',estado:'SP',cidade:'São Paulo',bairro:'Mooca',logradouro:'Rua teste',latitude:'-23.5',longitude:'-46.6',status:'OK'}],rowCount:1};
      if(q.includes('FROM candidatos c') && q.includes('genesis_geo_distancia_km')) return {rows:[{candidato_id:1,vaga_id:2,candidato_cep:'04310000',vaga_cep:'03132000',candidato_cidade:'São Paulo',candidato_bairro:'Jabaquara',distancia_km:'8.4',geo_status:'OK'}],rowCount:1};
      if(q.includes('COUNT(*)::INTEGER AS total') && q.includes('FROM geo_ceps')) return {rows:[{total:2,ok:2,pendentes:0}],rowCount:1};
      if(q.includes('FROM candidatos') && q.includes('AS com_cep')) return {rows:[{total:10,com_cep:9}],rowCount:1};
      if(q.includes('FROM geo_vagas') && q.includes('COUNT(*)')) return {rows:[{total:3}],rowCount:1};
      throw new Error(`Geo fake query não mapeada: ${q.slice(0,90)}`);
    },
  };
}

function crmPool(){
  const client={
    async query(sql){
      const q=String(sql);
      if(q==='BEGIN'||q==='COMMIT'||q==='ROLLBACK'||q.includes('pg_advisory_xact_lock')) return {rows:[],rowCount:0};
      if(q.includes('FROM prospeccao_leads') && q.includes('ORDER BY id')) return {rows:[],rowCount:0};
      if(q.includes('FROM genesis_demos') && q.includes('ORDER BY id')) return {rows:[],rowCount:0};
      throw new Error(`CRM client fake query não mapeada: ${q.slice(0,100)}`);
    },
    release(){},
  };
  return {
    connect: async()=>client,
    async query(sql){
      const q=String(sql);
      if(q.includes("AS abertas") && q.includes('pipeline_valor')) return {rows:[{abertas:2,demos:1,propostas:1,ganhos:1,pipeline_valor:'1500'}],rowCount:1};
      if(q.includes('GROUP BY etapa')) return {rows:[{etapa:'NOVO_LEAD',total:1,valor:'0'}],rowCount:1};
      if(q.includes('FROM crm_followups f') && q.includes("f.status='PENDENTE'")) return {rows:[],rowCount:0};
      if(q.includes('FROM crm_oportunidades co') && q.includes('ORDER BY co.updated_at DESC LIMIT 8')) return {rows:[],rowCount:0};
      if(q.includes('WHERE co.id=$1 LIMIT 1') && q.includes('demo_status')) return {rows:[{id:1,crm_empresa_id:10,empresa_nome:'Empresa Teste',titulo:'Oportunidade comercial',etapa:'QUALIFICADO',origem:'MANUAL',responsavel_nome:'Admin',valor_estimado:'1000',empresa_operacional_id:null}],rowCount:1};
      if(q.includes('FROM crm_contatos WHERE crm_empresa_id=')) return {rows:[],rowCount:0};
      if(q.includes('FROM crm_interacoes WHERE oportunidade_id=')) return {rows:[],rowCount:0};
      if(q.includes('FROM crm_followups f LEFT JOIN app_usuarios')) return {rows:[],rowCount:0};
      if(q.includes('followups_pendentes')) return {rows:[],rowCount:0};
      throw new Error(`CRM pool fake query não mapeada: ${q.slice(0,110)}`);
    },
  };
}

async function runHandler(handler, req={}){
  const res=response(); let nextError=null;
  await handler({body:{},query:{},params:{},user:{id:1,perfil:'ADMIN',nome:'Admin'},...req},res,(e)=>{nextError=e;});
  if(nextError) throw nextError;
  return res;
}

async function main(){
  const geoApp=new FakeApp(); registerGeoV1({app:geoApp,pool:geoPool()});
  for(const key of ['GET /api/geo/cep/:cep','GET /api/geo/vagas/:id','PUT /api/geo/vagas/:id','DELETE /api/geo/vagas/:id','GET /api/geo/candidatos/distancias','POST /api/geo/enriquecer','GET /api/geo/status']) assert.ok(geoApp.routes.has(key),`Rota ausente: ${key}`);
  const vacancyGeo=await runHandler(geoApp.routes.get('GET /api/geo/vagas/:id'),{params:{id:'2'}});
  assert.equal(vacancyGeo.body.geo.cep,'03132000');
  const distances=await runHandler(geoApp.routes.get('GET /api/geo/candidatos/distancias'));
  assert.equal(distances.statusCode,200); assert.equal(distances.body.distancias[0].distancia_km,8.4); assert.equal(distances.body.distancias[0].geo_status,'OK');
  const geoStatus=await runHandler(geoApp.routes.get('GET /api/geo/status'));
  assert.equal(geoStatus.body.candidatos.com_cep,9); assert.equal(geoStatus.body.vagas_com_cep,3);

  const crmApp=new FakeApp(); registerCrmV1({app:crmApp,pool:crmPool(),requireAdmin:(_q,_s,n)=>n(),currentUserName:()=> 'Admin'});
  for(const key of ['POST /api/admin/crm/sincronizar','GET /api/admin/crm/dashboard','GET /api/admin/crm/oportunidades','GET /api/admin/crm/oportunidades/:id','POST /api/admin/crm/oportunidades','PATCH /api/admin/crm/oportunidades/:id','POST /api/admin/crm/oportunidades/:id/interacoes','POST /api/admin/crm/oportunidades/:id/followups','PATCH /api/admin/crm/followups/:id','POST /api/admin/crm/oportunidades/:id/converter-cliente']) assert.ok(crmApp.routes.has(key),`Rota ausente: ${key}`);
  const sync=await runHandler(crmApp.routes.get('POST /api/admin/crm/sincronizar'));
  assert.deepEqual(sync.body.sincronizacao,{prospection:{created:0,updated:0},demos:{linked:0}});
  const dashboard=await runHandler(crmApp.routes.get('GET /api/admin/crm/dashboard'));
  assert.equal(dashboard.body.metricas.abertas,2); assert.equal(dashboard.body.metricas.propostas,1);
  const list=await runHandler(crmApp.routes.get('GET /api/admin/crm/oportunidades'));
  assert.deepEqual(list.body.oportunidades,[]);
  const detail=await runHandler(crmApp.routes.get('GET /api/admin/crm/oportunidades/:id'),{params:{id:'1'}});
  assert.equal(detail.body.oportunidade.empresa_nome,'Empresa Teste');
  assert.deepEqual(detail.body.contatos,[]);
  console.log('V19 runtime: registro e execução dos handlers Geo/CRM principais aprovados.');
}
main().catch((error)=>{console.error(error);process.exitCode=1;});
