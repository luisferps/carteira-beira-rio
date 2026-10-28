/* Painel para a FCA: faturamento por mês (acertos) e fotografias da inadimplência. */
export function criaPainel({ q, json, log }) {
  let ok = false;
  async function garante() {
    if (ok) return;
    await q(`create table if not exists carteira.inad_fotos(id serial primary key, data date not null, titulo text, resumo jsonb, itens jsonb not null, por text, criado_em timestamptz default now())`);
    await q(`create table if not exists carteira.comissoes(contrato text primary key, corretor text, percentual numeric, valor numeric, pago_em date, valor_pago numeric, obs text, por text, em timestamptz default now())`);
    ok = true;
  }
  return async function rotasPainel(p, m, body, real) {
    if (p[0] !== 'painel') return null;
    if (real !== 'luis') return json({ erro: 'Só o administrador' }, 403);
    await garante();
    try {
      if (p[1] === 'faturamento' && m === 'GET') {
        const h = await q(`select * from carteira.acerto_hist order by mes`).catch(() => []);
        return json({ meses: h });
      }
      if (p[1] === 'comissoes' && m === 'GET') {
        return json(await q(`select c.numero, c.quadra, c.lote, c.data_assinatura::text data, c.valor_imovel, c.corretor ct_corretor, c.corretagem ct_corretagem,
                               (select string_agg(x->>'nome', ' e ') from jsonb_array_elements(case when jsonb_typeof(c.compradores)='array' then c.compradores else '[]'::jsonb end) x) compradores,
                               k.corretor, k.percentual, k.valor, k.pago_em::text pago_em, k.valor_pago, k.obs
                             from carteira.contratos c left join carteira.comissoes k on k.contrato=c.numero
                             where coalesce(c.corretor,'')<>'' or coalesce(c.corretagem,0)>0 or k.contrato is not null order by c.data_assinatura desc nulls last, c.numero desc`));
      }
      if (p[1] === 'comissao' && p[2] && m === 'PUT') {
        const b = body;
        await q(`insert into carteira.comissoes(contrato, corretor, percentual, valor, pago_em, valor_pago, obs, por) values ($1,$2,$3,$4,$5,$6,$7,$8)
                 on conflict (contrato) do update set corretor=excluded.corretor, percentual=excluded.percentual, valor=excluded.valor, pago_em=excluded.pago_em, valor_pago=excluded.valor_pago, obs=excluded.obs, por=excluded.por, em=now()`,
          [p[2], b.corretor || null, b.percentual ?? null, b.valor ?? null, b.pago_em || null, b.valor_pago ?? null, b.obs || null, real]);
        await log(real, 'comissao_corretagem', { contrato: p[2], ...b });
        return json({ ok: true });
      }
      if (p[1] === 'fotos' && m === 'GET') return json(await q(`select id, data::text data, titulo, resumo, criado_em from carteira.inad_fotos order by data desc, id desc`));
      if (p[1] === 'foto' && p[2] && m === 'GET') { const [f] = await q(`select id, data::text data, titulo, resumo, itens from carteira.inad_fotos where id=$1`, [p[2]]); return f ? json(f) : json({ erro: 'Não encontrada' }, 404); }
      if (p[1] === 'foto' && !p[2] && m === 'POST') {
        const itens = (body.itens || []).filter(x => +x.valor > 0);
        const resumo = { contratos: itens.length, parcelas: itens.reduce((s, x) => s + (+x.parcelas || 0), 0), valor: Math.round(itens.reduce((s, x) => s + +x.valor, 0) * 100) / 100 };
        const [r] = await q(`insert into carteira.inad_fotos(data, titulo, resumo, itens, por) values ($1,$2,$3,$4,$5) returning id`, [body.data, body.titulo || null, resumo, JSON.stringify(itens), real]);
        await log(real, 'foto_inadimplencia', { id: r.id, ...resumo });
        return json({ id: r.id, resumo });
      }
      if (p[1] === 'foto' && p[2] && m === 'DELETE') { await q(`delete from carteira.inad_fotos where id=$1`, [p[2]]); return json({ ok: true }); }
      return json({ erro: 'Rota não encontrada' }, 404);
    } catch (e) { return json({ erro: e.message }, 500); }
  };
}
