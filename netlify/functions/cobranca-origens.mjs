const centavos = valor => Math.round((Number(valor) || 0) * 100);

function rateia(total, partes) {
  const soma = partes.reduce((s, parte) => s + parte.centavos, 0);
  if (!soma || !total) return [];
  let peso = 0;
  let anterior = 0;
  return partes.map(parte => {
    peso += parte.centavos;
    const acumulado = Math.round(total * peso / soma);
    const resultado = { ...parte, centavos: acumulado - anterior };
    anterior = acumulado;
    return resultado;
  }).filter(parte => parte.centavos > 0);
}

export function origensCobranca(acordo, custo = centavos(acordo.honorarios)) {
  const anteriores = (acordo.cobranca_origens || []).filter(parte => parte.centavos > 0);
  const herdado = anteriores.reduce((s, parte) => s + parte.centavos, 0);
  const atuais = Math.max(0, centavos(acordo.honorarios) - herdado);
  return rateia(Math.max(0, custo), [
    ...anteriores,
    { acordo: String(acordo.acordo_id ?? acordo.id), data: String(acordo.data_acordo).slice(0, 10), centavos: atuais },
  ]);
}

export function reclassificaCobranca(dados, parcelas) {
  const origens = new Map();
  for (const parcela of parcelas) {
    const acordado = centavos(parcela.valor_acordado);
    if (acordado <= 0 || parcela.tipo === 'repactuacao') continue;
    const custo = Math.max(0, centavos(parcela.honorarios));
    const composicao = centavos(parcela.principal) + centavos(parcela.multa) + centavos(parcela.juros) + custo;
    const custoConfirmado = Math.max(0, Math.min(custo, custo + acordado - composicao));
    const custoParcela = parcela.custo_acordo_rateado == null
      ? Math.round(centavos(parcela.valor_face) * custoConfirmado / acordado)
      : centavos(parcela.custo_acordo_rateado);
    for (const parte of origensCobranca(parcela, custoParcela)) {
      const anterior = origens.get(parte.acordo);
      origens.set(parte.acordo, { ...parte, centavos: parte.centavos + (anterior?.centavos || 0) });
    }
  }
  const partes = [...origens.values()];
  const herdado = partes.reduce((s, parte) => s + parte.centavos, 0);
  const transferido = Math.max(0, Math.min(herdado, centavos(dados.principal)));
  if (!transferido) return { ...dados, cobranca_origens: [] };
  return {
    ...dados,
    principal: (centavos(dados.principal) - transferido) / 100,
    honorarios: (centavos(dados.honorarios) + transferido) / 100,
    cobranca_origens: rateia(transferido, partes),
  };
}
