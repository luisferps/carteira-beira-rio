import pg from 'pg';

pg.types.setTypeParser(1082, v => v);

function enderecoBanco() {
  const raw = (process.env.DATABASE_URL || '').trim(), pw = (process.env.DB_PASSWORD || '').trim();
  if (!pw) return raw;
  try { const u = new URL(raw.replace('[YOUR-PASSWORD]', 'x')); u.password = encodeURIComponent(pw); return u.toString(); }
  catch { return raw; }
}

const pool = new pg.Pool({
  connectionString: enderecoBanco(),
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
  'vencimento_boleto', 'confirmada_em', 'saque_em', 'cliente_asaas', 'descricao', 'obs',
  'id_asaas', 'link_fatura', 'nosso_numero', 'linha_digitavel', 'valor_liquido', 'vencimento_original', 'pago_cliente_em',
  'juros_mes_pct', 'multa_pct', 'desconto_valor', 'id_cliente_asaas', 'id_parcelamento_asaas',
  'multa_paga', 'juros_pago', 'honorarios_pago', 'desconto_dado', 'compensacao'];

function limpa(v) { return v === '' || v === undefined ? null : v; }

async function corteEncerramento(contrato, conf) {
  const [e] = await q(`select t.vencimento, e.data from carteira.eventos e join carteira.titulos t on t.id=e.a_partir_titulo
                       where e.contrato=$1 and e.conferente=$2 and e.tipo='encerramento' order by e.id limit 1`, [contrato, conf]);
  return e ? String(e.vencimento instanceof Date ? e.vencimento.toISOString() : e.vencimento).slice(0, 10) : null;
}
async function bloqueioEncerrado(t, conf) {
  if (!t || t.grupo === 'acordo') return null;
  const corte = await corteEncerramento(t.contrato, conf);
  const v = String(t.vencimento instanceof Date ? t.vencimento.toISOString() : t.vencimento || '').slice(0, 10);
  return corte && v && v >= corte ? `Contrato encerrado/cancelado a partir de ${corte.split('-').reverse().join('/')}. Não é possível alterar parcelas dessa data em diante.` : null;
}
async function tituloDoConferente(id, conf) {
  const r = await q('select * from carteira.titulos where id=$1 and (conferente is null or conferente=$2)', [id, conf]);
  return r[0];
}

async function lerPrint(body) {
  const key = (process.env.ANTHROPIC_API_KEY || '').trim().replace(/^["']|["']$/g, '');
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
juros_mes_pct (juros ao mês %), multa_pct (valor percentual da multa), desconto_valor (valor fixo do desconto).
Datas: "Confirmada em" vai em confirmada_em; "Saque disponível em" ou "Recebida e disponível para saque em" vai em saque_em
(se só existir "Recebida e disponível para saque em", repita a mesma data em confirmada_em).
contrato (número de 4 dígitos do contrato citado na descrição, ex. "Condomínio Beira Rio - 0099" => "0099"),
quadra, lote (2 dígitos cada, ex. "Q05 L03" => "05","03"),
parcelas_citadas (lista de textos das parcelas citadas na descrição, ex. ["Mensal 34/120"]).
Números com ponto decimal (967.68). Descrição colada pelo usuário: """${body.descricao || ''}"""`,
  });
  const req = { method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 1200, messages: [{ role: 'user', content }] }) };
  let r, ultimo;
  for (let t = 0; t < 3; t++) {
    try { r = await fetch('https://api.anthropic.com/v1/messages', req); if (r.status < 500 && r.status !== 429) break; ultimo = 'servidor da IA respondeu ' + r.status; }
    catch (e) { ultimo = (e.cause && (e.cause.code || e.cause.message)) || e.message; r = null; }
    await new Promise(ok => setTimeout(ok, 800 * (t + 1)));
  }
  if (!r) return { erro: 'Não consegui falar com a IA (' + ultimo + '). Clique em "Ler de novo".' };
  const d = await r.json();
  if (!r.ok) return { erro: d.error?.message || 'Falha ao ler o print' };
  const txt = (d.content || []).map(c => c.text || '').join('');
  const i = txt.indexOf('{'), j = txt.lastIndexOf('}');
  try { return JSON.parse(txt.slice(i, j + 1)); } catch { return { erro: 'Não consegui entender a resposta', bruto: txt }; }
}


const ORDEM = `order by case grupo when 'entrada' then 0 when 'mensal' then 1 when 'anual' then 2 when 'outra' then 3 else 4 end, vencimento, numero`;
async function carregar(n, conf) {
  const [contrato] = await q('select * from carteira.contratos where numero=$1', [n]);
  if (!contrato) return null;
  const titulos = await q(`select * from carteira.titulos where contrato=$1 and (conferente is null or conferente=$2) ${ORDEM}`, [n, conf]);
  const ids = titulos.map(t => t.id);
  const pagamentos = await q(`select ${['id', 'titulo_id', 'tem_print', 'salvo_em', ...CAMPOS_PAG].join(',')} from carteira.pagamentos
                              where conferente=$1 and titulo_id = any($2) order by salvo_em`, [conf, ids]);
  const situacoes = await q('select * from carteira.conferencia_titulo where conferente=$1 and titulo_id = any($2)', [conf, ids]);
  const acordos = await q('select * from carteira.acordos where contrato=$1 and conferente=$2 order by data_acordo, id', [n, conf]);
  const correcoes = await q('select * from carteira.correcoes where contrato=$1 and conferente=$2 order by grupo, a_partir', [n, conf]);
  const eventos = await q('select * from carteira.eventos where contrato=$1 and conferente=$2 order by data, id', [n, conf]);
  const [fechamento] = await q('select * from carteira.fechamentos where contrato=$1 and conferente=$2', [n, conf]);
  const propostas = await q('select * from carteira.propostas where contrato=$1 and conferente=$2 order by id', [n, conf]).catch(() => []);
  const termosArq = await q('select termo, nome, enviado_em from carteira.termos_arq where contrato=$1 order by termo', [n]).catch(() => []);
  const boletos = await q(`select id_asaas, titulo_id, tipo, fatura, valor, vencimento::text vencimento, status, link, origem, motivo, composicao, criado_em from carteira.boletos where contrato=$1 order by vencimento desc, criado_em desc`, [n]).catch(() => []);
  return { contrato, titulos, pagamentos, situacoes, acordos, correcoes, eventos, propostas, termosArq, boletos, fechamento: fechamento || null, hoje: new Date().toISOString().slice(0, 10), conferente: conf };
}

/* ---------- cruzamento ---------- */
const HOJE = () => new Date().toISOString().slice(0, 10);
function estadoDe(t, D) {
  const pags = D.pagamentos.filter(p => p.titulo_id == t.id), sit = D.situacoes.find(s => s.titulo_id == t.id);
  const enc = D.eventos.find(e => e.tipo === 'encerramento' && t.grupo !== 'acordo' && (() => { const t0 = D.base.find(x => x.id == e.a_partir_titulo); return t0 && t.vencimento && t.vencimento >= t0.vencimento; })());
  if ((sit && sit.situacao === 'cancelada') || enc) return 'cancelada';
  if (pags.length) return 'paga';
  const ac = D.acordos.find(a => (a.titulos_origem || []).map(String).includes(String(t.id)));
  if (ac) { const pago = D.titAcordo.some(x => x.acordo_id == ac.id && D.pagamentos.some(p => p.titulo_id == x.id)); return pago ? 'quitada_acordo' : 'em_acordo'; }
  if (sit && sit.situacao === 'em_atraso') return 'em_atraso';
  if (t.vencimento && t.vencimento <= HOJE()) return 'vencida';
  return 'futura';
}
const n2 = v => v == null ? '' : Number(v).toFixed(2);
function assinaturaTitulo(t, D) {
  const e = estadoDe(t, D);
  const pg = D.pagamentos.filter(p => p.titulo_id == t.id).map(p => `${p.fatura || p.id_asaas || ''}:${n2(p.valor_pago)}:${p.confirmada_em || ''}`).sort().join(',');
  return e + '|' + pg;
}
function rot(D, id) { const t = D.base.find(x => x.id == id) || D.titAcordo.find(x => x.id == id); return t ? t.rotulo.replace(/^Acordo .* — /, 'Acordo ') : '?'; }
function assinaturaSecao(sec, D) {
  if (sec === 'acordos') return D.acordos.map(a => {
    const ts = D.titAcordo.filter(t => t.acordo_id == a.id);
    const pago = ts.reduce((s, t) => s + D.pagamentos.filter(p => p.titulo_id == t.id).reduce((x, p) => x + Number(p.valor_pago || 0), 0), 0);
    return `${a.data_acordo}|${n2(a.valor_acordado)}|${(a.titulos_origem || []).map(i => rot(D, i)).sort().join('+')}|${ts.length}x|pago ${n2(pago)}`;
  }).sort().join(' ; ');
  if (sec === 'correcoes') return D.correcoes.map(c => `${c.grupo} ${c.a_partir}: ${n2(c.novo_valor)}`).sort().join(' ; ');
  if (sec === 'eventos') return D.eventos.map(e => `${e.tipo} ${e.motivo || ''} a partir de ${rot(D, e.a_partir_titulo)}`).sort().join(' ; ');
}
async function dadosTodos(n, confs) {
  const out = {};
  for (const c of confs) {
    const d = await carregar(n, c);
    d.base = d.titulos.filter(t => t.grupo !== 'acordo'); d.titAcordo = d.titulos.filter(t => t.grupo === 'acordo');
    out[c] = d;
  }
  return out;
}
const COMPARA = ['luis', 'secretaria', 'legado'];
async function quemTem(n) {
  const r = await q(`select distinct conferente from (
     select g.conferente from carteira.pagamentos g join carteira.titulos t on t.id=g.titulo_id where t.contrato=$1
     union select ct.conferente from carteira.conferencia_titulo ct join carteira.titulos t on t.id=ct.titulo_id where t.contrato=$1
     union select conferente from carteira.acordos where contrato=$1 union select conferente from carteira.correcoes where contrato=$1
     union select conferente from carteira.eventos where contrato=$1 union select conferente from carteira.fechamentos where contrato=$1) x`, [n]);
  return COMPARA.filter(c => r.some(x => x.conferente === c));
}
function compararCom(confs, D, decis) {
  const base = (D[confs[0]] || D.final).base;
  const titulos = base.map(t => {
    const sig = {}; for (const c of confs) sig[c] = assinaturaTitulo(t, D[c]);
    const dec = decis.find(d => d.item === 'titulo:' + t.id);
    return { id: t.id, rotulo: t.rotulo, grupo: t.grupo, numero: t.numero, vencimento: t.vencimento, valor_face: t.valor_face, sig,
      diverge: confs.length > 1 && new Set(Object.values(sig)).size > 1, decidido: dec || null };
  });
  const secoes = ['acordos', 'correcoes', 'eventos'].map(sec => {
    const sig = {}; for (const c of confs) sig[c] = assinaturaSecao(sec, D[c]);
    const dec = decis.find(d => d.item === 'secao:' + sec);
    return { secao: sec, sig, diverge: confs.length > 1 && new Set(Object.values(sig)).size > 1, decidido: dec || null };
  });
  return { titulos, secoes };
}
async function comparar(n) {
  const confs = await quemTem(n);
  const D = await dadosTodos(n, [...confs, 'final']);
  const decis = await q('select item, de, em from carteira.decisoes where contrato=$1', [n]);
  return { confs, D, ...compararCom(confs, D, decis) };
}
async function compararTodos(numeros) {
  const all = ['luis', 'secretaria', 'legado', 'final'];
  const T = await q(`select * from carteira.titulos where contrato = any($1) and (conferente is null or conferente = any($2)) ${ORDEM}`, [numeros, all]);
  const P = await q(`select g.id, g.titulo_id, g.conferente, g.fatura, g.id_asaas, g.valor_pago, g.confirmada_em, t.contrato from carteira.pagamentos g join carteira.titulos t on t.id=g.titulo_id where t.contrato = any($1)`, [numeros]);
  const S = await q(`select ct.*, t.contrato from carteira.conferencia_titulo ct join carteira.titulos t on t.id=ct.titulo_id where t.contrato = any($1)`, [numeros]);
  const A = await q('select * from carteira.acordos where contrato = any($1)', [numeros]);
  const C = await q('select * from carteira.correcoes where contrato = any($1)', [numeros]);
  const E = await q('select * from carteira.eventos where contrato = any($1)', [numeros]);
  const F = await q('select * from carteira.fechamentos where contrato = any($1)', [numeros]);
  const X = await q('select contrato, item, de, em from carteira.decisoes where contrato = any($1)', [numeros]);
  const res = {};
  for (const n of numeros) {
    const D = {}, tem = new Set();
    for (const c of all) {
      const base = T.filter(t => t.contrato === n && t.conferente == null);
      const d = { base, titAcordo: T.filter(t => t.contrato === n && t.conferente === c),
        pagamentos: P.filter(x => x.contrato === n && x.conferente === c), situacoes: S.filter(x => x.contrato === n && x.conferente === c),
        acordos: A.filter(x => x.contrato === n && x.conferente === c), correcoes: C.filter(x => x.contrato === n && x.conferente === c),
        eventos: E.filter(x => x.contrato === n && x.conferente === c) };
      D[c] = d;
      if (d.pagamentos.length || d.situacoes.length || d.acordos.length || d.correcoes.length || d.eventos.length || F.some(f => f.contrato === n && f.conferente === c)) tem.add(c);
    }
    const confs = COMPARA.filter(c => tem.has(c));
    const r = compararCom(confs, D, X.filter(x => x.contrato === n));
    res[n] = { confs, fechados: F.filter(f => f.contrato === n).map(f => f.conferente),
      divergencias: r.titulos.filter(t => t.diverge).length + r.secoes.filter(s => s.diverge).length,
      pendentes: r.titulos.filter(t => t.diverge && !t.decidido).length + r.secoes.filter(s => s.diverge && !s.decidido).length };
  }
  return res;
}
async function copiarTitulo(id, de) {
  await q(`delete from carteira.pagamentos where conferente='final' and titulo_id=$1`, [id]);
  await q(`delete from carteira.conferencia_titulo where conferente='final' and titulo_id=$1`, [id]);
  const pags = await q('select * from carteira.pagamentos where conferente=$1 and titulo_id=$2', [de, id]);
  for (const g of pags) {
    const [nv] = await q(`insert into carteira.pagamentos(conferente, titulo_id, ${CAMPOS_PAG.join(',')}, tem_print)
                          values ('final',$1,${CAMPOS_PAG.map((_, i) => '$' + (i + 2)).join(',')},$${CAMPOS_PAG.length + 2}) returning id`,
      [id, ...CAMPOS_PAG.map(c => g[c]), g.tem_print]);
    if (g.tem_print) await q(`insert into carteira.prints(pagamento_id, tipo, conteudo) select $1, tipo, conteudo from carteira.prints where pagamento_id=$2`, [nv.id, g.id]);
  }
  await q(`insert into carteira.conferencia_titulo(conferente, titulo_id, situacao, obs)
           select 'final', titulo_id, situacao, obs from carteira.conferencia_titulo where conferente=$1 and titulo_id=$2`, [de, id]);
}
async function copiarSecao(n, sec, de) {
  if (sec === 'correcoes') {
    await q(`delete from carteira.correcoes where contrato=$1 and conferente='final'`, [n]);
    await q(`insert into carteira.correcoes(contrato, conferente, grupo, a_partir, data, igpm_pct, juros_pct, novo_valor, obs)
             select contrato, 'final', grupo, a_partir, data, igpm_pct, juros_pct, novo_valor, obs from carteira.correcoes where contrato=$1 and conferente=$2`, [n, de]);
  }
  if (sec === 'eventos') {
    await q(`delete from carteira.eventos where contrato=$1 and conferente='final'`, [n]);
    await q(`insert into carteira.eventos(contrato, conferente, tipo, motivo, a_partir_titulo, data, dados, obs)
             select contrato, 'final', tipo, motivo, a_partir_titulo, data, dados, obs from carteira.eventos where contrato=$1 and conferente=$2`, [n, de]);
  }
  if (sec === 'acordos') {
    await q(`delete from carteira.titulos where contrato=$1 and conferente='final' and grupo='acordo'`, [n]);
    await q(`delete from carteira.acordos where contrato=$1 and conferente='final'`, [n]);
    const acs = await q('select * from carteira.acordos where contrato=$1 and conferente=$2 order by id', [n, de]);
    const mapa = {};
    for (const a of acs) {
      const [na] = await q(`insert into carteira.acordos(contrato, conferente, data_acordo, titulos_origem, principal, multa, juros, honorarios,
                            valor_calculado, valor_acordado, desconto_encargos, qtd_parcelas, obs)
                            values ($1,'final',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
        [n, a.data_acordo, a.titulos_origem, a.principal, a.multa, a.juros, a.honorarios, a.valor_calculado, a.valor_acordado, a.desconto_encargos, a.qtd_parcelas, a.obs]);
      const ts = await q('select * from carteira.titulos where acordo_id=$1 order by numero', [a.id]);
      for (const t of ts) {
        const [nt] = await q(`insert into carteira.titulos(contrato, grupo, numero, total, rotulo, vencimento, valor_face, conferente, acordo_id)
                              values ($1,'acordo',$2,$3,$4,$5,$6,'final',$7) returning id`, [n, t.numero, t.total, t.rotulo, t.vencimento, t.valor_face, na.id]);
        mapa[t.id] = nt.id; await copiarTitulo(nt.id, '__nada__');
        const pags = await q('select * from carteira.pagamentos where conferente=$1 and titulo_id=$2', [de, t.id]);
        for (const g of pags) await q(`insert into carteira.pagamentos(conferente, titulo_id, ${CAMPOS_PAG.join(',')}, tem_print)
            values ('final',$1,${CAMPOS_PAG.map((_, i) => '$' + (i + 2)).join(',')},false)`, [nt.id, ...CAMPOS_PAG.map(c => g[c])]);
      }
    }
    const fin = await q(`select id, titulos_origem from carteira.acordos where contrato=$1 and conferente='final'`, [n]);
    for (const a of fin) await q('update carteira.acordos set titulos_origem=$2 where id=$1', [a.id, a.titulos_origem.map(i => mapa[i] || i)]);
  }
}
async function decidir(n, item, de, conf) {
  await q(`insert into carteira.decisoes(contrato, item, de, por) values ($1,$2,$3,$4)
           on conflict (contrato, item) do update set de=excluded.de, por=excluded.por, em=now()`, [n, item, de, conf]);
}

/* ---------- puxar descrições do banco antigo pelo número da fatura ---------- */
function acharDescricao(o) {
  let best = null;
  const walk = (x) => {
    if (!x || typeof x !== 'object') return;
    for (const [k, v] of Object.entries(x)) {
      if (typeof v === 'string' && /^(descri|description)/i.test(k) && (!best || v.length > best.length)) best = v;
      else if (v && typeof v === 'object') walk(v);
      else if (typeof v === 'string' && v.trim().startsWith('{')) { try { walk(JSON.parse(v)); } catch {} }
    }
  };
  walk(o); return best;
}
async function asaas(path) {
  const key = (process.env.ASAAS_API_KEY || '').trim();
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch('https://api.asaas.com/v3' + path, { headers: { access_token: key, 'User-Agent': 'carteira-beira-rio', accept: 'application/json' } });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('Asaas respondeu ' + r.status + ': ' + (await r.text()).slice(0, 200));
      return await r.json();
    } catch (e) { if (i === 2) throw e; await new Promise(x => setTimeout(x, 800)); }
  }
}
async function descricoesAsaas(contrato, faturas) {
  const mapa = {};
  if (!process.env.ASAAS_API_KEY) return { mapa, erro: 'sem_chave' };
  const cli = await q(`select distinct cliente_asaas_id c from public.lote_recebimentos_legado_20260911 where contrato_codigo=$1 and cliente_asaas_id is not null`, [contrato]).catch(() => []);
  const cli2 = await q(`select distinct id_cliente_asaas c from carteira.pagamentos g join carteira.titulos t on t.id=g.titulo_id where t.contrato=$1 and id_cliente_asaas like 'cus_%'`, [contrato]).catch(() => []);
  const clientes = [...new Set([...cli, ...cli2].map(x => x.c))];
  for (const c of clientes) {
    for (let off = 0; off < 2000; off += 100) {
      const r = await asaas(`/payments?customer=${c}&limit=100&offset=${off}`);
      for (const pg of r?.data || []) if (pg.invoiceNumber) mapa[String(pg.invoiceNumber)] = { desc: pg.description || '', id: pg.id };
      if (!r?.hasMore) break;
    }
  }
  const falta = faturas.filter(f => !mapa[f]);
  for (const f of falta) {
    const l = await q(`select coalesce(asaas_payment_real_id, asaas_payment_id) id from public.lote_recebimentos_legado_20260911 where numero_fatura=$1 limit 1`, [f]).catch(() => []);
    if (l[0]?.id) { const pg = await asaas('/payments/' + l[0].id); if (pg?.description != null) mapa[f] = { desc: pg.description, id: pg.id }; }
  }
  return { mapa, clientes };
}
async function puxarDescricoes(contrato, conferentes) {
  const pags = await q(`select g.id, g.fatura, g.conferente, g.descricao, t.rotulo from carteira.pagamentos g join carteira.titulos t on t.id=g.titulo_id
                        where t.contrato=$1 and g.conferente = any($2) and coalesce(g.fatura,'')<>''`, [contrato, conferentes]);
  const fat = [...new Set(pags.map(g => String(g.fatura).replace(/\D/g, '')).filter(f => f.length >= 6))];
  let A = { mapa: {} }, erroAsaas = null;
  try { A = await descricoesAsaas(contrato, fat); } catch (e) { erroAsaas = String(e.message || e); }
  const ok = [], sem = [];
  for (const g of pags) {
    const f = String(g.fatura).replace(/\D/g, '');
    const atual = (g.descricao || '').trim();
    let desc = A.mapa[f]?.desc?.trim() ? A.mapa[f].desc : null, onde = desc ? 'Asaas' : null;
    if (!desc && !atual && f.length >= 6) {
      const r = await q(`select descricao from public.lote_recebimentos_legado_20260911 where numero_fatura=$1 and coalesce(descricao,'')<>'' limit 1`, [f]).catch(() => []);
      if (r[0]) { desc = r[0].descricao; onde = 'banco antigo (resumida)'; }
    }
    if (desc && desc.trim() !== atual) { await q('update carteira.pagamentos set descricao=$2 where id=$1', [g.id, desc]); ok.push({ parcela: g.rotulo, fatura: f, fonte: onde }); }
    else if (!desc && !atual) sem.push({ parcela: g.rotulo, fatura: f });
  }
  return { preenchidas: ok.length, do_asaas: ok.filter(x => x.fonte === 'Asaas').length, sem_descricao: sem, erro_asaas: erroAsaas || (A.erro === 'sem_chave' ? 'Falta a chave do Asaas no Netlify' : null), detalhes: ok };
}

/* ---------- integração automática com o Asaas (só depois da data de conferência) ---------- */
const PAGO_A = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];
const FORMA_A = { BOLETO: 'Boleto Bancário', PIX: 'Pix', CREDIT_CARD: 'Cartão de crédito', DEBIT_CARD: 'Cartão de débito', UNDEFINED: 'Boleto Bancário' };
const SIT_A = { RECEIVED: 'Recebida', CONFIRMED: 'Confirmada', RECEIVED_IN_CASH: 'Recebida em dinheiro' };
const R2 = x => Math.round(x * 100) / 100;
const dstr = v => v == null ? null : String(v instanceof Date ? v.toISOString() : v).slice(0, 10);
function parseDesc(d0, ct) {
  const d = String(d0 || '').replace(/\s+/g, ' ');
  const sem = d.replace(/á Servi[cç]o.*$/i, '').replace(/Q\s*\d{1,2}\s*L\s*\d{1,2}/gi, ' ').replace(/\d{2}\/\d{2}\/\d{4}/g, ' ');
  const ps = [...sem.matchAll(/(?<![\d\/])(\d{1,3})\s*\/\s*(\d{1,3})(?![\d\/])/g)].map(m => ({ n: +m[1], tot: +m[2] }));
  const tipo = /cess[aã]o/i.test(d) ? 'cessao' : /renegocia|acordo|repactua/i.test(d) ? 'reneg' : /anual/i.test(d) ? 'anual' : /entrada|sinal/i.test(d) ? 'entrada' : 'mensal';
  const ex = () => new Set(ps.map(x => x.n + '/' + x.tot));
  let m = sem.match(/(\d{1,3}(?:\s*,\s*\d{1,3})+(?:\s*e\s*\d{1,3})?|\d{1,3}\s*e\s*\d{1,3})\s*\/\s*(\d{1,3})(?![\d\/])/);
  if (m) { const tot = +m[2], e = ex(); for (const n of m[1].split(/\s*,\s*|\s*e\s*/).map(Number)) if (!e.has(n + '/' + tot)) ps.push({ n, tot }); }
  m = sem.match(/(\d{1,3})\s*(?:à|a|até)\s*(\d{1,3})\s*\/\s*(\d{1,3})/i);
  if (m) { const a = +m[1], b = +m[2], tot = +m[3]; if (b > a && b - a < 40) { const e = ex(); for (let n = a; n <= b; n++) if (!e.has(n + '/' + tot)) ps.push({ n, tot }); } }
  return { ps, tipo };
}
function contratoDaDescricao(d) {
  const s = String(d || '').replace(/\s+/g, ' ');
  const c = s.match(/Beira\s*Rio\s*-\s*(\d{3,4})/i) || s.match(/Contrato\s*(?:n[ºo°.]*\s*)?(\d{3,4})/i);
  const ql = s.match(/Q(?:D|uadra)?\s*0?(\d{1,2})\s*L(?:T|ote)?\s*0?(\d{1,2})/i);
  return { numero: c ? c[1].padStart(4, '0') : null, quadra: ql ? ql[1].padStart(2, '0') : null, lote: ql ? ql[2].padStart(2, '0') : null };
}
function encargos(cob, pago, vo, dt) {
  const dias = vo && dt ? Math.max(0, Math.round((new Date(dt) - new Date(vo)) / 864e5)) : 0;
  let dif = R2(pago - cob), mu = 0, ju = 0, ho = 0, de = 0;
  if (dif < 0) de = -dif;
  else if (dif > 0 && dias > 0) { mu = Math.min(dif, R2(cob * .02)); const j = R2(cob * (Math.pow(1.01, dias / 30) - 1)); ju = Math.min(R2(dif - mu), j); ho = R2(dif - mu - ju); }
  return { multa_paga: mu, juros_pago: ju, honorarios_pago: ho, desconto_dado: de };
}
async function garanteAuto() {
  await q(`create table if not exists carteira.asaas_auto(id_asaas text primary key, fatura text, contrato text, titulo_id bigint, pagamento_id bigint,
           resultado text not null, motivo text, pago_em date, valor numeric, cliente text, descricao text, dados jsonb, em timestamptz default now())`);
  await q(`create table if not exists carteira.asaas_estado(chave text primary key, valor jsonb, em timestamptz default now())`);
}
async function registraAuto(g, r) {
  await q(`insert into carteira.asaas_auto(id_asaas, fatura, contrato, titulo_id, pagamento_id, resultado, motivo, pago_em, valor, cliente, descricao, dados)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           on conflict (id_asaas) do update set contrato=excluded.contrato, titulo_id=excluded.titulo_id, pagamento_id=excluded.pagamento_id,
             resultado=excluded.resultado, motivo=excluded.motivo, dados=excluded.dados, em=now()`,
    [g.id, g.invoiceNumber ? String(g.invoiceNumber) : null, r.contrato || null, r.titulo_id || null, r.pagamento_id || null, r.resultado, r.motivo || null,
      g.paymentDate || g.clientPaymentDate || g.confirmedDate || null, g.value, r.cliente || g.customer, g.description || null, g]);
  return r;
}
async function contextoAuto() {
  const fech = await q(`select contrato, (fechado_em at time zone 'America/Sao_Paulo')::date::text corte from carteira.fechamentos where conferente='luis'`);
  const corte = {}; for (const f of fech) corte[f.contrato] = f.corte;
  const cts = await q(`select numero, quadra, lote from carteira.contratos order by numero`);
  const enc = new Set((await q(`select distinct contrato from carteira.eventos where tipo='encerramento' and conferente='luis'`)).map(x => x.contrato));
  const cli = await q(`select g.id_cliente_asaas c, array_agg(distinct t.contrato) cs from carteira.pagamentos g join carteira.titulos t on t.id=g.titulo_id
                       where g.conferente='luis' and g.id_cliente_asaas like 'cus_%' group by 1`);
  const porCliente = {}; for (const x of cli) porCliente[x.c] = x.cs;
  return { corte, cts, enc, porCliente, cache: {}, nomes: {} };
}
async function jaLancado(g) {
  const f = g.invoiceNumber ? String(g.invoiceNumber) : '__';
  const r = await q(`select g.id, t.contrato from carteira.pagamentos g join carteira.titulos t on t.id=g.titulo_id
                     where g.conferente='luis' and (g.id_asaas=$1 or regexp_replace(coalesce(g.fatura,''),'\\D','','g')=$2) limit 1`, [g.id, f]);
  return r[0] || null;
}
function acharContrato(g, X) {
  const d = contratoDaDescricao(g.description);
  if (d.numero && X.cts.some(c => c.numero === d.numero)) return { n: d.numero, como: 'descrição' };
  if (d.numero) return { erro: `O boleto cita o contrato ${d.numero}, que não existe no sistema` };
  if (d.quadra && d.lote) {
    const c = X.cts.filter(c => c.quadra === d.quadra && c.lote === d.lote && !X.enc.has(c.numero));
    if (c.length === 1) return { n: c[0].numero, como: 'quadra e lote' };
  }
  const pc = X.porCliente[g.customer] || [];
  const ativos = pc.filter(n => !X.enc.has(n));
  if (ativos.length === 1) return { n: ativos[0], como: 'cliente' };
  if (pc.length === 1) return { n: pc[0], como: 'cliente' };
  return { erro: pc.length > 1 ? `Cliente tem mais de um contrato (${pc.join(', ')}) e o boleto não diz qual` : 'Não consegui identificar o contrato pelo boleto' };
}
function valorAno(t, D) {
  if (t.grupo === 'acordo') return +t.valor_face;
  const cs = D.correcoes.filter(x => x.grupo === t.grupo && +x.a_partir <= t.numero).sort((a, b) => b.a_partir - a.a_partir);
  return cs.length ? +cs[0].novo_valor : +t.valor_face;
}
function titulosLivres(D) {
  const corteEnc = (() => { const e = D.eventos.find(e => e.tipo === 'encerramento'); if (!e) return null; const t0 = D.titulos.find(x => x.id == e.a_partir_titulo); return t0 ? dstr(t0.vencimento) : null; })();
  const emAcordo = new Set(D.acordos.flatMap(a => (a.titulos_origem || []).map(String)));
  const canc = new Set(D.situacoes.filter(s => s.situacao === 'cancelada').map(s => String(s.titulo_id)));
  return D.titulos.filter(t => !D.pagamentos.some(p => p.titulo_id == t.id) && !emAcordo.has(String(t.id)) && !canc.has(String(t.id))
    && !(corteEnc && t.grupo !== 'acordo' && dstr(t.vencimento) >= corteEnc));
}
function escolherTitulo(g, D) {
  const r = parseDesc(g.description, D.contrato);
  if (r.tipo === 'cessao') return { erro: 'Boleto de taxa de cessão — precisa lançar à mão' };
  const livres = titulosLivres(D);
  const V = [g.dueDate, g.originalDueDate].filter(Boolean);
  const mes = t => V.some(v => dstr(t.vencimento).slice(0, 7) === v.slice(0, 7));
  if (r.tipo === 'reneg') {
    const ac = livres.filter(t => t.grupo === 'acordo');
    let c = ac.filter(t => V.includes(dstr(t.vencimento))); if (c.length !== 1) c = ac.filter(mes);
    if (c.length === 1) return { t: c[0] };
    return { erro: ac.length ? 'Boleto de acordo: não achei uma única parcela do acordo com esse vencimento' : 'Boleto de acordo, mas o contrato não tem acordo em aberto no sistema' };
  }
  const base = livres.filter(t => t.grupo !== 'acordo');
  const anualTot = new Set(D.titulos.filter(t => t.grupo === 'anual').map(t => t.total));
  const ts = r.ps.map(x => base.find(t => t.total == x.tot && t.numero == x.n && (r.tipo === 'anual' ? t.grupo === 'anual' : r.tipo === 'entrada' ? t.grupo === 'entrada'
    : t.grupo !== 'entrada' && (x.tot <= 12 && anualTot.has(x.tot) ? t.grupo === 'anual' : t.grupo === 'mensal')))).filter(Boolean);
  if (r.ps.length > 1) return { erro: 'Um boleto só pagando várias parcelas — precisa lançar à mão' };
  if (ts.length === 1) return { t: ts[0] };
  let c = base.filter(t => V.includes(dstr(t.vencimento)) && (r.tipo === 'anual' ? t.grupo === 'anual' : r.tipo === 'entrada' ? t.grupo === 'entrada' : true));
  if (c.length > 1) c = c.filter(t => Math.abs(valorAno(t, D) - +(g.originalValue ?? g.value)) < 0.05);
  if (c.length === 1) return { t: c[0] };
  if (r.ps.length === 1) {
    const ja = D.titulos.find(t => t.total == r.ps[0].tot && t.numero == r.ps[0].n && t.grupo !== 'acordo');
    if (ja && !livres.includes(ja)) return { erro: `A parcela ${ja.rotulo} já está paga ou em acordo no sistema` };
  }
  return { erro: 'Não achei a parcela certa pela descrição nem pelo vencimento' };
}
async function processaPagamentoAsaas(g, X, opc = {}) {
  if (!g || g.deleted || !PAGO_A.includes(g.status)) return { resultado: 'ignorado' };
  const [ja] = await q(`select resultado from carteira.asaas_auto where id_asaas=$1`, [g.id]);
  if (ja && !opc.forcar && ja.resultado !== 'erro') return { resultado: 'ja_visto' };
  const lan = await jaLancado(g);
  if (lan) return registraAuto(g, { resultado: 'ja_existia', contrato: lan.contrato, pagamento_id: lan.id });
  const pagoEm = g.paymentDate || g.clientPaymentDate || g.confirmedDate;
  await garanteBoletos();
  const [bol] = await q('select contrato, titulo_id, tipo, composicao from carteira.boletos where id_asaas=$1', [g.id]);
  if (bol) await gravaBoleto(g, {});
  if (bol?.titulo_id && !opc.titulo_id) { opc = { ...opc, titulo_id: bol.titulo_id, contrato: opc.contrato || bol.contrato, doBoleto: true }; }
  const k = opc.contrato ? { n: opc.contrato } : acharContrato(g, X);
  if (k.erro) return registraAuto(g, { resultado: 'pendente', motivo: k.erro });
  const n = k.n, corte = X.corte[n];
  if (!corte) return registraAuto(g, { resultado: 'pendente', contrato: n, motivo: 'Contrato ainda não teve a conferência fechada' });
  if (pagoEm < corte && (!opc.titulo_id || opc.doBoleto)) return registraAuto(g, { resultado: 'congelado', contrato: n, motivo: `Pago antes da conferência (${corte.split('-').reverse().join('/')})` });
  const D = X.cache[n] || (X.cache[n] = await carregar(n, 'luis'));
  let t;
  if (opc.titulo_id) {
    t = D.titulos.find(x => x.id == opc.titulo_id); if (!t) return { erro: 'Parcela não é deste contrato' };
    if (!titulosLivres(D).some(x => x.id == t.id)) {
      if (opc.doBoleto) return registraAuto(g, { resultado: 'pendente', contrato: n, motivo: `Boleto da parcela ${t.rotulo}, mas ela já está paga, em acordo ou cancelada no sistema` });
      return { erro: `A parcela ${t.rotulo} já está paga, em acordo ou cancelada — não vou sobrescrever` };
    }
  }
  else { const e = escolherTitulo(g, D); if (e.erro) return registraAuto(g, { resultado: 'pendente', contrato: n, motivo: e.erro }); t = e.t; }
  const b0 = await bloqueioEncerrado(t, 'luis'); if (b0) return registraAuto(g, { resultado: 'pendente', contrato: n, motivo: b0 });
  if (!(g.customer in X.nomes)) { const cu = await asaas('/customers/' + g.customer).catch(() => null); X.nomes[g.customer] = cu?.name || null; }
  const conf = g.confirmedDate || g.paymentDate || g.clientPaymentDate;
  const mesmoMes = String(g.dueDate || '').slice(0, 7) === dstr(t.vencimento).slice(0, 7);
  const cob = g.originalValue != null && mesmoMes ? +g.originalValue : (mesmoMes && pagoEm <= g.dueDate ? +g.value : R2(valorAno(t, D)));
  const body = { forma: FORMA_A[g.billingType] || g.billingType, fatura: g.invoiceNumber ? String(g.invoiceNumber) : null, situacao_asaas: SIT_A[g.status] || g.status,
    valor_cobranca: cob, valor_pago: +g.value, criada_em: g.dateCreated, vencimento_boleto: g.dueDate, confirmada_em: conf, saque_em: g.creditDate || null,
    cliente_asaas: X.nomes[g.customer], descricao: g.description, obs: 'Lançado automaticamente pela integração com o Asaas' + (opc.titulo_id ? ' (parcela escolhida à mão)' : ''),
    id_asaas: g.id, link_fatura: g.invoiceUrl || null, nosso_numero: g.nossoNumero || null, valor_liquido: g.netValue, vencimento_original: dstr(t.vencimento),
    pago_cliente_em: g.clientPaymentDate || g.paymentDate || null, id_cliente_asaas: g.customer, id_parcelamento_asaas: g.installment || null,
    ...encargos(cob, +g.value, dstr(t.vencimento), conf) };
  if (bol?.composicao) {
    const c = bol.composicao, B = +c.total, pago = +g.value, base = R2(c.principal + c.correcao);
    let ho = +c.cobranca, de = 0;
    if (pago > B) ho = R2(ho + (pago - B) * c.cobranca / B); else de = R2(B - pago);
    const ju = Math.max(0, R2(pago + de - base - c.multa - ho));
    Object.assign(body, { valor_cobranca: base, multa_paga: c.multa, juros_pago: ju, honorarios_pago: ho, desconto_dado: de,
      obs: 'Lançado automaticamente pela integração com o Asaas — boleto de cobrança (60 dias)' });
  }
  const [pg] = await q(`insert into carteira.pagamentos(conferente, titulo_id, ${CAMPOS_PAG.join(',')}, tem_print)
                        values ('luis',$1,${CAMPOS_PAG.map((_, i) => '$' + (i + 2)).join(',')}, false) returning id`, [t.id, ...CAMPOS_PAG.map(c => limpa(body[c]))]);
  await q(`insert into carteira.conferencia_titulo(conferente, titulo_id, situacao) values ('luis',$1,'paga')
           on conflict (conferente, titulo_id) do update set situacao='paga', salvo_em=now()`, [t.id]);
  D.pagamentos.push({ id: pg.id, titulo_id: t.id });
  await log('asaas', 'pagamento_automatico', { contrato: n, titulo: t.id, fatura: body.fatura, valor: g.value });
  return registraAuto(g, { resultado: 'lancado', contrato: n, titulo_id: t.id, pagamento_id: pg.id, motivo: t.rotulo, cliente: X.nomes[g.customer] });
}
export async function passoSync(limiteMs = 8000, recomecar = false) {
  await garanteAuto();
  const t0 = Date.now();
  const [st] = await q(`select valor from carteira.asaas_estado where chave='sync'`);
  let E = st?.valor || {};
  const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  if (recomecar) E = { ...E, janela: null };
  if (!E.janela) {
    let desde = E.ultimo_fim;
    if (!desde) { const [m] = await q(`select min((fechado_em at time zone 'America/Sao_Paulo')::date)::text d from carteira.fechamentos where conferente='luis'`); desde = m?.d || hoje; }
    else { const d = new Date(desde + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 3); desde = d.toISOString().slice(0, 10); }
    E.janela = { desde, ate: hoje, offset: 0, campo: 'paymentDate' };
  }
  const X = await contextoAuto();
  const cont = { lancado: 0, pendente: 0, congelado: 0, ja_existia: 0, ja_visto: 0, ignorado: 0 };
  let terminou = false;
  while (Date.now() - t0 < limiteMs) {
    const J = E.janela;
    const r = await asaas(`/payments?${J.campo}[ge]=${J.desde}&${J.campo}[le]=${J.ate}&limit=20&offset=${J.offset}`);
    for (const g of r?.data || []) {
      try { const x = await processaPagamentoAsaas(g, X); cont[x.resultado] = (cont[x.resultado] || 0) + 1; }
      catch (e) { await registraAuto(g, { resultado: 'erro', motivo: String(e.message || e) }).catch(() => {}); cont.erro = (cont.erro || 0) + 1; }
    }
    J.offset += (r?.data || []).length;
    if (!r?.hasMore) {
      E.ultimo_fim = J.ate; E.janela = null; E.ultima_execucao = new Date().toISOString(); terminou = true; break;
    }
  }
  await q(`insert into carteira.asaas_estado(chave, valor) values ('sync',$1) on conflict (chave) do update set valor=excluded.valor, em=now()`, [E]);
  return { terminou, estado: E, ...cont };
}
export async function webhookAsaas(req) {
  const tok = (process.env.ASAAS_WEBHOOK_TOKEN || '').trim();
  if (!tok || (req.headers.get('asaas-access-token') || '') !== tok) return json({ erro: 'token' }, 401);
  const b = await req.json().catch(() => ({}));
  try {
    await garanteAuto();
    const X = await contextoAuto();
    if (b.payment && /PAYMENT_(RECEIVED|CONFIRMED)/.test(b.event || '')) await processaPagamentoAsaas(b.payment, X);
    else if (b.payment) { await garanteBoletos(); await vinculaBoletoAsaas(b.event === 'PAYMENT_DELETED' ? { ...b.payment, deleted: true } : b.payment, X); }
  } catch (e) { console.error('webhook', e.message); }
  return json({ ok: true });
}

/* ---------- boletos: gerar, editar, excluir, vincular, cobrança dos 60 dias ---------- */
const ATIVOS_B = ['PENDING', 'OVERDUE', 'AWAITING_RISK_ANALYSIS'];
const FCA_RODAPE = 'á Serviço de: FCA CONSTRUTORA E INCORPORADORA LTDA (46.228.347/0001-97)';
const AVISO_30 = 'Após 30 dias de vencido esse boleto só poderá ser pago através do departamento de cobrança, com acréscimo de honorários, conforme contrato.';
const FATOR_ANO_S = { 2024: 1.02, 2025: 1.0854, 2026: 1.02 };
async function asaasReq(method, path, body) {
  const key = (process.env.ASAAS_API_KEY || '').trim();
  const r = await fetch('https://api.asaas.com/v3' + path, { method, headers: { access_token: key, 'User-Agent': 'carteira-beira-rio', accept: 'application/json', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = { bruto: t }; }
  if (!r.ok) throw new Error('Asaas: ' + ((d.errors || []).map(e => e.description).join('; ') || ('erro ' + r.status)));
  return d;
}
async function garanteBoletos() {
  await q(`create table if not exists carteira.boletos(id_asaas text primary key, contrato text, titulo_id bigint, tipo text not null default 'parcela',
           fatura text, valor numeric, vencimento date, status text, link text, descricao text, composicao jsonb, origem text, motivo text,
           substituido_por text, dados jsonb, criado_em timestamptz default now(), atualizado_em timestamptz default now())`);
  await q(`create index if not exists boletos_titulo on carteira.boletos(titulo_id)`);
}
async function gravaBoleto(g, extra = {}) {
  const st = g.deleted ? 'DELETED' : g.status;
  await q(`insert into carteira.boletos(id_asaas, contrato, titulo_id, tipo, fatura, valor, vencimento, status, link, descricao, composicao, origem, motivo, dados)
           values ($1,$2,$3,coalesce($4,'parcela'),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           on conflict (id_asaas) do update set status=case when carteira.boletos.status='SUBSTITUIDO' then 'SUBSTITUIDO' else excluded.status end,
             valor=excluded.valor, vencimento=excluded.vencimento, link=excluded.link, descricao=excluded.descricao, fatura=excluded.fatura, dados=excluded.dados,
             contrato=coalesce(carteira.boletos.contrato, excluded.contrato), titulo_id=coalesce(carteira.boletos.titulo_id, excluded.titulo_id),
             composicao=coalesce(excluded.composicao, carteira.boletos.composicao), motivo=coalesce(excluded.motivo, carteira.boletos.motivo), atualizado_em=now()`,
    [g.id, extra.contrato || null, extra.titulo_id || null, extra.tipo || null, g.invoiceNumber ? String(g.invoiceNumber) : null, g.value, g.dueDate, st,
      g.bankSlipUrl || g.invoiceUrl || null, g.description || null, extra.composicao || null, extra.origem || null, extra.motivo || null, g]);
}
function rotuloBoleto(t) {
  if (t.grupo === 'mensal') return `${t.numero}/${t.total}`;
  if (t.grupo === 'anual') return `Anual ${t.numero}/${t.total}`;
  if (t.grupo === 'entrada') return `Entrada ${t.numero}/${t.total}`;
  if (t.grupo === 'acordo') return `Renegociação ${String(t.numero).padStart(2, '0')} de ${String(t.total).padStart(2, '0')}`;
  return `${t.numero}/${t.total}`;
}
function descricaoBoleto(ct, linha, aviso = true) {
  return [`Condomínio Beira Rio - ${ct.numero}`, `Q${ct.quadra} L${ct.lote}`, linha, '', FCA_RODAPE, ...(aviso ? ['', AVISO_30] : [])].join('\r\n');
}
async function clienteDoContrato(n) {
  const [b] = await q(`select dados->>'customer' c from carteira.boletos where contrato=$1 and dados->>'customer' like 'cus_%' order by vencimento desc nulls last limit 1`, [n]);
  if (b?.c) return b.c;
  const [p] = await q(`select g.id_cliente_asaas c from carteira.pagamentos g join carteira.titulos t on t.id=g.titulo_id
                       where t.contrato=$1 and g.conferente='luis' and g.id_cliente_asaas like 'cus_%' order by g.vencimento_boleto desc nulls last limit 1`, [n]);
  if (p?.c) return p.c;
  const [ct] = await q('select compradores from carteira.contratos where numero=$1', [n]);
  for (const cp of (ct?.compradores || [])) {
    const doc = String(cp.cpf || '').replace(/\D/g, '');
    if (doc.length >= 11) { const r = await asaas('/customers?cpfCnpj=' + doc).catch(() => null); const c = (r?.data || []).find(x => !x.deleted); if (c) return c.id; }
  }
  return null;
}
const SQL_ABERTAS = `
  with corr as (select distinct on (contrato, grupo, a_partir) contrato, grupo, a_partir, novo_valor from carteira.correcoes where conferente='luis' order by contrato, grupo, a_partir, id desc)
  select t.id, t.contrato, t.grupo, t.numero, t.total, t.rotulo, t.vencimento::text vencimento, t.valor_face, c.quadra, c.lote,
    coalesce((select novo_valor from corr where corr.contrato=t.contrato and corr.grupo=t.grupo and corr.a_partir<=t.numero order by corr.a_partir desc limit 1), t.valor_face) valor,
    coalesce((select nullif(string_agg(x->>'nome', ' e ' order by o), '') from jsonb_array_elements(case when jsonb_typeof(c.compradores)='array' then c.compradores else '[]'::jsonb end) with ordinality as j(x,o)), c.nome_planilha) titular,
    (select e.dados->>'novos_titulares' from carteira.eventos e where e.contrato=t.contrato and e.conferente='luis' and e.tipo='cessao' and coalesce(e.dados->>'novos_titulares','')<>'' order by e.data desc nulls last, e.id desc limit 1) cessionario,
    (select b.id_asaas from carteira.boletos b where b.titulo_id=t.id and b.status = any($2) limit 1) boleto
  from carteira.titulos t join carteira.contratos c on c.numero=t.contrato
  where (t.conferente is null or t.conferente='luis')
    and exists (select 1 from carteira.fechamentos f where f.contrato=t.contrato and f.conferente='luis')
    and not exists (select 1 from carteira.pagamentos g where g.titulo_id=t.id and g.conferente='luis')
    and not exists (select 1 from carteira.acordos a where a.contrato=t.contrato and a.conferente='luis' and t.id = any(a.titulos_origem))
    and not exists (select 1 from carteira.conferencia_titulo s where s.titulo_id=t.id and s.conferente='luis' and s.situacao='cancelada')
    and not exists (select 1 from carteira.eventos e join carteira.titulos t0 on t0.id=e.a_partir_titulo
                    where e.contrato=t.contrato and e.conferente='luis' and e.tipo='encerramento' and t.grupo<>'acordo' and t.vencimento >= t0.vencimento)`;
async function previaBoletos(mes) {
  await garanteBoletos();
  const r = await q(SQL_ABERTAS + ` and to_char(t.vencimento,'YYYY-MM')=$1 order by t.vencimento, t.contrato, t.grupo, t.numero`, [mes, ATIVOS_B]);
  return r.map(t => ({ ...t, valor: R2(+t.valor), titular: t.cessionario || t.titular, linha: rotuloBoleto(t) }));
}
async function emitirBoleto(tituloId, conf) {
  await garanteBoletos();
  const [t] = await q(SQL_ABERTAS + ` and t.id=$1`, [tituloId, ATIVOS_B]);
  if (!t) return { titulo_id: tituloId, erro: 'Parcela não está em aberto (paga, em acordo, cancelada ou contrato sem conferência fechada)' };
  if (t.boleto) return { titulo_id: tituloId, erro: 'Essa parcela já tem boleto ativo', id_asaas: t.boleto };
  let venc = t.vencimento;
  if (venc < hojeBR()) { if (t.grupo === 'acordo') venc = hojeBR(); else return { titulo_id: tituloId, erro: 'O vencimento dessa parcela já passou — está em atraso' }; }
  const cliente = await clienteDoContrato(t.contrato);
  if (!cliente) return { titulo_id: tituloId, erro: 'Não achei o cliente deste contrato no Asaas' };
  const ex = await asaas(`/payments?customer=${cliente}&dueDate[ge]=${t.vencimento}&dueDate[le]=${venc}&limit=50`);
  const linha = rotuloBoleto(t);
  const dup = (ex?.data || []).find(g => !g.deleted && ATIVOS_B.concat(PAGO_A).includes(g.status) && (g.externalReference === 'cbr-titulo-' + t.id ||
    (contratoDaDescricao(g.description).numero === t.contrato && parseDesc(g.description).ps.some(p => p.n === t.numero && p.tot === t.total))));
  if (dup) { await gravaBoleto(dup, { contrato: t.contrato, titulo_id: t.id, tipo: t.grupo === 'acordo' ? 'acordo' : 'parcela', origem: 'asaas' }); return { titulo_id: tituloId, erro: 'Já existia boleto no Asaas para essa parcela — só vinculei', id_asaas: dup.id }; }
  const [ct] = await q('select numero, quadra, lote from carteira.contratos where numero=$1', [t.contrato]);
  let linhaF = linha;
  if (t.grupo === 'acordo') {
    const [tt] = await q('select acordo_id from carteira.titulos where id=$1', [t.id]);
    const [ac] = await q('select titulos_origem from carteira.acordos where id=$1', [tt?.acordo_id]);
    const os = ac ? await q('select grupo, numero, total from carteira.titulos where id = any($1) order by grupo, numero', [ac.titulos_origem]) : [];
    const lista = ns => ns.length > 1 ? ns.slice(0, -1).join(', ') + ' e ' + ns[ns.length - 1] : ns.join('');
    const partes = [];
    for (const [gr, nome] of [['entrada', 'entrada'], ['mensal', 'mensal'], ['anual', 'anual'], ['acordo', 'acordo']]) {
      const xs = os.filter(o => o.grupo === gr); if (!xs.length) continue;
      const pad = gr === 'acordo' ? n => String(n).padStart(2, '0') : n => String(n);
      partes.push(`${nome} ${lista(xs.map(o => pad(o.numero)))}/${gr === 'acordo' ? pad(xs[0].total) : xs[0].total}`);
    }
    if (partes.length) linhaF = `${linha} (${partes.join(' e ')})`;
  }
  const g = await asaasReq('POST', '/payments', { customer: cliente, billingType: 'BOLETO', value: R2(+t.valor), dueDate: venc,
    description: descricaoBoleto(ct, linhaF), externalReference: 'cbr-titulo-' + t.id, fine: { value: 2, type: 'PERCENTAGE' }, interest: { value: 1 } });
  await gravaBoleto(g, { contrato: t.contrato, titulo_id: t.id, tipo: t.grupo === 'acordo' ? 'acordo' : 'parcela', origem: 'sistema' });
  await log(conf, 'boleto_gerado', { contrato: t.contrato, titulo: t.id, id: g.id, valor: g.value, venc: g.dueDate });
  return { titulo_id: tituloId, ok: true, id_asaas: g.id, fatura: g.invoiceNumber, valor: g.value, vencimento: g.dueDate, link: g.bankSlipUrl || g.invoiceUrl };
}
async function excluirBoleto(id, conf, motivo) {
  await garanteBoletos();
  try { await asaasReq('DELETE', '/payments/' + id); }
  catch (e) { const g = await asaas('/payments/' + id).catch(() => null); if (!g || !g.deleted) throw e; }
  await q(`update carteira.boletos set status='DELETED', motivo=coalesce($2, motivo), atualizado_em=now() where id_asaas=$1`, [id, motivo || null]);
  await log(conf, 'boleto_excluido', { id, motivo });
  return { ok: true };
}
async function editarBoleto(id, b, conf) {
  const body = {};
  if (b.valor != null) body.value = R2(+b.valor);
  if (b.vencimento) body.dueDate = b.vencimento;
  if (b.descricao != null) body.description = b.descricao;
  let g;
  try { g = await asaasReq('POST', '/payments/' + id, body); }
  catch (e) { await new Promise(x => setTimeout(x, 2000)); g = await asaasReq('POST', '/payments/' + id, body); }
  await gravaBoleto(g, {});
  await log(conf, 'boleto_editado', { id, ...body });
  return { ok: true, valor: g.value, vencimento: g.dueDate };
}
/* atraso no servidor (mesma régua da tela): multa 2%, juros 1% a.m. dia a dia, correção de janeiro sobre tudo */
function compoAtraso(v, venc, ate, corr = true) {
  const dias = Math.max(0, Math.round((new Date(ate) - new Date(venc)) / 864e5));
  const mu = dias ? v * .02 : 0; let pr = v, ju = 0, co = 0, cur = venc;
  const cresce = d2 => { const d = Math.max(0, Math.round((new Date(d2) - new Date(cur)) / 864e5)); ju += pr * (Math.pow(1.01, d / 30) - 1); cur = d2; };
  if (dias && corr) for (let y = +venc.slice(0, 4) + 1; y <= +ate.slice(0, 4); y++) { const dj = `${y}-01-01`; if (dj > ate) break; const f = FATOR_ANO_S[y] || 1; cresce(dj); co += (v + co + mu + ju) * (f - 1); pr *= f; }
  if (dias) cresce(ate);
  return { principal: R2(v), correcao: R2(co), multa: R2(mu), juros: R2(ju), dias };
}
const hojeBR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const somaDias = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
async function candidatosCobranca(inicioAuto) {
  await garanteBoletos();
  const lim = somaDias(hojeBR(), -60);
  const r = await q(`select b.*, t.contrato tc, t.grupo, t.numero, t.total, t.vencimento::text tv from carteira.boletos b join carteira.titulos t on t.id=b.titulo_id
                     where b.tipo in ('parcela','acordo') and b.status = any($1) and b.vencimento <= $2
                       and not exists (select 1 from carteira.pagamentos g where g.titulo_id=t.id and g.conferente='luis')
                       and not exists (select 1 from carteira.acordos a where a.contrato=t.contrato and a.conferente='luis' and t.id = any(a.titulos_origem))
                       and not exists (select 1 from carteira.conferencia_titulo s where s.titulo_id=t.id and s.conferente='luis' and s.situacao='cancelada')
                       and not exists (select 1 from carteira.eventos e join carteira.titulos t0 on t0.id=e.a_partir_titulo
                                       where e.contrato=t.contrato and e.conferente='luis' and e.tipo='encerramento' and t.grupo<>'acordo' and t.vencimento >= t0.vencimento)
                       and not exists (select 1 from carteira.boletos b2 where b2.titulo_id=t.id and b2.tipo='cobranca' and b2.status = any($1))
                     order by b.vencimento`, [ATIVOS_B, lim]);
  return r.map(b => ({ ...b, automatico: !inicioAuto || String(b.vencimento instanceof Date ? b.vencimento.toISOString() : b.vencimento).slice(0, 10) >= inicioAuto }));
}
async function passarParaCobranca(b, conf) {
  const hoje = hojeBR(), venc = String(b.vencimento instanceof Date ? b.vencimento.toISOString() : b.vencimento).slice(0, 10);
  const g0 = await asaas('/payments/' + b.id_asaas);
  if (!g0 || g0.deleted || !ATIVOS_B.includes(g0.status)) { if (g0) await gravaBoleto(g0, {}); return { id: b.id_asaas, erro: 'Boleto já não está em aberto no Asaas' }; }
  const v = +(g0.originalValue ?? g0.value);
  const c = compoAtraso(v, venc, hoje, b.grupo !== 'acordo' && b.grupo !== 'entrada');
  c.cobranca = R2((c.principal + c.correcao + c.multa + c.juros) * .10);
  c.total = R2(c.principal + c.correcao + c.multa + c.juros + c.cobranca);
  c.data = hoje; c.vencimento_original = venc;
  const [ct] = await q('select numero, quadra, lote from carteira.contratos where numero=$1', [b.tc]);
  const t = { grupo: b.grupo, numero: b.numero, total: b.total };
  const linha = `Renegociação ${b.grupo === 'acordo' ? 'acordo ' + String(b.numero).padStart(2, '0') + '/' + String(b.total).padStart(2, '0') : rotuloBoleto(t).replace(/^Anual /, 'anual ').replace(/^Entrada /, 'entrada ')} (vencimento em ${venc.split('-').reverse().join('/')})`;
  const g = await asaasReq('POST', '/payments', { customer: g0.customer, billingType: 'BOLETO', value: c.total, dueDate: hoje,
    description: descricaoBoleto(ct, linha, false), externalReference: 'cbr-cobranca-' + b.titulo_id, interest: { value: 1 }, fine: { value: 0 } });
  await gravaBoleto(g, { contrato: b.tc, titulo_id: b.titulo_id, tipo: 'cobranca', origem: 'sistema', composicao: c, motivo: 'Cobrança dos 60 dias (substitui ' + (g0.invoiceNumber || g0.id) + ')' });
  try { await asaasReq('DELETE', '/payments/' + b.id_asaas); } catch (e) { console.error('excluir antigo', e.message); }
  await q(`update carteira.boletos set status='SUBSTITUIDO', substituido_por=$2, motivo='Passou para cobrança aos 60 dias', atualizado_em=now() where id_asaas=$1`, [b.id_asaas, g.id]);
  await log(conf, 'boleto_cobranca_60', { contrato: b.tc, titulo: b.titulo_id, antigo: b.id_asaas, novo: g.id, ...c });
  return { ok: true, contrato: b.tc, titulo_id: b.titulo_id, novo: g.id, fatura: g.invoiceNumber, valor: c.total };
}
async function cobrancaSemBoleto(tituloId, conf) {
  const [t] = await q(SQL_ABERTAS + ` and t.id=$1`, [tituloId, ATIVOS_B]);
  if (!t) return { titulo_id: tituloId, erro: 'Parcela não está em aberto' };
  if (t.boleto) return { titulo_id: tituloId, erro: 'Parcela já tem boleto ativo' };
  const [jc] = await q(`select 1 from carteira.boletos where titulo_id=$1 and tipo='cobranca' and status = any($2)`, [t.id, ATIVOS_B]);
  if (jc) return { titulo_id: tituloId, erro: 'Já tem boleto de cobrança' };
  const cliente = await clienteDoContrato(t.contrato);
  if (!cliente) return { titulo_id: tituloId, erro: 'Não achei o cliente no Asaas' };
  const hoje = hojeBR();
  const c = compoAtraso(R2(+t.valor), t.vencimento, hoje, t.grupo !== 'acordo' && t.grupo !== 'entrada');
  c.cobranca = R2((c.principal + c.correcao + c.multa + c.juros) * .10);
  c.total = R2(c.principal + c.correcao + c.multa + c.juros + c.cobranca); c.data = hoje; c.vencimento_original = t.vencimento;
  const linha = `Renegociação ${t.grupo === 'acordo' ? 'acordo ' + String(t.numero).padStart(2, '0') + '/' + String(t.total).padStart(2, '0') : rotuloBoleto(t).replace(/^Anual /, 'anual ').replace(/^Entrada /, 'entrada ')} (vencimento em ${t.vencimento.split('-').reverse().join('/')})`;
  const g = await asaasReq('POST', '/payments', { customer: cliente, billingType: 'BOLETO', value: c.total, dueDate: hoje,
    description: descricaoBoleto({ numero: t.contrato, quadra: t.quadra, lote: t.lote }, linha, false), externalReference: 'cbr-cobranca-' + t.id, interest: { value: 1 }, fine: { value: 0 } });
  await gravaBoleto(g, { contrato: t.contrato, titulo_id: t.id, tipo: 'cobranca', origem: 'sistema', composicao: c, motivo: 'Cobrança dos 60 dias (parcela estava sem boleto)' });
  await log(conf, 'boleto_cobranca_sem_boleto', { contrato: t.contrato, titulo: t.id, novo: g.id, ...c });
  return { ok: true, contrato: t.contrato, titulo_id: t.id, novo: g.id, fatura: g.invoiceNumber, valor: c.total };
}
export async function rodaCobranca60(limiteMs = 15000) {
  await garanteAuto(); await garanteBoletos();
  const [st] = await q(`select valor from carteira.asaas_estado where chave='cobranca60'`);
  if (!st?.valor?.ativo) return { desligado: true };
  const inicio = st.valor.inicio_auto;
  const t0 = Date.now(), out = [];
  for (const b of (await candidatosCobranca(inicio)).filter(b => b.automatico)) {
    if (Date.now() - t0 > limiteMs) break;
    try { out.push(await passarParaCobranca(b, 'automatico')); } catch (e) { out.push({ id: b.id_asaas, erro: e.message }); }
  }
  return out;
}
/* importa/atualiza boletos que existem no Asaas (feitos pelo sistema ou direto no Asaas) */
async function vinculaBoletoAsaas(g, X) {
  const [ja] = await q('select titulo_id from carteira.boletos where id_asaas=$1', [g.id]);
  if (ja && (ja.titulo_id || g.deleted || !ATIVOS_B.includes(g.status))) { await gravaBoleto(g, {}); return 'atualizado'; }
  if (g.deleted || !ATIVOS_B.includes(g.status)) return 'ignorado';
  const ref = String(g.externalReference || '').match(/^cbr-(titulo|cobranca)-(\d+)$/);
  if (ref) { const [t] = await q('select contrato from carteira.titulos where id=$1', [ref[2]]); await gravaBoleto(g, { contrato: t?.contrato, titulo_id: +ref[2], tipo: ref[1] === 'cobranca' ? 'cobranca' : null, origem: 'sistema' }); return 'vinculado'; }
  const k = acharContrato(g, X);
  if (k.erro) { await gravaBoleto(g, { origem: 'asaas', motivo: k.erro }); return 'sem_vinculo'; }
  if (!X.corte[k.n]) { await gravaBoleto(g, { contrato: k.n, origem: 'asaas', motivo: 'Contrato sem conferência fechada' }); return 'sem_vinculo'; }
  const D = X.cache[k.n] || (X.cache[k.n] = await carregar(k.n, 'luis'));
  const r = parseDesc(g.description);
  const e = escolherTitulo(g, D);
  const tipo = r.tipo === 'reneg' && /\(vencimento em/i.test(g.description || '') ? 'cobranca' : null;
  if (e.erro && tipo !== 'cobranca') {
    const um = r.ps.length === 1 && D.titulos.find(x => x.grupo !== 'acordo' && x.numero == r.ps[0].n && x.total == r.ps[0].tot);
    if (um) { await gravaBoleto(g, { contrato: k.n, titulo_id: um.id, origem: 'asaas', motivo: 'Parcela já paga, em acordo ou cancelada — este boleto deveria ser excluído' }); return 'vinculado_sobra'; }
    await gravaBoleto(g, { contrato: k.n, origem: 'asaas', motivo: e.erro }); return 'sem_vinculo';
  }
  let tid = e.t?.id;
  if (tipo === 'cobranca') { const m = (g.description || '').match(/(\d{1,3})\s*\/\s*(\d{1,3})/); const t = m && D.titulos.find(x => x.grupo !== 'acordo' && x.numero == +m[1] && x.total == +m[2]); tid = t?.id; }
  const [ativo] = tid ? await q(`select id_asaas from carteira.boletos where titulo_id=$1 and status = any($2) and id_asaas<>$3`, [tid, ATIVOS_B, g.id]) : [];
  await gravaBoleto(g, { contrato: k.n, titulo_id: tid || null, tipo: tipo || (e.t?.grupo === 'acordo' ? 'acordo' : null), origem: 'asaas', motivo: ativo ? 'ATENÇÃO: a parcela já tinha outro boleto ativo (' + ativo.id_asaas + ')' : null });
  return tid ? 'vinculado' : 'sem_vinculo';
}
export async function passoBoletos(limiteMs = 8000) {
  await garanteBoletos(); await garanteAuto();
  const t0 = Date.now();
  const [st] = await q(`select valor from carteira.asaas_estado where chave='boletos'`);
  const E = st?.valor || {};
  const X = await contextoAuto();
  const cont = {};
  if (!E.importou_abertos) {
    E.fase = E.fase || 'PENDING'; E.offset = E.offset || 0;
    while (Date.now() - t0 < limiteMs) {
      const r = await asaas(`/payments?status=${E.fase}&limit=50&offset=${E.offset}`);
      for (const g of r?.data || []) { const x = await vinculaBoletoAsaas(g, X).catch(e => 'erro'); cont[x] = (cont[x] || 0) + 1; }
      E.offset += (r?.data || []).length;
      if (!r?.hasMore) { if (E.fase === 'PENDING') { E.fase = 'OVERDUE'; E.offset = 0; } else { E.importou_abertos = true; E.ultimo = hojeBR(); break; } }
    }
  } else {
    const desde = somaDias(E.ultimo || hojeBR(), -2), ate = hojeBR();
    E.off2 = E.off2 || 0;
    while (Date.now() - t0 < limiteMs) {
      const r = await asaas(`/payments?dateCreated[ge]=${desde}&dateCreated[le]=${ate}&limit=50&offset=${E.off2}`);
      for (const g of r?.data || []) { const x = await vinculaBoletoAsaas(g, X).catch(() => 'erro'); cont[x] = (cont[x] || 0) + 1; }
      E.off2 += (r?.data || []).length;
      if (!r?.hasMore) { E.ultimo = ate; E.off2 = 0; break; }
    }
    const velhos = await q(`select id_asaas from carteira.boletos where status = any($1) order by atualizado_em limit 40`, [ATIVOS_B]);
    for (const b of velhos) { if (Date.now() - t0 > limiteMs) break; const g = await asaas('/payments/' + b.id_asaas).catch(() => null); if (g) await gravaBoleto(g, {}); else await q(`update carteira.boletos set status='DELETED', atualizado_em=now() where id_asaas=$1`, [b.id_asaas]); cont.conferidos = (cont.conferidos || 0) + 1; }
  }
  await q(`insert into carteira.asaas_estado(chave, valor) values ('boletos',$1) on conflict (chave) do update set valor=excluded.valor, em=now()`, [E]);
  return { estado: E, ...cont };
}

let schemaOk = false;
async function garanteEsquema() {
  if (schemaOk) return;
  try {
    const [r] = await q(`select pg_get_constraintdef(oid) d from pg_constraint where conname='eventos_tipo_check'`);
    if (!r || !/'vencimento'/.test(r.d)) {
      await q(`alter table carteira.eventos drop constraint if exists eventos_tipo_check`);
      await q(`alter table carteira.eventos add constraint eventos_tipo_check check (tipo in ('encerramento','cessao','repactuacao','credito','devolucao','pendencia','observacao','vencimento'))`);
    }
    await q(`alter table carteira.acordos add column if not exists tipo text not null default 'acordo'`);
    await q(`alter table carteira.pagamentos add column if not exists compensacao numeric default 0`);
    await q(`alter table carteira.acordos add column if not exists termo text`);
    await q(`create table if not exists carteira.propostas(id serial primary key, contrato text not null, conferente text not null, dados jsonb not null, criado_em timestamptz default now())`);
    await q(`create table if not exists carteira.termos_arq(termo text primary key, contrato text not null, nome text, b64 text not null, conferente text, enviado_em timestamptz default now())`);
    await q(`alter table carteira.termos_arq add column if not exists html text`);
    await q(`alter table carteira.termos_arq alter column b64 drop not null`);
    await q(`create table if not exists carteira.clientes(id serial primary key, chave text unique not null, cpf text, nome text, planilha jsonb, asaas jsonb, manual jsonb, atualizado_em timestamptz default now())`);
    schemaOk = true;
  } catch (e) { console.error('garanteEsquema', e.message); }
}

export default async (req) => {
  await garanteEsquema();
  const url = new URL(req.url);
  const p = url.pathname.replace(/^\/(\.netlify\/functions\/api|api)/, '').split('/').filter(Boolean);
  if (p[0] === 'asaas-webhook' && req.method === 'POST') return webhookAsaas(req);
  if (p[0] === 'diag') {
    let teste = 'ok';
    try { await q('select 1'); } catch (e) { teste = e.message; }
    const k = (process.env.ANTHROPIC_API_KEY || '').trim();
    return json({ teste_conexao: teste, chave_ia: k ? { comeca_com_sk_ant: k.startsWith('sk-ant-'), tamanho: k.length, tem_espaco: /\s/.test(k) } : 'não configurada' });
  }
  let conf = quem(req);
  if (!conf) {
    const falta = [!PL && 'PIN_LUIS', !PS && 'PIN_SECRETARIA', !process.env.DATABASE_URL && 'DATABASE_URL'].filter(Boolean);
    return json({ erro: falta.length ? 'O servidor não está lendo: ' + falta.join(', ') : 'Senha inválida' }, 401);
  }
  const m = req.method;
  const body = m === 'GET' || m === 'DELETE' ? {} : await req.json().catch(() => ({}));
  const real = conf;
  if (conf === 'luis' && req.headers.get('x-como') === 'final') conf = 'final';

  try {
    if (p[0] === 'eu') return json({ conferente: real });

    if (p[0] === 'ajusta-vencimentos' && m === 'POST') {
      if (real !== 'luis') return json({ erro: 'Só o administrador' }, 403);
      const b = body; const meses = parseInt(b.meses || 0, 10); const dias = parseInt(b.dias || 0, 10);
      if (!b.contrato || !['mensal', 'anual', 'entrada'].includes(b.grupo) || (!meses && !dias) || Math.abs(meses) > 24 || Math.abs(dias) > 27) return json({ erro: 'Dados inválidos' }, 400);
      const r = await q(`update carteira.titulos set vencimento = (vencimento + make_interval(months => $3, days => $5))::date
                         where contrato=$1 and grupo=$2 and conferente is null and numero >= $4 returning id`, [b.contrato, b.grupo, meses, parseInt(b.a_partir || 1, 10), dias]);
      await log(conf, 'vencimentos_ajustados', { ...b, qtd: r.length });
      if (r.length && !b.sem_evento) {
        const ap = parseInt(b.a_partir || 1, 10);
        const [t0] = await q(`select id, vencimento from carteira.titulos where contrato=$1 and grupo=$2 and conferente is null and numero=$3`, [b.contrato, b.grupo, ap]);
        const ant = t0 ? new Date(new Date(t0.vencimento).getTime()) : null;
        if (ant) { ant.setUTCDate(ant.getUTCDate() - dias); ant.setUTCMonth(ant.getUTCMonth() - meses); }
        await q(`insert into carteira.eventos(contrato, conferente, tipo, motivo, a_partir_titulo, data, dados, obs) values($1,$2,'vencimento',null,$3,current_date,$4,$5)`,
          [b.contrato, conf, t0 ? t0.id : null, JSON.stringify({ grupo: b.grupo, meses, dias, qtd: r.length, antes: ant ? ant.toISOString().slice(0, 10) : null, depois: t0 ? new Date(t0.vencimento).toISOString().slice(0, 10) : null }), b.obs || null]);
      }
      return json({ ok: true, qtd: r.length });
    }
    if (p[0] === 'asaas-sync' && m === 'POST') {
      if (real !== 'luis') return json({ erro: 'Só o administrador' }, 403);
      return json(await passoSync(7000, !!body.recomecar));
    }
    if (p[0] === 'asaas-auto' && !p[1] && m === 'GET') {
      await garanteAuto();
      const [st] = await q(`select valor, em from carteira.asaas_estado where chave='sync'`);
      const pend = await q(`select id_asaas, fatura, contrato, resultado, motivo, pago_em, valor, cliente, descricao, dados->>'dueDate' venc, em from carteira.asaas_auto where resultado in ('pendente','erro') order by pago_em desc nulls last`);
      const lanc = await q(`select id_asaas, fatura, contrato, motivo, pago_em, valor, cliente, em from carteira.asaas_auto where resultado='lancado' order by em desc limit 100`);
      const [cnt] = await q(`select count(*) filter (where resultado='lancado')::int lancados, count(*) filter (where resultado='congelado')::int congelados,
                             count(*) filter (where resultado='ja_existia')::int ja_existiam, count(*) filter (where resultado='ignorado_mao')::int ignorados from carteira.asaas_auto`);
      return json({ estado: st?.valor || null, estado_em: st?.em || null, pendentes: pend, lancados: lanc, contagem: cnt, webhook: !!(process.env.ASAAS_WEBHOOK_TOKEN || '').trim() });
    }
    if (p[0] === 'asaas-auto' && p[1] === 'resolver' && m === 'POST') {
      if (real !== 'luis') return json({ erro: 'Só o administrador' }, 403);
      await garanteAuto();
      if (body.ignorar) { await q(`update carteira.asaas_auto set resultado='ignorado_mao', motivo=coalesce(motivo,'')||' — ignorado pelo Luis', em=now() where id_asaas=$1`, [body.id_asaas]); return json({ ok: true }); }
      const g = await asaas('/payments/' + body.id_asaas);
      if (!g) return json({ erro: 'Cobrança não encontrada no Asaas' }, 404);
      const r = await processaPagamentoAsaas(g, await contextoAuto(), { forcar: true, contrato: body.contrato, titulo_id: body.titulo_id });
      if (r.erro) return json({ erro: r.erro }, 400);
      if (r.resultado !== 'lancado') return json({ erro: r.motivo || 'Não lancei: ' + r.resultado }, 400);
      return json(r);
    }
    if (p[0] === 'boletos' && real === 'luis') {
      await garanteBoletos();
      if (p[1] === 'previa' && m === 'GET') return json(await previaBoletos(url.searchParams.get('mes')));
      if (p[1] === 'emitir' && m === 'POST') {
        const t0 = Date.now(), out = [];
        for (const id of body.titulos || []) {
          if (Date.now() - t0 > 7000) { out.push({ titulo_id: id, adiado: true }); continue; }
          try { out.push(await emitirBoleto(id, real)); } catch (e) { out.push({ titulo_id: id, erro: e.message }); }
        }
        return json(out);
      }
      if (p[1] === 'sync' && m === 'POST') {
        if (body.reimportar) {
          await q(`update carteira.asaas_estado set valor = valor - 'importou_abertos' - 'fase' - 'offset' where chave='boletos'`);
          await q(`update carteira.boletos b set tipo='acordo' from carteira.titulos t where t.id=b.titulo_id and t.grupo='acordo' and b.tipo='parcela'`);
        }
        return json(await passoBoletos(7000));
      }
      if (p[1] === 'cobranca' && m === 'GET') {
        const [st] = await q(`select valor from carteira.asaas_estado where chave='cobranca60'`).catch(() => []);
        const ini = st?.valor?.inicio_auto || somaDias(hojeBR(), -60);
        const r = await candidatosCobranca(ini);
        const ult = await q(`select b.id_asaas, b.contrato, b.valor, b.vencimento::text vencimento, b.status, b.fatura, b.composicao, b.criado_em, t.rotulo from carteira.boletos b left join carteira.titulos t on t.id=b.titulo_id where b.tipo='cobranca' order by b.criado_em desc limit 100`);
        return json({ ativo: !!st?.valor?.ativo, inicio_auto: ini, candidatos: r.map(b => ({ id_asaas: b.id_asaas, contrato: b.tc, rotulo: ({ acordo: 'Acordo ', anual: 'Anual ', entrada: 'Entrada ' }[b.grupo] || '') + b.numero + '/' + b.total, vencimento: dstr(b.vencimento), valor: b.valor, automatico: b.automatico, fatura: b.fatura })), cobrancas: ult });
      }
      if (p[1] === 'cobranca' && m === 'POST') {
        const r = await candidatosCobranca(null), out = [], t0 = Date.now();
        for (const id of body.ids || []) {
          const b = r.find(x => x.id_asaas === id); if (!b) { out.push({ id, erro: 'Não está mais na lista' }); continue; }
          if (Date.now() - t0 > 7000) { out.push({ id, adiado: true }); continue; }
          try { out.push(await passarParaCobranca(b, real)); } catch (e) { out.push({ id, erro: e.message }); }
        }
        return json(out);
      }
      if (p[1] === 'atrasadas-sem-boleto' && m === 'GET') {
        const r = await q(SQL_ABERTAS + ` and t.vencimento between $1::date and $3::date order by t.vencimento`, [url.searchParams.get('de'), ATIVOS_B, url.searchParams.get('ate')]);
        return json(r.filter(t => !t.boleto).map(t => ({ ...t, valor: R2(+t.valor) })));
      }
      if (p[1] === 'cobranca-sem-boleto' && m === 'POST') {
        const t0 = Date.now(), out = [];
        for (const id of body.titulos || []) {
          if (Date.now() - t0 > 7000) { out.push({ titulo_id: id, adiado: true }); continue; }
          try { out.push(await cobrancaSemBoleto(id, real)); } catch (e) { out.push({ titulo_id: id, erro: e.message }); }
        }
        return json(out);
      }
      if (p[1] === 'cobranca-auto' && m === 'POST') {
        await garanteAuto();
        const [st] = await q(`select valor from carteira.asaas_estado where chave='cobranca60'`);
        const v = { ...(st?.valor || {}), ativo: !!body.ativo };
        if (v.ativo && !v.inicio_auto) v.inicio_auto = somaDias(hojeBR(), -60);
        await q(`insert into carteira.asaas_estado(chave, valor) values ('cobranca60',$1) on conflict (chave) do update set valor=excluded.valor, em=now()`, [v]);
        await log(real, 'cobranca_automatica', v);
        return json(v);
      }
      if (p[1] === 'sobras' && m === 'GET') return json(await q(`select b.id_asaas, b.contrato, b.fatura, b.valor, b.vencimento::text vencimento, b.status, t.rotulo,
          case when exists(select 1 from carteira.pagamentos g where g.titulo_id=t.id and g.conferente='luis') then 'paga'
               when exists(select 1 from carteira.acordos a where a.conferente='luis' and t.id = any(a.titulos_origem)) then 'em acordo' else 'cancelada/encerrada' end situacao
        from carteira.boletos b join carteira.titulos t on t.id=b.titulo_id
        where b.status = any($1) and t.id not in (select x.id from (${SQL_ABERTAS}) x) order by b.contrato, b.vencimento`, [ATIVOS_B, ATIVOS_B]));
      if (p[1] === 'sem-vinculo' && m === 'GET') return json(await q(`select id_asaas, contrato, fatura, valor, vencimento::text vencimento, status, motivo, descricao from carteira.boletos where titulo_id is null and status = any($1) order by vencimento`, [ATIVOS_B]));
      if (p[1] === 'vincular' && m === 'POST') {
        const [t] = await q('select id, contrato from carteira.titulos where id=$1', [body.titulo_id]);
        if (!t) return json({ erro: 'Parcela não encontrada' }, 404);
        const [ativo] = await q(`select id_asaas from carteira.boletos where titulo_id=$1 and status = any($2) and id_asaas<>$3`, [t.id, ATIVOS_B, body.id_asaas]);
        if (ativo) return json({ erro: 'Essa parcela já tem outro boleto ativo (' + ativo.id_asaas + ')' }, 409);
        await q(`update carteira.boletos set titulo_id=$2, contrato=$3, motivo=null, atualizado_em=now() where id_asaas=$1`, [body.id_asaas, t.id, t.contrato]);
        return json({ ok: true });
      }
    }
    if (p[0] === 'boleto' && p[1] && real === 'luis') {
      await garanteBoletos();
      if (m === 'DELETE') return json(await excluirBoleto(p[1], real, url.searchParams.get('motivo') || 'Excluído pelo sistema'));
      if (m === 'PUT') return json(await editarBoleto(p[1], body, real));
      if (m === 'GET') return json(await asaas('/payments/' + p[1]));
    }
    if (p[0] === 'contrato-novo' && m === 'POST') {
      if (real !== 'luis') return json({ erro: 'Só o administrador' }, 403);
      const b = body;
      if (!/^\d{4}$/.test(b.numero || '')) return json({ erro: 'Número inválido' }, 400);
      const [ja] = await q('select numero from carteira.contratos where numero=$1', [b.numero]);
      if (ja) return json({ erro: 'Contrato já existe' }, 409);
      await q(`insert into carteira.contratos(numero, quadra, lote, rua, area, valor_imovel, data_assinatura, entrada_total, indice, juros_aa, corretor, corretagem, compradores, itens, fonte, arquivo)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [b.numero, b.quadra, b.lote, b.rua || null, b.area || null, b.valor_imovel, b.data_assinatura, b.entrada_total || null, b.indice || 'IGPM', b.juros_aa ?? 2,
          b.corretor || null, b.corretagem || null, JSON.stringify(b.compradores || []), JSON.stringify(b.itens || []), 'cadastro manual', b.arquivo || null]);
      const [g] = await q('select carteira.gerar_titulos($1) n', [b.numero]);
      await log(real, 'contrato_novo', b);
      return json({ ok: true, titulos: g.n });
    }
    if (p[0] === 'vencimentos-divergentes') {
      const r = await q(`select t.contrato, count(*)::int n,
          count(*) filter (where p.vencimento_boleto::date <> t.vencimento)::int dif,
          mode() within group (order by extract(day from p.vencimento_boleto::date))::int dia_boleto,
          mode() within group (order by extract(day from t.vencimento))::int dia_titulo,
          mode() within group (order by ((extract(year from p.vencimento_boleto::date)*12+extract(month from p.vencimento_boleto::date))-(extract(year from t.vencimento)*12+extract(month from t.vencimento))))::int meses
        from carteira.pagamentos p join carteira.titulos t on t.id=p.titulo_id
        where t.grupo='mensal' and p.vencimento_boleto is not null and p.forma not in ('Pagamento à construtora','Crédito','Compensação')
        group by t.contrato order by t.contrato`);
      return json(r);
    }
    if (p[0] === 'asaas-busca') {
      if (real !== 'luis') return json({ erro: 'Só o administrador' }, 403);
      const de = url.searchParams.get('de'), ate = url.searchParams.get('ate'), campo = url.searchParams.get('campo') || 'paymentDate';
      const min = Number(url.searchParams.get('min') || 0), max = Number(url.searchParams.get('max') || 1e12);
      const out = [], nomes = {}; const qs = url.searchParams.get('q'); const qre = qs ? new RegExp(qs, 'i') : null;
      for (let off = 0; off < 3000; off += 100) {
        const r = await asaas(`/payments?${campo}[ge]=${de}&${campo}[le]=${ate}&limit=100&offset=${off}`);
        for (const g of r?.data || []) if (g.value >= min && g.value <= max && (!qre || qre.test(g.description || ''))) out.push(g);
        if (!r?.hasMore) break;
      }
      for (const g of out) if (!(g.customer in nomes)) { const cu = await asaas('/customers/' + g.customer).catch(() => null); nomes[g.customer] = cu?.name || null; }
      return json(out.map(g => ({ fatura: g.invoiceNumber, status: g.status, valor: g.value, criada: g.dateCreated, venc: g.dueDate, pago_em: g.paymentDate || g.clientPaymentDate, forma: g.billingType, descricao: g.description, cliente: g.customer, nome: nomes[g.customer], deletado: g.deleted })));
    }
    if (p[0] === 'asaas-fatura' && p[1]) {
      if (real !== 'luis') return json({ erro: 'Só o administrador' }, 403);
      const l = await q(`select coalesce(asaas_payment_real_id, asaas_payment_id) id from public.lote_recebimentos_legado_20260911 where numero_fatura=$1 limit 1`, [p[1]]);
      const pg = l[0]?.id ? await asaas('/payments/' + l[0].id) : null;
      return json({ id: l[0]?.id || null, invoiceNumber: pg?.invoiceNumber, description: pg?.description, status: pg?.status });
    }

    if (p[0] === 'asaas-contrato' && p[1]) {
      if (real !== 'luis') return json({ erro: 'Só o administrador' }, 403);
      const n = p[1];
      const cl = await q(`select distinct cliente_asaas_id c from public.lote_recebimentos_legado_20260911 where contrato_codigo=$1 and cliente_asaas_id like 'cus_%'`, [n]).catch(() => []);
      const extra = (url.searchParams.get('clientes') || '').split(',').filter(x => x.startsWith('cus_'));
      const [ct] = await q('select compradores from carteira.contratos where numero=$1', [n]);
      const porCpf = [];
      for (const cp of (ct?.compradores || [])) {
        const doc = String(cp.cpf || '').replace(/\D/g, '');
        if (doc.length >= 11) { const r = await asaas('/customers?cpfCnpj=' + doc + '&limit=20').catch(() => null); (r?.data || []).forEach(c => porCpf.push(c.id)); }
      }
      const porNome = [];
      const evc = await q(`select dados->>'novos_titulares' t from carteira.eventos where contrato=$1 and tipo='cessao' and coalesce(dados->>'novos_titulares','')<>''`, [n]).catch(() => []);
      const sem = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
      for (const e of evc) for (const nome of String(e.t).split(/\s+e\s+|,/i).map(x => x.trim()).filter(x => x.length > 5)) {
        const r = await asaas('/customers?name=' + encodeURIComponent(nome) + '&limit=10').catch(() => null);
        (r?.data || []).filter(c => sem(c.name) === sem(nome)).forEach(c => porNome.push(c.id));
      }
      const clientes = [...new Set([...cl.map(x => x.c), ...extra, ...porCpf, ...porNome])];
      const out = [], nomes = {};
      for (const c of clientes) {
        const cu = await asaas('/customers/' + c).catch(() => null); nomes[c] = cu?.name || null;
        for (let off = 0; off < 3000; off += 100) {
          const r = await asaas(`/payments?customer=${c}&limit=100&offset=${off}`);
          for (const g of r?.data || []) out.push({
            id: g.id, fatura: g.invoiceNumber, status: g.status, valor: g.value, liquido: g.netValue, original: g.originalValue,
            criada: g.dateCreated, venc: g.dueDate, venc_original: g.originalDueDate, pago_em: g.paymentDate, cliente_pagou: g.clientPaymentDate,
            confirmada: g.confirmedDate, credito: g.creditDate, forma: g.billingType, descricao: g.description, cliente: c, nome: nomes[c],
            parcelamento: g.installment, juros: g.interest?.value, multa: g.fine?.value, desconto: g.discount?.value, deletado: g.deleted, ext: g.externalReference });
          if (!r?.hasMore) break;
        }
      }
      return json({ clientes, nomes, pagamentos: out });
    }

    if (p[0] === 'legado-contrato' && p[1]) {
      if (real !== 'luis') return json({ erro: 'Só o administrador' }, 403);
      const [c] = await q('select quadra, lote from carteira.contratos where numero=$1', [p[1]]);
      const parcelas = await q(`select tipo, numero, data_vencimento, valor_previsto, situacao, valor_pago, data_pagamento, quitada_via, numero_fatura, observacao
                                from public.lote_parcelas where contrato_codigo=$1 order by tipo, numero`, [p[1]]).catch(e => [{ erro: e.message }]);
      const receb = await q(`select numero_fatura, asaas_payment_id, cliente_asaas_id, cliente_nome, contrato_codigo, quadra, lote, descricao, situacao, data_vencimento, data_pagamento, valor, valor_pago
                             from public.lote_recebimentos_legado_20260911 where contrato_codigo=$1 or (quadra=$2 and lote=$3) order by data_vencimento`, [p[1], c?.quadra, c?.lote]).catch(async () =>
        q(`select row_to_json(x) j from public.lote_recebimentos_legado_20260911 x where contrato_codigo=$1 or (quadra=$2 and lote=$3)`, [p[1], c?.quadra, c?.lote]));
      return json({ parcelas, receb });
    }

    if (p[0] === 'fatura-legado' && p[1]) {
      if (real !== 'luis') return json({ erro: 'Só o administrador' }, 403);
      const f = String(p[1]).replace(/\D/g, '');
      const tabs = await q(`select table_name from information_schema.tables where table_schema='public' and table_name ilike 'lote%'`);
      const out = [];
      for (const t of tabs) {
        const r = await q(`select row_to_json(x) j from public."${t.table_name}" x where row_to_json(x)::text ~ $1 limit 3`, ['(^|[^0-9])' + f + '([^0-9]|$)']).catch(() => []);
        r.forEach(x => out.push({ tabela: t.table_name, linha: x.j }));
      }
      return json(out);
    }

    if (p[0] === 'descricoes' && m === 'POST') {
      if (real !== 'luis') return json({ erro: 'Só o administrador' }, 403);
      const r = await puxarDescricoes(body.contrato, body.todos ? ['luis', 'secretaria', 'final'] : [conf]);
      await log(real, 'puxar_descricoes', { contrato: body.contrato, ...r });
      return json(r);
    }

    if (p[0] === 'cruzamento') {
      if (real !== 'luis') return json({ erro: 'Só o administrador acessa o cruzamento' }, 403);
      if (!p[1] && m === 'GET') {
        const cs = await q(`select c.numero, c.quadra, c.lote, coalesce((select nullif(string_agg(x->>'nome', ' e ' order by o), '') from jsonb_array_elements(case when jsonb_typeof(c.compradores)='array' then c.compradores else '[]'::jsonb end) with ordinality as j(x,o)), c.nome_planilha) as titular,
          (select array_agg(conferente) from carteira.fechamentos f where f.contrato=c.numero) as fechados
          from carteira.contratos c order by c.numero`);
        const soFechados = url.searchParams.get('todos') !== '1';
        const alvo = cs.filter(c => !soFechados || ((c.fechados || []).includes('luis') && (c.fechados || []).includes('secretaria')));
        const r = await compararTodos(alvo.map(c => c.numero));
        const out = alvo.map(c => ({ ...c, ...r[c.numero], resolvido: (c.fechados || []).includes('final') }));
        return json(out);
      }
      if (p[1] && m === 'GET') {
        const r = await comparar(p[1]);
        const D = {}; for (const [k, v] of Object.entries(r.D)) D[k] = { ...v, base: undefined, titAcordo: undefined };
        return json({ confs: r.confs, titulos: r.titulos, secoes: r.secoes, dados: D, hoje: HOJE() });
      }
      if (p[1] && m === 'POST') {
        const n = p[1], b = body;
        if (b.acao === 'titulo') { await copiarTitulo(b.titulo_id, b.de); await decidir(n, 'titulo:' + b.titulo_id, b.de, real); }
        if (b.acao === 'secao') { await copiarSecao(n, b.secao, b.de); await decidir(n, 'secao:' + b.secao, b.de, real); }
        if (b.acao === 'aceitar_iguais') {
          const r = await comparar(n); const de = r.confs[0];
          for (const t of r.titulos) if (!t.diverge && !t.decidido && de) { await copiarTitulo(t.id, de); await decidir(n, 'titulo:' + t.id, de + ' (iguais)', real); }
          for (const s of r.secoes) if (!s.diverge && !s.decidido && de) { await copiarSecao(n, s.secao, de); await decidir(n, 'secao:' + s.secao, de + ' (iguais)', real); }
        }
        if (b.acao === 'resolver') await q(`insert into carteira.fechamentos(contrato, conferente) values ($1,'final') on conflict (contrato, conferente) do update set fechado_em=now()`, [n]);
        if (b.acao === 'reabrir') await q(`delete from carteira.fechamentos where contrato=$1 and conferente='final'`, [n]);
        await log(real, 'cruzamento', { contrato: n, ...b });
        return json({ ok: true });
      }
    }


    if (p[0] === 'termo-arq' && m === 'POST') {
      if (!body.termo || !(body.b64 || body.html)) return json({ erro: 'Termo vazio' }, 400);
      await q(`insert into carteira.termos_arq(termo, contrato, nome, b64, html, conferente) values ($1,$2,$3,$4,$5,$6)
               on conflict (termo) do update set nome=excluded.nome, b64=excluded.b64, html=excluded.html, conferente=excluded.conferente, enviado_em=now()`, [body.termo, body.contrato, body.nome || null, body.b64 || null, body.html || null, conf]);
      await log(conf, 'termo_editado_enviado', { termo: body.termo, nome: body.nome });
      return json({ ok: true });
    }
    if (p[0] === 'termo-arq' && p[1] && m === 'GET') {
      const [r] = await q('select termo, nome, b64, html, enviado_em from carteira.termos_arq where termo=$1', [decodeURIComponent(p[1])]);
      return r ? json(r) : json({ erro: 'Termo não encontrado' }, 404);
    }
    if (p[0] === 'termo-arq' && p[1] && m === 'DELETE') {
      await q('delete from carteira.termos_arq where termo=$1', [decodeURIComponent(p[1])]);
      return json({ ok: true });
    }
    if (p[0] === 'clientes' && !p[1] && m === 'GET') {
      const cl = await q(`select id, chave, cpf, nome, planilha, asaas, manual from carteira.clientes order by nome`);
      const ct = await q(`select numero, quadra, lote, compradores from carteira.contratos order by numero`);
      const ev = await q(`select contrato, data, dados->>'novos_titulares' nt from carteira.eventos where tipo='cessao' and conferente='luis' and coalesce(dados->>'novos_titulares','')<>'' order by data, id`);
      const enc = new Set((await q(`select distinct contrato from carteira.eventos where tipo='encerramento' and conferente='luis'`)).map(x => x.contrato));
      const norm = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
      const dig = v => String(v || '').replace(/\D/g, '');
      const ult = {}; for (const e of ev) ult[e.contrato] = e;
      for (const c of cl) {
        const nn = norm(c.nome), L = [];
        for (const k of ct) {
          const comp = (Array.isArray(k.compradores) ? k.compradores : []).some(x => (c.cpf && dig(x.cpf) === c.cpf) || (nn && norm(x.nome) === nn));
          const ces = nn.length > 8 && ev.some(e => e.contrato === k.numero && norm(e.nt).includes(nn));
          if (!comp && !ces) continue;
          const atual = ult[k.numero] ? norm(ult[k.numero].nt).includes(nn) : comp;
          L.push({ numero: k.numero, quadra: k.quadra, lote: k.lote, papel: ces && !comp ? 'cessionário' : 'comprador', atual: atual && !enc.has(k.numero), encerrado: enc.has(k.numero) });
        }
        c.contratos = L;
      }
      const fc = url.searchParams.get('contrato');
      return json(fc ? cl.filter(c => c.contratos.some(k => k.numero === fc)) : cl);
    }
    if (p[0] === 'clientes' && p[1] === 'planilha' && m === 'POST') {
      if (real !== 'luis') return json({ erro: 'Só o administrador' }, 403);
      let n = 0;
      for (const r of body.linhas || []) {
        const chave = r.cpf ? 'cpf:' + r.cpf : 'nome:' + String(r.nome || '').toLowerCase().trim();
        await q(`insert into carteira.clientes(chave, cpf, nome, planilha) values ($1,$2,$3,$4)
                 on conflict (chave) do update set planilha=excluded.planilha, cpf=coalesce(carteira.clientes.cpf, excluded.cpf), nome=coalesce(carteira.clientes.nome, excluded.nome), atualizado_em=now()`, [chave, r.cpf || null, r.nome, r]);
        n++;
      }
      return json({ ok: true, n });
    }
    if (p[0] === 'clientes' && p[1] === 'asaas' && m === 'POST') {
      if (real !== 'luis') return json({ erro: 'Só o administrador' }, 403);
      const off0 = parseInt(body.offset || 0, 10); let n = 0, mais = false, off = off0;
      for (; off < off0 + 500; off += 100) {
        const r = await asaas(`/customers?limit=100&offset=${off}`);
        for (const c of r?.data || []) {
          if (c.deleted) continue;
          const cpf = String(c.cpfCnpj || '').replace(/\D/g, '') || null;
          const chave = cpf ? 'cpf:' + cpf : 'asaas:' + c.id;
          const ex = cpf ? null : (await q(`select id from carteira.clientes where asaas->>'id'=$1`, [c.id]))[0];
          if (ex) { await q(`update carteira.clientes set asaas=$2, atualizado_em=now() where id=$1`, [ex.id, c]); n++; continue; }
          await q(`insert into carteira.clientes(chave, cpf, nome, asaas) values ($1,$2,$3,$4)
                   on conflict (chave) do update set asaas=excluded.asaas, nome=excluded.nome, cpf=coalesce(carteira.clientes.cpf, excluded.cpf), atualizado_em=now()`, [chave, cpf, c.name, c]);
          n++;
        }
        if (!r?.hasMore) { mais = false; off += 100; break; }
        mais = true;
      }
      return json({ ok: true, n, proximo: mais ? off : null });
    }
    if (p[0] === 'clientes' && p[1] === 'contratos' && m === 'POST') {
      if (real !== 'luis') return json({ erro: 'Só o administrador' }, 403);
      const ct = await q(`select numero, compradores from carteira.contratos`); let n = 0;
      for (const k of ct) for (const x of (Array.isArray(k.compradores) ? k.compradores : [])) {
        const cpf = String(x.cpf || '').replace(/\D/g, ''); if (!cpf || !x.nome) continue;
        const r = await q(`insert into carteira.clientes(chave, cpf, nome, planilha) values ($1,$2,$3,$4) on conflict (chave) do nothing returning id`, ['cpf:' + cpf, cpf, x.nome, { nome: x.nome, cpf, origem: 'contrato ' + k.numero }]);
        n += r.length;
      }
      return json({ ok: true, novos: n });
    }
    if (p[0] === 'cliente' && p[1] && m === 'PUT') {
      await q(`update carteira.clientes set manual=$2, atualizado_em=now() where id=$1`, [p[1], body.manual || null]);
      await log(conf, 'cliente_editado', { id: p[1], manual: body.manual });
      return json({ ok: true });
    }

    if (p[0] === 'contratos' && m === 'GET') {
      const rows = await q(`
        select c.numero, c.quadra, c.lote, c.valor_imovel, c.data_assinatura,
               coalesce((select e.dados->>'novos_titulares' from carteira.eventos e where e.contrato=c.numero and e.conferente=$1 and e.tipo='cessao' and coalesce(e.dados->>'novos_titulares','')<>'' order by e.data desc nulls last, e.id desc limit 1), (select nullif(string_agg(x->>'nome', ' e ' order by o), '') from jsonb_array_elements(case when jsonb_typeof(c.compradores)='array' then c.compradores else '[]'::jsonb end) with ordinality as j(x,o)), c.nome_planilha) as titular,
               jsonb_array_length(c.alertas) as n_alertas,
               (select count(*) from carteira.titulos t where t.contrato=c.numero and t.conferente is null and t.vencimento <= current_date) as vencidas,
               (select count(distinct t.id) from carteira.titulos t
                  where t.contrato=c.numero and t.conferente is null and t.vencimento <= current_date
                    and (exists(select 1 from carteira.pagamentos g where g.titulo_id=t.id and g.conferente=$1)
                      or exists(select 1 from carteira.conferencia_titulo ct where ct.titulo_id=t.id and ct.conferente=$1)
                      or exists(select 1 from carteira.acordos a where a.contrato=c.numero and a.conferente=$1 and t.id = any(a.titulos_origem)))) as conferidas,
               (select fechado_em from carteira.fechamentos f where f.contrato=c.numero and f.conferente=$1) as fechado_em,
               exists(select 1 from carteira.eventos e where e.contrato=c.numero and e.conferente=$1 and e.tipo='encerramento') as cancelado,
               (select e.motivo from carteira.eventos e where e.contrato=c.numero and e.conferente=$1 and e.tipo='encerramento' order by e.id desc limit 1) as motivo_enc,
               (select string_agg(coalesce(e.obs,''),' | ' order by e.id) from carteira.eventos e where e.contrato=c.numero and e.conferente=$1 and e.tipo='pendencia') as pendencia,
               ea.n as em_atraso, ea.v as em_atraso_valor
        from carteira.contratos c cross join lateral (select count(*) as n, coalesce(sum(t.valor_face),0) as v from carteira.titulos t
                  where t.contrato=c.numero and (t.conferente is null or t.conferente=$1) and t.vencimento <= current_date
                    and not exists(select 1 from carteira.pagamentos g where g.titulo_id=t.id and g.conferente=$1)
                    and not exists(select 1 from carteira.acordos a where a.contrato=c.numero and a.conferente=$1 and t.id = any(a.titulos_origem))
                    and not exists(select 1 from carteira.conferencia_titulo ct where ct.titulo_id=t.id and ct.conferente=$1 and ct.situacao='cancelada')
                    and not exists(select 1 from carteira.eventos e join carteira.titulos t0 on t0.id=e.a_partir_titulo
                                   where e.contrato=c.numero and e.conferente=$1 and e.tipo='encerramento' and t.grupo<>'acordo' and t.vencimento >= t0.vencimento)) ea order by c.numero`, [conf]);
      return json(rows);
    }

    if (p[0] === 'contrato-data' && m === 'POST') {
      if (real !== 'luis') return json({ erro: 'Só o administrador' }, 403);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.data_assinatura || '')) return json({ erro: 'Data inválida' }, 400);
      const [a] = await q(`select data_assinatura from carteira.contratos where numero=$1`, [body.contrato]);
      if (!a) return json({ erro: 'Contrato não encontrado' }, 404);
      await q(`update carteira.contratos set data_assinatura=$2 where numero=$1`, [body.contrato, body.data_assinatura]);
      await log(conf, 'data_assinatura_corrigida', { contrato: body.contrato, antes: a.data_assinatura, depois: body.data_assinatura, motivo: body.motivo || null });
      return json({ ok: true });
    }
    if (p[0] === 'contrato' && p[1] && m === 'GET') {
      const d = await carregar(p[1], conf);
      if (!d) return json({ erro: 'Contrato não encontrado' }, 404);
      return json(d);
    }

    if (p[0] === 'pagamento' && m === 'POST') {
      const t = await tituloDoConferente(body.titulo_id, conf);
      if (!t) return json({ erro: 'Parcela não encontrada' }, 404);
      { const b0 = await bloqueioEncerrado(t, conf); if (b0) return json({ erro: b0 }, 409); }
      const vals = CAMPOS_PAG.map(c => limpa(body[c]));
      const [g] = await q(`insert into carteira.pagamentos(conferente, titulo_id, ${CAMPOS_PAG.join(',')}, tem_print)
                           values ($1,$2,${CAMPOS_PAG.map((_, i) => '$' + (i + 3)).join(',')}, $${CAMPOS_PAG.length + 3}) returning id, salvo_em`,
        [conf, t.id, ...vals, !!body.print]);
      if (body.print) await q('insert into carteira.prints(pagamento_id, tipo, conteudo) values ($1,$2,$3)', [g.id, 'image/jpeg', body.print]);
      await q(`insert into carteira.conferencia_titulo(conferente, titulo_id, situacao) values ($1,$2,'paga')
               on conflict (conferente, titulo_id) do update set situacao='paga', salvo_em=now()`, [conf, t.id]);
      await log(conf, 'pagamento_novo', { id: g.id, titulo: t.id });
      if (!body.id_asaas && conf === 'luis') {
        const ab = await q(`select id_asaas from carteira.boletos where titulo_id=$1 and status = any($2)`, [t.id, ATIVOS_B]).catch(() => []);
        g.boletos_cancelados = [];
        for (const b of ab) { try { await excluirBoleto(b.id_asaas, conf, 'Baixa manual: ' + (body.forma || 'pagamento fora do boleto')); g.boletos_cancelados.push(b.id_asaas); } catch (e) { g.erro_boleto = e.message; } }
      }
      return json(g);
    }

    if (p[0] === 'pagamento' && p[1] && m === 'PUT') {
      const [old] = await q('select * from carteira.pagamentos where id=$1 and conferente=$2', [p[1], conf]);
      if (!old) return json({ erro: 'Pagamento não encontrado' }, 404);
      { const [tt] = await q('select * from carteira.titulos where id=$1', [old.titulo_id]); const b0 = await bloqueioEncerrado(tt, conf); if (b0) return json({ erro: b0 }, 409); }
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
                           where pr.pagamento_id=$1 and (g.conferente=$2 or $3)`, [p[1], conf, real === 'luis']);
      return json({ conteudo: r?.conteudo || null });
    }

    if (p[0] === 'situacao' && m === 'POST') {
      const t = await tituloDoConferente(body.titulo_id, conf);
      if (!t) return json({ erro: 'Parcela não encontrada' }, 404);
      { const b0 = await bloqueioEncerrado(t, conf); if (b0 && body.situacao !== 'cancelada') return json({ erro: b0 }, 409); }
      if (!body.situacao) await q('delete from carteira.conferencia_titulo where conferente=$1 and titulo_id=$2', [conf, t.id]);
      else await q(`insert into carteira.conferencia_titulo(conferente, titulo_id, situacao, obs) values ($1,$2,$3,$4)
                    on conflict (conferente, titulo_id) do update set situacao=excluded.situacao, obs=excluded.obs, salvo_em=now()`,
        [conf, t.id, body.situacao, limpa(body.obs)]);
      await log(conf, 'situacao', body);
      return json({ ok: true });
    }

    if (p[0] === 'proposta' && m === 'POST') {
      const [r] = await q('insert into carteira.propostas(contrato, conferente, dados) values ($1,$2,$3) returning id', [body.contrato, conf, body.dados]);
      await log(conf, 'proposta_nova', { id: r.id, contrato: body.contrato });
      return json(r);
    }
    if (p[0] === 'proposta' && p[1] && m === 'DELETE') {
      await q('delete from carteira.propostas where id=$1 and conferente=$2', [p[1], conf]);
      await log(conf, 'proposta_apagada', { id: p[1] });
      return json({ ok: true });
    }

    if (p[0] === 'acordo' && m === 'POST') {
      const b = body;
      for (const id of b.titulos_origem || []) { const [tt] = await q('select * from carteira.titulos where id=$1', [id]); const b0 = await bloqueioEncerrado(tt, conf); if (b0) return json({ erro: b0 }, 409); }
      const [a] = await q(`insert into carteira.acordos(contrato, conferente, data_acordo, titulos_origem, principal, multa, juros, honorarios,
                           valor_calculado, valor_acordado, desconto_encargos, qtd_parcelas, obs, tipo, termo)
                           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
        [b.contrato, conf, b.data_acordo, b.titulos_origem, b.principal, b.multa, b.juros, b.honorarios, b.valor_calculado,
          b.valor_acordado, b.desconto_encargos, b.parcelas.length, limpa(b.obs), b.tipo === 'repactuacao' ? 'repactuacao' : 'acordo', limpa(b.termo)]);
      let i = 0;
      for (const par of b.parcelas) {
        i++;
        await q(`insert into carteira.titulos(contrato, grupo, numero, total, rotulo, vencimento, valor_face, conferente, acordo_id)
                 values ($1,'acordo',$2,$3,$4,$5,$6,$7,$8)`,
          [b.contrato, i, b.parcelas.length, `${b.tipo === 'repactuacao' ? 'Repactuação' : 'Acordo'} ${b.data_acordo.split('-').reverse().join('/')} — ${i}/${b.parcelas.length}`, par.vencimento, par.valor, conf, a.id]);
      }
      await log(conf, 'acordo_novo', { id: a.id, ...b });
      if (conf === 'luis') {
        const ab = await q(`select id_asaas from carteira.boletos where titulo_id = any($1) and status = any($2)`, [(b.titulos_origem || []).map(Number), ATIVOS_B]).catch(() => []);
        a.boletos_excluidos = [];
        for (const x of ab) { try { await excluirBoleto(x.id_asaas, conf, 'Parcela entrou no acordo de ' + b.data_acordo); a.boletos_excluidos.push(x.id_asaas); } catch (e) { a.erro_boleto = e.message; } }
      }
      return json(a);
    }

    if (p[0] === 'acordo' && p[1] && m === 'PUT') {
      const b = body;
      await q(`update carteira.acordos set data_acordo=$3, titulos_origem=$4, principal=$5, multa=$6, juros=$7, honorarios=$8,
               valor_calculado=$9, valor_acordado=$10, desconto_encargos=$11, qtd_parcelas=$12, obs=$13, termo=$14, salvo_em=now()
               where id=$1 and conferente=$2`,
        [p[1], conf, b.data_acordo, b.titulos_origem, b.principal, b.multa, b.juros, b.honorarios, b.valor_calculado,
          b.valor_acordado, b.desconto_encargos, b.parcelas.length, limpa(b.obs), limpa(b.termo)]);
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
      { const [tt] = await q('select * from carteira.titulos where contrato=$1 and grupo=$2 and numero=$3 and conferente is null', [b.contrato, b.grupo, b.a_partir]); const b0 = await bloqueioEncerrado(tt, conf); if (b0) return json({ erro: b0 }, 409); }
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
      if (b.tipo === 'encerramento') {
        const [ja] = await q(`select id from carteira.eventos where contrato=$1 and conferente=$2 and tipo='encerramento' limit 1`, [b.contrato, conf]);
        if (ja) return json({ erro: 'Este contrato já está encerrado/cancelado. Para mudar, edite ou apague o encerramento que já existe.' }, 409);
      }
      if (b.tipo === 'cessao') { const [tt] = await q('select * from carteira.titulos where id=$1', [b.a_partir_titulo]); const b0 = await bloqueioEncerrado(tt, conf); if (b0) return json({ erro: b0 }, 409); }
      const [r] = await q(`insert into carteira.eventos(contrato, conferente, tipo, motivo, a_partir_titulo, data, dados, obs)
                           values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [b.contrato, conf, b.tipo, limpa(b.motivo), b.a_partir_titulo, limpa(b.data), b.dados || {}, limpa(b.obs)]);
      await log(conf, 'evento_novo', b);
      return json(r);
    }

    if (p[0] === 'evento' && p[1] && m === 'PUT') {
      const b = body;
      await q(`update carteira.eventos set motivo=$3, a_partir_titulo=$4, data=$5, dados=$6, obs=$7, salvo_em=now() where id=$1 and conferente=$2`,
        [p[1], conf, limpa(b.motivo), b.a_partir_titulo, limpa(b.data), b.dados || {}, limpa(b.obs)]);
      await log(conf, 'evento_alterado', { id: p[1], ...b });
      return json({ ok: true });
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

    if (p[0] === 'zerar' && m === 'POST') {
      if (real !== 'luis') return json({ erro: 'Só o administrador' }, 403);
      const n = body.contrato, sub = 'select id from carteira.titulos where contrato=$1';
      const r = {};
      r.pagamentos = (await q(`delete from carteira.pagamentos where conferente=$2 and titulo_id in (${sub}) returning id`, [n, conf])).length;
      await q(`delete from carteira.conferencia_titulo where conferente=$2 and titulo_id in (${sub})`, [n, conf]);
      await q(`delete from carteira.titulos where contrato=$1 and grupo='acordo' and conferente=$2`, [n, conf]);
      for (const t of ['acordos', 'correcoes', 'eventos', 'fechamentos']) r[t] = (await q(`delete from carteira.${t} where contrato=$1 and conferente=$2 returning 1`, [n, conf])).length;
      await log(real, 'zerar_contrato', { contrato: n, ...r });
      return json(r);
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
