/* Documentos do contrato e dos compradores: checklist (tem / falta) e arquivos anexados. */
export const ITENS_CONTRATO = [['contrato_assinado', 'Contrato assinado'], ['firma', 'Firma reconhecida em cartório'], ['testemunhas', 'Testemunhas assinaram'], ['proposta', 'Proposta']];
export const ITENS_PESSOA = [['rg', 'RG ou CNH'], ['cpf', 'CPF'], ['endereco', 'Comprovante de endereço'], ['estado_civil', 'Certidão de estado civil']];
export function criaDocumentos({ q, json, log }) {
  let ok = false;
  async function garante() {
    if (ok) return;
    await q(`create table if not exists carteira.documentos(id serial primary key, contrato text not null, chave text not null, nome text, mime text, tamanho int, b64 text not null, por text, enviado_em timestamptz default now())`);
    await q(`create table if not exists carteira.doc_check(contrato text not null, chave text not null, status text, obs text, por text, em timestamptz default now(), primary key(contrato, chave))`);
    ok = true;
  }
  return async function rotasDocumentos(p, m, body, real, url) {
    if (p[0] !== 'documentos' && p[0] !== 'documento') return null;
    if (!['luis', 'assistente'].includes(real)) return json({ erro: 'Sem permissão' }, 403);
    await garante();
    try {
      if (p[0] === 'documentos' && p[1] === 'pendencias' && m === 'GET') {
        const cts = await q(`select c.numero, c.quadra, c.lote, c.compradores from carteira.contratos c
                             where not exists (select 1 from carteira.eventos e where e.contrato=c.numero and e.tipo='encerramento' and e.conferente='luis') order by c.numero`);
        const ck = await q(`select contrato, chave, status from carteira.doc_check`);
        const ar = await q(`select contrato, chave, count(*)::int n from carteira.documentos group by 1,2`);
        const K = {}; for (const x of ck) K[x.contrato + '|' + x.chave] = x.status;
        const A = {}; for (const x of ar) A[x.contrato + '|' + x.chave] = x.n;
        const out = cts.map(c => {
          const pes = (Array.isArray(c.compradores) ? c.compradores : []).map((x, i) => ({ i, nome: x.nome }));
          const chaves = [...ITENS_CONTRATO.map(([k, l]) => ({ k, l })), ...pes.flatMap(pp => ITENS_PESSOA.map(([k, l]) => ({ k: `p${pp.i}_${k}`, l: `${l} — ${pp.nome}` })))];
          const falta = chaves.filter(x => !(K[c.numero + '|' + x.k] === 'ok' || A[c.numero + '|' + x.k]) && K[c.numero + '|' + x.k] !== 'dispensado');
          return { contrato: c.numero, quadra: c.quadra, lote: c.lote, titular: pes.map(x => x.nome).join(' e '), total: chaves.length, falta: falta.map(x => x.l), marcados: chaves.filter(x => K[c.numero + '|' + x.k] || A[c.numero + '|' + x.k]).length };
        });
        return json(out);
      }
      if (p[0] === 'documentos' && m === 'GET') {
        const n = url.searchParams.get('contrato');
        const [c] = await q(`select numero, compradores from carteira.contratos where numero=$1`, [n]);
        return json({ itens_contrato: ITENS_CONTRATO, itens_pessoa: ITENS_PESSOA, pessoas: (Array.isArray(c?.compradores) ? c.compradores : []).map((x, i) => ({ i, nome: x.nome })),
          check: await q(`select chave, status, obs, por, em from carteira.doc_check where contrato=$1`, [n]),
          arquivos: await q(`select id, chave, nome, mime, tamanho, por, enviado_em from carteira.documentos where contrato=$1 order by enviado_em`, [n]) });
      }
      if (p[0] === 'documentos' && p[1] === 'check' && m === 'PUT') {
        const b = body;
        if (!b.status) await q(`delete from carteira.doc_check where contrato=$1 and chave=$2`, [b.contrato, b.chave]);
        else await q(`insert into carteira.doc_check(contrato, chave, status, obs, por) values ($1,$2,$3,$4,$5) on conflict (contrato, chave) do update set status=excluded.status, obs=excluded.obs, por=excluded.por, em=now()`, [b.contrato, b.chave, b.status, b.obs || null, real]);
        return json({ ok: true });
      }
      if (p[0] === 'documento' && !p[1] && m === 'POST') {
        const b = body; if (!b.contrato || !b.chave || !b.b64) return json({ erro: 'Arquivo incompleto' }, 400);
        const tam = Math.round(b.b64.length * 3 / 4); if (tam > 4.2e6) return json({ erro: 'Arquivo grande demais (máximo 4 MB)' }, 400);
        const [r] = await q(`insert into carteira.documentos(contrato, chave, nome, mime, tamanho, b64, por) values ($1,$2,$3,$4,$5,$6,$7) returning id`, [b.contrato, b.chave, b.nome || null, b.mime || null, tam, b.b64, real]);
        await log(real, 'documento_anexado', { contrato: b.contrato, chave: b.chave, nome: b.nome });
        return json(r);
      }
      if (p[0] === 'documento' && p[1] && m === 'GET') { const [r] = await q(`select nome, mime, b64 from carteira.documentos where id=$1`, [p[1]]); return r ? json(r) : json({ erro: 'Não encontrado' }, 404); }
      if (p[0] === 'documento' && p[1] && m === 'DELETE') { await q(`delete from carteira.documentos where id=$1`, [p[1]]); await log(real, 'documento_apagado', { id: p[1] }); return json({ ok: true }); }
      return json({ erro: 'Rota não encontrada' }, 404);
    } catch (e) { return json({ erro: e.message }, 500); }
  };
}
