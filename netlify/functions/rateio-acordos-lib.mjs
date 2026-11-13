const centavos = valor => Math.round(Number(valor) * 100);

// Centavos. Multa e juros do termo são atribuídos proporcionalmente
// à cobrança embutida em cada parcela de origem ainda em aberto.
export const rateiosConferidos = {
  // Seis parcelas originais, todas acima de 60 dias. Base com correção: R$ 8.305,75.
  '0058-001': { cobrancaNova: 83058, herdado: 0, multaHerdada: 0, jurosHerdados: 0 },
  // Em 09/11, somente M45, A4 e M46 tinham mais de 60 dias de atraso.
  // O acordo de março não registrou custo embutido na parcela 7/7.
  '0070-001': { cobrancaNova: 43873, herdado: 0, multaHerdada: 0, jurosHerdados: 0 },
  '0123-001': { atualBruta: 72508, herdado: 24094, multaHerdada: 482, jurosHerdados: 1674 },
  // Mesmo critério do 0168: 10% dentro do valor negociado de dezembro,
  // quatro das seis parcelas em aberto e cobrança nova do termo de novembro.
  '0153-001': { cobrancaNova: 147404, herdado: 56310, multaHerdada: 1126, jurosHerdados: 3926 },
  // Base de novembro e saldo de dezembro conferidos no fechamento do 0168.
  '0168-001': { cobrancaNova: 74460 + 103296, herdado: 62118, multaHerdada: 1242, jurosHerdados: 4331 },
};

export function rateioConferido(acordo, parcelas, regra) {
  const total = centavos(acordo.valor_acordado);
  const valorParcelas = parcelas.reduce((s, t) => s + centavos(t.valor_face), 0);
  if (total <= 0 || valorParcelas < total || !parcelas.length) return new Map();
  const entrada = centavos(parcelas[0].valor_face);
  const herdadoAtualizado = regra.herdado + regra.multaHerdada + regra.jurosHerdados;
  // Os outros termos mantêm o cálculo já conferido sobre a parte da FCA.
  const atual = regra.cobrancaNova ?? (regra.atualBruta - Math.round(herdadoAtualizado / 10));
  const custo = atual + herdadoAtualizado;
  const saldo = valorParcelas - entrada;
  const juros = valorParcelas - total;
  let acumulado = 0;
  let custoAnterior = 0;
  return new Map(parcelas.map((parcela, i) => {
    acumulado += centavos(parcela.valor_face);
    const financiamento = saldo && i > 0 ? juros * (acumulado - entrada) / saldo : 0;
    const custoAcumulado = Math.round(custo * (acumulado - financiamento) / total + financiamento * 0.1);
    const daParcela = custoAcumulado - custoAnterior;
    custoAnterior = custoAcumulado;
    return [String(parcela.id), daParcela / 100];
  }));
}

export function custoRateadoNaBaixa(custo, valorFace, recebido) {
  const face = centavos(valorFace);
  if (face <= 0) return 0;
  const parte = Math.max(0, Math.min(face, centavos(recebido)));
  return Math.round(centavos(custo) * parte / face) / 100;
}
