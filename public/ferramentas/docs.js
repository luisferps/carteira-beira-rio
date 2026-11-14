/* Documentos do contrato: informe de pagamentos para o Imposto de Renda e termo de quitação (prévia na tela -> PDF com a marca d'água) */
(function(){
const BRL=n=>'R$ '+Number(n||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const DBR=d=>d?String(d).slice(0,10).split('-').reverse().join('/'):'';
const MES=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const dataExt=d=>{const [a,m,dd]=String(d).slice(0,10).split('-');return `${+dd} de ${MES[+m-1]} de ${a}`};
const E=x=>String(x??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fcpf=s=>{const d=String(s||'').replace(/\D/g,'');return d.length===11?d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,'$1.$2.$3-$4'):''};
const nn=x=>String(x||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/\s+/g,' ').trim();
const PAGO=['paga','paga_atraso','quitada_acordo','quitada_repact','cancelada','diluida'];

function titulares(){const c=C.contrato;
  const ces=(C.eventos||[]).filter(e=>e.tipo==='cessao'&&e.dados?.subtipo!=='credito'&&e.dados?.novos_titulares&&!/não informado/.test(e.dados.novos_titulares)).sort((a,b)=>String(b.data).localeCompare(String(a.data)))[0];
  const base=(c.compradores||[]).map(x=>({nome:x.nome,cpf:x.cpf||''}));
  if(!ces)return base;
  return ces.dados.novos_titulares.split(/\s+e\s+/).map(n=>{const nome=n.trim();const k=(C.clientes||[]).find(x=>nn(x.nome)===nn(nome))||base.find(x=>nn(x.nome)===nn(nome));return {nome:nome.toUpperCase(),cpf:k?.cpf||''}})}
const imovel=()=>{const c=C.contrato;return `Lote ${E(c.lote)} da Quadra ${E(c.quadra)}${c.rua?', '+E(/^rua/i.test(c.rua)?c.rua:'Rua '+c.rua):''}${c.area?', com '+Number(c.area).toLocaleString('pt-BR')+' m²':''}, do Condomínio de Chácaras Beira Rio, município de Varjão/GO`};
const nomesCpf=L=>L.map(t=>`<b>${E(t.nome)}</b>${fcpf(t.cpf)?', CPF '+fcpf(t.cpf):''}`).join(' e ');
const VEND='<b>FCA CONSTRUTORA E INCORPORADORA LTDA</b>, CNPJ 46.228.347/0001-97, por sua administradora de carteira, <b>INERENTE GESTÃO IMOBILIÁRIA</b>';
const P=(x,al)=>`<p${al?` style="text-align:${al}"`:''}>${x}</p>`,V='<p><br></p>';
const assin=()=>V+V+P('_____________________________________________','center')+P('<b>INERENTE GESTÃO IMOBILIÁRIA</b>','center')+P('Administradora de carteira da FCA Construtora e Incorporadora Ltda','center')+P('Luis Fernando · CRECI 19898-GO','center');
const pagos=()=>(C.pagamentos||[]).filter(p=>p.confirmada_em&&+p.valor_pago>0&&(!p.conferente||p.conferente==='luis')).map(p=>({...p,t:C.titulos.find(t=>t.id===p.titulo_id)})).sort((a,b)=>String(a.confirmada_em).localeCompare(String(b.confirmada_em)));
const soma=L=>Math.round(L.reduce((s,p)=>s+(+p.valor_pago||0),0)*100)/100;

window.htmlInformeIR=function(ano){const c=C.contrato,L=pagos(),noAno=L.filter(p=>String(p.confirmada_em).slice(0,4)===String(ano));
  const ate=a=>soma(L.filter(p=>String(p.confirmada_em).slice(0,4)<=String(a)));
  const linhas=noAno.map(p=>`<tr><td>${DBR(p.confirmada_em)}</td><td>${E(p.t?.rotulo||'Pagamento')}</td><td style="text-align:right">${BRL(p.valor_pago)}</td></tr>`).join('');
  return `<h1>INFORME DE PAGAMENTOS — ANO-CALENDÁRIO ${ano}</h1>${P('Para fins de declaração do Imposto de Renda Pessoa Física','center')}${V}
  ${P(`<b>Vendedora:</b> ${VEND}.`)}
  ${P(`<b>${titulares().length<2?'Comprador':'Compradores'}:</b> ${nomesCpf(titulares())}.`)}
  ${P(`<b>Imóvel:</b> ${imovel()}.`)}
  ${P(`<b>Contrato:</b> nº ${E(c.numero)}, assinado em ${DBR(c.data_assinatura)}${c.valor_imovel?', valor do imóvel '+BRL(c.valor_imovel):''}.`)}
  ${V}${P(`<b>Pagamentos recebidos em ${ano}</b>`,'left')}
  <table><thead><tr><th style="width:22%">Data do pagamento</th><th>Parcela</th><th style="width:26%">Valor pago</th></tr></thead><tbody>${linhas||'<tr><td colspan="3">Nenhum pagamento recebido no ano.</td></tr>'}
  <tr class="tot"><td colspan="2"><b>Total pago em ${ano}</b></td><td style="text-align:right"><b>${BRL(soma(noAno))}</b></td></tr></tbody></table>
  ${V}<table><tbody><tr><td>Total pago até 31/12/${ano-1}</td><td style="width:26%;text-align:right">${BRL(ate(ano-1))}</td></tr><tr><td>Total pago até 31/12/${ano}</td><td style="text-align:right"><b>${BRL(ate(ano))}</b></td></tr></tbody></table>
  ${P('Os valores incluem multa, juros e encargos pagos, quando houve. Informe emitido com base nos pagamentos confirmados no banco.')}
  ${V}${P(`Goiânia/GO, ${dataExt(C.hoje)}.`,'right')}${assin()}`};

window.contratoQuitado=function(){const ts=C.titulos||[];return ts.length>0&&ts.every(t=>PAGO.includes(estado(t)))&&!(C.eventos||[]).some(e=>e.tipo==='encerramento')};
window.htmlQuitacao=function(){const c=C.contrato,L=pagos(),tot=soma(L),ult=L.length?L[L.length-1].confirmada_em:null,T=titulares(),um=T.length<2;
  return `<h1>TERMO DE QUITAÇÃO</h1>${V}
  ${P(`${VEND}, declara para os devidos fins que ${nomesCpf(T)} ${um?'pagou':'pagaram'} integralmente o preço do ${imovel()}, objeto do Contrato Particular de Promessa de Venda e Compra nº ${E(c.numero)}, assinado em ${DBR(c.data_assinatura)}.`)}
  ${P(`O total recebido foi de <b>${BRL(tot)}</b>${typeof window.extensoReais==='function'?' ('+window.extensoReais(tot)+')':''}, em ${L.length} pagamento(s), sendo o último em ${DBR(ult)}, incluídos multa, juros e encargos, quando houve.`)}
  ${P('Com isso, dá plena, geral e irrevogável quitação das obrigações de pagamento do referido contrato, nada mais tendo a reclamar a esse título, ficando '+(um?'o comprador apto':'os compradores aptos')+' a requerer a escritura definitiva, cujas despesas (ITBI, emolumentos, registro e taxas) correm por conta '+(um?'dele':'deles')+', conforme o contrato.')}
  ${V}${P(`Goiânia/GO, ${dataExt(C.hoje)}.`,'right')}${assin()}`};

async function garanteTermo(){if(!window.pdfBlobInerente)await carregaTermo()}
const nomeArq=(tipo,extra)=>{const c=C.contrato,t=titulares()[0]?.nome||'';return `${c.numero} - Q${c.quadra} L${c.lote} - ${tipo}${extra?' '+extra:''} - ${t}`.replace(/[\\/:*?"<>|]/g,'')};
async function previa(titulo,html,arq){await garanteTermo();window._DOC={html,arq};
  abreModal(`<h3 style="margin-top:0">${E(titulo)} — prévia</h3><div style="background:#fff;color:#000;border:1px solid #ccc;padding:24px;max-height:60vh;overflow:auto;font-family:Arial;font-size:12px;line-height:1.45">${html}</div>
  <div class="bt" style="margin-top:10px"><button class="pri" onclick="baixaDocPdf(this)">Baixar PDF</button><button onclick="fechaModal()">Fechar</button></div>`)}
window.baixaDocPdf=async function(b){b.disabled=true;b.textContent='Gerando…';try{const blob=await window.pdfBlobInerente(window._DOC.html);const nome=window._DOC.arq+'.pdf';
  if(window.showSaveFilePicker){try{const fh=await window.showSaveFilePicker({suggestedName:nome,types:[{description:'PDF',accept:{'application/pdf':['.pdf']}}]});const w=await fh.createWritable();await w.write(blob);await w.close();b.textContent='Salvo';return}catch(e){if(e.name==='AbortError'){b.disabled=false;b.textContent='Baixar PDF';return}}}
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=nome;a.click();b.textContent='Baixado'}catch(e){alert('Não consegui gerar o PDF: '+e.message);b.disabled=false;b.textContent='Baixar PDF'}};
window.modalInformeIR=function(){const ano=new Date().getFullYear()-1;const anos=[...new Set(pagos().map(p=>+String(p.confirmada_em).slice(0,4)))].sort((a,b)=>b-a);
  if(!anos.length)return alert('Este contrato não tem pagamento confirmado.');const a=anos.includes(ano)?ano:anos[0];
  abreModal(`<h3 style="margin-top:0">Informe de pagamentos para o Imposto de Renda</h3><label>Ano</label><select id="ir_ano" style="max-width:160px">${anos.map(x=>`<option ${x===a?'selected':''}>${x}</option>`).join('')}</select>
  <div class="bt" style="margin-top:10px"><button class="pri" onclick="const y=+$('#ir_ano').value;abreInformeIR(y)">Ver prévia</button><button onclick="fechaModal()">Cancelar</button></div>`)};
window.abreInformeIR=ano=>previa('Informe de pagamentos '+ano,window.htmlInformeIR(ano),nomeArq('Informe de Pagamentos IR',ano));
window.abreQuitacao=function(){if(!window.contratoQuitado()&&!confirm('O sistema ainda mostra parcela em aberto neste contrato. Gerar o termo de quitação mesmo assim?'))return;
  previa('Termo de quitação',window.htmlQuitacao(),nomeArq('Termo de Quitação'))};
})();
