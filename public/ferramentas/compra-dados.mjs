const texto = (v, max = 240) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const data = v => /^\d{4}-\d\d-\d\d$/.test(v ?? '') && Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
const dinheiro = v => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 100000000 ? Math.round(n * 100) : 0;
};
export const comissaoPadrao = valor => Math.round(dinheiro(valor) * 0.05) / 100;
export const somaParcelasCentavos = itens => itens.reduce((total, p) => total + (Number(p.qtd) || 0) * dinheiro(p.valor), 0);
export const totalRedondo = centavos => Math.round(centavos / 100) * 100;
export function ajusteDoGrupo(itens, preco, soma) {
  const delta = preco - soma;
  if (Math.abs(delta) !== 1 || preco !== totalRedondo(soma)) return null;
  const indice = ['anual', 'mensal', 'entrada']
    .map(tipo => itens.findLastIndex(p => p.tipo === tipo && !p.pago && !p.forma?.endsWith('_pago') && dinheiro(p.valor) + delta > 0))
    .find(i => i >= 0);
  return indice === undefined ? null : { indice, delta };
}
export const cpfValido = cpf => /^\d{11}$/.test(cpf) && !/^(\d)\1+$/.test(cpf) &&
  [9, 10].every(i => [...cpf.slice(0,i)].reduce((s, d, j) => s + +d * (i + 1 - j), 0) * 10 % 11 % 10 === +cpf[i]);

export function validaCompraVenda(raw = {}) {
  const b = Object.fromEntries(['numero','quadra','lote','rua','matricula','cartorio','cidade','corretor','pagamento_corretagem']
    .map(k => [k, texto(raw[k])]));
  if (!/^\d{4}$/.test(b.numero) || +b.numero < 1) throw new Error('Informe o número do contrato com quatro dígitos.');
  if (!/^\d{1,3}$/.test(b.quadra) || !/^\d{1,3}[A-Za-z]?$/.test(b.lote) || !b.rua || !b.matricula || !b.cartorio || !b.cidade)
    throw new Error('Confira quadra, lote, endereço, matrícula, cartório e cidade de assinatura.');
  b.quadra = b.quadra.padStart(2, '0');
  b.lote = b.lote.replace(/^\d+/, s => s.padStart(2, '0')).toUpperCase();
  const area = Number(raw.area);
  if (!Number.isFinite(area) || area <= 0 || !data(raw.data_assinatura)) throw new Error('Informe a área e a data do contrato.');
  const preco = dinheiro(raw.valor_imovel), corretagem = dinheiro(raw.corretagem);
  if (!preco || !b.corretor || !b.pagamento_corretagem || (Number(raw.corretagem) !== 0 && !corretagem))
    throw new Error('Confira o valor do imóvel e as condições de corretagem.');

  const origem = Array.isArray(raw.compradores) ? raw.compradores : [];
  if (origem.length > 4) throw new Error('O contrato aceita até quatro compradores.');
  const compradores = origem.map(p => ({
    nome: texto(p?.nome), cpf: texto(p?.cpf).replace(/\D/g, ''), fone: texto(p?.fone),
    email: texto(p?.email), rg: texto(p?.rg), nacionalidade: texto(p?.nacionalidade),
    estado_civil: texto(p?.estado_civil), profissao: texto(p?.profissao),
    emissor: texto(p?.emissor), naturalidade: texto(p?.naturalidade), nascimento: data(p?.nascimento) ? p.nascimento : '',
    endereco: texto(p?.endereco), qualificacao: texto(p?.qualificacao, 1200),
  }));
  if (!compradores.length || compradores.some(p => !p.nome || !cpfValido(p.cpf) || !p.qualificacao ||
      !p.rg || !p.endereco || !p.estado_civil || !p.nacionalidade || !p.profissao || p.fone.replace(/\D/g,'').length < 10) ||
      new Set(compradores.map(p => p.cpf)).size !== compradores.length)
    throw new Error('Confira nome, CPF, RG ou CNH, estado civil, nacionalidade, profissão, endereço e telefone de cada comprador.');

  const grupos = Array.isArray(raw.itens) ? raw.itens : [];
  if (!grupos.length || grupos.length > 20) throw new Error('Informe os grupos de pagamento.');
  let soma = 0;
  const itens = grupos.map(p => {
    const valor = dinheiro(p?.valor), qtd = Number(p?.qtd);
    if (!['entrada','mensal','anual'].includes(p?.tipo) || !valor || !data(p.primeiro_venc) || !Number.isInteger(qtd) || qtd < 1 || qtd > 360)
      throw new Error('Confira tipo, quantidade, vencimento e valor de cada grupo de pagamento.');
    const forma = texto(p.forma);
    if (p.tipo === 'entrada' && !['boleto','direto','pix_pago','conta_pago','construtora_pago'].includes(forma))
      throw new Error('Informe a forma de cada entrada.');
    const recebedor = texto(p.recebedor);
    if (p.tipo === 'entrada' && !recebedor) throw new Error('Informe quem recebe cada pagamento da entrada.');
    const pago = p.tipo === 'entrada' && forma.endsWith('_pago');
    const fatura = texto(p.fatura, 30);
    if (pago && (qtd !== 1 || !data(p.data_pagamento) || (fatura && !/^\d+$/.test(fatura))))
      throw new Error('Para cada entrada paga, informe uma parcela, a data do pagamento e, se houver, o número da fatura.');
    soma += qtd * valor;
    return {
      secao: p.tipo === 'entrada' ? 'entrada' : 'saldo', tipo: p.tipo, qtd, valor: valor / 100,
      primeiro_venc: p.primeiro_venc, periodicidade: p.tipo === 'anual' ? 'anual' : 'mensal',
      meio: pago ? ({pix_pago:'Pix',conta_pago:'Transferência bancária',construtora_pago:'Pagamento à construtora'})[forma]
        : forma === 'direto' && p.tipo === 'entrada' ? 'Pagamento direto' : 'Boleto Bancário',
      pago, emitir: p.tipo === 'entrada' && forma === 'boleto',
      ...(p.tipo === 'entrada' ? {recebedor} : {}),
      data_pagamento: pago ? p.data_pagamento : null, fatura: pago ? fatura || null : null,
    };
  });
  if (soma !== preco) {
    const ajuste = ajusteDoGrupo(itens, preco, soma);
    if (!ajuste) throw new Error('A soma da entrada e das parcelas deve ser igual ao preço do imóvel.');
    itens[ajuste.indice].ajuste_ultima_centavos = ajuste.delta;
  }
  for (const tipo of ['mensal','anual']) if (itens.filter(p => p.tipo === tipo).length > 1)
    throw new Error('Use um grupo para as mensais e um para as anuais.');
  const faturas = itens.map(p => p.fatura).filter(Boolean);
  if (itens.reduce((n, p) => n + p.qtd, 0) > 720)
    throw new Error('O contrato aceita até 720 parcelas.');
  if (itens.reduce((n, p) => n + (p.emitir ? p.qtd : 0), 0) > 12)
    throw new Error('Use até 12 parcelas de entrada por boleto.');
  if (new Set(faturas).size !== faturas.length) throw new Error('Cada entrada paga deve ter uma fatura diferente.');
  const entradas = itens.filter(p => p.tipo === 'entrada');
  const entrada = somaParcelasCentavos(entradas) + entradas.reduce((n, p) => n + (p.ajuste_ultima_centavos || 0), 0);
  return {...b, area, data_assinatura: raw.data_assinatura, valor_imovel: preco / 100,
    corretagem: corretagem / 100, entrada_total: entrada / 100, compradores, itens};
}
