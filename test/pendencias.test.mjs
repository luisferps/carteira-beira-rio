import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const code=html.slice(html.indexOf('async function salvaPend('),html.indexOf('function blocoPendencias('));
function fixture({text='Conversar pessoalmente antes de cobrar',status='aberta',fail=false}={}){
 const fields={'#pend_texto':{value:text},'#pend_resp':{value:'Luis'},'#pend_status':{value:status},'#pend_resultado':{value:'Apurar diferenças'},'#pend_salvar':{disabled:false},'#pend_erro':{textContent:''}};
 const calls=[];let closed=false,reloaded=false;
 const C={hoje:'2026-11-07',contrato:{numero:'0094'},eventos:[{id:7,data:'2026-09-01',obs:'Anterior',dados:{fonte:'legado'}}]};
 const ctx=vm.createContext({C,$:k=>fields[k],api:async(...args)=>{calls.push(args);if(fail)throw Error('Sem conexão');},fechaModal:()=>{closed=true},recarrega:async()=>{reloaded=true}});vm.runInContext(code,ctx);
 return {ctx,fields,calls,get closed(){return closed},get reloaded(){return reloaded}};
}
test('salva pendência e resolução preservando origem e data do evento',async()=>{const f=fixture({status:'resolvida'});await f.ctx.salvaPend(7);const [url,req]=f.calls[0];assert.equal(url,'evento/7');assert.equal(req.method,'PUT');assert.equal(req.body.data,'2026-09-01');assert.equal(req.body.dados.fonte,'legado');assert.equal(req.body.dados.resolvida_em,'2026-11-07');assert.equal(req.body.obs,'Conversar pessoalmente antes de cobrar');assert.ok(f.closed&&f.reloaded);});
test('reabrir retira data da resolução sem apagar evento',async()=>{const f=fixture();await f.ctx.salvaPend(7);assert.equal(f.calls[0][1].body.dados.status,'aberta');assert.equal(f.calls[0][1].body.dados.resolvida_em,null);});
test('falha mantém formulário e informa erro; vazio não grava',async()=>{const f=fixture({fail:true});await f.ctx.salvaPend(null);assert.equal(f.closed,false);assert.equal(f.fields['#pend_salvar'].disabled,false);assert.equal(f.fields['#pend_erro'].textContent,'Sem conexão');const empty=fixture({text:'  '});await empty.ctx.salvaPend(null);assert.equal(empty.calls.length,0);});
