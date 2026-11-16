export const mimeWord = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const dataBR = iso => iso.split('-').reverse().join('/');
const dataLonga = iso => new Intl.DateTimeFormat('pt-BR', {
  day:'numeric', month:'long', year:'numeric', timeZone:'UTC'
}).format(new Date(iso));

function linhasPagamento(texto) {
  const destaque = /(^4\.1\s+[–-]\s+VALOR DA ENTRADA:|^[A-Z]\)|\b\d+ parcelas?\b(?: (?:mensais|anuais))?|R\$\s*[\d.,]+)/g;
  return texto.split('\n').map(linha => ({
    trechos:linha.split(destaque).map((parte,i) => i % 2
      ? {negrito:parte, normal:''}
      : {negrito:'', normal:parte}),
  }));
}

export function qualifica(p) {
  const cpf = String(p.cpf || '').replace(/\D/g,'').replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,'$1.$2.$3-$4');
  return [p.nome, p.nacionalidade, p.estado_civil, p.profissao,
    p.rg && 'RG nº ' + [p.rg,p.emissor].filter(Boolean).join(' '), cpf && 'CPF nº ' + cpf,
    p.endereco && 'com endereço em ' + p.endereco, p.email && 'e-mail ' + p.email,
    p.fone && 'telefone ' + p.fone.replace(/\s+/g,'\u00a0')].filter(Boolean).join(', ');
}

export function dadosMinuta(b, brl, reaisExt) {
  const moeda = v => brl(v) + ' (' + reaisExt(v) + ')';
  const qualificacoes = b.compradores.map((p,i) => {
    const nome = p.nome.trim();
    const texto = p.qualificacao.trim();
    const iniciaPeloNome = texto.slice(0,nome.length).localeCompare(nome,'pt-BR',{sensitivity:'base'}) === 0 &&
      /^[,\s]|^$/.test(texto.slice(nome.length));
    return {
      nome_comprador: iniciaPeloNome ? texto.slice(0,nome.length) : nome,
      dados_comprador: iniciaPeloNome ? texto.slice(nome.length) : ', ' + texto,
      separador: i < b.compradores.length - 1 ? '\n' : '',
    };
  });
  const condicao = p => {
    const ajuste = p.ajuste_ultima_centavos || 0;
    const ultimoValor = (Math.round(p.valor * 100) + ajuste) / 100;
    const frequencia = p.tipo === 'anual' ? 'anuais' : 'mensais';
    const descricao = p.qtd === 1 ? '1 parcela de ' + moeda(ultimoValor) :
      p.qtd + ' parcelas ' + frequencia + (ajuste
        ? ', as ' + (p.qtd - 1) + ' primeiras de ' + moeda(p.valor) + ' e a última de ' + moeda(ultimoValor)
        : ' de ' + moeda(p.valor));
    return descricao + ', por ' + p.meio.toLowerCase() + ', ' + (p.qtd === 1 ? 'com vencimento em ' : 'com primeiro vencimento em ') + dataBR(p.primeiro_venc) + '.';
  };
  const entradas = b.itens.filter(p => p.secao === 'entrada');
  let textoEntrada = moeda(b.entrada_total);
  if (entradas[0]?.entrada_na_minuta === 'vencimentos') {
    const grupos = entradas.sort((a,z) => a.primeiro_venc.localeCompare(z.primeiro_venc));
    const detalhamento = grupos.map((p,i) => {
      const ajuste = p.ajuste_ultima_centavos || 0;
      const ultima = (Math.round(p.valor * 100) + ajuste) / 100;
      const valor = p.qtd === 1 ? moeda(ultima) : p.qtd + ' parcelas mensais e consecutivas' +
        (ajuste ? ', as ' + (p.qtd - 1) + ' primeiras de ' + moeda(p.valor) + ' e a última de ' + moeda(ultima) : ' de ' + moeda(p.valor) + ' cada');
      const vencimento = p.qtd > 1 ? ', vencendo a primeira em ' + dataLonga(p.primeiro_venc) :
        p.primeiro_venc === b.data_assinatura ? ' no ato da assinatura deste contrato' : ' com vencimento em ' + dataLonga(p.primeiro_venc);
      const meio = {boleto:'boleto bancário', transferencia:'transferência bancária', pix:'Pix'}[p.meio_na_minuta];
      return String.fromCharCode(65+i) + ') ' + valor + vencimento + (meio ? '. Meio de pagamento: ' + meio : '');
    });
    textoEntrada += ' a serem pagos da seguinte forma:\n' + detalhamento.join('.\n');
  } else if (entradas.length) textoEntrada += ' a serem pagos no ato da assinatura deste contrato';
  const condicoesSaldo = b.itens.filter(p => p.secao === 'saldo')
    .map((p,i) => String.fromCharCode(65+i) + ') ' + condicao(p)).join('\n') || 'Sem saldo a parcelar.';
  return {
    numero:b.numero, qualificacoes,
    logradouro:b.rua, quadra:b.quadra, lote:b.lote,
    area:new Intl.NumberFormat('pt-BR',{maximumFractionDigits:6}).format(b.area),
    preco:moeda(b.valor_imovel),
    entrada:textoEntrada, condicoes_entrada:entradas.length ? '' : 'Sem entrada.',
    condicoes_saldo:condicoesSaldo,
    linhas_entrada:linhasPagamento('4.1 – VALOR DA ENTRADA: ' + textoEntrada + '.'),
    linhas_saldo:linhasPagamento(condicoesSaldo),
    corretor:b.corretor + ', CRECI nº ' + b.creci_corretor,
    nome_corretor:b.corretor, registro_corretor:', CRECI nº ' + b.creci_corretor,
    corretagem:moeda(b.corretagem), pagamento_corretagem:b.pagamento_corretagem,
    matricula:b.matricula, cartorio:b.cartorio, cidade:b.cidade,
    data_por_extenso:dataLonga(b.data_assinatura),
    assinaturas:b.compradores.map(p => ({nome:p.nome.toLocaleUpperCase('pt-BR')})),
  };
}

export function gerarMinuta({ PizZip, docxtemplater, modelo, dados }) {
  const doc = new docxtemplater(new PizZip(modelo), {paragraphLoop:true, linebreaks:true});
  doc.render(dados);
  return doc.getZip().generate({type:'uint8array', compression:'DEFLATE'});
}
