/* Cessão de direitos: documento numerado, andamento (enviada, voltou assinada, firma reconhecida) e conclusão (troca de titulares no contrato). */
const PASSOS = ['emitida', 'enviada', 'assinada', 'reconhecida', 'concluida'];
const dig = v => String(v || '').replace(/\D/g, '');
export function criaCessoes({ q, json, log }) {
  let ok = false;
  async function garante() {
    if (ok) return;
    await q(`create table if not exists carteira.cessoes(id serial primary key, numero int unique, contrato text not null, dados jsonb not null default '{}',
             status text not null default 'emitida', datas jsonb not null default '{}', evento_id int, criado_em timestamptz default now(), por text)`);
    ok = true;
  }
  return async function rotasCessoes(p, m, body, real) {
    if (p[0] !== 'cessoes') return null;
    await garante();
    try {
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
        return json(r);
      }
      const [c] = p[1] ? await q(`select * from carteira.cessoes where id=$1`, [p[1]]) : [];
      if (!c) return json({ erro: 'Cessão não encontrada' }, 404);
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
        await q(`delete from carteira.cessoes where id=$1`, [c.id]); await log(real, 'cessao_apagada', { numero: c.numero, contrato: c.contrato });
        return json({ ok: true });
      }
      if (p[2] === 'concluir' && m === 'POST') {
        if (c.status === 'concluida') return json({ erro: 'Já concluída' }, 400);
        const d = c.dados || {}, hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
        const data = body.data || d.data || hoje;
        /* troca de titulares a partir da 1ª parcela em aberto */
        const [t0] = await q(`select t.id from carteira.titulos t where t.contrato=$1 and t.grupo<>'acordo'
                               and not exists (select 1 from carteira.pagamentos g where g.titulo_id=t.id) order by t.vencimento limit 1`, [c.contrato]);
        const nomes = (d.cessionarios || []).map(x => x.nome).filter(Boolean);
        const [ev] = await q(`insert into carteira.eventos(contrato, conferente, tipo, motivo, a_partir_titulo, data, dados, obs) values ($1,'luis','cessao',null,$2,$3,$4,$5) returning id`,
          [c.contrato, t0?.id || null, data, { novos_titulares: nomes.join(' e '), antes: (d.cedentes || []).map(x => x.nome).join(' e '), taxa_cessao: d.taxa ?? null, documento: String(c.numero).padStart(4, '0') },
            `Cessão de direitos nº ${String(c.numero).padStart(4, '0')}`]);
        /* cessionários entram no cadastro de clientes */
        for (const x of d.cessionarios || []) {
          const cpf = dig(x.cpf); if (!cpf) continue;
          const manual = { nome: x.nome, cpf: x.cpf, rg: x.rg, profissao: x.profissao, estado_civil: x.estado_civil, nacionalidade: x.nacionalidade, endereco: x.endereco, fone: x.fone || null, email: x.email || null };
          await q(`insert into carteira.clientes(chave, cpf, nome, manual) values ($1,$2,$3,$4)
                   on conflict (chave) do update set manual = coalesce(carteira.clientes.manual,'{}'::jsonb) || excluded.manual, atualizado_em=now()`, ['cpf:' + cpf, cpf, x.nome, manual]);
        }
        await q(`update carteira.cessoes set status='concluida', datas=datas || $2, evento_id=$3 where id=$1`, [c.id, { concluida: hoje }, ev.id]);
        await log(real, 'cessao_concluida', { numero: c.numero, contrato: c.contrato, novos: nomes });
        return json({ ok: true, evento: ev.id });
      }
      return json({ erro: 'Rota não encontrada' }, 404);
    } catch (e) { return json({ erro: e.message }, 500); }
  };
}
