/* conferência em lote: importa do Asaas, compara com o legado; sem divergência real -> fecha; com divergência -> lista */
window.DIV=async n=>{const H={'x-pin':localStorage.cbr_pin};const [C,L]=await Promise.all([fetch('/api/contrato/'+n,{headers:H}).then(r=>r.json()),fetch('/api/legado-contrato/'+n,{headers:H}).then(r=>r.json())]);
  const hoje=C.hoje||new Date().toISOString().slice(0,10),FOTO='2026-09-28';
  const acOr=new Set(C.acordos.flatMap(a=>a.titulos_origem.map(Number)));const enc=C.eventos.find(e=>e.tipo==='encerramento');const t0=enc&&C.titulos.find(t=>t.id==enc.a_partir_titulo);
  const pagDe=t=>C.pagamentos.filter(p=>p.titulo_id==t.id);
  const nosso=t=>{if(pagDe(t).length)return 'paga';if(acOr.has(+t.id))return 'paga';const s=C.situacoes.find(s=>s.titulo_id==t.id);if(s&&s.situacao==='cancelada')return 'cancelada';if(t0&&t.grupo!=='acordo'&&t.vencimento>=t0.vencimento)return 'cancelada';if(t.vencimento<=hoje)return 'em_atraso';return 'a_vencer'};
  const ents=C.titulos.filter(t=>!t.conferente&&t.grupo==='entrada').sort((a,b)=>a.numero-b.numero);const hasS=(L.parcelas||[]).some(x=>x.tipo==='sinal');const out=[];
  if(!Array.isArray(L.parcelas)||!L.parcelas.length)return ['legado sem parcelas'];
  for(const p of L.parcelas){if(p.data_vencimento>hoje)continue;let t;
    if(p.tipo==='sinal')t=ents[0];else if(p.tipo==='entrada')t=ents[p.numero-1+(hasS?1:0)];else t=C.titulos.find(x=>!x.conferente&&x.grupo===p.tipo&&x.numero==p.numero);
    if(!t){out.push(p.tipo+' '+p.numero+': não existe no novo');continue}
    const lv=p.situacao==='paga'?'paga':p.situacao==='cancelada'?'cancelada':p.situacao==='a_vencer'?'a_vencer':'em_atraso';const nv=nosso(t);if(lv===nv)continue;
    if(nv==='paga'&&lv==='a_vencer')continue; /* legado projetou e não marcou; Asaas mostra paga */
    if(nv==='paga'&&lv==='em_atraso'&&pagDe(t).some(x=>x.fatura&&x.forma!=='Pagamento à construtora'))continue; /* boleto pago no Asaas: Asaas é a autoridade */
    if(nv==='paga'&&lv==='cancelada'&&/acordo|reneg/i.test(p.quitada_via||''))continue; /* legado chama de cancelada a parcela quitada por acordo */
    if(nv==='paga'&&pagDe(t).every(x=>String(x.confirmada_em||'')>FOTO))continue; /* pago depois da foto do legado */
    if(lv!=='paga'&&nv!=='paga'&&lv!=='cancelada'&&nv!=='cancelada')continue; /* atraso x a vencer: só data da foto */
    out.push(t.rotulo.replace(/\/\d+$/,'')+' (venc '+t.vencimento+'): novo '+nv+' | legado '+lv+(p.quitada_via?'/'+p.quitada_via:'')+(p.data_pagamento?' pago '+p.data_pagamento:'')+(p.valor_pago&&+p.valor_pago?' R$ '+p.valor_pago:''))}
  return out};
window.LOTE=async(ns,conc=2)=>{const B=window._BATCH=window._BATCH||{};const fila=ns.slice();
  const um=async n=>{B[n]={st:'rodando'};try{
      const r=await IMP3(n,true);if(r.dup.length||r.estranhos.length||!r.n){B[n]={st:'lista',motivo:'importação: '+(r.dup.length?r.dup.length+' boleto(s) duplicado(s) ':'')+(r.estranhos.length?r.estranhos.length+' boleto(s) estranho(s) ':'')+(!r.n?'nenhum boleto no Asaas':'')};return}
      const l=await IMP3(n);await ENTC(n,[1]);const pg=await PAG(n);const d=await DIV(n);
      const avisos=[];if(pg&&pg.length)avisos.push('pagador que não é comprador: '+pg.map(x=>typeof x==='string'?x:JSON.stringify(x)).join('; ').slice(0,200));/* boletos com descrição de outro contrato são importados no contrato deles */
      if(!d.length&&!avisos.length){const s=await FECHA(n);B[n]={st:s===200?'fechado':'erro ao fechar '+s}}
      else B[n]={st:'lista',div:d,avisos,feito:(l||[]).filter(x=>!/IGNOREI queda/.test(x))};
    }catch(e){B[n]={st:'lista',motivo:'erro: '+e.message}}
    try{localStorage.lote_batch=JSON.stringify(B)}catch(e){}};
  await Promise.all(Array.from({length:conc},async()=>{while(fila.length){await um(fila.shift())}}));window._BATCH_FIM=true;return B};

window.REDIV=async()=>{const B=window._BATCH;for(const [n,v] of Object.entries(B)){if(v.st!=='lista'||v.motivo)continue;const d=await DIV(n);v.div=d;v.avisos=(v.avisos||[]).filter(a=>!/descrição de outro contrato/.test(a));if(!d.length&&!v.avisos.length){const s=await FECHA(n);B[n]={st:s===200?'fechado':'erro ao fechar '+s}}}try{localStorage.lote_batch=JSON.stringify(B)}catch(e){}return B};
