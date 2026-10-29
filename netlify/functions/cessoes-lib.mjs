/* Cessão de direitos: documento numerado, andamento (enviada, voltou assinada, firma reconhecida) e conclusão (troca de titulares no contrato). */
const PASSOS = ['emitida', 'enviada', 'assinada', 'reconhecida', 'concluida'];
const dig = v => String(v || '').replace(/\D/g, '');
const R2 = x => Math.round(x * 100) / 100;
const hojeBR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const somaDias = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const pad4 = n => String(n).padStart(4, '0');
const FCA_RODAPE = 'á Serviço de: FCA CONSTRUTORA E INCORPORADORA LTDA (46.228.347/0001-97)';
/* IGP-M mensal (FGV) pela série 189 do Banco Central */
async function igpmMeses(desde) {
  const br = d => d.split('-').reverse().join('/');
  const r = await fetch(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.189/dados?formato=json&dataInicial=${br(desde)}&dataFinal=${br(hojeBR())}`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error('Não consegui buscar o IGP-M no Banco Central (erro ' + r.status + ')');
  const L = await r.json();
  return (Array.isArray(L) ? L : []).map(x => ({ mes: x.data.split('/').reverse().join('-').slice(0, 7), pct: +String(x.valor).replace(',', '.') }));
}
export function criaCessoes({ q, json, log, asaas, asaasReq, gravaBoleto, garanteBoletos, refazBoletoPara }) {
  /* taxa de cessão = 2% do valor total do contrato, corrigido pelo IGP-M desde o mês da assinatura (cláusula 10.1 dos contratos FCA) */
  async function calculaTaxa(contrato) {
    const [ct] = await q(`select numero, valor_imovel, data_assinatura::text data_assinatura from carteira.contratos where numero=$1`, [contrato]);
    if (!ct || !+ct.valor_imovel) throw new Error('Contrato sem valor do imóvel cadastrado');
    if (!ct.data_assinatura) throw new Error('Contrato sem data de assinatura cadastrada');
    const base = R2(+ct.valor_imovel * 0.02);
    /* conta desde o IGP-M do mês da assinatura: ele só é divulgado no fim do mês, depois que o contrato já foi assinado */
    const meses = await igpmMeses(ct.data_assinatura.slice(0, 7) + '-01');
    const fator = meses.reduce((a, x) => a * (1 + x.pct / 100), 1);
    return { contrato, valor_contrato: +ct.valor_imovel, data_assinatura: ct.data_assinatura, base, meses: meses.length,
      desde: meses[0]?.mes || null, ate: meses[meses.length - 1]?.mes || null, igpm_pct: R2((fator - 1) * 100), taxa: R2(base * fator) };
  }
  /* todos os cedentes e cessionários entram (ou são atualizados) no cadastro de clientes já no registro da cessão */
  async function cadastraPessoas(d, contrato, numero) {
    const out = [];
    for (const [papel, L] of [['cedente', d.cedentes || []], ['cessionário', d.cessionarios || []]]) for (const x of L) {
      const cpf = dig(x.cpf); if (cpf.length < 11 || !x.nome) continue;
      const [ex] = await q(`select id, manual from carteira.clientes where chave=$1`, ['cpf:' + cpf]);
      const M = ex?.manual || {};
      const manual = { ...M, ...(x.endereco && !M.endereco ? { endereco: x.endereco } : {}), ...(x.fone && !M.telefone ? { telefone: x.fone } : {}), ...(x.email && !M.email ? { email: x.email } : {}),
        pessoais: { ...Object.fromEntries(Object.entries({ rg: x.rg, profissao: x.profissao, estado_civil: x.estado_civil, nacionalidade: x.nacionalidade }).filter(([, v]) => v)), ...(M.pessoais || {}) },
        origem: M.origem || `Cessão de direitos nº ${pad4(numero)} (contrato ${contrato}) — ${papel}` };
      const [r] = await q(`insert into carteira.clientes(chave, cpf, nome, manual) values ($1,$2,$3,$4)
               on conflict (chave) do update set manual = excluded.manual, nome = coalesce(carteira.clientes.nome, excluded.nome), atualizado_em=now() returning id, (xmax = 0) novo`, ['cpf:' + cpf, cpf, x.nome, manual]);
      out.push({ nome: x.nome, papel, novo: r.novo });
    }
    return out;
  }
  /* boleto da taxa sai sempre no nome do 1º cessionário */
  async function clienteAsaas(p) {
    const cpf = dig(p.cpf); if (cpf.length < 11) throw new Error('O 1º cessionário está sem CPF — preciso dele para gerar o boleto da taxa');
    const r = await asaas('/customers?cpfCnpj=' + cpf).catch(() => null);
    const c = (r?.data || []).find(x => !x.deleted); if (c) return c.id;
    const fone = dig(p.fone);
    const n = await asaasReq('POST', '/customers', { name: p.nome, cpfCnpj: cpf, ...(fone.length >= 10 ? { mobilePhone: fone } : {}), ...(p.email ? { email: p.email } : {}) });
    return n.id;
  }
  const listaTaxa = d => d.boletos_taxa || (d.boleto ? [{ ...d.boleto, k: 1, total: 1 }] : []);
  const somaMeses = (d0, n) => { const [y, m, dd] = d0.split('-').map(Number); const ult = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m - 1 + n, Math.min(dd, ult))).toISOString().slice(0, 10); };
  /* taxa em 1 ou mais boletos mensais, sempre no nome do 1º cessionário; 1º vencimento padrão = 7 dias após a emissão */
  async function emiteBoletoTaxa(c) {
    const d = c.dados || {};
    const ex = listaTaxa(d);
    if (ex.length) {
      let vivos = 0; for (const b of ex) { const g = await asaas('/payments/' + b.id).catch(() => null); if (g && !g.deleted) vivos++; }
      if (vivos === ex.length) return { boleto: ex[0], boletos: ex };
      if (vivos) throw new Error('Parte dos boletos da taxa foi excluída no Asaas — confira no Asaas antes de gerar de novo');
    }
    const taxa = R2(+d.taxa || 0); if (!(taxa > 0)) throw new Error('Taxa de cessão sem valor');
    const n = Math.max(1, Math.min(24, parseInt(d.taxa_parcelas, 10) || 1));
    const parc = R2(Math.round(taxa / n * 100) / 100), ult = R2(taxa - parc * (n - 1));
    const p1 = (d.cessionarios || [])[0]; if (!p1?.nome) throw new Error('Cessão sem cessionário');
    const cliente = await clienteAsaas(p1);
    const venc1 = d.venc_taxa && d.venc_taxa >= hojeBR() ? d.venc_taxa : somaDias(hojeBR(), 7);
    const [ct] = await q('select numero, quadra, lote from carteira.contratos where numero=$1', [c.contrato]);
    const L = [];
    for (let k = 1; k <= n; k++) {
      const g = await asaasReq('POST', '/payments', { customer: cliente, billingType: 'BOLETO', value: k === n ? ult : parc, dueDate: somaMeses(venc1, k - 1),
        description: [`Condomínio Beira Rio - ${c.contrato}`, `Q${ct?.quadra || ''} L${ct?.lote || ''}`, `Taxa de cessão de direitos${n > 1 ? ` ${String(k).padStart(2, '0')}/${String(n).padStart(2, '0')}` : ''} - Documento nº ${pad4(c.numero)}`, '', FCA_RODAPE].join('\r\n'),
        externalReference: 'cbr-cessao-' + c.id + (n > 1 ? '-' + k : '') });
      await garanteBoletos();
      await gravaBoleto(g, { contrato: c.contrato, tipo: 'cessao', origem: 'sistema', motivo: `Taxa de cessão nº ${pad4(c.numero)}${n > 1 ? ` (${k}/${n})` : ''}` });
      L.push({ k, total: n, id: g.id, fatura: g.invoiceNumber ? String(g.invoiceNumber) : null, link: g.bankSlipUrl || g.invoiceUrl || null, valor: g.value, vencimento: g.dueDate, cliente: p1.nome });
    }
    await q(`update carteira.cessoes set dados = dados || $2::jsonb where id=$1`, [c.id, JSON.stringify({ boletos_taxa: L, boleto: L[0], taxa_parcelas: n })]);
    await log('luis', 'boleto_taxa_cessao', { numero: c.numero, contrato: c.contrato, boletos: L.map(b => b.id), valor: taxa });
    return { boleto: L[0], boletos: L };
  }

  let ok = false;
  async function garante() {
    if (ok) return;
    await q(`create table if not exists carteira.cessoes(id serial primary key, numero int unique, contrato text not null, dados jsonb not null default '{}',
             status text not null default 'emitida', datas jsonb not null default '{}', evento_id int, criado_em timestamptz default now(), por text)`);
    ok = true;
  }
  /* conclusão: troca os titulares do contrato a partir da 1ª parcela em aberto (chamada à mão ou quando o boleto da taxa é pago) */
  async function concluir(c, dataBody, real) {
        const d = c.dados || {}, hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
        const data = dataBody || d.data || hoje;
        /* troca de titulares a partir da 1ª parcela em aberto */
        /* novo titular a partir da 1ª parcela (fora renegociações) que vence na data da cessão ou depois */
        const dataCes = d.data || data;
        const [t0] = await q(`select t.id from carteira.titulos t where t.contrato=$1 and t.grupo<>'acordo' and t.vencimento >= $2
                               and not exists (select 1 from carteira.pagamentos g where g.titulo_id=t.id) order by t.vencimento limit 1`, [c.contrato, dataCes]);
        const nomes = (d.cessionarios || []).map(x => x.nome).filter(Boolean);
        const [ev] = await q(`insert into carteira.eventos(contrato, conferente, tipo, motivo, a_partir_titulo, data, dados, obs) values ($1,'luis','cessao',null,$2,$3,$4,$5) returning id`,
          [c.contrato, t0?.id || null, data, { novos_titulares: nomes.join(' e '), antes: (d.cedentes || []).map(x => x.nome).join(' e '), taxa_cessao: d.taxa ?? null, documento: String(c.numero).padStart(4, '0'),
            fatura: listaTaxa(d).map(b => b.fatura).filter(Boolean).join(', ') || null, vencimento: d.boleto?.vencimento || null, forma: 'Boleto Bancário', pago_em: d.taxa_paga?.pago_em || null, valor_pago: d.taxa_paga?.valor_pago ?? null },
            `Cessão de direitos nº ${String(c.numero).padStart(4, '0')}`]);
        await cadastraPessoas(d, c.contrato, c.numero);
        /* boletos em aberto do contrato saem do nome do cedente e passam para o do 1º cessionário */
        const movidos = [], erros = [];
        try {
          const p1 = (d.cessionarios || [])[0];
          if (p1?.cpf && refazBoletoPara) {
            const cli = await clienteAsaas(p1);
            const bs = await q(`select b.*, t.grupo, t.acordo_id from carteira.boletos b left join carteira.titulos t on t.id=b.titulo_id
                                where b.contrato=$1 and b.status = any($2) and coalesce(b.tipo,'')<>'cessao' order by b.vencimento`, [c.contrato, ['PENDING', 'OVERDUE', 'AWAITING_RISK_ANALYSIS']]);
            const passa = new Set((d.renegs || []).filter(r => r.quem === 'cessionarios').map(r => r.k));
            for (const b of bs) {
              /* renegociações (acordo/proposta) ficam com quem foi escolhido; parcelas normais passam se vencem a partir da data da cessão */
              const ehReneg = b.grupo === 'acordo' || b.tipo === 'proposta';
              if (ehReneg && !(b.acordo_id ? passa.has('a' + b.acordo_id) : [...passa].some(k => k.startsWith('p')))) continue;
              if (!ehReneg && String(b.vencimento).slice(0, 10) < String(dataCes).slice(0, 10)) continue;
              try { const r = await refazBoletoPara(b, cli, real, `Cessão nº ${pad4(c.numero)}: boleto passado do cedente para o cessionário`); if (!r.mesmo) movidos.push(r.novo); }
              catch (e) { erros.push(b.id_asaas + ': ' + e.message); }
            }
          }
        } catch (e) { erros.push(e.message); }
        await q(`update carteira.cessoes set status='concluida', datas=datas || $2, evento_id=$3 where id=$1`, [c.id, { concluida: hoje }, ev.id]);
        await log(real, 'cessao_concluida', { numero: c.numero, contrato: c.contrato, novos: nomes, boletos_passados: movidos, erros });
        return { ok: true, evento: ev.id, boletos_passados: movidos.length, erros };
      }
  async function concluirPorPagamento(id) {
    await garante();
    const [c] = await q(`select * from carteira.cessoes where id=$1`, [id]);
    if (!c || c.status === 'concluida') return null;
    return concluir(c, null, 'asaas');
  }
  const rotas = async function rotasCessoes(p, m, body, real) {
    if (p[0] !== 'cessoes') return null;
    await garante();
    try {
      if (p[1] === 'taxa' && p[2] && m === 'GET') return json(await calculaTaxa(String(p[2]).padStart(4, '0')));
      if (!p[1] && m === 'GET') {
        const L = await q(`select c.*, ct.quadra, ct.lote from carteira.cessoes c left join carteira.contratos ct on ct.numero=c.contrato order by c.numero desc`);
        const [mx] = await q(`select greatest(coalesce(max(numero),0), 42) n from carteira.cessoes`);
        return json({ lista: L, proximo: mx.n + 1 });
      }
      if (!p[1] && m === 'POST') {
        const b = body; if (!b.contrato || !b.dados) return json({ erro: 'Dados incompletos' }, 400);
        const [mx] = await q(`select greatest(coalesce(max(numero),0), 42) n from carteira.cessoes`);
        const numero = +b.numero || mx.n + 1;
        const [r] = await q(`insert into carteira.cessoes(numero, contrato, dados, status, datas, por) values ($1,$2,$3,'emitida',$4,$5) returning *`,
          [numero, b.contrato, b.dados, { emitida: new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10) }, real]);
        await log(real, 'cessao_emitida', { numero, contrato: b.contrato });
        try { r.cadastro = await cadastraPessoas(b.dados, b.contrato, numero); } catch (e) { r.cadastro_erro = e.message; }
        if (b.dados.gerar_boleto !== false && +b.dados.taxa > 0) {
          try { Object.assign(r, await emiteBoletoTaxa(r)); } catch (e) { r.boleto_erro = e.message; }
        }
        return json(r);
      }
      const [c] = p[1] ? await q(`select * from carteira.cessoes where id=$1`, [p[1]]) : [];
      if (!c) return json({ erro: 'Cessão não encontrada' }, 404);
      if (p[2] === 'boleto' && m === 'POST') {
        if (body.taxa != null || body.venc_taxa || body.taxa_parcelas) {
          const extra = { ...(body.taxa != null ? { taxa: +body.taxa } : {}), ...(body.venc_taxa ? { venc_taxa: body.venc_taxa } : {}), ...(body.taxa_parcelas ? { taxa_parcelas: +body.taxa_parcelas } : {}) };
          await q(`update carteira.cessoes set dados = dados || $2::jsonb where id=$1`, [c.id, JSON.stringify(extra)]); c.dados = { ...c.dados, ...extra };
        }
        const cadastro = await cadastraPessoas(c.dados || {}, c.contrato, c.numero);
        return json({ ok: true, cadastro, ...(await emiteBoletoTaxa(c)) });
      }
      if (!p[2] && m === 'PUT') {
        if (c.status === 'concluida' && body.dados) return json({ erro: 'Cessão já concluída' }, 400);
        const datas = { ...c.datas, ...(body.datas || {}) };
        for (const k of Object.keys(datas)) if (!datas[k]) delete datas[k];
        const status = body.status && PASSOS.includes(body.status) ? body.status : (PASSOS.filter(k => datas[k]).pop() || c.status);
        await q(`update carteira.cessoes set dados=coalesce($2,dados), datas=$3, status=$4 where id=$1`, [c.id, body.dados || null, datas, status === 'concluida' ? c.status : status]);
        return json({ ok: true });
      }
      if (!p[2] && m === 'DELETE') {
        if (c.status === 'concluida') return json({ erro: 'Cessão concluída não pode ser apagada' }, 400);
        /* excluir a cessão exclui junto os boletos da taxa que ela gerou (os já pagos não são tocados e impedem a exclusão) */
        const L = listaTaxa(c.dados || {}), pagos = [], excluidos = [];
        for (const b of L) {
          const g = await asaas('/payments/' + b.id).catch(() => null);
          if (g && !g.deleted && ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(g.status)) pagos.push(b);
        }
        if (pagos.length) return json({ erro: `A taxa desta cessão já foi paga (fatura ${pagos.map(b => b.fatura).join(', ')}). Não dá para excluir: estorne no Asaas antes.` }, 400);
        for (const b of L) {
          const g = await asaas('/payments/' + b.id).catch(() => null);
          if (g && !g.deleted) await asaasReq('DELETE', '/payments/' + b.id);
          await q(`update carteira.boletos set status='DELETED', motivo='Cessão nº ' || $2 || ' excluída', atualizado_em=now() where id_asaas=$1`, [b.id, pad4(c.numero)]).catch(() => {});
          excluidos.push(b.fatura || b.id);
        }
        await q(`delete from carteira.cessoes where id=$1`, [c.id]); await log(real, 'cessao_apagada', { numero: c.numero, contrato: c.contrato, boletos_excluidos: excluidos });
        return json({ ok: true, boletos_excluidos: excluidos });
      }
      if (p[2] === 'concluir' && m === 'POST') {
        if (c.status === 'concluida') return json({ erro: 'Já concluída' }, 400);
        return json(await concluir(c, body.data, real));
      }
      return json({ erro: 'Rota não encontrada' }, 404);
    } catch (e) { return json({ erro: e.message }, 500); }
  };
  rotas.concluirPorPagamento = concluirPorPagamento;
  return rotas;
}
