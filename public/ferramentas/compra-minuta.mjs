export const mimeWord = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const dataBR = iso => iso.split('-').reverse().join('/');
const dataLonga = iso => new Intl.DateTimeFormat('pt-BR', {
  day:'numeric', month:'long', year:'numeric', timeZone:'UTC'
}).format(new Date(iso));

export function qualifica(p) {
  const cpf = String(p.cpf || '').replace(/\D/g,'').replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,'$1.$2.$3-$4');
  return [p.nome, p.nacionalidade, p.estado_civil, p.profissao,
    p.rg && 'RG nº ' + [p.rg,p.emissor].filter(Boolean).join(' '), cpf && 'CPF nº ' + cpf,
    p.endereco && 'com endereço em ' + p.endereco, p.email && 'e-mail ' + p.email,
    p.fone && 'telefone ' + p.fone].filter(Boolean).join(', ');
}

export function dadosMinuta(b, brl, reaisExt) {
  const moeda = v => brl(v) + ' (' + reaisExt(v) + ')';
  const condicao = p => {
    const ajuste = p.ajuste_ultima_centavos || 0;
    const ultimoValor = (Math.round(p.valor * 100) + ajuste) / 100;
    const frequencia = p.tipo === 'anual' ? 'anuais' : 'mensais';
    const descricao = p.qtd === 1 ? '1 parcela de ' + moeda(ultimoValor) :
      p.qtd + ' parcelas ' + frequencia + (ajuste
        ? ', as ' + (p.qtd - 1) + ' primeiras de ' + moeda(p.valor) + ' e a última de ' + moeda(ultimoValor)
        : ' de ' + moeda(p.valor));
    const recebedor = p.recebedor ? ', a favor de ' + p.recebedor : '';
    if (p.pago) {
      if (p.meio === 'Pagamento à construtora') return descricao + ', já paga à vista.';
      return descricao + ', já paga à vista por ' + p.meio + ' em ' + dataBR(p.data_pagamento) + '.';
    }
    return descricao + ', por ' + p.meio.toLowerCase() + recebedor + ', ' + (p.qtd === 1 ? 'com vencimento em ' : 'com primeiro vencimento em ') + dataBR(p.primeiro_venc) + '.';
  };
  const linhas = (secao, vazio) => b.itens.filter(p => p.secao === secao).map(condicao).join('\n') || vazio;
  return {
    numero:b.numero, qualificacao:b.compradores.map(p => p.qualificacao).join('\n'),
    logradouro:b.rua, quadra:b.quadra, lote:b.lote,
    area:new Intl.NumberFormat('pt-BR',{maximumFractionDigits:6}).format(b.area),
    preco:moeda(b.valor_imovel), entrada:moeda(b.entrada_total),
    condicoes_entrada:linhas('entrada','Sem entrada.'), condicoes_saldo:linhas('saldo','Sem saldo a parcelar.'),
    corretor:b.corretor + ', CRECI nº ' + b.creci_corretor,
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
