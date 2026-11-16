import test from 'node:test';
import assert from 'node:assert/strict';
import { criaOneDrive, destinoArquivo } from '../netlify/functions/onedrive-lib.mjs';
import { criaDocumentos } from '../netlify/functions/documentos-lib.mjs';
import { enviaAnexo } from '../public/ferramentas/onedrive.mjs';

const contrato={numero:'0252',quadra:'01',lote:'10',comprador:'Compradora Exemplo'};
test('seleciona as pastas existentes e usa uma subpasta por comprador ou negociação',()=>{
  for(const [chave,pastas] of [
    ['proposta',['Propostas']],['p1_rg',['Compradores','Compradora Exemplo']],
    ['contrato_minuta',['Contratos','Redigidos','Word']],['contrato_assinado',['Contratos','Assinados']],
    ['termo_assinado_0252-001',['Contratos','Negociações','0252-001 - Q01 L10 - Compradora Exemplo']],
  ])assert.deepEqual(destinoArquivo({...contrato,nome:'certificado.pdf',chave}).pastas,pastas);
  assert.throws(()=>destinoArquivo({...contrato,nome:'teste.pdf',chave:'../../fora'}),/Classifique/);
});

const json=(body,status=200)=>Response.json(body,{status});
test('conecta com estado descartável e mantém toda a navegação no acervo configurado',async()=>{
  const configs=new Map();
  let nomeGravado='0252 - Q01 L10 - Proposta.pdf';
  const q=async(sql,args=[])=>{
    if(sql.startsWith('select'))return configs.has(args[0])?[{valor:configs.get(args[0])}]:[];
    if(sql.startsWith('insert'))configs.set(...args);
    if(sql.startsWith('delete') && args.length)configs.delete(args[0]);
    return [];
  };
  const env={ONEDRIVE_TOKEN_KEY:Buffer.alloc(32,4).toString('base64')};
  const fetcher=async(input,opt)=>{
    const url=new URL(input);
    if(url.hostname==='login.microsoftonline.com'){
      assert.equal(opt.body.get('grant_type'),'authorization_code');
      assert.ok(opt.body.get('code_verifier'));
      return json({access_token:'access-test',refresh_token:'refresh-test',expires_in:3600});
    }
    assert.equal(url.hostname,'graph.microsoft.com');
    assert.equal(opt.headers.Authorization,'Bearer access-test');
    if(url.pathname.includes('/search('))return json({value:[
      {id:'dentro',name:'Pasta',folder:{},parentReference:{driveId:'drive',path:'/drive/root:/Beira%20Rio/Beira%20Rio%20ADM/Documentos/Compradores'}},
      {id:'fora',name:'Privado.pdf',file:{},parentReference:{driveId:'drive',path:'/drive/root:/Pessoal'}},
    ]});
    if(url.pathname.endsWith('/children'))return json({value:[
      {id:'proposal',name:'Propostas',folder:{}},{id:'doc',name:'Teste.pdf',file:{mimeType:'application/pdf'}},
      {id:'outside',name:'Atalho',folder:{},remoteItem:{id:'fora'}},
    ]});
    if(url.pathname.endsWith('/createUploadSession'))return json({uploadUrl:'https://upload.example.net/session'});
    if(url.pathname.endsWith('/items/doc'))return json({id:'doc',name:nomeGravado,size:4,file:{mimeType:'application/pdf'},parentReference:{id:'folder'},'@microsoft.graph.downloadUrl':'https://download.example.net/arquivo'});
    return json({id:url.pathname.includes('/me/drive/')?'root':'folder',folder:{},parentReference:{driveId:'drive'}});
  };
  const od=criaOneDrive({q,json,fetcher,env});
  const route=(p,m,body,real='luis',query='',prepara,req)=>od.rota(['onedrive',p],m,body,real,new URL('https://local.invalid/api/onedrive/'+p+query),'equipe',prepara,req);
  assert.equal((await route('conectar','POST',{},'assistente')).status,404);
  const r=await route('conectar','POST',{client:'11111111-1111-1111-1111-111111111111',secret:'segredo-de-teste'});
  const auth=new URL((await r.json()).url);
  assert.match(auth.pathname,/consumers\/oauth2/);
  const state=auth.searchParams.get('state');
  const cookie=r.headers.get('Set-Cookie').split(';')[0];
  const url=new URL('https://papaya-cocada-88fc90.netlify.app/api/onedrive/retorno?state='+state+'&code=abc');
  const erro=new URL(url);erro.searchParams.set('error','server_error');
  await assert.rejects(()=>od.confirmaConta(new Request(erro,{headers:{cookie}}),erro),/server_error/);
  const req=new Request(url,{headers:{cookie}});
  assert.equal((await (await route('status','GET',{},'luis','',null,req)).json()).retomavel,true);
  const rr=await route('conectar','POST',{retomar:true},'luis','',null,req);
  const novo=new URL(url);novo.searchParams.set('state',new URL((await rr.json()).url).searchParams.get('state'));
  const novoCookie=rr.headers.get('Set-Cookie').split(';')[0];
  await assert.rejects(()=>od.confirmaConta(req,url),/expirou/);
  assert.equal((await od.confirmaConta(new Request(novo,{headers:{cookie:novoCookie}}),novo)).status,303);
  await assert.rejects(()=>od.confirmaConta(new Request(novo,{headers:{cookie:novoCookie}}),novo),/expirou/);
  assert.ok(![...configs.values()].some(v=>v.includes('refresh-test')));
  const list=await (await route('listar','GET',{},'assistente')).json();
  assert.deepEqual(list.itens.map(i=>i.nome),['Propostas','Teste.pdf']);
  const filtro=await (await route('listar','GET',{},'assistente','?busca=proposta')).json();
  assert.deepEqual(filtro.itens.map(i=>i.nome),['Pasta']);
  assert.equal((await route('abrir','GET',{},'assistente','?cursor=invalido')).status,403);
  const doc=await (await route('abrir','GET',{},'assistente','?cursor='+list.itens[1].cursor)).json();
  assert.match(doc.url,/download.example.net/);
  const destino=destinoArquivo({...contrato,nome:'certificado.pdf',chave:'proposta'}),contexto={contrato:'0252',chave:'proposta'};
  const sessao=await (await route('enviar','POST',{tamanho:4},'assistente','',async()=>({destino,contexto}))).json();
  assert.equal((await od.confirmaArquivo(sessao.ticket,'doc','equipe',contexto)).id,'doc');
  nomeGravado='0252 - Q01 L10 - Proposta 1.pdf';
  assert.equal((await od.confirmaArquivo(sessao.ticket,'doc','equipe',contexto)).nome,nomeGravado);
  nomeGravado='Outros dados.pdf';
  await assert.rejects(()=>od.confirmaArquivo(sessao.ticket,'doc','equipe',contexto),/não corresponde/);
  await assert.rejects(()=>od.confirmaArquivo(sessao.ticket,'doc','outra',contexto),/outro documento/);
});

test('armazena a referência do OneDrive sem bytes no banco',async()=>{
  let insert;
  const ref={drive:'drive',id:'file',tamanho:123,nome:'Proposta.pdf',mime:'application/pdf'};
  const q=async(sql,args)=>{if(sql.startsWith('insert into carteira.documentos')){insert=args;return [{id:9}];}return [];};
  const documentos=criaDocumentos({q,json,log:async()=>{},onedrive:{temConexao:async()=>true,confirmaArquivo:async()=>ref}});
  const meta={contrato:'0252',chave:'proposta',nome:'original.pdf',mime:'application/pdf'};
  const url=new URL('https://local.invalid');
  const resposta=await documentos(['documento'],'POST',{...meta,onedrive:{ticket:'recibo',id:'file'}},'assistente',url,'secretaria@test.invalid');
  assert.equal((await resposta.json()).id,9);
  assert.equal(insert[5],'');
  assert.equal(insert[7].onedrive.id,'file');
  assert.equal((await documentos(['documento'],'POST',{...meta,b64:'ZmlsZQ=='},'assistente',url)).status,409);
});

test('envia arquivos grandes por partes e vincula somente após a confirmação',async t=>{
  const chamadas=[],partes=[];
  const file = new File([new Uint8Array(4_000_000)],'contrato.pdf',{type:'application/pdf'});
  t.mock.method(globalThis,'fetch',async(url,opt)=>{
    partes.push(opt.headers['Content-Range']);
    return partes.length===1?json({nextExpectedRanges:['3276800-']},202):json({id:'drive-file'},201);
  });
  const api=async(path,opt)=>{
    chamadas.push([path,opt.body]);
    if(path==='onedrive/enviar')return {url:'https://upload.example.net/sessao',ticket:'ticket'};
    return {id:1};
  };
  await enviaAnexo(api,{contrato:'0252',chave:'contrato_assinado'},file,{conectado:true});
  assert.deepEqual(partes,['bytes 0-3276799/4000000','bytes 3276800-3999999/4000000']);
  assert.deepEqual(chamadas.map(x=>x[0]),['onedrive/enviar','documento']);
  assert.equal(chamadas[1][1].b64,undefined);
  assert.equal(chamadas[1][1].onedrive.id,'drive-file');
});
