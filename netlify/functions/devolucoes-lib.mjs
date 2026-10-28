/* Devoluções (distrato / rescisão): crédito a devolver por contrato, cronograma mensal, pagamentos (Pix do Asaas) e saldo. */
const R2 = x => Math.round((+x || 0) * 100) / 100;
export const nmDev = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const addMes = (d, n) => { const [y, m, dd] = String(d).slice(0, 10).split('-').map(Number); const x = new Date(Date.UTC(y, m - 1 + n, 1)); const ult = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate(); return `${x.toISOString().slice(0, 7)}-${String(Math.min(dd || 15, ult)).padStart(2, '0')}`; };
const hojeBR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
export function beneficiarioPix(d) { const m = String(d || '').match(/\bpara\s+(.+)$/i); return m ? m[1].replace(/\(.*?\)/g, '').trim() : ''; }
/* mesmo nome: igual, ou um contém o outro com pelo menos 3 palavras em comum */
export function mesmoNome(a, b) {
  const x = nmDev(a), y = nmDev(b); if (!x || !y) return false; if (x === y) return true;
  const A = x.split(' ').filter(w => w.length > 2), B = new Set(y.split(' ').filter(w => w.length > 2));
  const comuns = A.filter(w => B.has(w)).length;
  return comuns >= 3 && A[0] === [...B][0] && comuns >= Math.min(A.length, B.size) - 1;
}

export function criaDevolucoes({ q, asaas, json, log }) {
  /* lista de contratos com crédito a devolver, já com cronograma, pagos e situação */
  async function carrega() {
    const cr = await q(`select e.id, e.contrato, e.data::text data, e.dados, e.obs from carteira.eventos e where e.tipo='credito' and e.conferente='luis' order by e.contrato, e.id`);
    const pg = await q(`select e.id, e.contrato, e.data::text data, e.dados, e.obs from carteira.eventos e where e.tipo='devolucao' and e.conferente='luis' order by e.data, e.id`);
    const cts = await q(`select numero, quadra, lote, compradores from carteira.contratos`);
    const ct = {}; for (const c of cts) ct[c.numero] = c;
    const cl = await q(`select nome, planilha->>'cod' cod from carteira.clientes where planilha->>'cod' is not null`);
    const porCod = {}; for (const c of cl) porCod[String(+c.cod)] = c.nome;
    const hoje = hojeBR(), out = [];
    const porContrato = {};
    for (const e of cr) (porContrato[e.contrato] = porContrato[e.contrato] || { creditos: [], pagos: [] }).creditos.push(e);
    for (const e of pg) if (porContrato[e.contrato]) porContrato[e.contrato].pagos.push(e);
    for (const [n, X] of Object.entries(porContrato)) {
      const d = X.creditos.reduce((o, e) => ({ ...o, ...e.dados }), {});
      const credito = R2(X.creditos.reduce((s, e) => s + (+e.dados?.valor || 0), 0));
      const pagos = X.pagos.map(e => ({ id: e.id, data: e.data, valor: R2(e.dados?.valor), forma: e.dados?.forma, documento: e.dados?.documento, destino: e.dados?.destino, obs: e.obs }));
      const devolvido = R2(pagos.reduce((s, p) => s + p.valor, 0));
      const saldo = R2(credito - devolvido);
      const nP0 = +d.prazo || 0, vp = +d.valor_parcela || (nP0 ? R2(credito / nP0) : 0);
      /* o cronograma começa no 1º pagamento de fato (se ele veio depois da data prevista); sem nenhum pagamento, fica aguardando */
      const p1 = pagos.map(p => p.data).sort()[0] || null;
      const ass = d.assinado_em ? String(d.assinado_em).slice(0, 10) : null;
      let prim = d.primeira || null;
      if (ass) { const [y, mm, dd] = ass.split('-').map(Number); prim = new Date(Date.UTC(y, mm - 1 + (dd > 10 ? 1 : 0), 15)).toISOString().slice(0, 10); }
      const vale = !!(ass || pagos.length);
      if (p1 && prim && p1.slice(0, 7) > prim.slice(0, 7)) prim = p1.slice(0, 8) + String(prim).slice(8, 10);
      const fecha = !nP0 || !vp || Math.abs(vp * nP0 - credito) <= Math.max(1, nP0 * 0.02);
      const nP = fecha ? nP0 : Math.ceil(credito / vp - 0.001);
      const crono = [];
      if (nP && prim && credito > 0) {
        let resto = devolvido;
        for (let i = 0; i < nP; i++) {
          const v = i < nP - 1 ? vp : R2(credito - vp * (nP - 1));
          const pago = R2(Math.min(Math.max(resto, 0), v)); resto = R2(resto - pago);
          crono.push({ n: i + 1, venc: addMes(prim, i), valor: v, pago, situacao: pago >= v - 0.01 ? 'paga' : vale && addMes(prim, i) < hoje ? 'atrasada' : 'a vencer' });
        }
      }
      const esperado = R2(crono.filter(p => p.venc <= hoje).reduce((s, p) => s + p.valor, 0));
      const atraso = vale ? R2(Math.max(0, esperado - devolvido)) : 0;
      const prox = crono.find(p => p.situacao !== 'paga');
      const c = ct[n] || {};
      const nomes = new Set([...(Array.isArray(c.compradores) ? c.compradores.map(x => x.nome) : []), ...(d.clientes || []).map(k => porCod[String(+k)]).filter(Boolean), ...(d.favorecidos || [])].filter(Boolean));
      out.push({ contrato: n, quadra: c.quadra, lote: c.lote, nomes: [...nomes], credito, devolvido, saldo, prazo: nP, aviso_prazo: fecha ? null : `O prazo anotado (${nP0} parcelas de ${vp.toFixed(2).replace('.', ',')}) não fecha com o crédito; o cronograma segue o valor da parcela (${nP} parcelas)`, valor_parcela: vp, primeira: prim,
        parcelas_pagas: crono.filter(p => p.situacao === 'paga').length, atraso, atrasadas: crono.filter(p => p.situacao === 'atrasada').length,
        proxima: prox ? { n: prox.n, venc: prox.venc, falta: R2(prox.valor - prox.pago) } : null,
        assinado_em: ass, situacao: saldo <= 1 ? 'quitada' : !vale ? 'aguardando' : atraso > 0.01 ? 'atrasada' : 'em dia',
        dados: d, cronograma: crono, pagos, credito_ids: X.creditos.map(e => e.id) });
    }
    return out.sort((a, b) => (a.situacao === 'quitada') - (b.situacao === 'quitada') || a.contrato.localeCompare(b.contrato));
  }

  /* acha o contrato de devolução pelo nome de quem recebeu o Pix */
  function contratoDoFavorecido(L, nome) {
    const c = L.filter(x => x.saldo > 1 && x.nomes.some(n => mesmoNome(n, nome)));
    return c.length === 1 ? c[0] : null;
  }

  /* registra como devolução os Pix do extrato do Asaas para os favorecidos (sem repetir: documento = id da transação) */
  async function registraDoExtrato(itens) {
    const L = await carrega();
    const ja = new Set((await q(`select dados->>'documento' d from carteira.eventos where tipo='devolucao' and coalesce(dados->>'documento','') like 'ftn_%'`)).map(x => x.d));
    const novos = [];
    for (const it of itens) {
      if (+it.valor >= 0 || ja.has(it.id) || /FEE/.test(it.tipo || '')) continue;
      const ben = beneficiarioPix(it.descricao); if (!ben) continue;
      const c = contratoDoFavorecido(L, ben); if (!c) continue;
      const [t0] = await q(`select a_partir_titulo from carteira.eventos where contrato=$1 and tipo='encerramento' and conferente='luis' limit 1`, [c.contrato]);
      await q(`insert into carteira.eventos(contrato, conferente, tipo, motivo, a_partir_titulo, data, dados, obs) values ($1,'luis','devolucao','Pix',$2,$3,$4,$5)`,
        [c.contrato, t0?.a_partir_titulo || null, it.data, { valor: R2(-it.valor), forma: 'Pix', documento: it.id, favorecido: ben }, 'Lançado automaticamente: Pix do Asaas para ' + ben]);
      ja.add(it.id); c.saldo = R2(c.saldo + +it.valor);
      novos.push({ contrato: c.contrato, data: it.data, valor: R2(-it.valor), favorecido: ben });
    }
    if (novos.length) await log('asaas', 'devolucoes_lancadas_do_extrato', { itens: novos });
    return novos;
  }

  async function buscaAsaas(desde, ate, prazo) {
    const novos = []; let ini = desde;
    while (ini <= ate && Date.now() < prazo) {
      const fim = (() => { const x = addMes(ini.slice(0, 7) + '-01', 1); const d = new Date(x + 'T12:00:00Z'); d.setUTCDate(0); const f = d.toISOString().slice(0, 10); return f > ate ? ate : f; })();
      let itens = [], off = 0, tot = 1;
      while (off < tot) {
        const p = await asaas(`/financialTransactions?startDate=${ini}&finishDate=${fim}&limit=100&offset=${off}`);
        tot = p?.totalCount || 0; itens = itens.concat((p?.data || []).map(x => ({ id: x.id, data: x.date, valor: +x.value, tipo: x.type, descricao: x.description }))); off += 100;
        if (!p?.hasMore) break;
      }
      novos.push(...await registraDoExtrato(itens));
      ini = addMes(ini.slice(0, 7) + '-01', 1);
    }
    return { novos, proximo: ini <= ate ? ini : null };
  }

  return { carrega, registraDoExtrato, contratoDoFavorecido, rotas: async function (p, m, body, real) {
    if (p[0] !== 'devolucoes') return null;
    if (real !== 'luis') return json({ erro: 'Só o administrador' }, 403);
    try {
      if (!p[1] && m === 'GET') return json({ hoje: hojeBR(), lista: await carrega() });
      if (p[1] === 'buscar-asaas' && m === 'POST') {
        const r = await buscaAsaas(body.desde || '2025-01-01', body.ate || hojeBR(), Date.now() + 7000);
        return json(r);
      }
      if (p[1] === 'procurar' && m === 'POST') {
        /* procura no extrato do Asaas saídas com os valores pedidos (qualquer nome), mês a mês */
        const vals = (body.valores || []).map(Number), prazo = Date.now() + 8000, achados = [];
        let ini = body.desde || '2023-07-01'; const ate = body.ate || hojeBR();
        while (ini <= ate && Date.now() < prazo) {
          const d = new Date(addMes(ini.slice(0, 7) + '-01', 1) + 'T12:00:00Z'); d.setUTCDate(0); const fim = d.toISOString().slice(0, 10);
          let off = 0, tot = 1;
          while (off < tot) { const pg = await asaas(`/financialTransactions?startDate=${ini}&finishDate=${fim}&limit=100&offset=${off}`); tot = pg?.totalCount || 0;
            for (const x of pg?.data || []) if (+x.value < 0 && vals.some(v => Math.abs(-x.value - v) < 0.015)) achados.push({ id: x.id, data: x.date, valor: -x.value, descricao: x.description, tipo: x.type });
            off += 100; if (!pg?.hasMore) break; }
          ini = addMes(ini.slice(0, 7) + '-01', 1);
        }
        const ja = new Set((await q(`select dados->>'documento' d from carteira.eventos where tipo='devolucao'`)).map(x => x.d));
        return json({ achados: achados.map(a => ({ ...a, ja_lancado: ja.has(a.id) })), proximo: ini <= ate ? ini : null });
      }
      if (p[1] === 'conciliar-acertos' && m === 'POST') {
        /* devoluções que estão nos acertos mensais (aba Devoluções) e não estão lançadas no contrato (pagas fora do Asaas ou não achadas) */
        const L = await carrega(); const usados = {}; const novos = [], semContrato = [];
        const rows = (body.linhas || []).slice().sort((a, b) => a.data.localeCompare(b.data));
        const dev = {}; for (const x of L) dev[x.contrato] = x.devolvido;
        for (const r of rows) {
          const cs = L.filter(x => x.nomes.some(n => mesmoNome(n, r.nome)));
          if (cs.length !== 1) { semContrato.push(r.nome); continue; }
          const c = cs[0];
          const idx = c.pagos.findIndex((p, i) => !(usados[c.contrato] || new Set()).has(i) && p.data.slice(0, 7) === r.data.slice(0, 7) && Math.abs(p.valor - r.valor) < 0.03);
          if (idx >= 0) { (usados[c.contrato] = usados[c.contrato] || new Set()).add(idx); continue; }
          if (dev[c.contrato] + r.valor > c.credito + 0.05) continue;
          dev[c.contrato] = R2(dev[c.contrato] + r.valor);
          novos.push({ contrato: c.contrato, data: r.data, valor: r.valor, favorecido: r.nome, acerto: r.acerto });
        }
        if (!body.previa) for (const n of novos) {
          const [t0] = await q(`select a_partir_titulo from carteira.eventos where contrato=$1 and tipo='encerramento' and conferente='luis' limit 1`, [n.contrato]);
          await q(`insert into carteira.eventos(contrato, conferente, tipo, motivo, a_partir_titulo, data, dados, obs) values ($1,'luis','devolucao','Pix',$2,$3,$4,$5)`,
            [n.contrato, t0?.a_partir_titulo || null, n.data, { valor: n.valor, forma: 'Pix', documento: 'acerto ' + n.acerto, favorecido: n.favorecido }, 'Lançado do acerto mensal (aba Devoluções) — não encontrado no extrato do Asaas']);
        }
        if (!body.previa && novos.length) await log(real, 'devolucoes_dos_acertos', { novos });
        return json({ previa: !!body.previa, novos, sem_contrato: [...new Set(semContrato)] });
      }
      if (p[1] === 'importar' && m === 'POST') {
        /* linhas da planilha "Devoluções" (Contratos.xlsx): cria o crédito a devolver de quem ainda não tem */
        const tem = new Set((await q(`select distinct contrato from carteira.eventos where tipo='credito' and conferente='luis'`)).map(x => x.contrato));
        const feitos = [], pulados = [];
        for (const r of body.linhas || []) {
          const n = String(r.contrato).padStart(4, '0');
          if (tem.has(n)) { pulados.push({ contrato: n, motivo: 'já tem crédito no sistema' }); continue; }
          if (!(+r.devolvido > 0)) { pulados.push({ contrato: n, motivo: 'nada a devolver na planilha' }); continue; }
          const [ex] = await q(`select numero from carteira.contratos where numero=$1`, [n]); if (!ex) { pulados.push({ contrato: n, motivo: 'contrato não existe no sistema' }); continue; }
          const [t0] = await q(`select a_partir_titulo, data::text d from carteira.eventos where contrato=$1 and tipo='encerramento' and conferente='luis' limit 1`, [n]);
          const dados = { valor: R2(r.devolvido), origem: 'Distrato (devolução)', pago_cliente: R2(r.pago), multa: R2(r.multa), comissao: R2(r.comissao), retido: R2(r.retencao),
            prazo: +r.prazo || null, primeira: r.primeira || null, valor_parcela: R2(r.valor_parcela), pix_tipo: r.pix_tipo || null, pix: r.pix != null ? String(r.pix) : null,
            banco: r.banco || null, conta: r.conta || null, data_distrato: r.data_distrato || null, clientes: r.clientes || [], fonte: 'planilha Devoluções' };
          if (!body.previa) await q(`insert into carteira.eventos(contrato, conferente, tipo, motivo, a_partir_titulo, data, dados, obs) values ($1,'luis','credito','Distrato (devolução)',$2,$3,$4,$5)`,
            [n, t0?.a_partir_titulo || null, r.data_distrato || t0?.d || null, dados, 'Importado da planilha Devoluções']);
          feitos.push({ contrato: n, devolver: dados.valor, prazo: dados.prazo, primeira: dados.primeira });
        }
        if (!body.previa) await log(real, 'devolucoes_importadas', { feitos, pulados });
        return json({ previa: !!body.previa, feitos, pulados });
      }
      if (p[1] === 'credito' && p[2] && m === 'PUT') {
        /* completa o crédito (prazo, 1ª parcela, Pix, favorecidos...) */
        const [e] = await q(`select dados from carteira.eventos where id=$1 and tipo='credito'`, [p[2]]); if (!e) return json({ erro: 'Crédito não encontrado' }, 404);
        const dados = { ...e.dados, ...body.dados };
        await q(`update carteira.eventos set dados=$2 where id=$1`, [p[2], dados]);
        await log(real, 'credito_atualizado', { id: p[2], dados: body.dados });
        return json({ ok: true });
      }
      return json({ erro: 'Rota não encontrada' }, 404);
    } catch (e) { return json({ erro: e.message }, 500); }
  } };
}
