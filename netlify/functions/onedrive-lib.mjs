import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const microsoft = tipo => 'https://login.microsoftonline.com/'+(tipo==='pessoal'?'consumers':'common')+'/oauth2/v2.0';
const ROOT = ['Beira Rio','Beira Rio ADM','Documentos'];
const SCOPES = 'offline_access https://graph.microsoft.com/Files.ReadWrite';
const SELECT = 'id,name,size,file,folder,parentReference,remoteItem';
const TESTE = 'Arquivo de teste da integração Carteira Beira Rio com o OneDrive.\n';
const CONTEXTO_TESTE = {teste:true};
const esc = encodeURIComponent;
export const MAX_FILE = 250 * 1024 * 1024;

class DriveError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const validSegment = value => typeof value === 'string' && value && !/[\/\\\u0000-\u001f]/.test(value) && !['.','..'].includes(value);
const folderName = value => String(value || '').replace(/["*:<>?\/\\|\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().replace(/^\.+|\.+$/g,'').slice(0,100);
function caminhoPai(item,drive) {
  if(item.parentReference?.driveId!==drive)return null;
  try {
    const path=String(item.parentReference.path || '').split('root:')[1];
    const partes=path?.split('/').filter(Boolean).map(decodeURIComponent);
    return partes && ROOT.every((p,i)=>partes[i]?.normalize('NFC')===p) ? partes.slice(ROOT.length) : null;
  }catch{return null;}
}
export function destinoArquivo({ chave, nome, numero, quadra, lote, comprador }) {
  const original = folderName(nome);
  if (!original || !/^\d{4}$/.test(numero)) throw new DriveError('Contrato ou nome de arquivo inválido.');
  const imovel = 'Q' + folderName(quadra) + ' L' + folderName(lote);
  const base = numero + ' - ' + imovel;
  const ext = /\.[a-z0-9]{1,8}$/i.exec(original)?.[0] || '';
  if (chave === 'proposta') return { pastas:['Propostas'], nome:base + ' - Proposta' + ext };
  if (chave === 'contrato_minuta') return {pastas:['Contratos','Redigidos','Word'], nome:base + ext};
  if (chave === 'contrato_minuta_pdf') return {pastas:['Contratos','Redigidos'], nome:base + ' - Retificado.pdf'};
  if (chave === 'contrato_assinado') return {pastas:['Contratos','Assinados'], nome:base + ext};
  const termo = /^termo_(assinado|pdf|word)_([\w.-]+)$/.exec(chave);
  if (termo) return {pastas:['Contratos','Negociações',[termo[2],imovel,folderName(comprador)].filter(Boolean).join(' - ')],
    nome:termo[2] + (termo[1]==='assinado'?' - Assinado':' - Termo') + ext};
  if (/^p[0-3]_(rg|cpf|endereco|estado_civil|outro)$/.test(chave) && folderName(comprador))
    return {pastas:['Compradores',folderName(comprador)], nome:numero + ' - ' + original};
  if (chave === 'pacote_original' || chave === 'outro')
    return {pastas:['Propostas'], nome:base + ' - ' + original};
  if (['firma','testemunhas'].includes(chave))
    return {pastas:['Contratos','Assinados'], nome:base + ' - ' + original};
  throw new DriveError('Classifique o documento antes de arquivá-lo.');
}

export function criaOneDrive({q,pool,json,fetcher=fetch, env=process.env}) {
  const key = Buffer.from(env.ONEDRIVE_TOKEN_KEY || '', 'base64');
  const origin = env.ONEDRIVE_ORIGIN || 'https://papaya-cocada-88fc90.netlify.app';
  const callback = new URL('/api/onedrive/retorno',origin).href;
  const ok = key.length === 32;
  const db = async () => q('create table if not exists carteira.config_geral(chave text primary key, valor text, em timestamptz default now())');
  let ready;
  const garante = () => ready ||= db().catch(e => { ready = null; throw e; });
  const sela = (tag, data) => {
    const iv=randomBytes(12), c=createCipheriv('aes-256-gcm',key,iv);
    c.setAAD(Buffer.from(tag));
    const bin=Buffer.concat([c.update(JSON.stringify(data),'utf8'),c.final()]);
    return Buffer.concat([iv,c.getAuthTag(),bin]).toString('base64url');
  };
  const abre = (tag, raw) => {
    try {
      const b=Buffer.from(raw,'base64url'), d=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));
      d.setAAD(Buffer.from(tag)); d.setAuthTag(b.subarray(12,28));
      return JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString('utf8'));
    } catch { throw new DriveError('A referência do OneDrive é inválida ou expirou.',403); }
  };
  const ticket = (tipo,data,ms=3600e3) => sela(tipo,{...data,exp:Date.now()+ms});
  const abreTicket = (tipo,raw) => {
    const d=abre(tipo,raw);
    if (!(d.exp>Date.now())) throw new DriveError('O acesso expirou. Abra a pasta novamente.',403);
    return d;
  };
  const configKey = 'onedrive_config_v1';
  const confSql = 'select valor from carteira.config_geral where chave=$1';
  const gravaSql = 'insert into carteira.config_geral(chave,valor) values($1,$2) on conflict(chave) do update set valor=excluded.valor,em=now()';
  async function temConexao() {
    if (!ok) return false;
    await garante();
    return Boolean((await q(confSql,[configKey]))[0]);
  }
  function erroMicrosoft(codigo,descricao) {
    const info=/\bAADSTS\d{4,8}\b/.exec(descricao || '')?.[0];
    const simples=/^[a-z_]{3,40}$/.test(codigo || '')?codigo:null;
    return [info,simples].filter(Boolean).join(', ');
  }
  async function token(campos, secret, client, tipo) {
    const r=await fetcher(microsoft(tipo)+'/token',{method:'POST',signal:AbortSignal.timeout(12000),
      body:new URLSearchParams({client_id:client,client_secret:secret,...campos})});
    const d=await r.json();
    if (!r.ok || !d.access_token) {
      const codigo=erroMicrosoft(d.error,d.error_description);
      throw new DriveError('A Microsoft recusou a autenticação'+(codigo?' ('+codigo+')':'')+'.',r.status===400?409:502);
    }
    return {access:d.access_token,refresh:d.refresh_token,exp:Date.now()+Number(d.expires_in)*1000};
  }
  async function sessao() {
    if (!await temConexao()) throw new DriveError('Conecte o OneDrive em Documentos.',409);
    const [row]=await q(confSql,[configKey]);
    const atual=abre(configKey,row.valor);
    if (atual.exp > Date.now()+60e3) return atual;
    const c=await pool.connect();
    try {
      await c.query('begin');
      const {rows:[r]}=await c.query(confSql+' for update',[configKey]);
      const d=abre(configKey,r.valor);
      if (d.exp <= Date.now()+60e3) {
        const t=await token({grant_type:'refresh_token',refresh_token:d.refresh,scope:SCOPES},d.secret,d.client,d.tipo);
        Object.assign(d,t,{refresh:t.refresh||d.refresh});
        await c.query(gravaSql,[configKey,sela(configKey,d)]);
      }
      await c.query('commit');
      return d;
    } catch (e) { await c.query('rollback'); throw e; }
    finally {c.release();}
  }
  async function graph(access,path,options={}, podeFaltar=false) {
    const url = new URL(path.startsWith('/') ? GRAPH+path : path);
    if (url.origin !== 'https://graph.microsoft.com' || !url.pathname.startsWith('/v1.0/'))
      throw new DriveError('Endereço do OneDrive inválido.');
    const r=await fetcher(url,{...options,redirect:'manual',signal:AbortSignal.timeout(15000),
      headers:{Authorization:'Bearer '+access,...options.headers}});
    if (podeFaltar && r.status===404) return null;
    if (!r.ok) throw new DriveError(r.status===404?'Arquivo ou pasta não encontrado no OneDrive.':
      r.status===409?'Já existe um arquivo com esse nome no OneDrive.':
      r.status===403?'A conta conectada não tem acesso a essa pasta.':
      'O OneDrive respondeu '+r.status+'. Tente novamente.',r.status===404?404:r.status===409?409:502);
    return r.json();
  }
  const arq = (d,id) => '/drives/'+esc(d.drive)+'/items/'+esc(id);
  const caminho = partes => partes.map(esc).join('/');
  async function pasta(d,partes) {
    if (!Array.isArray(partes) || partes.length>20 || partes.some(x=>!validSegment(x)))
      throw new DriveError('Pasta inválida.');
    if (!partes.length) return {id:d.root};
    const item=await graph(d.access,arq(d,d.root)+':/'+caminho(partes)+'?$select='+SELECT);
    if (!item.folder || item.remoteItem) throw new DriveError('O destino não é uma pasta do acervo.');
    return item;
  }
  const COOKIE='cbr_od_state';
  const cookie = req => (req.headers.get('cookie')||'').split(/;\s*/).find(s=>s.startsWith(COOKIE+'='))?.split('=')[1];
  async function estadoPendente(req,raw) {
    if (!/^[a-f0-9]{64}$/.test(raw || '')) return null;
    const [row]=await q(confSql,['onedrive_state:'+raw]);
    if (!row) return null;
    const state=abreTicket('oauth',row.valor);
    if (cookie(req)!==raw+'.'+state.browser) return null;
    return state;
  }
  async function confirmaConta(req,url) {
    if (!ok) throw new DriveError('Ativação do OneDrive indisponível.',503);
    await garante();
    const raw=url.searchParams.get('state');
    if (!/^[a-f0-9]{64}$/.test(raw || '')) throw new DriveError('Autorização inválida. Volte a Documentos.');
    const erro=url.searchParams.get('error'), diag=erroMicrosoft(erro,url.searchParams.get('error_description'));
    if(erro)throw new DriveError('A Microsoft não concluiu a autorização'+(diag?' ('+diag+')':'')+'.',409);
    const state=await estadoPendente(req,raw);
    if(!state)throw new DriveError('A autorização expirou ou foi aberta em outro navegador.',403);
    const code=url.searchParams.get('code');
    if (!code) throw new DriveError('A Microsoft não enviou o código de autorização.');
    const t=await token({grant_type:'authorization_code',code,redirect_uri:callback,code_verifier:state.pkce},state.secret,state.client,state.tipo);
    if (!t.refresh) throw new DriveError('A Microsoft não autorizou acesso contínuo.');
    const root=await graph(t.access,'/me/drive/root:/'+caminho(ROOT)+'?$select='+SELECT);
    if (!root.folder || !root.parentReference?.driveId) throw new DriveError('A conta não contém a pasta Documentos do Beira Rio.');
    const d={...t,client:state.client,secret:state.secret,tipo:state.tipo,drive:root.parentReference.driveId,root:root.id};
    for(const p of [['Propostas'],['Compradores'],['Contratos','Assinados'],['Contratos','Redigidos','Word'],['Contratos','Negociações']])
      await pasta(d,p);
    await q(gravaSql,[configKey,sela(configKey,d)]);
    await q('delete from carteira.config_geral where chave=$1',['onedrive_state:'+raw]);
    return new Response(null,{status:303,headers:{Location:new URL('/#onedrive',origin).href,
      'Set-Cookie':COOKIE+'=; Path=/api/onedrive; Secure; HttpOnly; SameSite=Lax; Max-Age=0','Cache-Control':'no-store'}});
  }
  async function listagem(url) {
    const d=await sessao(), cursor=url.searchParams.get('cursor');
    const state=cursor?abreTicket('pasta',cursor):{partes:[],busca:(url.searchParams.get('busca')||'').trim().slice(0,100)};
    if (state.drive && state.drive!==d.drive) throw new DriveError('O OneDrive foi trocado. Abra a pasta novamente.');
    const busca=state.busca ? esc(state.busca.replaceAll("'","''")).replaceAll("'","%27") : '';
    const at=state.next || (busca?arq(d,d.root)+"/search(q='"+busca+"')":arq(d,(await pasta(d,state.partes)).id)+'/children')+'?$top=120&$select='+SELECT;
    const r=await graph(d.access,at);
    const sinal = (partes,next,busca) => ticket('pasta',{partes,next,busca,drive:d.drive});
    return {pastas:state.partes,
      trilha:[[],...state.partes.map((_,i)=>state.partes.slice(0,i+1))].map(partes=>({nome:partes.at(-1)||'Documentos',cursor:sinal(partes)})),
      itens:(r.value||[]).filter(x=>!x.remoteItem && validSegment(x.name) && (x.folder||x.file)).flatMap(x=>{
        const pai=busca?caminhoPai(x,d.drive):state.partes;
        if(!pai || pai.some(x=>!validSegment(x)))return [];
        return [{nome:x.name,tamanho:x.size,pasta:!!x.folder,pai:busca?pai.join(' / '):null,cursor:x.folder?sinal([...pai,x.name]):
          ticket('arquivo',{drive:d.drive,id:x.id})}];
      }), proximo:r['@odata.nextLink']?sinal(state.partes,r['@odata.nextLink'],state.busca):null};
  }
  async function abrirRef(ref) {
    const d=await sessao();
    if(!ref || ref.drive!==d.drive) throw new DriveError('O arquivo está em outra conta do OneDrive.',404);
    const item=await graph(d.access,arq(d,ref.id));
    const url=item['@microsoft.graph.downloadUrl'];
    if(!item.file || !url || new URL(url).protocol!=='https:') throw new DriveError('O OneDrive não liberou este arquivo.',502);
    return {url,nome:item.name,mime:item.file.mimeType,tamanho:item.size};
  }
  async function iniciaArquivo({destino,size,ator,contexto}) {
    if (!Number.isSafeInteger(size) || size<1 || size>MAX_FILE)
      throw new DriveError('Selecione um arquivo de até 250 MB.');
    const d=await sessao();
    const dirs=[...destino.pastas];
    const subpasta=dirs[0]==='Compradores'||dirs[1]==='Negociações'?dirs.pop():null;
    let p=await pasta(d,dirs);
    if(subpasta){
      const busca=()=>graph(d.access,arq(d,p.id)+':/'+esc(subpasta)+'?$select='+SELECT,{},true);
      let sub=await busca();
      if(!sub){
        try {sub=await graph(d.access,arq(d,p.id)+'/children',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({name:subpasta,folder:{},'@microsoft.graph.conflictBehavior':'fail'})});}
        catch(e){if(e.status!==409)throw e;sub=await busca();}
      }
      if(!sub?.folder || sub.remoteItem) throw new DriveError('A pasta do comprador não está disponível.');
      p=sub;
    }
    const r=await graph(d.access,arq(d,p.id)+':/'+esc(destino.nome)+':/createUploadSession',{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({item:{'@microsoft.graph.conflictBehavior':'rename',name:destino.nome}})});
    if(!r.uploadUrl || new URL(r.uploadUrl).protocol!=='https:') throw new DriveError('O OneDrive não iniciou o envio.',502);
    return {url:r.uploadUrl, ticket:ticket('envio',{drive:d.drive,pai:p.id,ator,contexto,size,destino})};
  }
  async function confirmaArquivo(raw,id,ator,contexto) {
    const t=abreTicket('envio',raw);
    if(t.ator!==ator || JSON.stringify(t.contexto)!==JSON.stringify(contexto)) throw new DriveError('O envio é de outro documento.',403);
    const d=await sessao();
    if(t.drive!==d.drive || typeof id!=='string' || !id || id.length>300) throw new DriveError('Arquivo do OneDrive inválido.');
    const item=await graph(d.access,arq(d,id)+'?$select='+SELECT);
    if(!item.file || item.remoteItem || item.size!==t.size || item.parentReference?.id!==t.pai) throw new DriveError('O OneDrive não confirmou o arquivo enviado.',409);
    const ext=/\.[^.]+$/.exec(t.destino.nome)?.[0] || '';
    const base=t.destino.nome.slice(0,t.destino.nome.length-ext.length);
    const adicional=item.name.slice(base.length,item.name.length-ext.length);
    if(item.name!==t.destino.nome && !(item.name.startsWith(base) && item.name.endsWith(ext) && /^ ?\(\d+\)$/.test(adicional)))
      throw new DriveError('O arquivo gravado não corresponde ao envio.',409);
    return {drive:d.drive,id:item.id,nome:item.name,tamanho:item.size,mime:item.file.mimeType,destino:t.destino};
  }
  async function lerBytes(ref) {
    const a=await abrirRef(ref);
    if(a.tamanho>20*1024*1024) throw new DriveError('Abra o PDF no validador de assinaturas para conferir este arquivo.');
    const r=await fetcher(a.url,{signal:AbortSignal.timeout(12000)});
    if(!r.ok) throw new DriveError('Não foi possível ler o documento no OneDrive.',502);
    return Buffer.from(await r.arrayBuffer()).toString('base64');
  }
  async function rota(p, m, body, real, url, ator, prepara, req) {
    if (p[0]!=='onedrive') return null;
    if (!['luis','assistente'].includes(real)) return json({erro:'Use o login individual da equipe.'},403);
    try {
      const anterior=req && cookie(req)?.split('.')[0];
      if(m==='GET'&&p[1]==='status'){
        const retomavel=ok && real==='luis' && anterior && await estadoPendente(req,anterior).catch(()=>null);
        return json({configuravel:ok,conectado:await temConexao(),retomavel:!!retomavel});
      }
      if(m==='POST'&&p[1]==='conectar'&&real==='luis'){
        if (!ok) throw new DriveError('O armazenamento seguro do OneDrive ainda não foi configurado.',503);
        await garante();
        const anteriorEstado=body.retomar&&req?await estadoPendente(req,anterior).catch(()=>null):null;
        if(body.retomar&&!anteriorEstado)throw new DriveError('A tentativa anterior expirou. Informe os dados do aplicativo novamente.',403);
        const client=String(anteriorEstado?.client||body.client||'').trim(), secret=String(anteriorEstado?.secret||body.secret||'').trim();
        const tipo=(anteriorEstado?.tipo||body.tipo)==='empresa'?'empresa':'pessoal';
        if(!/^[a-f\d-]{36}$/i.test(client)||secret.length<8||secret.length>512) throw new DriveError('Preencha o ID e o valor do segredo do aplicativo Microsoft.');
        const state=randomBytes(32).toString('hex'), browser=randomBytes(24).toString('hex'), pkce=randomBytes(32).toString('base64url');
        await q("delete from carteira.config_geral where chave like 'onedrive_state:%' and em<now()-interval '1 hour'");
        await q(gravaSql,['onedrive_state:'+state,ticket('oauth',{client,secret,browser,pkce,tipo},20*60e3)]);
        if(anteriorEstado)await q('delete from carteira.config_geral where chave=$1',['onedrive_state:'+anterior]);
        const auth=new URL(microsoft(tipo)+'/authorize');
        auth.search=new URLSearchParams({client_id:client,response_type:'code',response_mode:'query',redirect_uri:callback,scope:SCOPES,state,
          code_challenge_method:'S256',code_challenge:createHash('sha256').update(pkce).digest('base64url')});
        const r=json({url:auth.href});
        r.headers.set('Set-Cookie',COOKIE+'='+state+'.'+browser+'; Path=/api/onedrive; Secure; HttpOnly; SameSite=Lax; Max-Age=1200');
        return r;
      }
      if(m==='GET'&&p[1]==='listar') return json(await listagem(url));
      if(m==='GET'&&p[1]==='abrir') return json(await abrirRef(abreTicket('arquivo',url.searchParams.get('cursor'))));
      if(m==='POST'&&p[1]==='teste'&&real==='luis'&&!p[2]){
        const data=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date());
        const nome='TESTE Carteira Beira Rio - '+data+' - '+randomBytes(4).toString('hex')+'.txt';
        const sessao=await iniciaArquivo({destino:{pastas:['Propostas'],nome},size:Buffer.byteLength(TESTE),ator,contexto:CONTEXTO_TESTE});
        return json({...sessao,nome,conteudo:TESTE});
      }
      if(m==='POST'&&p[1]==='teste'&&real==='luis'&&p[2]==='conferir'){
        const ref=await confirmaArquivo(body.ticket,body.id,ator,CONTEXTO_TESTE);
        if(await lerBytes(ref)!==Buffer.from(TESTE).toString('base64'))throw new DriveError('O conteúdo do teste gravado diverge do arquivo enviado.',409);
        return json({nome:ref.nome,pasta:'Propostas',tamanho:ref.tamanho});
      }
      if(m==='POST'&&p[1]==='enviar'){
        const {destino,contexto}=await prepara(body);
        return json(await iniciaArquivo({destino,size:body.tamanho,ator,contexto}));
      }
      return json({erro:'Rota inválida.'},404);
    } catch(e) { return json({erro:e.status?e.message:'Falha ao acessar o OneDrive. Tente novamente.'},e.status||502); }
  }
  return {rota,temConexao,confirmaConta,abrirRef,confirmaArquivo,lerBytes};
}
