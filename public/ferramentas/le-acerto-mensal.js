/* Lê a planilha "Acerto Mensal" de um imóvel (o controle que hoje fica no Drive) e devolve os meses com os lançamentos.
   Formato: título do imóvel, "Mês - AAAA", linhas "descrição | valor", "À RECEBER:"/"À PAGAR" com o total.
   Linhas "Acumulado do mês anterior" / "Saldo do período anterior" são o saldo que passou de um mês para o outro:
   não viram lançamento (o sistema calcula o saldo sozinho) e mostram que o mês anterior não foi repassado. */
(function (raiz) {
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const sem = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const R2 = x => Math.round((+x || 0) * 100) / 100;
  function tipoDe(d) {
    const s = sem(d);
    if (/^aluguel|^alugue/.test(s)) return 'aluguel';
    if (/juros|multa/.test(s) && !/condom/.test(s)) return 'encargos';
    if (/administra/.test(s)) return 'adm';
    if (/intermedia/.test(s)) return 'intermediacao';
    if (/retido|retencao/.test(s)) return 'retencao';
    if (/fundo de reserva/.test(s)) return 'fundo_reserva';
    if (/condom|rateio/.test(s)) return 'condominio';
    if (/\biptu\b|^itu\b/.test(s)) return 'iptu';
    if (/saneago|\bagua\b/.test(s)) return 'agua';
    if (/\benel\b|energia|celg|equatorial/.test(s)) return 'energia';
    if (/\bgas\b/.test(s)) return 'gas';
    if (/caucao/.test(s)) return 'caucao';
    if (/repasse|transferencia/.test(s) && !/nao foi/.test(s)) return 'repasse';
    return 'manutencao';
  }
  function mesDe(s) {
    const m = sem(s).match(/^([a-z]+)\s*[-–/]?\s*(\d{4})$/);
    if (!m) return null;
    const i = MESES.map(sem).indexOf(m[1]);
    return i < 0 ? null : `${m[2]}-${String(i + 1).padStart(2, '0')}`;
  }
  const ehCarry = s => /acumulado|saldo (do|de) (periodo|mes) anterior|saldo anterior/.test(sem(s));
  const ehTotal = s => /^a (receber|pagar)/.test(sem(s));

  /* linhas: matriz (cada linha uma lista de células), como XLSX.utils.sheet_to_json(ws, {header:1}) */
  function leLinhas(linhas) {
    let titulo = null, cur = null;
    const blocos = [];
    for (const row of linhas) {
      const cel = (row || []).filter(v => v !== null && v !== undefined && String(v).trim() !== '');
      if (!cel.length) continue;
      const iTxt = cel.findIndex(v => typeof v === 'string');
      if (iTxt < 0) continue;
      const rot = String(cel[iTxt]).trim();
      const num = cel.slice(iTxt + 1).find(v => typeof v === 'number');
      const comp = num === undefined ? mesDe(rot) : null;
      if (comp) { cur = { competencia: comp, rotulo: rot, itens: [], carry: null, total: null, notas: [] }; blocos.push(cur); continue; }
      if (!cur) { if (!titulo && num === undefined) titulo = rot; continue; }
      if (num === undefined) {
        if (ehTotal(rot)) { cur.total = null; continue; }
        if (titulo && sem(rot) === sem(titulo)) continue;
        if (/[a-z]/i.test(rot) && rot === rot.toUpperCase() && rot.length > 4 && !/nao foi|não foi/i.test(rot)) continue; /* título repetido do imóvel */
        cur.notas.push(rot); continue;
      }
      if (/^(r\$|valor|total|descri)/i.test(sem(rot)) && rot.length < 12) continue; /* cabeçalho da planilha */
      if (ehTotal(rot)) { cur.total = R2(num); continue; }
      if (ehCarry(rot)) { cur.carry = R2((cur.carry || 0) + num); continue; }
      cur.itens.push({ descricao: rot, valor: R2(num), tipo: tipoDe(rot) });
    }
    /* mês digitado errado na planilha (repetido, voltando no tempo ou no futuro): sugere o mês seguinte ao anterior */
    const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 7);
    const prox = c => { const [a, m] = c.split('-').map(Number); return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`; };
    const igual = (x, y) => x && y && x.rotulo === y.rotulo && JSON.stringify(x.itens) === JSON.stringify(y.itens) && x.total === y.total;
    let ant = null;
    blocos.forEach((b, i) => {
      if (igual(b, blocos[i - 1])) { b.ignorar = true; b.aviso = `"${b.rotulo}" aparece duas vezes igual na planilha; a cópia não entra`; return; }
      if (ant && (b.competencia <= ant || b.competencia > hoje)) {
        let c = b.competencia; /* ano digitado errado: mesmo mês num ano seguinte */
        while (c <= ant) c = `${+c.slice(0, 4) + 1}${c.slice(4)}`;
        const novo = c <= hoje ? c : prox(ant);
        b.aviso = `na planilha está "${b.rotulo}"; entra como ${novo.slice(5)}/${novo.slice(0, 4)}`; b.competencia = novo;
      } else if (ant && b.competencia !== prox(ant)) b.aviso = 'pulou mês(es) depois do anterior (imóvel vago?)';
      ant = b.competencia;
    });
    return { titulo, blocos };
  }

  /* monta o que vai para o sistema: os lançamentos de cada mês + o repasse do saldo quando o mês foi fechado */
  function preparaImportacao(lido, ultimoRepassado) {
    const B = lido.blocos.filter(b => !b.ignorar);
    let saldo = 0;
    const meses = [];
    B.forEach((b, i) => {
      const prox = B[i + 1];
      const anterior = R2(saldo);
      const doMes = R2(b.itens.reduce((s, x) => s + x.valor, 0));
      saldo = R2(anterior + doMes);
      const calc = saldo;
      const naoFeito = b.notas.some(n => /nao foi feit|não foi feit|nao repass|não repass/i.test(n));
      const fechado = prox ? !(prox.carry !== null && Math.abs(prox.carry) > 0.004) && !naoFeito : (ultimoRepassado && !naoFeito);
      const itens = b.itens.map(x => ({ ...x }));
      let repasse = 0;
      if (fechado && Math.abs(saldo) > 0.004) {
        repasse = saldo;
        itens.push({ tipo: 'repasse', descricao: saldo > 0 ? 'Repasse ao proprietário' : 'Valor acertado pelo proprietário', valor: R2(-saldo) });
        saldo = 0;
      }
      const confere = b.total === null ? null : Math.abs(R2(b.total) - calc) < 0.02;
      meses.push({ competencia: b.competencia, rotulo: b.rotulo, aviso: b.aviso || null, anterior, doMes, calculado: calc, planilha: b.total, confere, carryPlanilha: b.carry, repasse: R2(repasse), notas: b.notas, itens });
    });
    return { meses, saldoFinal: R2(saldo) };
  }
  const api = { leLinhas, preparaImportacao, tipoDe, mesDe };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else raiz.LeAcerto = api;
})(typeof window !== 'undefined' ? window : globalThis);
