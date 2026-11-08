import test from 'node:test';
import assert from 'node:assert/strict';
import { criaBuscaRegistros } from '../netlify/functions/registros-rag.mjs';
test('busca de registros exige identificação e consulta parametrizada sem gravar', async()=>{
 let args;
 const buscar=criaBuscaRegistros(async(...a)=>{args=a;return [{fonte_id:'evento:10',contrato:'0094',tipo:'pendencia',trecho:'Luis conversar pessoalmente com Marcone',status:'aberta'}]});
 assert.ok((await buscar({contrato:'x'})).erro);assert.equal(args,undefined);
 const query="x'); delete from carteira.eventos; --";
 const r=await buscar({contrato:'0094',texto:query,limite:100});
 assert.ok(!args[0].includes(query));assert.deepEqual(args[1],['0094',query,30]);
 assert.match(args[0],/^with fontes as/);assert.equal(r.fontes[0].fonte_id,'evento:10');
 assert.equal(r.fontes[0].url,'https://papaya-cocada-88fc90.netlify.app/#c/0094');
 assert.match(r.aviso,/não comprova/);
});
