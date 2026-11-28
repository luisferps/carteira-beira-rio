/* Ágios à venda no Beira Rio: o que vem do contrato sai do sistema; o administrador digita o pedido do proprietário. */
export function criaAgios({ q, json, log }) {
  let ok = false;
  async function garante() {
    if (ok) return;
    await q(`create table if not exists carteira.agios(contrato text primary key, status text not null default 'venda', valor_pedido numeric, aceita_proposta boolean default false,
             contato text, telefone text, captador text, desde date, divulgacao jsonb default '{}', obs text, por text, criado_em timestamptz default now(), atualizado_em timestamptz default now())`);
    await q(`alter table carteira.agios add column if not exists comissao_inclusa boolean not null default true`);
    await q(`alter table carteira.agios add column if not exists comissao_pct numeric not null default 5`);
    await q(`alter table carteira.agios add column if not exists pago_base numeric`);
    ok = true;
  }
  return async function rotasAgios(p, m, body, real) {
    if (p[0] !== 'agios' && p[0] !== 'agio') return null;
    if (real !== 'luis') return json({ erro: 'Só o administrador' }, 403);
    await garante();
    try {
      if (p[0] === 'agios' && m === 'GET') {
        return json(await q(`select a.*, a.desde::text desde, c.quadra, c.lote, c.area, c.rua, c.valor_imovel, c.data_assinatura::text data_assinatura,
            coalesce((select e.dados->>'novos_titulares' from carteira.eventos e where e.contrato=c.numero and e.conferente='luis' and e.tipo='cessao' and coalesce(e.dados->>'novos_titulares','')<>'' order by e.data desc nulls last, e.id desc limit 1),
                     (select nullif(string_agg(x->>'nome', ' e ' order by o), '') from jsonb_array_elements(case when jsonb_typeof(c.compradores)='array' then c.compradores else '[]'::jsonb end) with ordinality as j(x,o)), c.nome_planilha) titular
          from carteira.agios a join carteira.contratos c on c.numero=a.contrato order by lpad(coalesce(c.quadra::text,''),3,'0'), lpad(coalesce(c.lote::text,''),3,'0'), a.contrato`).catch(() =>
          q(`select a.*, a.desde::text desde, c.quadra, c.lote, c.area, c.rua, c.valor_imovel, c.data_assinatura::text data_assinatura, c.nome_planilha titular
             from carteira.agios a join carteira.contratos c on c.numero=a.contrato order by a.contrato`)));
      }
      if (p[0] === 'agio' && p[1] && m === 'PUT') {
        const [c] = await q(`select numero from carteira.contratos where numero=$1`, [p[1]]);
        if (!c) return json({ erro: 'Contrato não encontrado' }, 404);
        const b = body || {}, num = v => v === '' || v == null || isNaN(+v) ? null : +v;
        await q(`insert into carteira.agios(contrato, status, valor_pedido, aceita_proposta, contato, telefone, captador, desde, divulgacao, obs, por, comissao_inclusa, comissao_pct, pago_base)
                 values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
                 on conflict (contrato) do update set status=excluded.status, valor_pedido=excluded.valor_pedido, aceita_proposta=excluded.aceita_proposta, contato=excluded.contato,
                   telefone=excluded.telefone, captador=excluded.captador, desde=excluded.desde, divulgacao=excluded.divulgacao, obs=excluded.obs, por=excluded.por, comissao_inclusa=excluded.comissao_inclusa, comissao_pct=excluded.comissao_pct, pago_base=excluded.pago_base, atualizado_em=now()`,
          [p[1], b.status || 'venda', num(b.valor_pedido), !!b.aceita_proposta, b.contato || null, b.telefone || null, b.captador || null, b.desde || null, JSON.stringify(b.divulgacao || {}), b.obs || null, real, b.comissao_inclusa !== false, num(b.comissao_pct) ?? 5, num(b.pago_base)]);
        await log(real, 'agio_salvo', { contrato: p[1], status: b.status, valor_pedido: num(b.valor_pedido) });
        return json({ ok: true });
      }
      if (p[0] === 'agio' && p[1] && m === 'DELETE') {
        await q(`delete from carteira.agios where contrato=$1`, [p[1]]);
        await log(real, 'agio_excluido', { contrato: p[1] });
        return json({ ok: true });
      }
      return json({ erro: 'Rota não encontrada' }, 404);
    } catch (e) { return json({ erro: e.message }, 500); }
  };
}
