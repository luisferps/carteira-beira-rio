import pg from 'pg';

pg.types.setTypeParser(1082, v => v);

const pool = new pg.Pool({
  connectionString: process.env.DB_PASSWORD
    ? (process.env.DATABASE_URL || '').trim().replace('[YOUR-PASSWORD]', encodeURIComponent(process.env.DB_PASSWORD.trim()))
    : process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false },
  max: 3,
});

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

const PL = (process.env.PIN_LUIS || '').trim(), PS = (process.env.PIN_SECRETARIA || '').trim();
function quem(req) {
  const pin = (req.headers.get('x-pin') || '').trim();
  if (pin && pin === PL) return 'luis';
  if (pin && pin === PS) return 'secretaria';
  return null;
}

async function q(sql, params = []) {
  const r = await pool.query(sql, params);
  return r.rows;
}

async function log(conf, acao, detalhe) {
  await q('insert into carteira.historico(conferente, acao, detalhe) values ($1,$2,$3)', [conf, acao, detalhe]);
}

const CAMPOS_PAG = ['forma', 'fatura', 'situacao_asaas', 'valor_cobranca', 'valor_pago', 'criada_em',
  'vencimento_boleto', 'confirmada_em', 'saque_em', 'cliente_asaas', 'descricao', 'obs'];

function limpa(v) { return v === '' || v === undefined ? null : v; }

async function tituloDoConferente(id, conf) {
  const r = await q('select * from carteira.titulos where id=$1 and (conferente is null or conferente=$2)', [id, conf]);
  return r[0];
}

async function lerPrint(body) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { erro: 'Falta a chave da inteligência artificial no Netlify (ANTHROPIC_API_KEY).' };
  const content = [];
  if (body.imagem) {
    const m = body.imagem.match(/^data:(image\/[a-z]+);base64,(.*)$/);
    if (m) content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
  }
  content.push({
    type: 'text',
    text: `Você está lendo a tela "Detalhes" de uma cobrança do banco Asaas (e, se houver, a descrição colada abaixo).
Devolva SOMENTE um JSON, sem texto antes ou depois, com estas chaves (null quando não aparecer):
fatura (número da fatura, só dígitos), situacao_asaas (ex.: Recebida, Confirmada, Recebida em dinheiro, Vencida, Cancelada),
valor_cobranca (valor original da cobrança, número), valor_pago (número), criada_em, vencimento_boleto, confirmada_em, saque_em (datas no formato AAAA-MM-DD),
forma (Boleto Bancário, Pix, Cartão, etc.), cliente_asaas (nome), descricao (texto completo da descrição),
contrato (número de 4 dígitos do contrato citado na descrição, ex. "Condomínio Beira Rio - 0099" => "0099"),
quadra, lote (2 dígitos cada, ex. "Q05 L03" => "05","03"),
parcelas_citadas (lista de textos das parcelas citadas na descrição, ex. ["Mensal 34/120"]).
Números com ponto decimal (967.68). Descrição colada pelo usuário: """${body.descricao || ''}"""`,
  });
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 1200, messages: [{ role: 'user', content }] }),
  });
  const d = await r.json();
  if (!r.ok) return { erro: d.error?.message || 'Falha ao ler o print' };
  const txt = (d.content || []).map(c => c.text || '').join('');
  const i = txt.indexOf('{'), j = txt.lastIndexOf('}');
  try { return JSON.parse(txt.slice(i, j + 1)); } catch { return { erro: 'Não consegui entender a resposta', bruto: txt }; }
}

export default async (req) => {
  const url = new URL(req.url);
  const p = url.pathname.replace(/^\/(\.netlify\/functions\/api|api)/, '').split('/').filter(Boolean);
  if (p[0] === 'diag') {
    const raw = (process.env.DATABASE_URL || '').trim(), pw = (process.env.DB_PASSWORD || '').trim();
    let info = {};
    try { const u = new URL(raw.replace('[YOUR-PASSWORD]', 'x')); info = { usuario: u.username, servidor: u.hostname, porta: u.port, banco: u.pathname }; } catch (e) { info = { erro_endereco: e.message }; }
    let teste = 'ok';
    try { await q('select 1'); } catch (e) { teste = e.message; }
    return json({ ...info, tem_marcador_senha: raw.includes('[YOUR-PASSWORD]'), tamanho_senha: pw.length,
      senha_tem_espaco_ou_aspas: /[\s"']/.test(pw), inicio_fim_senha: pw ? pw[0] + '…' + pw[pw.length - 1] : '', teste_conexao: teste });
  }
  const conf = quem(req);
  if (!conf) {
    const falta = [!PL && 'PIN_LUIS', !PS && 'PIN_SECRETARIA', !process.env.DATABASE_URL && 'DATABASE_URL'].filter(Boolean);
    return json({ erro: falta.length ? 'O servidor não está lendo: ' + falta.join(', ') : 'Senha inválida' }, 401);
  }
  const m = req.method;
  const body = m === 'GET' || m === 'DELETE' ? {} : await req.json().catch(() => ({}));

  try {
    if (p[0] === 'eu') return json({ conferente: conf });

    if (p[0] === 'contratos' && m === 'GET') {
      const rows = await q(`
        select c.numero, c.quadra, c.lote, c.valor_imovel, c.data_assinatura,
               coalesce(c.compradores->0->>'nome', c.nome_planilha) as titular,
               jsonb_array_length(c.alertas) as n_alertas,
               (select count(*) from carteira.titulos t where t.contrato=c.numero and t.conferente is null and t.vencimento <= current_date) as vencidas,
               (select count(distinct t.id) from carteira.titulos t
                  where t.contrato=c.numero and t.conferente is null and t.vencimento <= current_date
                    and (exists(select 1 from carteira.pagamentos g where g.titulo_id=t.id and g.conferente=$1)
                      or exists(select 1 from carteira.conferencia_titulo ct where ct.titulo_id=t.id and ct.conferente=$1))) as conferidas,
               (select fechado_em from carteira.fechamentos f where f.contrato=c.numero and f.conferente=$1) as fechado_em
        from carteira.contratos c order by c.numero`, [conf]);
      return json(rows);
    }

    if (p[0] === 'contrato' && p[1] && m === 'GET') {
      const n = p[1];
      const [contrato] = await q('select * from carteira.contratos where numero=$1', [n]);
      if (!contrato) return json({ erro: 'Contrato não encontrado' }, 404);
      const titulos = await q(`select * from carteira.titulos where contrato=$1 and (conferente is null or conferente=$2)
                               order by case grupo when 'entrada' then 0 when 'mensal' then 1 when 'anual' then 2 when 'outra' then 3 else 4 end, vencimento, numero`, [n, conf]);
      const ids = titulos.map(t => t.id);
      const pagamentos = await q(`select ${['id', 'titulo_id', 'tem_print', 'salvo_em', ...CAMPOS_PAG].join(',')} from carteira.pagamentos
                                  where conferente=$1 and titulo_id = any($2) order by salvo_em`, [conf, ids]);
      const situacoes = await q('select * from carteira.conferencia_titulo where conferente=$1 and titulo_id = any($2)', [conf, ids]);
      const acordos = await q('select * from carteira.acordos where contrato=$1 and conferente=$2 order by data_acordo, id', [n, conf]);
      const correcoes = await q('select * from carteira.correcoes where contrato=$1 and conferente=$2 order by grupo, a_partir', [n, conf]);
      const eventos = await q('select * from carteira.eventos where contrato=$1 and conferente=$2 order by data, id', [n, conf]);
      const [fechamento] = await q('select * from carteira.fechamentos where contrato=$1 and conferente=$2', [n, conf]);
      return json({ contrato, titulos, pagamentos, situacoes, acordos, correcoes, eventos, fechamento: fechamento || null, hoje: new Date().toISOString().slice(0, 10) });
    }

    if (p[0] === 'pagamento' && m === 'POST') {
      const t = await tituloDoConferente(body.titulo_id, conf);
      if (!t) return json({ erro: 'Parcela não encontrada' }, 404);
      const vals = CAMPOS_PAG.map(c => limpa(body[c]));
      const [g] = await q(`insert into carteira.pagamentos(conferente, titulo_id, ${CAMPOS_PAG.join(',')}, tem_print)
                           values ($1,$2,${CAMPOS_PAG.map((_, i) => '$' + (i + 3)).join(',')}, $${CAMPOS_PAG.length + 3}) returning id, salvo_em`,
        [conf, t.id, ...vals, !!body.print]);
      if (body.print) await q('insert into carteira.prints(pagamento_id, tipo, conteudo) values ($1,$2,$3)', [g.id, 'image/jpeg', body.print]);
      await q(`insert into carteira.conferencia_titulo(conferente, titulo_id, situacao) values ($1,$2,'paga')
               on conflict (conferente, titulo_id) do update set situacao='paga', salvo_em=now()`, [conf, t.id]);
      await log(conf, 'pagamento_novo', { id: g.id, titulo: t.id });
      return json(g);
    }

    if (p[0] === 'pagamento' && p[1] && m === 'PUT') {
      const [old] = await q('select * from carteira.pagamentos where id=$1 and conferente=$2', [p[1], conf]);
      if (!old) return json({ erro: 'Pagamento não encontrado' }, 404);
      await q(`update carteira.pagamentos set ${CAMPOS_PAG.map((c, i) => c + '=$' + (i + 3)).join(',')}, salvo_em=now()
               where id=$1 and conferente=$2`, [p[1], conf, ...CAMPOS_PAG.map(c => limpa(body[c]))]);
      if (body.print) {
        await q(`insert into carteira.prints(pagamento_id, tipo, conteudo) values ($1,'image/jpeg',$2)
                 on conflict (pagamento_id) do update set conteudo=excluded.conteudo`, [p[1], body.print]);
        await q('update carteira.pagamentos set tem_print=true where id=$1', [p[1]]);
      }
      await log(conf, 'pagamento_alterado', { id: p[1], antes: old });
      return json({ ok: true });
    }

    if (p[0] === 'pagamento' && p[1] && m === 'DELETE') {
      const [old] = await q('delete from carteira.pagamentos where id=$1 and conferente=$2 returning *', [p[1], conf]);
      if (old) {
        const [r] = await q('select count(*)::int n from carteira.pagamentos where titulo_id=$1 and conferente=$2', [old.titulo_id, conf]);
        if (!r.n) await q(`delete from carteira.conferencia_titulo where conferente=$1 and titulo_id=$2 and situacao='paga'`, [conf, old.titulo_id]);
        await log(conf, 'pagamento_apagado', old);
      }
      return json({ ok: true });
    }

    if (p[0] === 'print' && p[1]) {
      const [r] = await q(`select pr.conteudo from carteira.prints pr join carteira.pagamentos g on g.id=pr.pagamento_id
                           where pr.pagamento_id=$1 and g.conferente=$2`, [p[1], conf]);
      return json({ conteudo: r?.conteudo || null });
    }

    if (p[0] === 'situacao' && m === 'POST') {
      const t = await tituloDoConferente(body.titulo_id, conf);
      if (!t) return json({ erro: 'Parcela não encontrada' }, 404);
      if (!body.situacao) await q('delete from carteira.conferencia_titulo where conferente=$1 and titulo_id=$2', [conf, t.id]);
      else await q(`insert into carteira.conferencia_titulo(conferente, titulo_id, situacao, obs) values ($1,$2,$3,$4)
                    on conflict (conferente, titulo_id) do update set situacao=excluded.situacao, obs=excluded.obs, salvo_em=now()`,
        [conf, t.id, body.situacao, limpa(body.obs)]);
      await log(conf, 'situacao', body);
      return json({ ok: true });
    }

    if (p[0] === 'acordo' && m === 'POST') {
      const b = body;
      const [a] = await q(`insert into carteira.acordos(contrato, conferente, data_acordo, titulos_origem, principal, multa, juros, honorarios,
                           valor_calculado, valor_acordado, desconto_encargos, qtd_parcelas, obs)
                           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
        [b.contrato, conf, b.data_acordo, b.titulos_origem, b.principal, b.multa, b.juros, b.honorarios, b.valor_calculado,
          b.valor_acordado, b.desconto_encargos, b.parcelas.length, limpa(b.obs)]);
      let i = 0;
      for (const par of b.parcelas) {
        i++;
        await q(`insert into carteira.titulos(contrato, grupo, numero, total, rotulo, vencimento, valor_face, conferente, acordo_id)
                 values ($1,'acordo',$2,$3,$4,$5,$6,$7,$8)`,
          [b.contrato, i, b.parcelas.length, `Acordo ${b.data_acordo.split('-').reverse().join('/')} — ${i}/${b.parcelas.length}`, par.vencimento, par.valor, conf, a.id]);
      }
      await log(conf, 'acordo_novo', { id: a.id, ...b });
      return json(a);
    }

    if (p[0] === 'acordo' && p[1] && m === 'PUT') {
      const b = body;
      await q(`update carteira.acordos set data_acordo=$3, titulos_origem=$4, principal=$5, multa=$6, juros=$7, honorarios=$8,
               valor_calculado=$9, valor_acordado=$10, desconto_encargos=$11, qtd_parcelas=$12, obs=$13, salvo_em=now()
               where id=$1 and conferente=$2`,
        [p[1], conf, b.data_acordo, b.titulos_origem, b.principal, b.multa, b.juros, b.honorarios, b.valor_calculado,
          b.valor_acordado, b.desconto_encargos, b.parcelas.length, limpa(b.obs)]);
      const atuais = await q('select * from carteira.titulos where acordo_id=$1 and conferente=$2 order by numero', [p[1], conf]);
      for (let i = 0; i < b.parcelas.length; i++) {
        const par = b.parcelas[i], rot = `Acordo ${b.data_acordo.split('-').reverse().join('/')} — ${i + 1}/${b.parcelas.length}`;
        if (atuais[i]) await q('update carteira.titulos set numero=$2,total=$3,rotulo=$4,vencimento=$5,valor_face=$6 where id=$1',
          [atuais[i].id, i + 1, b.parcelas.length, rot, par.vencimento, par.valor]);
        else await q(`insert into carteira.titulos(contrato, grupo, numero, total, rotulo, vencimento, valor_face, conferente, acordo_id)
                      values ($1,'acordo',$2,$3,$4,$5,$6,$7,$8)`, [b.contrato, i + 1, b.parcelas.length, rot, par.vencimento, par.valor, conf, p[1]]);
      }
      for (const t of atuais.slice(b.parcelas.length)) await q('delete from carteira.titulos where id=$1', [t.id]);
      await log(conf, 'acordo_alterado', { id: p[1], ...b });
      return json({ ok: true });
    }

    if (p[0] === 'acordo' && p[1] && m === 'DELETE') {
      await q('delete from carteira.titulos where acordo_id=$1 and conferente=$2', [p[1], conf]);
      const [a] = await q('delete from carteira.acordos where id=$1 and conferente=$2 returning *', [p[1], conf]);
      await log(conf, 'acordo_apagado', a || { id: p[1] });
      return json({ ok: true });
    }

    if (p[0] === 'correcao' && m === 'POST') {
      const b = body;
      const [r] = await q(`insert into carteira.correcoes(contrato, conferente, grupo, a_partir, data, igpm_pct, juros_pct, novo_valor, obs)
                           values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [b.contrato, conf, b.grupo, b.a_partir, limpa(b.data), limpa(b.igpm_pct), limpa(b.juros_pct), b.novo_valor, limpa(b.obs)]);
      await log(conf, 'correcao_nova', b);
      return json(r);
    }

    if (p[0] === 'correcao' && p[1] && m === 'DELETE') {
      const [r] = await q('delete from carteira.correcoes where id=$1 and conferente=$2 returning *', [p[1], conf]);
      await log(conf, 'correcao_apagada', r || {});
      return json({ ok: true });
    }

    if (p[0] === 'evento' && m === 'POST') {
      const b = body;
      const [r] = await q(`insert into carteira.eventos(contrato, conferente, tipo, motivo, a_partir_titulo, data, dados, obs)
                           values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [b.contrato, conf, b.tipo, limpa(b.motivo), b.a_partir_titulo, limpa(b.data), b.dados || {}, limpa(b.obs)]);
      await log(conf, 'evento_novo', b);
      return json(r);
    }

    if (p[0] === 'evento' && p[1] && m === 'DELETE') {
      const [r] = await q('delete from carteira.eventos where id=$1 and conferente=$2 returning *', [p[1], conf]);
      await log(conf, 'evento_apagado', r || {});
      return json({ ok: true });
    }

    if (p[0] === 'fechar' && m === 'POST') {
      await q(`insert into carteira.fechamentos(contrato, conferente) values ($1,$2)
               on conflict (contrato, conferente) do update set fechado_em=now()`, [body.contrato, conf]);
      await log(conf, 'fechar', body);
      return json({ ok: true });
    }

    if (p[0] === 'fechar' && p[1] && m === 'DELETE') {
      await q('delete from carteira.fechamentos where contrato=$1 and conferente=$2', [p[1], conf]);
      await log(conf, 'reabrir', { contrato: p[1] });
      return json({ ok: true });
    }

    if (p[0] === 'ler-print' && m === 'POST') return json(await lerPrint(body));

    return json({ erro: 'Rota não encontrada' }, 404);
  } catch (e) {
    return json({ erro: e.message }, 500);
  }
};

export const config = { path: ['/api/*'] };
