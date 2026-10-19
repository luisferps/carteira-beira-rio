/* Emite o Termo de Confissão e Renegociação de Dívida (.docx) a partir do acordo aberto na tela e salva na pasta Renegociações */
(function(){
const carrega=src=>new Promise((ok,er)=>{if(window.docx)return ok();const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=er;document.head.appendChild(s)});
const BRL=n=>Number(n||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const DBR=d=>d?String(d).slice(0,10).split('-').reverse().join('/'):'';
const MES=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
function ext(n){const u=['','um','dois','três','quatro','cinco','seis','sete','oito','nove','dez','onze','doze','treze','quatorze','quinze','dezesseis','dezessete','dezoito','dezenove'],d=['','','vinte','trinta','quarenta','cinquenta','sessenta','setenta','oitenta','noventa'],c=['','cento','duzentos','trezentos','quatrocentos','quinhentos','seiscentos','setecentos','oitocentos','novecentos'];
  const ate999=x=>{if(x===100)return'cem';const p=[];if(x>=100){p.push(c[Math.floor(x/100)]);x%=100}if(x>=20){p.push(d[Math.floor(x/10)]);x%=10;if(x)p.push(u[x])}else if(x)p.push(u[x]);return p.join(' e ')};
  const int=x=>{if(!x)return'zero';const p=[];const mi=Math.floor(x/1e6),mil=Math.floor(x%1e6/1000),r=x%1000;if(mi)p.push(mi===1?'um milhão':ate999(mi)+' milhões');if(mil)p.push(mil===1?'mil':ate999(mil)+' mil');if(r)p.push(ate999(r));return p.length>1&&(r<100||r%100===0)&&r?p.slice(0,-1).join(' ')+' e '+p[p.length-1]:p.join(' ')};
  const v=Math.round(n*100),re=Math.floor(v/100),ce=v%100;let s='';if(re)s=int(re)+(re===1?' real':(re%1e6===0?' de reais':' reais'));if(ce)s+=(s?' e ':'')+int(ce)+(ce===1?' centavo':' centavos');return s||'zero real'}

async function pasta(){if(!window.showDirectoryPicker)return null;
  const db=await new Promise(r=>{const o=indexedDB.open('cbr-termos',1);o.onupgradeneeded=()=>o.result.createObjectStore('h');o.onsuccess=()=>r(o.result);o.onerror=()=>r(null)});
  const get=()=>db?new Promise(r=>{const q=db.transaction('h').objectStore('h').get('pasta');q.onsuccess=()=>r(q.result);q.onerror=()=>r(null)}):null;
  let h=await get();
  if(h){const p=await h.requestPermission({mode:'readwrite'}).catch(()=>'denied');if(p!=='granted')h=null}
  if(!h){alert('Escolha a pasta "Renegociações" (OneDrive > Beira Rio > Beira Rio ADM > Documentos > Renegociações). Só precisa fazer isso uma vez.');
    h=await window.showDirectoryPicker({mode:'readwrite',id:'renegociacoes'}).catch(()=>null);
    if(h&&db)db.transaction('h','readwrite').objectStore('h').put(h,'pasta')}
  return h}

window.emitirTermo=async function(A0,modo){
  await carrega('/ferramentas/docx.js');
  const D=window.docx,{Document,Packer,Paragraph,TextRun,Table,TableRow,TableCell,WidthType,AlignmentType,BorderStyle,ShadingType,ImageRun,Header,Footer,PageNumber,HorizontalPositionRelativeFrom,VerticalPositionRelativeFrom,TextWrappingType,HorizontalPositionAlign,VerticalPositionAlign}=D;
  const A=A0||window._salvaAcordoDados(),c=C.contrato;
  if(!A.parcelas||!A.parcelas.length){alert('Defina as parcelas do acordo antes de emitir o termo.');return}
  let num=(A.termo||'').trim();if(!num){num=window.proxTermo();A.termo=num;const it=document.querySelector('#a_termo');if(it)it.value=num}
  const ces=(C.eventos||[]).filter(e=>e.tipo==='cessao'&&e.dados?.subtipo!=='credito'&&e.dados?.novos_titulares&&!/não informado/.test(e.dados.novos_titulares)).sort((a,b)=>String(b.data).localeCompare(String(a.data)))[0];
  const dev=ces?ces.dados.novos_titulares.split(/\s+e\s+/).map(n=>({nome:n.trim().toUpperCase(),cpf:''})):(c.compradores||[]).map(x=>({nome:x.nome,cpf:x.cpf||''}));
  const fcpf=s=>{const d=String(s||'').replace(/\D/g,'');return d.length===11?d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,'$1.$2.$3-$4'):'___.___.___-__'};
  const orig=A.titulos_origem.map(id=>C.titulos.find(t=>t.id==id)).filter(Boolean).sort((a,b)=>String(a.vencimento).localeCompare(String(b.vencimento)));
  const L=orig.map(t=>{const k=atrasoDe(t,A.data_acordo);const r=x=>Math.round(x*100)/100;const o={rot:t.rotulo,venc:DBR(t.vencimento),dias:k.dias,v:r(k.v),co:r(k.co),mu:r(k.mu),ju:r(k.ju),ho:r(k.ho)};o.tot=r(o.v+o.co+o.mu+o.ju+o.ho);return o});
  const S=['v','co','mu','ju','ho','tot'].reduce((a,k)=>(a[k]=Math.round(L.reduce((s,x)=>s+x[k],0)*100)/100,a),{});
  const tot=Number(A.valor_acordado),dif=Math.round((S.tot-tot)*100)/100;
  const F='Arial',SZ=20,J=AlignmentType.JUSTIFIED;
  const t=x=>new TextRun({text:x,font:F,size:SZ}),b=x=>new TextRun({text:x,font:F,size:SZ,bold:true});
  const p=(runs,o={})=>new Paragraph({spacing:{after:o.after??120,line:276},alignment:o.al??J,children:(Array.isArray(runs)?runs:[runs]).map(r=>typeof r==='string'?t(r):r)});
  const tit=x=>p([b(x)],{after:80,al:AlignmentType.LEFT});
  const bd={style:BorderStyle.SINGLE,size:4,color:'999999'},borders={top:bd,bottom:bd,left:bd,right:bd};
  const cell=(x,w,o={})=>new TableCell({borders,width:{size:w,type:WidthType.DXA},shading:o.sh?{fill:o.sh,type:ShadingType.CLEAR,color:'auto'}:undefined,margins:{top:40,bottom:40,left:70,right:70},children:[new Paragraph({alignment:o.al??AlignmentType.RIGHT,children:[new TextRun({text:String(x),font:F,size:17,bold:!!o.b})]})]});
  const tab=(W,H,rows,foot)=>new Table({width:{size:W.reduce((a,c)=>a+c,0),type:WidthType.DXA},columnWidths:W,rows:[new TableRow({tableHeader:true,children:H.map((h,i)=>cell(h,W[i],{b:true,sh:'E8EEF4',al:AlignmentType.CENTER}))}),...rows.map(r=>new TableRow({children:r.map((x,i)=>cell(x,W[i],{al:i<2?AlignmentType.LEFT:AlignmentType.RIGHT}))})),...(foot?[new TableRow({children:foot.map((x,i)=>cell(x,W[i],{b:true,sh:'F4F6F8',al:i<2?AlignmentType.LEFT:AlignmentType.RIGHT}))})]:[])]});
  const W1=[1500,1150,600,1200,1000,900,1000,1100,1250];
  const tab1=tab(W1,['Parcela','Vencimento','Dias','Valor','Correção','Multa 2%','Juros 1% a.m.','Custo cobr. 10%','Total'],L.map(x=>[x.rot,x.venc,x.dias,BRL(x.v),x.co?BRL(x.co):'—',BRL(x.mu),BRL(x.ju),x.ho?BRL(x.ho):'—',BRL(x.tot)]),['Total','','',BRL(S.v),BRL(S.co),BRL(S.mu),BRL(S.ju),BRL(S.ho),BRL(S.tot)]);
  const W2=[1500,3000,3000];
  const tab2=tab(W2,['Parcela','Vencimento','Valor (R$)'],A.parcelas.map((x,i)=>[(i+1)+'/'+A.parcelas.length,DBR(x.vencimento),BRL(x.valor)]),['Total','',BRL(A.parcelas.reduce((s,x)=>s+Number(x.valor||0),0))]);
  const hoje=new Date(),dAss=`${hoje.getDate()} de ${MES[hoje.getMonth()]} de ${hoje.getFullYear()}`;
  const kids=[
    p([new TextRun({text:'TERMO DE CONFISSÃO E RENEGOCIAÇÃO DE DÍVIDA',font:F,size:26,bold:true})],{al:AlignmentType.CENTER,after:60}),
    p([b('Nº '+num)],{al:AlignmentType.CENTER,after:60}),
    p([t(`Referente ao Contrato nº ${c.numero} – Condomínio de Chácaras Beira Rio – Quadra ${c.quadra}, Lote ${c.lote}`)],{al:AlignmentType.CENTER,after:300}),
    p([b('CREDORA: '),t('FCA CONSTRUTORA E INCORPORADORA LTDA, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº 46.228.347/0001-97, com sede na Via Gustavo Corção, nº 281, Q26, L01, Condomínio Amin Camargo, Goiânia/GO, neste ato por sua administradora de carteira, INERENTE GESTÃO IMOBILIÁRIA, autorizada à cobrança nos termos do contrato.')]),
    p([b(dev.length>1?'DEVEDORES: ':'DEVEDOR(A): '),t(dev.map(x=>`${x.nome}, inscrito(a) no CPF sob o nº ${fcpf(x.cpf)}`).join('; ')+', já qualificado(s) no Contrato de Origem.')]),
    p('As partes acima qualificadas, doravante denominadas CREDORA e DEVEDOR(ES), celebram o presente Termo de Confissão e Renegociação de Dívida, que se regerá pelas cláusulas seguintes.',{after:200}),
    tit('CLÁUSULA PRIMEIRA – DO CONTRATO DE ORIGEM'),
    p(`O(s) DEVEDOR(ES) é(são) titular(es) dos direitos do Instrumento Particular de Contrato de Venda e Compra de Unidade de Lote de Terreno nº ${c.numero}, firmado em ${DBR(c.data_assinatura)}, referente à chácara situada na Rua ${String(c.rua||'').replace(/^Rua\s+/i,'')}, Quadra ${c.quadra}, Lote ${c.lote}, do Condomínio de Chácaras Beira Rio, município de Varjão/GO, doravante "Contrato de Origem".`),
    tit('CLÁUSULA SEGUNDA – DA CONFISSÃO DA DÍVIDA'),
    p([t('O(s) DEVEDOR(ES) reconhece(m) e confessa(m), de forma irrevogável e irretratável, dever à CREDORA a quantia líquida, certa e exigível de '),b(`R$ ${BRL(tot)} (${ext(tot)})`),t(`, apurada em ${DBR(A.data_acordo)}, correspondente às parcelas vencidas e não pagas do Contrato de Origem abaixo relacionadas, acrescidas dos encargos previstos nas cláusulas 10.2 (multa de 2%), 10.3 (juros de mora de 1% ao mês) e 10.4 (custo de cobrança de 10%) do Quadro Resumo do Contrato de Origem, e da correção anual pactuada:`)]),
    tab1,p('',{after:80}),
    ...(Math.abs(dif)>=0.01?[p([t(dif>0?`Sobre o total apurado de R$ ${BRL(S.tot)} a CREDORA concede, por liberalidade, desconto de R$ ${BRL(dif)} nos encargos, resultando no valor confessado de `:`Ao total apurado de R$ ${BRL(S.tot)} foram acrescidos R$ ${BRL(-dif)} de encargos até a data do acordo, resultando no valor confessado de `),b(`R$ ${BRL(tot)}`),t('.')])]:[]),
    p([t('Composição do valor confessado: principal '),b('R$ '+BRL(A.principal)),t('; multa '),b('R$ '+BRL(A.multa)),t('; juros '),b('R$ '+BRL(A.juros)),t('; custo de cobrança '),b('R$ '+BRL(A.honorarios)),t('.')]),
    tit('CLÁUSULA TERCEIRA – DA FORMA DE PAGAMENTO'),
    p(`O valor confessado será pago em ${A.parcelas.length} parcela(s), por boleto bancário emitido pela administradora da CREDORA, nos valores e vencimentos abaixo:`),
    tab2,p('',{after:80}),
    p('Parágrafo único. Nenhum valor é devido até o vencimento de cada parcela deste acordo; os encargos da Cláusula Quinta só incidem a partir do vencimento não pago.'),
    tit('CLÁUSULA QUARTA – DA NOVAÇÃO'),
    p('As partes declaram, com ânimo de novar (arts. 360, I, e 361 do Código Civil), que a presente renegociação substitui as parcelas relacionadas na Cláusula Segunda, que se extinguem e dão lugar à obrigação ora assumida. Os encargos já vencidos (multa, juros, correção e custo de cobrança) passam a integrar o valor desta nova obrigação.'),
    p('Parágrafo único. A novação alcança somente as parcelas relacionadas na Cláusula Segunda. Permanecem em pleno vigor todas as demais cláusulas do Contrato de Origem, inclusive as parcelas a vencer, a correção anual, a alienação fiduciária em garantia e as hipóteses de rescisão.'),
    tit('CLÁUSULA QUINTA – DO ATRASO NO PAGAMENTO DESTE ACORDO'),
    p('O atraso no pagamento de qualquer parcela deste acordo sujeitará o(s) DEVEDOR(ES), sobre o valor da parcela em atraso, a: (i) multa moratória de 2% (dois por cento); (ii) juros de mora de 1% (um por cento) ao mês, desde o vencimento até o efetivo pagamento; e (iii) após 30 (trinta) dias de atraso, custo de cobrança de 10% (dez por cento) sobre o débito, ou de 20% (vinte por cento) se houver cobrança judicial, nos termos da cláusula 10.4 do Contrato de Origem.'),
    p('Parágrafo primeiro. O atraso superior a 30 (trinta) dias de qualquer parcela deste acordo, ou de qualquer parcela a vencer do Contrato de Origem, acarretará o vencimento antecipado de todo o saldo deste acordo, independentemente de notificação, que poderá ser exigido de uma só vez, com os encargos acima.'),
    p('Parágrafo segundo. O inadimplemento autoriza ainda a CREDORA, a seu critério e sem prejuízo da execução deste Termo, a adotar as medidas previstas no Contrato de Origem, inclusive a intimação para purgação da mora e a consolidação da propriedade na forma da Lei nº 9.514/1997, bem como a inclusão do nome do(s) DEVEDOR(ES) nos órgãos de proteção ao crédito.'),
    tit('CLÁUSULA SEXTA – DO TÍTULO EXECUTIVO'),
    p('O(s) DEVEDOR(ES) reconhece(m) o presente Termo como título executivo extrajudicial, nos termos do art. 784, III, do Código de Processo Civil, admitida a assinatura eletrônica, que dispensa testemunhas (art. 784, § 4º, do CPC, e Lei nº 14.063/2020). Este Termo constitui ato inequívoco de reconhecimento do débito para os fins do art. 202, VI, do Código Civil.'),
    tit('CLÁUSULA SÉTIMA – DISPOSIÇÕES GERAIS'),
    p('a) A quitação do valor confessado somente se dará com a compensação de todas as parcelas deste acordo.'),
    p('b) A tolerância da CREDORA quanto a atrasos ou ao recebimento de valores fora do prazo é mera liberalidade e não implica renúncia, novação ou alteração deste Termo.'),
    p('c) Fica eleito o mesmo foro previsto no Contrato de Origem para dirimir qualquer questão oriunda deste Termo.'),
    p('E, por estarem justas e acordadas, as partes assinam o presente Termo, física ou eletronicamente, para que produza seus efeitos legais.',{after:200}),
    p(`Goiânia/GO, ${dAss}.`,{al:AlignmentType.RIGHT,after:200})];
  const assin=(n,d)=>[p('',{after:500}),p('_____________________________________________',{al:AlignmentType.CENTER,after:0}),p([b(n)],{al:AlignmentType.CENTER,after:0}),p(d,{al:AlignmentType.CENTER,after:200})];
  kids.push(...assin('FCA CONSTRUTORA E INCORPORADORA LTDA','CNPJ 46.228.347/0001-97 – por sua administradora Inerente Gestão Imobiliária'));
  for(const x of dev)kids.push(...assin(x.nome,'CPF '+fcpf(x.cpf)));
  kids.push(p([b('TESTEMUNHAS')],{al:AlignmentType.LEFT,after:0}),p('1. ________________________  Nome: ______________________  CPF: ______________',{al:AlignmentType.LEFT,after:300}),p('2. ________________________  Nome: ______________________  CPF: ______________',{al:AlignmentType.LEFT}));
  const wm=new Uint8Array(await (await fetch('/ferramentas/wm.png')).arrayBuffer());
  const doc=new Document({sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:1134,bottom:1134,left:1134,right:1134}}},
    headers:{default:new Header({children:[new Paragraph({children:[new ImageRun({type:'png',data:wm,transformation:{width:330,height:463},floating:{horizontalPosition:{relative:HorizontalPositionRelativeFrom.PAGE,align:HorizontalPositionAlign.CENTER},verticalPosition:{relative:VerticalPositionRelativeFrom.PAGE,align:VerticalPositionAlign.CENTER},behindDocument:true,wrap:{type:TextWrappingType.NONE}}})]})]})},
    footers:{default:new Footer({children:[new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:'Termo de Confissão e Renegociação de Dívida nº '+num+'   ·   ',font:F,size:15,color:'888888'}),new TextRun({children:['Página ',PageNumber.CURRENT,' de ',PageNumber.TOTAL_PAGES],font:F,size:15,color:'888888'})]})]})},
    children:kids}]});
  const blob=window._blobPronto||await Packer.toBlob(doc);window._blobPronto=null;
  const nome1=(dev[0]?.nome||'').toLowerCase().replace(/(^|\s)\S/g,m=>m.toUpperCase()).replace(/\s(De|Da|Do|Dos|Das|E)\s/g,m=>m.toLowerCase());
  const pastaNome=`${num} - Q${c.quadra} L${c.lote} - ${nome1}`.replace(/[\\/:*?"<>|]/g,''),arq=`${num} - Termo de Renegociação - ${nome1}.docx`.replace(/[\\/:*?"<>|]/g,'');
  const h=modo==='pasta'?(window._pastaTermo||await pasta()):null;window._pastaTermo=null;
  if(h){try{const sub=await h.getDirectoryHandle(pastaNome,{create:true});const f=await sub.getFileHandle(arq,{create:true});const w=await f.createWritable();await w.write(blob);await w.close();
      alert(`Termo ${num} salvo em Renegociações\\${pastaNome}\\${arq}.`);return true}catch(e){console.error(e)}}
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=arq;a.click();
  if(modo==='pasta')alert(`Não consegui gravar na pasta. O termo foi baixado (${arq}); mova para Renegociações\\${pastaNome}.`);return true};
window.escolhePastaTermo=async()=>{window._pastaTermo=await pasta();return !!window._pastaTermo};
})();
