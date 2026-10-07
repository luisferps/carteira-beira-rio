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
  'multa_paga', 'juros_pago', 'honorarios_pago', 'desconto_dado'];

function limpa(v) { return v === '' || v === undefined ? null : v; }

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
  return { contrato, titulos, pagamentos, situacoes, acordos, correcoes, eventos, fechamento: fechamento || null, hoje: new Date().toISOString().slice(0, 10), conferente: conf };
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

export default async (req) => {
  const url = new URL(req.url);
  const p = url.pathname.replace(/^\/(\.netlify\/functions\/api|api)/, '').split('/').filter(Boolean);
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
      const clientes = [...new Set([...cl.map(x => x.c), ...extra])];
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
        const cs = await q(`select c.numero, c.quadra, c.lote, coalesce(c.compradores->0->>'nome', c.nome_planilha) as titular,
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
      const d = await carregar(p[1], conf);
      if (!d) return json({ erro: 'Contrato não encontrado' }, 404);
      return json(d);
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
                           where pr.pagamento_id=$1 and (g.conferente=$2 or $3)`, [p[1], conf, real === 'luis']);
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
