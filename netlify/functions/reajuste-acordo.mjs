export function aniversarioAcordo(data, ano) {
  const [, mes, dia] = String(data).slice(0, 10).split('-').map(Number);
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${String(mes).padStart(2, '0')}-${String(Math.min(dia, ultimoDia)).padStart(2, '0')}`;
}

export function valorReajustadoAcordo(valor, vencimento, data, reajustes) {
  let atualizado = Number(valor);
  if (!data || !vencimento || reajustes == null) return { valor: atualizado };
  const venc = String(vencimento).slice(0, 10);
  for (let ano = Number(String(data).slice(0, 4)) + 1; aniversarioAcordo(data, ano) <= venc; ano++) {
    if (!Object.hasOwn(reajustes, ano)) return { valor: atualizado, anoPendente: ano };
    atualizado = Math.round(atualizado * (1 + Number(reajustes[ano]) / 100) * 100) / 100;
  }
  return { valor: atualizado };
}
