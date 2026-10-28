/* Painel para a FCA: faturamento por mês (acertos) e fotografias da inadimplência. */
export function criaPainel({ q, json, log }) {
  let ok = false;
  async function garante() {
    if (ok) return;
    await q(`create table if not exists carteira.inad_fotos(id serial primary key, data date not null, titulo text, resumo jsonb, itens jsonb not null, por text, criado_em timestamptz default now())`);
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
