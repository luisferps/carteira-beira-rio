const centavos = valor => Math.round(Number(valor) * 100);

// Valores conferidos nos termos e nos acertos das parcelas de origem.
export const rateiosConferidos = {
  '0123-001': { atual: 72508, herdado: 24094, sobreposto: 2409 },
  '0153-001': { atual: 132050, herdado: 10552, sobreposto: 1055 },
  '0168-001': { atual: 162425, herdado: 33828, sobreposto: 3383 },
};

export function rateioConferido(acordo, parcelas, regra) {
  const total = centavos(acordo.valor_acordado);
  const valorParcelas = parcelas.reduce((s, t) => s + centavos(t.valor_face), 0);
  if (total <= 0 || valorParcelas < total || !parcelas.length) return new Map();
  const entrada = centavos(parcelas[0].valor_face);
  const custo = regra.atual + regra.herdado - regra.sobreposto;
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
