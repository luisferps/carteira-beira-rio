const centavos = valor => Math.round(Number(valor) * 100);

// Centavos. Multa e juros do termo são atribuídos proporcionalmente
// à cobrança embutida em cada parcela de origem ainda em aberto.
export const rateiosConferidos = {
  '0123-001': { atualBruta: 72508, herdado: 24094, multaHerdada: 482, jurosHerdados: 1674 },
  '0153-001': { atualBruta: 132050, herdado: 10552, multaHerdada: 212, jurosHerdados: 736 },
  '0168-001': { atualBruta: 162425, herdado: 33828, multaHerdada: 676, jurosHerdados: 2358 },
};

export function rateioConferido(acordo, parcelas, regra) {
  const total = centavos(acordo.valor_acordado);
  const valorParcelas = parcelas.reduce((s, t) => s + centavos(t.valor_face), 0);
  if (total <= 0 || valorParcelas < total || !parcelas.length) return new Map();
  const entrada = centavos(parcelas[0].valor_face);
  const herdadoAtualizado = regra.herdado + regra.multaHerdada + regra.jurosHerdados;
  // Nestes termos todas as parcelas de origem com custo herdado
  // entraram na base da cobrança nova bruta. Retire a parte da Inerente.
  const atual = regra.atualBruta - Math.round(herdadoAtualizado / 10);
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
