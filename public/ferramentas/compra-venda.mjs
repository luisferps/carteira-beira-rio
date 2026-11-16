import { ajusteDoGrupo, comissaoPadrao, cpfValido, modoEntradaSugerido, padroesCompraVenda, somaParcelasCentavos, totalRedondo, validaCompraVenda } from './compra-dados.mjs';
import { dadosMinuta, gerarMinuta, mimeWord, qualifica } from './compra-minuta.mjs';
import { enviaAnexo, LIMITE } from './onedrive.mjs';

const formato = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp';
const limiteLeitura = 2_390_000;
const imovel = [
  ['numero','Nº do contrato'], ['quadra','Quadra'], ['lote','Lote'], ['area','Área (m²)','number'],
  ['rua','Logradouro do imóvel'], ['matricula','Matrícula do lote'], ['cartorio','Cartório de registro de imóveis'],
  ['valor_imovel','Valor total do negócio (R$)','number'], ['cidade','Cidade de assinatura'], ['data_assinatura','Data de assinatura','date'],
  ['corretor','Nome do beneficiário da comissão'], ['creci_corretor','Número do CRECI'],
  ['corretagem','Comissão (5% do preço, em R$)','number'], ['pagamento_corretagem','Como a comissão será paga'],
];
const pessoais = [
  ['nome','Nome completo'], ['cpf','CPF'], ['rg','RG ou CNH'], ['emissor','Órgão emissor / UF'],
  ['nacionalidade','Nacionalidade'], ['naturalidade','Naturalidade'], ['nascimento','Data de nascimento','date'],
  ['estado_civil','Estado civil / regime de bens'], ['profissao','Profissão'], ['endereco','Endereço completo com CEP'],
  ['fone','Telefone pessoal'], ['email','E-mail','email'],
];
const tipos = [['proposta','Proposta'],['rg_cpf','RG ou CNH com CPF'],['rg','RG ou CNH'],['cpf','CPF'],
  ['endereco','Comprovante de endereço'],['outro','Outro anexo']];
const tipoPag = [['entrada','Entrada'],['mensal','Mensais'],['anual','Anuais']];
const formas = [['','Selecione'],['boleto','Emitir boleto'],['direto','Pagamento direto pendente'],
  ['pix_pago','Pix já pago'],['conta_pago','Já pago em conta'],['construtora_pago','Já pago por conta da FCA']];
const meiosMinuta = [['','Omitir na minuta'],['boleto','Boleto bancário'],['transferencia','Transferência bancária'],['pix','Pix']];
const opcionais = new Set(['nascimento','emissor','naturalidade','email','fatura','cartorio','pagamento_corretagem']);
const somenteLeitura = new Set(['cidade','corretagem']);
const cpf = v => String(v ?? '').replace(/\D/g,'');
const normaliza = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const hoje = () => new Date(Date.now() - 3 * 36e5).toISOString().slice(0,10);
const arquivoPdf = f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const baixar = (file, download = true) => {
  const url = URL.createObjectURL(file);
  if (download) {
    const a = document.createElement('a'); a.href = url; a.download = file.name; a.click();
  } else window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};
const base64 = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('Não foi possível abrir ' + file.name));
  reader.readAsDataURL(file);
});
const lerValores = el => Object.fromEntries([...el.querySelectorAll('[data-campo]')].map(n => [
  n.dataset.campo, n.type === 'number' ? n.valueAsNumber : n.value.trim()
]));

export async function abreCompraVenda({ api, abreModal, fechaModal, esc, libsDocx, brl, reaisExt }) {
  const [{numero},driveStatus] = await Promise.all([api('contrato-novo'),api('onedrive/status',{silencioso:true})]);
  const campos = itens => itens.map(([key, label, tipo = 'text']) =>
    '<label>' + label + '<input data-campo="' + key + '" type="' + tipo + '"' +
    (somenteLeitura.has(key) ? ' readonly' : opcionais.has(key) ? '' : ' required') +
    (key === 'nascimento' ? ' max="' + hoje() + '"' : '') +
    (tipo === 'number' ? ' min="0" step="any"' : '') + '></label>').join('');
  const options = (itens, value) => itens.map(([k,v]) =>
    '<option value="' + esc(k) + '"' + (k === value ? ' selected' : '') + '>' + esc(v) + '</option>').join('');
  abreModal('<section id="compra-venda"><div class="bt"><h3 style="flex:1">Novo contrato de compra e venda</h3>' +
    '<button type="button" id="cv-fechar">Fechar</button></div>' +
    '<form id="cv-form" novalidate><fieldset id="cv-edicao">' +
    '<h4>Proposta e documentos</h4><label>Adicionar PDFs ou imagens, juntos ou separados' +
    '<input id="cv-proposta" type="file" multiple accept="' + formato + '"></label>' +
    '<div id="cv-arquivos"></div>' +
    '<h4>Imóvel e condições da venda</h4><div class="cv-grade" id="cv-imovel">' + campos(imovel) + '</div>' +
    '<h4>Compradores</h4><div id="cv-pessoas"></div><button type="button" id="cv-add-pessoa">Adicionar comprador</button>' +
    '<h4>Condições de pagamento</h4><label id="cv-entrada-clausula">Como a entrada aparece na cláusula 4.1' +
    '<select id="cv-entrada-minuta"><option value="assinatura">No ato da assinatura</option>' +
    '<option value="vencimentos">Parcelas com datas de vencimento</option></select></label>' +
    '<div id="cv-pagamentos"></div><button type="button" id="cv-add-pag">Adicionar grupo de pagamento</button>' +
    '<div id="cv-total" class="mut" aria-live="polite"></div></fieldset>' +
    '<p id="cv-status" role="status" aria-live="polite"></p>' +
    '<div class="bt"><button type="button" id="cv-word">Baixar prévia em Word</button>' +
    '<button type="submit" id="cv-aprovar" class="pri">Aprovar e cadastrar</button>' +
    '<button type="button" id="cv-retry" hidden>Tentar pendências novamente</button>' +
    '<button type="button" id="cv-abrir" hidden>Abrir contrato</button></div></form></section>');
  const root = document.getElementById('compra-venda');
  root.closest('.card').style.maxWidth = '940px';
  const el = s => root.querySelector(s);
  const arquivos = [];
  const limiteAnexo = driveStatus.conectado ? LIMITE : 4e6;
  const confereArquivo = file => {
    if (!file.size || file.size > limiteAnexo)
      throw new Error('Confira se o arquivo tem conteúdo e está dentro do limite de ' + (driveStatus.conectado ? '250' : '4') + ' MB.');
  };
  const notas = [];
  let sequencia = 0, ocupado = false, salvo = null, word = null, tarefas = [];
  const pessoas = () => [...el('#cv-pessoas').children];
  const grupos = () => [...el('#cv-pagamentos').children];
  const preco = el('[data-campo="valor_imovel"]');
  const comissao = el('[data-campo="corretagem"]');
  const atualizaComissao = () => {
    comissao.value = preco.valueAsNumber > 0 ? comissaoPadrao(preco.valueAsNumber) : '';
  };
  const msg = (s, erro = false) => {
    el('#cv-status').textContent = s;
    el('#cv-status').className = erro ? 'aviso' : s ? 'info' : '';
  };
  const atualizaVencimento = grupo => {
    const data = grupo.querySelector('[data-campo="primeiro_venc"]');
    const meio = grupo.querySelector('[data-campo="meio_na_minuta"]');
    const entrada = grupo.querySelector('[data-campo="tipo"]').value === 'entrada';
    const naAssinatura = entrada && el('#cv-entrada-minuta').value === 'assinatura';
    data.disabled = naAssinatura;
    data.parentElement.hidden = naAssinatura;
    meio.disabled = !entrada || naAssinatura;
    meio.parentElement.hidden = meio.disabled;
  };
  const preencher = (container, dados, avisar = false) => {
    for (const n of container.querySelectorAll('[data-campo]')) {
      const v = dados?.[n.dataset.campo];
      if (v == null || !['string','number'].includes(typeof v) || String(v).trim() === '') continue;
      if (!n.value) n.value = v;
      else if (avisar && ['cpf','rg','endereco','nome','estado_civil'].includes(n.dataset.campo)) {
        const comparar = n.dataset.campo === 'cpf' ? cpf : normaliza;
        if (comparar(n.value) !== comparar(v)) {
          const label = pessoais.find(([k]) => k === n.dataset.campo)?.[1];
          const aviso = label + ' diverge entre os arquivos. Confira os dados do comprador.';
          if (!notas.includes(aviso)) notas.push(aviso);
        }
      }
    }
  };
  const soma = () => {
    const itens = grupos().map(lerValores);
    el('#cv-entrada-clausula').hidden = !itens.some(p => p.tipo === 'entrada');
    const total = somaParcelasCentavos(itens);
    const alvo = Math.round(preco.valueAsNumber * 100);
    const ajuste = ajusteDoGrupo(itens, alvo, total);
    el('#cv-total').textContent = 'Soma da entrada e das parcelas ' + brl((total + (ajuste?.delta || 0)) / 100) +
      (ajuste ? ' · Ajuste de 1 centavo na última parcela do grupo ' +
        ({anual:'de anuais', mensal:'de mensais', entrada:'de entrada'})[itens[ajuste.indice].tipo] + '.' : '');
  };
  const escolhaArquivo = () => {
    const exibidos = el('#cv-arquivos');
    const destinos = [['','Selecione o destino'],['contrato','Do contrato'], ...pessoas().map((p,i) =>
      [p.dataset.id, (i+1) + 'º comprador · ' + (lerValores(p).nome || 'Sem nome')])];
    exibidos.innerHTML = arquivos.map((a,i) => '<div class="cv-anexo"><span>' + esc(a.file.name) +
      '</span><select aria-label="Pessoa ou contrato" data-destino="' + i + '">' + options(destinos,a.destino) +
      '</select><select aria-label="Tipo de documento" data-tipo="' + i + '">' + options([['','Selecione o tipo'],...tipos],a.tipo) +
      '</select><div class="bt"><button type="button" data-ver="' + i + '">Ver</button>' +
      '<button type="button" data-reusar="' + i + '">Vincular também</button>' +
      (a.separavel ? '<button type="button" data-separar="' + i + '">Separar páginas</button>' : '') +
      '<button type="button" data-remover="' + i + '">Remover</button></div></div>').join('');
  };
  const adicionarPessoa = (dados = {}) => {
    if (pessoas().length >= 4) return null;
    const card = document.createElement('div');
    card.className = 'cv-bloco';
    card.dataset.id = 'comprador-' + (++sequencia);
    card.innerHTML = '<div class="bt"><b style="flex:1">Comprador</b><button type="button">Remover comprador</button></div>' +
      '<div class="cv-grade">' + campos(pessoais) + '</div>' +
      '<label>Anexar comprovante de endereço deste comprador<input data-comprovante type="file" accept="' + formato + '"></label>' +
      '<label>Qualificação para a minuta (opcional, preenche automaticamente com os dados acima)<textarea data-campo="qualificacao" rows="2"></textarea></label>';
    el('#cv-pessoas').append(card);
    preencher(card, dados);
    card.querySelector('button').onclick = () => {
      if (pessoas().length <= 1) return;
      for (const a of arquivos) if (a.destino === card.dataset.id) a.destino = '';
      card.remove(); escolhaArquivo();
    };
    card.querySelector('[data-campo="nome"]').addEventListener('change', escolhaArquivo);
    card.querySelector('[data-comprovante]').onchange = ({target}) => {
      const file = target.files[0];
      target.value = '';
      if (!file || ocupado || salvo) return;
      try {
        arquivos.push({file:preparaArquivo(file),tipo:'endereco',destino:card.dataset.id});
        escolhaArquivo();
        msg('Comprovante anexado para ' + (lerValores(card).nome || 'este comprador') + '.');
      } catch (e) { msg(e.message,true); }
    };
    escolhaArquivo();
    return card;
  };
  const adicionarGrupo = (dados = {}) => {
    const card = document.createElement('div'); card.className = 'cv-bloco';
    card.innerHTML = '<div class="cv-grade"><label>Tipo<select data-campo="tipo">' +
      options(tipoPag, dados.tipo || 'entrada') + '</select></label>' +
      campos([['qtd','Quantidade','number'],['valor','Valor por parcela (R$)','number'],['primeiro_venc','Primeiro vencimento','date']]) +
      '<label>Meio previsto na minuta<select data-campo="meio_na_minuta">' + options(meiosMinuta,dados.meio_na_minuta) + '</select></label>' +
      '<label data-forma>Forma da entrada<select data-campo="forma" required>' + options(formas,dados.forma) + '</select></label>' +
      '<label data-recebedor>Recebedor da entrada (controle interno)<input data-campo="recebedor" placeholder="Ex.: Inerente, FCA ou corretor" maxlength="240" required></label>' +
      '<small data-aviso-boleto hidden>O boleto é emitido pela conta Asaas integrada à Carteira.</small>' +
      '<div data-pago class="cv-grade">' + campos([['data_pagamento','Data em que pagou','date'],['fatura','Fatura do Asaas (se houver)']]) +
      '</div></div><button type="button">Remover grupo</button>';
    el('#cv-pagamentos').append(card);
    preencher(card,dados);
    const atualizar = () => {
      const {tipo,forma} = lerValores(card);
      atualizaVencimento(card);
      card.querySelector('[data-forma]').hidden = tipo !== 'entrada';
      card.querySelector('[data-recebedor]').hidden = tipo !== 'entrada';
      card.querySelector('[data-aviso-boleto]').hidden = tipo !== 'entrada' || forma !== 'boleto';
      card.querySelector('[data-pago]').hidden = tipo !== 'entrada' || !forma.endsWith('_pago');
      card.querySelector('[data-campo="forma"]').disabled = tipo !== 'entrada';
      card.querySelector('[data-campo="recebedor"]').disabled = tipo !== 'entrada';
      card.querySelector('[data-campo="data_pagamento"]').disabled = tipo !== 'entrada' || !forma.endsWith('_pago');
      soma();
    };
    card.addEventListener('input', atualizar);
    card.querySelector('button').onclick = () => { card.remove(); soma(); };
    atualizar();
  };
  const localizarPessoa = (dados, indice, podeCriar) => {
    const ps = pessoas();
    const doc = cpf(dados?.cpf);
    const nome = normaliza(dados?.nome);
    const mesma = ps.find(p => {
      const atual = lerValores(p);
      return (doc && cpf(atual.cpf) === doc) ||
        (nome && normaliza(atual.nome) === nome && (!doc || !atual.cpf || cpf(atual.cpf) === doc));
    });
    if (mesma) return mesma;
    const peloIndice = ps[indice - 1];
    if (peloIndice) {
      const atual = lerValores(peloIndice);
      if ((!doc || !atual.cpf || cpf(atual.cpf) === doc) && (!nome || !atual.nome || normaliza(atual.nome) === nome))
        return peloIndice;
    }
    if (podeCriar && nome && cpfValido(doc))
      return ps.find(p => !lerValores(p).cpf && !lerValores(p).nome) || adicionarPessoa();
    return null;
  };
  const temDadosProposta = r => r && (r.quadra || r.lote || r.valor_imovel || r.compradores?.length || r.itens?.length);
  const aplicarProposta = r => {
    if (!temDadosProposta(r)) return;
    const {quadra, lote, rua, area, valor_imovel, corretor, creci_corretor} = r;
    preencher(el('#cv-imovel'),{quadra,lote,rua,area,valor_imovel,corretor,creci_corretor});
    if (Array.isArray(r.compradores)) r.compradores.slice(0,4).forEach((d,i) => {
      if (!d?.nome && !d?.cpf) return;
      const p = localizarPessoa(d, i+1, true) || (!pessoas()[i] && adicionarPessoa());
      if (p) preencher(p,d);
    });
    if (Array.isArray(r.itens) && r.itens.length && !grupos().some(g => lerValores(g).valor > 0)) {
      el('#cv-pagamentos').replaceChildren();
      const data = el('[data-campo="data_assinatura"]').value;
      el('#cv-entrada-minuta').value = modoEntradaSugerido(r.itens,data);
      r.itens.slice(0,20).filter(p => p && tipoPag.some(([k]) => k === p.tipo)).forEach(p =>
        adicionarGrupo({...p, forma:formas.some(([k]) => k === p.forma && !k.endsWith('_pago')) ? p.forma : ''}));
      const itens = grupos().map(lerValores);
      const total = somaParcelasCentavos(itens);
      const redondo = totalRedondo(total);
      if (!preco.value && itens.every(p => Number.isInteger(p.qtd) && p.qtd > 0 && p.valor > 0) &&
          redondo > 0 && Math.abs(redondo - total) <= 1) {
        preco.value = redondo / 100;
        notas.push('Preço sugerido pela soma das parcelas: ' + brl(redondo / 100) + '. Confira com a proposta.');
      }
    }
    atualizaComissao();
    soma();
  };
  const tipoLido = (tipo,dados) => tipo === 'rg' && cpfValido(cpf(dados?.cpf)) ? 'rg_cpf' :
    tipos.some(([k]) => k === tipo) ? tipo : '';
  const ler = async (file, tipo) => {
    if (file.size > limiteLeitura) {
      notas.push(file.name + ' excede o limite da leitura automática. Confira e preencha manualmente.');
      return null;
    }
    try {
      return await api('contrato-novo/ler', {method:'POST',body:{imagem:await base64(file),tipo}, silencioso:true});
    } catch (e) {
      notas.push(file.name + ' precisa de conferência manual.');
      return null;
    }
  };
  const guardar = (file, tipo, dados, indice) => {
    const tido = tipoLido(tipo,dados);
    const pessoa = tido && !['proposta','outro'].includes(tido) ? localizarPessoa(dados, indice, true) : null;
    if (pessoa) preencher(pessoa,dados,true);
    const anexo = {file, tipo:tido, dados, indice, destino:pessoa?.dataset.id || (tido === 'proposta' ? 'contrato' : '')};
    arquivos.push(anexo);
    return anexo;
  };
  const preparaArquivo = file => {
    const mime = arquivoPdf(file) ? 'application/pdf' : file.type ||
      ({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp'})[file.name.split('.').pop().toLowerCase()];
    if (!['application/pdf','image/jpeg','image/png','image/webp'].includes(mime))
      throw new Error('Selecione um PDF ou uma imagem JPG, PNG ou WebP.');
    confereArquivo(file);
    return file.type === mime ? file : new File([file],file.name,{type:mime,lastModified:file.lastModified});
  };
  const importarImagem = async file => {
    const r = await ler(file,'proposta');
    aplicarProposta(r);
    const partes = Array.isArray(r?.partes) ? r.partes.slice(0,12) : [];
    if (partes.length <= 1) {
      const [p] = partes;
      guardar(file,p?.tipo || (temDadosProposta(r) ? 'proposta' : ''),p?.dados,p?.proponente);
      return;
    }
    const imagem = await createImageBitmap(file);
    const recortes = [];
    try {
      for (const p of partes) {
        const {tipo,dados,proponente,caixa} = p;
        if (!tipoLido(tipo,dados) || !Array.isArray(caixa) || caixa.length !== 4 ||
            caixa.some(v => !Number.isFinite(v) || v < 0 || v > 1000) || caixa[2] <= caixa[0] || caixa[3] <= caixa[1])
          throw new Error('Use Vincular também se a imagem servir para mais de um documento.');
        const [x1,y1,x2,y2] = caixa;
        const x = Math.floor(x1 * imagem.width / 1000), y = Math.floor(y1 * imagem.height / 1000);
        const w = Math.ceil(x2 * imagem.width / 1000) - x, h = Math.ceil(y2 * imagem.height / 1000) - y;
        const tela = document.createElement('canvas');
        tela.width = w;
        tela.height = h;
        tela.getContext('2d').drawImage(imagem,x,y,w,h,0,0,w,h);
        const blob = await new Promise(resolve => tela.toBlob(resolve,'image/png'));
        if (!blob) throw new Error('A imagem precisa de classificação manual.');
        const recorte = new File([blob],file.name.replace(/\.[^.]+$/,'') + ' - parte ' + (recortes.length + 1) + '.png',{type:'image/png'});
        confereArquivo(recorte);
        recortes.push({file:recorte,tipo,dados,proponente});
      }
    } finally { imagem.close(); }
    for (const p of recortes) guardar(p.file,p.tipo,p.dados,p.proponente);
    notas.push('Confira os recortes e os vínculos de ' + file.name + ' antes de cadastrar.');
  };
  const separaPagina = async (PDFDocument,pdf,file,i) => {
    const separado = await PDFDocument.create();
    const [pagina] = await separado.copyPages(pdf,[i]);
    separado.addPage(pagina);
    return new File([await separado.save()],file.name.replace(/\.pdf$/i,'') + ' - pág ' + (i+1) + '.pdf',{type:'application/pdf'});
  };
  const importarPdf = async file => {
    const { PDFDocument, PDFSignature } = await import('./pdf-lib-1.17.1.min.mjs');
    const pdf = await PDFDocument.load(await file.arrayBuffer());
    const n = pdf.getPageCount();
    if (n > 30) throw new Error('Divida o PDF em arquivos de até 30 páginas.');
    if (n === 1) {
      const r = await ler(file,'proposta');
      aplicarProposta(r);
      const p = r?.paginas?.find(x => x?.pagina === 1);
      guardar(file, p?.tipo || (temDadosProposta(r) ? 'proposta' : ''), p?.dados, p?.proponente);
      return;
    }
    const pacote = file.size <= limiteLeitura ? await ler(file,'proposta') : null;
    aplicarProposta(pacote);
    const paginas=[];
    for (let i = 0; i < n; i++) {
      const f = await separaPagina(PDFDocument,pdf,file,i);
      let p = pacote?.paginas?.find(x => x?.pagina === i+1);
      if (!pacote) {
        msg('Lendo página ' + (i+1) + ' de ' + n + '…');
        const r = await ler(f,'proposta');
        aplicarProposta(r);
        p = r?.paginas?.find(x => x?.pagina === 1);
      }
      paginas.push({file:f,leitura:p});
    }
    const proposta=temDadosProposta(pacote)||paginas.some(x=>x.leitura?.tipo==='proposta');
    const grupo=paginas.map(x=>x.leitura);
    if (!proposta && !grupo.some(p => tipoLido(p?.tipo,p?.dados))) {
      guardar(file,'').separavel = true;
      notas.push('Classifique ' + file.name + ' pela lista, ou use Separar páginas se houver mais de um documento.');
      return;
    }
    const tipo=grupo[0]?.tipo;
    if(!proposta && ['rg','cpf','endereco'].includes(tipo) && grupo.every(x=>x?.tipo===tipo) &&
        new Set(grupo.map(x=>x.proponente).filter(Boolean)).size<=1 &&
        new Set(grupo.map(x=>cpf(x.dados?.cpf)).filter(Boolean)).size<=1 &&
        new Set(grupo.map(x=>normaliza(x.dados?.nome)).filter(Boolean)).size<=1) {
      const dados=Object.assign({},...grupo.map(x=>Object.fromEntries(Object.entries(x.dados||{}).filter(([,v])=>v))));
      guardar(file,tipo,dados,grupo.find(x=>x.proponente)?.proponente);
      return;
    }
    let selo=false;
    try{selo=pdf.getForm().getFields().some(x=>x instanceof PDFSignature);}catch{}
    const preserva=proposta&&(selo||paginas.some(x=>x.leitura?.tipo==='auditoria')||!paginas.some(x=>x.leitura?.tipo==='proposta'));
    if(preserva)guardar(file,'proposta');
    for(const {file,leitura} of paginas) {
      if(preserva && ['proposta','auditoria'].includes(leitura?.tipo))continue;
      guardar(file,leitura?.tipo,leitura?.dados,leitura?.proponente);
    }
  };
  async function importar(lista) {
    if (ocupado || salvo) return;
    ocupado = true;
    el('#cv-edicao').disabled = true;
    notas.length = 0;
    try {
      for (const escolhido of lista) {
        let file;
        try { file = preparaArquivo(escolhido); }
        catch (e) { notas.push(escolhido.name + ': ' + e.message); continue; }
        msg('Lendo ' + file.name + '…');
        try {
          if (arquivoPdf(file)) {
            if (file.size > 30e6) throw new Error('O PDF é grande demais para leitura automática.');
            await importarPdf(file);
          } else await importarImagem(file);
        } catch (e) {
          guardar(file,'');
          notas.push(file.name + ': ' + e.message + ' Arquivo mantido na lista para classificação manual.');
        }
      }
      for (const a of arquivos.filter(a => !a.destino && a.tipo && !['proposta','outro'].includes(a.tipo))) {
        const p = localizarPessoa(a.dados,a.indice,false);
        if (!p) continue;
        preencher(p,a.dados,true);
        a.destino = p.dataset.id;
      }
      escolhaArquivo();
      msg(notas.join(' ') || 'Confira os dados e a distribuição dos documentos.', !!notas.length);
    } finally {
      ocupado = false; el('#cv-edicao').disabled = false;
    }
  }

  const dadosFormulario = () => ({
    ...lerValores(el('#cv-imovel')),
    entrada_na_minuta:el('#cv-entrada-minuta').value,
    compradores:pessoas().map(p => {
      const d = lerValores(p); return {...d,qualificacao:d.qualificacao || qualifica(d)};
    }),
    itens:grupos().map(lerValores),
  });
  const confereCampos = () => {
    const campo = [...el('#cv-edicao').querySelectorAll('input,select')].find(n => n.willValidate && !n.validity.valid);
    if (!campo) return true;
    const rotulo = campo.parentElement.firstChild.textContent;
    msg('Revise o campo ' + rotulo + '.',true);
    campo.focus();
    campo.reportValidity();
    return false;
  };
  const criaWord = async b => {
    await libsDocx();
    const {modelo,representante} = await api('contrato-novo/modelo',{silencioso:true});
    const bytes = gerarMinuta({PizZip:window.PizZip, docxtemplater:window.docxtemplater,
      modelo:Uint8Array.from(atob(modelo),c=>c.charCodeAt(0)), dados:{...dadosMinuta(b,brl,reaisExt),representante}});
    return new File([bytes], b.numero + ' - Q' + b.quadra + ' L' + b.lote + '.docx',{type:mimeWord});
  };
  const prepararArquivos = () => {
    const ps = pessoas();
    const out = arquivos.map(a => {
      if (!a.destino || !a.tipo) throw new Error('Selecione o destino e o tipo de documento para ' + a.file.name + '.');
      confereArquivo(a.file);
      const pessoa = ps.findIndex(p => p.dataset.id === a.destino);
      if ((pessoa < 0 && !['proposta','outro'].includes(a.tipo)) || (pessoa >= 0 && a.tipo === 'proposta'))
        throw new Error('Vincule os documentos aos compradores e a proposta ao contrato.');
      return {...a, pessoa};
    });
    ps.forEach((_,i) => {
      const ts = out.filter(a => a.pessoa === i).map(a => a.tipo);
      const falta = [];
      if (!ts.includes('rg_cpf') && !ts.includes('rg')) falta.push('RG ou CNH');
      if (!ts.includes('rg_cpf') && !ts.includes('cpf')) falta.push('CPF');
      if (!ts.includes('endereco')) falta.push('comprovante de endereço');
      if (falta.length) throw new Error('Documento pendente para ' + (lerValores(ps[i]).nome || (i+1) + 'º comprador') + ': ' + falta.join(', ') + '.');
    });
    return out;
  };
  const finalizar = async () => {
    if (ocupado || !salvo) return;
    ocupado = true;
    el('#cv-retry').hidden = true;
    const falhas = [];
    try {
      for (const t of tarefas) {
        if (t.ok) continue;
        msg('Contrato ' + salvo.numero + ' gravado. ' + t.rotulo + '…');
        try { await t.fazer(); t.ok = true; }
        catch (e) { falhas.push(t.rotulo + ': ' + e.message); }
      }
      el('#cv-retry').hidden = !falhas.length;
      msg(falhas.length ? 'Contrato gravado. Pendências: ' + falhas.join(' · ') :
        'Contrato ' + salvo.numero + ' cadastrado. Documentos e Word guardados, compradores vinculados ao Asaas.' +
        (salvo.emitir.length ? ' Boleto da entrada emitido.' : ''), !!falhas.length);
    } finally { ocupado = false; }
  };
  el('#cv-word').onclick = async () => {
    if (ocupado || (!salvo && !confereCampos())) return;
    try {
      ocupado = true;
      baixar(word && salvo ? word : await criaWord(validaCompraVenda(dadosFormulario())));
    } catch (e) { msg(e.message,true); }
    finally { ocupado = false; }
  };
  el('#cv-form').onsubmit = async event => {
    event.preventDefault();
    if (ocupado || salvo || !confereCampos()) return;
    try {
      const raw = dadosFormulario(), b = validaCompraVenda(raw), lista = prepararArquivos();
      const gera = b.itens.some(p => p.emitir), paga = b.itens.some(p => p.pago);
      if (!confirm('Cadastrar o contrato ' + b.numero + ' e vincular os compradores ao Asaas?' +
        (gera ? ' Serão emitidos os boletos das entradas em aberto marcadas para emissão.' : '') +
        (paga ? ' As entradas já pagas serão registradas.' : ''))) return;
      ocupado = true;
      el('#cv-edicao').disabled = true;
      msg('Gerando o contrato em Word…');
      word = await criaWord(b);
      const anexos = [{file:word,pessoa:-1,tipo:'contrato_minuta'}, ...lista];
      const post = (rota, body) => api(rota,{method:'POST',body,silencioso:true});
      const rascunho = crypto.randomUUID(), enviados = [];
      for (const [i,a] of anexos.entries()) {
        msg('Preparando documento ' + (i+1) + ' de ' + anexos.length + '…');
        const chave = (a.pessoa < 0 ? '' : 'p' + a.pessoa + '_') + (a.tipo === 'rg_cpf' ? 'rg' : a.tipo);
        const imovel={quadra:b.quadra,lote:b.lote,comprador:a.pessoa<0?null:b.compradores[a.pessoa].nome};
        const r = await enviaAnexo(api,{contrato:b.numero,rascunho,chave,imovel,inclui_cpf:a.tipo==='rg_cpf'},a.file,driveStatus,
          pct=>msg('Enviando documento '+(i+1)+' de '+anexos.length+' · '+pct+'%'));
        enviados.push(r.id);
      }
      msg('Gravando contrato, cadastro e documentos…');
      salvo = await post('contrato-novo',{...raw,origem:'compra-venda',rascunho,anexos:enviados});
      el('#cv-aprovar').hidden = true;
      el('#cv-abrir').hidden = false;
      el('#cv-word').textContent = 'Baixar contrato em Word';
      tarefas = b.compradores.map((p,i) => ({
        rotulo:'Vincular ' + (i+1) + 'º comprador ao Asaas',
        fazer:() => post('contrato-novo/asaas',{contrato:salvo.numero,cpf:p.cpf}),
      }));
      tarefas.push(...salvo.emitir.map((id,i) => ({
        rotulo:'Emitir boleto da entrada ' + (i+1),
        fazer:() => post('contrato-novo/boleto',{titulo_id:id}),
      })));
      baixar(word);
    } catch (e) { msg(e.message,true); }
    finally {
      ocupado = false;
      if (!salvo) el('#cv-edicao').disabled = false;
    }
    if (salvo) await finalizar();
  };
  el('#cv-retry').onclick = finalizar;
  const podeSair = () => !(ocupado || tarefas.some(t => !t.ok)) ||
    confirm('Há operações pendentes. Fechar a tela agora?');
  el('#cv-fechar').onclick = () => { if (podeSair()) fechaModal(); };
  el('#cv-abrir').onclick = () => {
    if (podeSair()) { fechaModal(); location.hash = 'c/' + salvo.numero; }
  };
  root.closest('.modal').onclick = null;
  preco.oninput = () => { atualizaComissao(); soma(); };
  el('#cv-entrada-minuta').onchange = () => grupos().forEach(atualizaVencimento);
  el('#cv-proposta').onchange = e => { const files = [...e.target.files]; e.target.value = ''; importar(files); };
  el('#cv-add-pessoa').onclick = () => { if (!adicionarPessoa()) msg('O limite é de quatro compradores.',true); };
  el('#cv-add-pag').onclick = () => adicionarGrupo();
  el('#cv-arquivos').addEventListener('change', ({target}) => {
    if (target.dataset.destino != null) arquivos[target.dataset.destino].destino = target.value;
    if (target.dataset.tipo != null) arquivos[target.dataset.tipo].tipo = target.value;
  });
  el('#cv-arquivos').addEventListener('click', async ({target}) => {
    if (ocupado || salvo) return;
    if (target.dataset.ver != null) baixar(arquivos[target.dataset.ver].file,false);
    if (target.dataset.reusar != null) {
      const {file} = arquivos[target.dataset.reusar];
      arquivos.splice(Number(target.dataset.reusar) + 1,0,{file,tipo:'',destino:''});
      escolhaArquivo();
      msg('Selecione o destino e o tipo do novo vínculo de ' + file.name + '.');
    }
    if (target.dataset.separar != null) {
      const i = Number(target.dataset.separar);
      const {file,tipo,destino} = arquivos[i];
      if ((tipo || destino) && !confirm('Substituir o PDF inteiro pelas páginas separadas?')) return;
      ocupado = true;
      el('#cv-edicao').disabled = true;
      try {
        const { PDFDocument } = await import('./pdf-lib-1.17.1.min.mjs');
        const pdf = await PDFDocument.load(await file.arrayBuffer());
        const paginas = [];
        for (let p = 0; p < pdf.getPageCount(); p++)
          paginas.push({file:await separaPagina(PDFDocument,pdf,file,p),tipo:'',destino:''});
        arquivos.splice(i,1,...paginas);
        escolhaArquivo();
        msg('Páginas separadas. Escolha o destino e o tipo de cada documento.');
      } catch (e) { msg('Não foi possível separar as páginas: ' + e.message,true); }
      finally { ocupado = false; el('#cv-edicao').disabled = false; }
    }
    if (target.dataset.remover != null) {
      arquivos.splice(target.dataset.remover,1); escolhaArquivo();
    }
  });
  preencher(el('#cv-imovel'),{...padroesCompraVenda,numero,data_assinatura:hoje()});
  adicionarPessoa();
  adicionarGrupo({qtd:1});
}
