/* Acerto mensal Inerente × FCA (Beira Rio). Base = data de CRÉDITO no extrato do Asaas. */
const R2 = x => Math.round((+x || 0) * 100) / 100;
const nm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export const CAT_E = { entrada: 'Parcelas de Entrada', mensal: 'Parcelas Mensais', anual: 'Parcelas Intermediárias', cobranca: 'Parcelas de Cobrança', contrato: 'Contratos', revisar: 'A classificar' };
/* [rótulo, sai do montante da Inerente?] na ordem do relatório */
export const CAT_S = {
  andre: ['André Darlan · FCA', 0], luis: ['Luis Fernando · Inerente', 1], lucikelly: ['Lucikelly · salário', 1], imposto: ['Impostos da folha · Lucikelly', 1],
  devolucao: ['Devoluções de terreno', 0], saneago: ['Saneago', 1], equatorial: ['Equatorial', 1], telefone: ['Telefone', 1], outro_inerente: ['Outra despesa da Inerente', 1],
  indenizacao: ['Indenização · Banco do Brasil', 0], conta_fca: ['Contas a pedido do André · FCA', 0], taxas: ['Custos da Conta', 0], revisar: ['A classificar', 0],
};
const ROT_ACERTO = { luis: 'Repasse Luis Fernando · Inerente', lucikelly: 'Pagamento Lucikelly', imposto: 'Impostos da folha · Lucikelly', telefone: 'Telefone', equatorial: 'Equatorial', saneago: 'Saneago', outro_inerente: 'Outra despesa da Inerente' };
const REGRAS_FIXAS = [[/andre darlan/, 'andre'], [/lucikelly/, 'lucikelly'], [/inerente gestao|luis fernando pimentel/, 'luis'], [/saneamento de goias|saneago/, 'saneago'],
  [/equatorial/, 'equatorial'], [/camilla chagas/, 'telefone'], [/banco do brasil/, 'indenizacao']];
const DUVIDA = /ministerio da fazenda|caixa economica|receita federal/;
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const HIST0 = { '2022-08': 15117.93, '2022-09': 141349.37, '2022-10': 182052.54, '2022-11': 158704.10, '2022-12': 134032.33,
  '2023-01': 127420.77, '2023-02': 104602.55, '2023-03': 112034.44, '2023-04': 108530.27, '2023-05': 118155.32, '2023-06': 151979.14, '2023-07': 144773.82, '2023-08': 119191.47, '2023-09': 120582.23, '2023-10': 101320.45, '2023-11': 95228.28, '2023-12': 101073.04,
  '2024-01': 122865.65, '2024-02': 109551.08, '2024-03': 99904.31, '2024-04': 112678.56, '2024-05': 105963.74, '2024-06': 108394.17, '2024-07': 177224.41, '2024-08': 117215.36, '2024-09': 134151.56, '2024-10': 125243.62, '2024-11': 110042.44, '2024-12': 126841.03,
  '2025-01': 127272.82, '2025-02': 145932.04, '2025-03': 174668.71, '2025-04': 180040.51, '2025-05': 204587.98, '2025-06': 141067.91, '2025-07': 212730.41, '2025-08': 196062.28, '2025-09': 180732.22, '2025-10': 164568.29, '2025-11': 140855.48, '2025-12': 190574.90,
  '2026-01': 151786.20, '2026-02': 169816.63, '2026-03': 178333.99, '2026-04': 156848.95, '2026-05': 171816.90, '2026-06': 156151.32, '2026-07': 218965.90 };
const HIST_DET = { '2026-08': { recebido: 157720.81, boletos: 153, mensais: 127588.76, anuais: 5078.08, cobrancas: 18766.01, entradas: 3919.06, contratos: 2368.9 } };
const REGRAS_SEMENTE = { 'ana paula vilela veiga boletti': 'devolucao', 'fagner do nascimento silva': 'devolucao', 'wesley antonio de souza': 'devolucao', 'altamiro ferreira da silva': 'devolucao', 'rodolfo henrique araujo rodrigues cardoso': 'devolucao' };

function ultimoDia(mes) { const [a, m] = mes.split('-').map(Number); return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10); }
function somaDias(d, n) { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
const mesAnt = mes => { const [a, m] = mes.split('-').map(Number); return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`; };
const br = v => (+v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const nomeMes = mes => MESES[+mes.slice(5) - 1] + '/' + mes.slice(0, 4);

function beneficiario(d) { const m = String(d || '').match(/\bpara\s+(.+)$/i); return m ? m[1].replace(/\(.*?\)/g, '').trim() : String(d || ''); }
function linhaBoleto(desc) {
  const ls = String(desc || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const fim = ls.findIndex(l => /servi[çc]o de|^á servi/i.test(l));
  const u = fim >= 0 ? ls.slice(0, fim) : ls;
  return (u.length > 2 ? u.slice(2) : u).join(' ');
}
function catDaLinha(l) {
  if (/gerada automaticamente a partir de pix/i.test(l)) return 'revisar';
  if (/cess/i.test(l)) return 'contrato';
  if (/entrada|sinal/i.test(l)) return 'entrada';
  if (/renegocia|cobran|acordo|parcelament|confiss|t[ií]tulo/i.test(l)) return 'cobranca';
  if (/\b\d{1,2}\s+de\s+\d{1,2}\b/i.test(l)) return 'cobranca';
  if (/anual|intermedi/i.test(l)) return 'anual';
  return 'mensal';
}
function vencRef(g) {
  const m = String(g.description || '').match(/(?:venc(?:imento)?(?: original)?|original vencido)\s+em\s+(\d{2})\/(\d{2})\/(\d{4})/i);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return g.originalDueDate || g.dueDate || null;
}
const dias = (a, b) => a && b ? Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5) : 0;

export function criaAcerto({ q, asaas, json, log }) {
  let ok = false;
  async function garante() {
    if (ok) return;
    await q(`create table if not exists carteira.acerto_extrato(mes text not null, id text not null, data date, valor numeric, saldo numeric, tipo text, descricao text,
             payment_id text, transfer_id text, primary key(mes, id))`);
    await q(`create table if not exists carteira.acerto_pag(id text primary key, dados jsonb not null, em timestamptz default now())`);
    await q(`create table if not exists carteira.acerto_cls(id text primary key, cat text not null, por text, em timestamptz default now())`);
    await q(`create table if not exists carteira.acerto_regras(nome text primary key, cat text not null, em timestamptz default now())`);
    await q(`create table if not exists carteira.acerto_meses(mes text primary key, carregado_em timestamptz, fechado_em timestamptz, por text, saldo_anterior numeric,
             ajustes jsonb default '[]', texto text, saldo numeric, dados jsonb)`);
    await q(`create table if not exists carteira.acerto_hist(mes text primary key, recebido numeric, boletos int, mensais numeric, anuais numeric, cobrancas numeric, entradas numeric, contratos numeric)`);
    const [c] = await q(`select count(*)::int n from carteira.acerto_hist`);
    if (!c.n) {
      for (const [m, v] of Object.entries(HIST0)) await q(`insert into carteira.acerto_hist(mes, recebido) values($1,$2) on conflict do nothing`, [m, v]);
      for (const [m, d] of Object.entries(HIST_DET)) await q(`insert into carteira.acerto_hist values($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing`, [m, d.recebido, d.boletos, d.mensais, d.anuais, d.cobrancas, d.entradas, d.contratos]);
      for (const [n, cat] of Object.entries(REGRAS_SEMENTE)) await q(`insert into carteira.acerto_regras(nome, cat) values($1,$2) on conflict do nothing`, [n, cat]);
      await q(`insert into carteira.acerto_meses(mes, saldo, fechado_em, por, texto) values('2026-09', -4292.05, '2026-10-05', 'planilha', 'Fechado fora do sistema (planilha de setembro/2026)') on conflict do nothing`);
      await q(`insert into carteira.acerto_hist values('2026-09',156160.60,162,134724.43,10569.06,4813.79,3920.28,2133.04) on conflict do nothing`);
    }
    ok = true;
  }

  async function carregaExtrato(mes) {
    const ini = mes + '-01', fim = ultimoDia(mes);
    const base = `/financialTransactions?startDate=${ini}&finishDate=${fim}&limit=100&order=asc`;
    const p0 = await asaas(base + '&offset=0');
    let itens = p0?.data || [];
    const tot = p0?.totalCount || itens.length;
    const offs = []; for (let o = 100; o < tot; o += 100) offs.push(o);
    for (let i = 0; i < offs.length; i += 5) {
      const ps = await Promise.all(offs.slice(i, i + 5).map(o => asaas(base + '&offset=' + o)));
      for (const p of ps) itens = itens.concat(p?.data || []);
    }
    const vistos = new Set(); itens = itens.filter(x => x?.id && !vistos.has(x.id) && vistos.add(x.id));
    await q(`delete from carteira.acerto_extrato where mes=$1`, [mes]);
    for (let i = 0; i < itens.length; i += 200) {
      const L = itens.slice(i, i + 200);
      await q(`insert into carteira.acerto_extrato(mes, id, data, valor, saldo, tipo, descricao, payment_id, transfer_id)
               select $1, x->>'id', (x->>'date')::date, (x->>'value')::numeric, nullif(x->>'balance','')::numeric, x->>'type', x->>'description', x->>'paymentId', x->>'transferId'
               from jsonb_array_elements($2::jsonb) x`, [mes, JSON.stringify(L.map(x => ({ id: x.id, date: x.date, value: x.value, balance: x.balance, type: x.type, description: x.description,
        paymentId: x.payment?.id || x.paymentId || (typeof x.payment === 'string' ? x.payment : null), transferId: x.transfer?.id || x.transferId || null })))]);
    }
    await q(`insert into carteira.acerto_meses(mes, carregado_em) values($1, now()) on conflict (mes) do update set carregado_em=now()`, [mes]);
    return itens.length;
  }
  async function faltaPag(mes) {
    return (await q(`select distinct e.payment_id id from carteira.acerto_extrato e left join carteira.acerto_pag p on p.id=e.payment_id
                     where e.mes=$1 and e.tipo='PAYMENT_RECEIVED' and e.payment_id is not null and p.id is null`, [mes])).map(x => x.id);
  }
  async function guardaPags(L) {
    if (!L.length) return;
    await q(`insert into carteira.acerto_pag(id, dados) select x->>'id', x from jsonb_array_elements($1::jsonb) x on conflict (id) do update set dados=excluded.dados, em=now()`, [JSON.stringify(L)]);
  }
  async function carregaPagamentos(mes, prazo) {
    let falta = await faltaPag(mes);
    if (falta.length > 25) {
      const ini = somaDias(mes + '-01', -20), fim = ultimoDia(mes);
      const base = `/payments?paymentDate%5Bge%5D=${ini}&paymentDate%5Ble%5D=${fim}&limit=100`;
      const p0 = await asaas(base + '&offset=0'); let L = p0?.data || [];
      const offs = []; for (let o = 100; o < (p0?.totalCount || 0); o += 100) offs.push(o);
      for (let i = 0; i < offs.length && Date.now() < prazo; i += 5) for (const p of await Promise.all(offs.slice(i, i + 5).map(o => asaas(base + '&offset=' + o)))) L = L.concat(p?.data || []);
      const F = new Set(falta); await guardaPags(L.filter(x => F.has(x.id)));
      falta = await faltaPag(mes);
    }
    for (let i = 0; i < falta.length && Date.now() < prazo; i += 8) {
      const ps = (await Promise.all(falta.slice(i, i + 8).map(id => asaas('/payments/' + id).catch(() => null)))).filter(x => x?.id);
      await guardaPags(ps);
    }
    return (await faltaPag(mes)).length;
  }


  /* custo de cobrança = o "custo de cobrança pago" registrado no pagamento da parcela (o que o cliente pagou). */
  async function custoDaParcela(L) {
    if (!L.length) return;
    const ids = L.map(x => x.payment).filter(Boolean), fs = L.map(x => x.fatura).filter(Boolean);
    const rs = await q(`select g.id_asaas, regexp_replace(coalesce(g.fatura,''),'\\D','','g') fat, g.valor_pago, g.honorarios_pago, t.contrato, t.rotulo, t.grupo, t.valor_face,
                          a.honorarios a_hon, a.valor_acordado a_val
                        from carteira.pagamentos g join carteira.titulos t on t.id=g.titulo_id left join carteira.acordos a on a.id=t.acordo_id
                        where g.conferente='luis' and (g.id_asaas = any($1) or regexp_replace(coalesce(g.fatura,''),'\\D','','g') = any($2))`, [ids, fs]).catch(() => []);
    for (const x of L) {
      const P = rs.filter(r => (x.payment && r.id_asaas === x.payment) || (x.fatura && r.fat === x.fatura));
      x.parcelas_sis = P.map(r => r.rotulo).join(', ');
      if (!P.length) { x.sem_lancamento = true; continue; }
      let h = 0;
      for (const r of P) {
        h += +r.honorarios_pago || 0;
      }
      h = h < 0.05 ? 0 : h; x.hon = R2(Math.min(h, x.valor)); x.fca = R2(x.valor - x.hon);
    }
  }
  async function calcula(mes) {
    const [M] = await q(`select * from carteira.acerto_meses where mes=$1`, [mes]);
    if (M?.fechado_em && M.dados) return { ...M.dados, fechado: true, fechado_em: M.fechado_em, por: M.por };
    const foraSis = !!M?.fechado_em;
    const ext = await q(`select e.*, e.data::text data, p.dados pg from carteira.acerto_extrato e left join carteira.acerto_pag p on p.id=e.payment_id where e.mes=$1 order by e.data, e.id`, [mes]);
    const cls = {}; for (const c of await q(`select c.id, c.cat from carteira.acerto_cls c join carteira.acerto_extrato e on e.id=c.id and e.mes=$1`, [mes])) cls[c.id] = c.cat;
    const regras = {}; for (const r of await q(`select nome, cat from carteira.acerto_regras`)) regras[r.nome] = r.cat;
    const acordos = new Set((await q(`select distinct contrato from carteira.acordos`).catch(() => [])).map(x => x.contrato));
    const ent = [], sai = [];
    for (const e of ext) {
      const v = +e.valor;
      if (e.tipo === 'PAYMENT_RECEIVED' || v > 0) {
        const g = e.pg || {};
        const linha = linhaBoleto(g.description);
        const ct = (String(g.description || '').match(/Beira\s*Rio\s*-\s*(\d{3,4})/i) || [])[1] || null;
        const ql = (String(g.description || '').split(/\r?\n/)[1] || '').trim();
        let cat = e.tipo === 'PAYMENT_RECEIVED' && e.pg ? catDaLinha(linha) : 'revisar';
        const venc = vencRef(g), pago = g.clientPaymentDate || g.paymentDate || null, d = dias(venc, pago);
        let obs = '';
        if ((cat === 'mensal' || cat === 'anual') && d > 60) { cat = 'cobranca'; obs = `Paga com ${d} dias de atraso (acima de 60 dias)`; }
        const auto = cat;
        if (cls[e.id]) cat = cls[e.id];
        const fat = (String(e.descricao).match(/fatura nr\.?\s*(\d+)/i) || [])[1] || (g.invoiceNumber ? String(g.invoiceNumber) : null);
        const L = { id: e.id, data: e.data, descricao: e.descricao, valor: R2(v), cat, auto, manual: !!cls[e.id], contrato: ct, ql, linha, venc, pago, dias: d, obs, fatura: fat, payment: e.payment_id, sem_boleto: !e.pg };
        ent.push(L);
      } else {
        const ben = beneficiario(e.descricao), n = nm(ben);
        let cat, como = '';
        if (/FEE/.test(e.tipo || '') || /^taxa/i.test(e.descricao || '')) { cat = 'taxas'; como = 'taxa do Asaas'; }
        else if (regras[n]) { cat = regras[n]; como = 'nome já classificado antes'; }
        else { const r = REGRAS_FIXAS.find(([re]) => re.test(n)); cat = r ? r[1] : 'revisar'; como = r ? 'regra fixa' : DUVIDA.test(n) ? 'imposto da folha (Inerente) ou conta a pedido do André (FCA)?' : 'nome novo'; }
        const auto = cat;
        if (cls[e.id]) { cat = cls[e.id]; como = 'classificado por você'; }
        sai.push({ id: e.id, data: e.data, descricao: e.descricao, beneficiario: ben, valor: R2(v), cat, auto, como, duvida: DUVIDA.test(n), tipo: e.tipo });
      }
    }
    await custoDaParcela(ent.filter(x => ['mensal', 'anual', 'cobranca'].includes(x.cat)));
    for (const x of ent) {
      if ((x.cat === 'mensal' || x.cat === 'anual') && !x.manual && x.hon > 0.5) { x.cat = x.auto = 'cobranca'; x.obs = (x.obs ? x.obs + ' · ' : '') + 'Tem custo de cobrança lançado na parcela'; }
      if (x.cat !== 'cobranca') { delete x.hon; delete x.fca; }
      else if (x.sem_lancamento || x.hon == null) { x.fca = R2(x.valor / 1.1); x.hon = R2(x.valor - x.fca); x.provisorio = true; x.obs = (x.obs ? x.obs + ' · ' : '') + 'Pagamento ainda não lançado na parcela (valor ÷ 1,10 provisório)'; }
    }
    const soma = (L, f = x => x.valor) => R2(L.reduce((s, x) => s + f(x), 0));
    const E = {}; for (const k of Object.keys(CAT_E)) { const L = ent.filter(x => x.cat === k); E[k] = { rotulo: CAT_E[k], qtd: L.length, total: soma(L) }; }
    const cob = ent.filter(x => x.cat === 'cobranca'); E.cobranca.fca = soma(cob, x => x.fca); E.cobranca.hon = R2(E.cobranca.total - E.cobranca.fca);
    const totE = soma(ent);
    const S = {}; for (const k of Object.keys(CAT_S)) { const L = sai.filter(x => x.cat === k); S[k] = { rotulo: CAT_S[k][0], inerente: !!CAT_S[k][1], qtd: L.length, total: R2(-soma(L)) }; }
    const totS = R2(-soma(sai));
    const ajustes = M?.ajustes || [];
    const serv = [
      ['ADM de Carteira (Mensais)', R2(E.mensal.total * .06)], ['ADM de Carteira (Intermediárias)', R2(E.anual.total * .06)],
      ['ADM de Carteira (Cobrança)', R2(E.cobranca.fca * .06)], ['Cobrança (acima de 60 dias de atraso)', E.cobranca.hon], ['Contratos', R2(E.contrato.total * .2)],
      ...ajustes.filter(a => a.bloco === 'servicos').map(a => [a.descricao, R2(a.valor)])].map(([rotulo, valor]) => ({ rotulo, valor }));
    const totServ = soma(serv);
    let saldoAnt = M?.saldo_anterior, origemSaldo = 'informado por você';
    const [P] = await q(`select saldo, fechado_em from carteira.acerto_meses where mes=$1`, [mesAnt(mes)]);
    if (saldoAnt == null) { saldoAnt = P?.fechado_em ? +P.saldo : 0; origemSaldo = P?.fechado_em ? 'fechamento de ' + nomeMes(mesAnt(mes)) : 'mês anterior não fechado no sistema'; }
    saldoAnt = R2(saldoAnt);
    const ac = [{ rotulo: 'Serviços', valor: totServ },
      { rotulo: `Saldo anterior (${saldoAnt < 0 ? 'Inerente adiantou' : 'faltou FCA pagar'} · ${nomeMes(mesAnt(mes))})`, valor: saldoAnt, saldo: true },
      ...Object.keys(ROT_ACERTO).filter(k => S[k].total).map(k => ({ rotulo: ROT_ACERTO[k], valor: -S[k].total, cat: k })),
      ...ajustes.filter(a => a.bloco === 'acerto').map(a => ({ rotulo: a.descricao, valor: R2(a.valor) }))];
    const res = soma(ac);
    const andre = sai.filter(x => x.cat === 'andre').map(x => ({ data: x.data, valor: x.valor }));
    /* conferências */
    const conf = [];
    const saldos = ext.filter(e => e.saldo != null);
    if (saldos.length) {
      const ini = R2(+saldos[0].saldo - +saldos[0].valor), fimS = R2(+saldos[saldos.length - 1].saldo);
      conf.push({ ok: Math.abs(R2(ini + totE - totS) - fimS) < 0.02, t: 'Saldo da conta no Asaas', d: `Começou o mês com ${br(ini)}, entrou ${br(totE)}, saiu ${br(totS)} e terminou com ${br(fimS)}.` });
    }
    const semPg = ent.filter(x => x.sem_boleto);
    conf.push({ ok: !semPg.length, t: 'Recebimentos com o boleto identificado', d: semPg.length ? `${semPg.length} recebimento(s) sem o boleto do Asaas — clique em "Atualizar do Asaas".` : `Os ${ent.length} recebimentos têm o boleto identificado.` });
    if (P?.fechado_em && P.dados?.entradas) {
      const fa = new Set(P.dados.entradas.map(x => x.fatura).filter(Boolean)), rep = ent.filter(x => x.fatura && fa.has(x.fatura));
      const ia = new Set((P.dados.saidas || []).map(x => x.id)), rs = sai.filter(x => ia.has(x.id));
      conf.push({ ok: !rep.length && !rs.length, t: 'Emenda com o mês anterior', d: rep.length || rs.length ? `Repetidos do mês anterior: ${rep.map(x => x.fatura).concat(rs.map(x => x.descricao)).join(', ')}` : 'Nenhuma fatura nem saída repetida com o mês anterior.' });
    }
    const prov = ent.filter(x => x.provisorio);
    conf.push({ ok: !prov.length, t: 'Cobranças com o pagamento lançado na parcela', d: prov.length ? `Ainda sem lançamento na parcela (o custo de cobrança fica provisório até lançar): ${prov.map(x => `${x.contrato || ''} ${x.linha.slice(0, 50)} ${br(x.valor)}`).join(' · ')}` : 'Todas: o custo de cobrança é o mesmo que está na parcela.' });
    const r42 = ent.filter(x => x.obs && /dias de atraso/.test(x.obs));
    conf.push({ ok: true, t: 'Pagas com mais de 60 dias de atraso (vão para Cobrança)', d: r42.length ? r42.map(x => `${x.contrato || ''} ${x.linha} — ${x.dias} dias`).join(' · ') : 'Nenhuma.' });
    const fora = ent.filter(x => x.cat === 'mensal' && !/^\d+\s*\/\s*\d+$/.test(x.linha.trim()));
    conf.push({ ok: true, t: 'Mensais com descrição fora do padrão', d: fora.length ? fora.map(x => `${x.contrato || ''}: ${x.linha}`).join(' · ') : 'Nenhuma.' });
    const ks = {}; const dup = [];
    for (const x of ent) { if (!x.contrato || !/\d+\s*\/\s*\d+/.test(x.linha)) continue; const k = x.contrato + '|' + x.cat + '|' + x.linha.match(/\d+\s*\/\s*\d+/)[0].replace(/\s/g, ''); if (ks[k]) dup.push(k.replace(/\|/g, ' ')); ks[k] = 1; }
    conf.push({ ok: !dup.length, t: 'Parcela paga duas vezes no mês', d: dup.length ? dup.join(' · ') : 'Nenhuma.' });
    const ctMens = [...new Set(ent.filter(x => x.cat === 'mensal' && x.contrato).map(x => x.contrato))];
    if (ctMens.length) {
      const med = {}; for (const r of await q(`select t.contrato, percentile_cont(0.5) within group (order by g.valor_pago) m from carteira.pagamentos g join carteira.titulos t on t.id=g.titulo_id
                       where t.grupo='mensal' and t.contrato = any($1) and g.confirmada_em >= now() - interval '14 months' and g.valor_pago > 0 group by 1`, [ctMens])) med[r.contrato] = +r.m;
      const alto = ent.filter(x => x.cat === 'mensal' && med[x.contrato] && (x.valor / med[x.contrato] > 1.04)).map(x => `${x.contrato} ${x.linha}: ${br(x.valor)} (normal ${br(med[x.contrato])}${Math.abs(x.valor / 1.1 - med[x.contrato]) / med[x.contrato] < .01 ? ' — bate com 10% embutido' : ''})`);
      conf.push({ ok: true, t: 'Mensais acima do valor normal do contrato (pode ter honorário embutido)', d: alto.length ? alto.join(' · ') : 'Nenhuma.' });
    }
    const ac2 = ent.filter(x => x.cat === 'mensal' && acordos.has(x.contrato)).map(x => `${x.contrato} ${x.linha}`);
    conf.push({ ok: true, t: 'Mensais de contratos que têm acordo (conferir se não é parcela do acordo)', d: ac2.length ? ac2.join(' · ') : 'Nenhuma.' });
    const pend = ent.filter(x => x.cat === 'revisar').length + sai.filter(x => x.cat === 'revisar').length;
    /* comparativo */
    const H = {}; for (const h of await q(`select * from carteira.acerto_hist`)) H[h.mes] = h;
    const ano = mes.slice(0, 4), ma = mesAnt(mes), mano = (+ano - 1) + mes.slice(4);
    const atual = { recebido: totE, boletos: ent.length, mensais: E.mensal.total, anuais: E.anual.total, cobrancas: E.cobranca.total, entradas: E.entrada.total, contratos: E.contrato.total };
    const anoAte = Object.values(H).filter(h => h.mes.startsWith(ano) && h.mes < mes).reduce((s, h) => s + +h.recebido, 0) + totE;
    const anoAntAte = Object.values(H).filter(h => h.mes.startsWith(+ano - 1 + '') && h.mes <= mano).reduce((s, h) => s + +h.recebido, 0);
    const comp = { anterior: H[ma] ? { mes: ma, ...H[ma] } : null, atual, mesmo_mes_ano_passado: H[mano] ? { mes: mano, recebido: +H[mano].recebido } : null,
      ano: { total: R2(anoAte), meses: +mes.slice(5), media: R2(anoAte / +mes.slice(5)), ano_passado_ate: R2(anoAntAte) } };
    return { mes, periodo: [mes + '-01', ultimoDia(mes)], carregado_em: M?.carregado_em || null, fechado: false, fechado_fora: foraSis ? 'Este mês foi fechado fora do sistema (planilha), com saldo ' + br(+M.saldo) + '. Aqui é só para conferir.' : null, entradas: ent, saidas: sai,
      E, totE, S, totS, servicos: serv, totServ, acerto: ac, resultado: res, saldo_anterior: saldoAnt, origem_saldo: origemSaldo, caixa: R2(totE - totS), andre,
      ajustes, texto: M?.texto || '', conferencias: conf, pendentes: pend, comparativo: comp };
  }

  async function geraTexto(mes) {
    const key = (process.env.ANTHROPIC_API_KEY || '').trim().replace(/^["']|["']$/g, '');
    if (!key) return { erro: 'Falta a chave da inteligência artificial no Netlify.' };
    const A = await calcula(mes); const c = A.comparativo;
    const dados = { mes: nomeMes(mes), atual: c.atual, mes_anterior: c.anterior ? { mes: nomeMes(c.anterior.mes), recebido: +c.anterior.recebido, boletos: c.anterior.boletos, mensais: c.anterior.mensais, anuais: c.anterior.anuais, cobrancas: c.anterior.cobrancas, entradas: c.anterior.entradas } : null,
      mesmo_mes_ano_passado: c.mesmo_mes_ano_passado, acumulado_ano: c.ano,
      maiores_cobrancas: A.entradas.filter(x => x.cat === 'cobranca').sort((a, b) => b.valor - a.valor).slice(0, 5).map(x => ({ cliente: (x.descricao.match(/\d+\s+(.+)$/) || [])[1], valor: x.valor })),
      qtd_mensais: A.E.mensal.qtd, qtd_anuais: A.E.anual.qtd, qtd_cobrancas: A.E.cobranca.qtd };
    const prompt = `Escreva o quadro "Resumo do mês" do relatório de acerto da carteira do Condomínio Beira Rio, para o André (dono da carteira, FCA). Três parágrafos curtos (no máximo 3 frases cada), português do Brasil, tom direto e profissional. Fale SÓ dos recebimentos e do que explica a diferença em relação ao mês anterior e ao ano (composição: mensais, anuais/intermediárias, cobranças/acordos, entradas, cessões). Nunca fale do acerto da Inerente, dos serviços ou de saídas. Use valores em reais no formato R$ 1.234,56 e variações em %. Não invente nada além dos dados. Devolva só os três parágrafos separados por linha em branco.\n\nDADOS:\n${JSON.stringify(dados)}`;
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5', max_tokens: 900, messages: [{ role: 'user', content: prompt }] }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { erro: d.error?.message || 'IA respondeu ' + r.status };
    const texto = (d.content || []).map(x => x.text || '').join('').trim();
    await q(`insert into carteira.acerto_meses(mes, texto) values($1,$2) on conflict (mes) do update set texto=excluded.texto`, [mes, texto]);
    return { texto };
  }

  return async function rotasAcerto(p, m, body, real) {
    if (p[0] !== 'acerto') return null;
    if (real !== 'luis') return json({ erro: 'Só o administrador' }, 403);
    await garante();
    const mes = p[1];
    try {
      if (!mes && m === 'GET') {
        const ms = await q(`select mes, carregado_em, fechado_em, por, saldo from carteira.acerto_meses order by mes desc`);
        const hs = await q(`select * from carteira.acerto_hist order by mes desc`);
        return json({ meses: ms, hist: hs });
      }
      if (!/^\d{4}-\d{2}$/.test(mes || '')) return json({ erro: 'Mês inválido' }, 400);
      const [M] = await q(`select fechado_em, dados is not null tem from carteira.acerto_meses where mes=$1`, [mes]);
      const fechado = !!M?.fechado_em && M.tem;
      if (!p[2] && m === 'GET') return json(await calcula(mes));
      if (p[2] === 'reabrir' && m === 'POST') {
        await q(`update carteira.acerto_meses set fechado_em=null, dados=null where mes=$1`, [mes]);
        await log('luis', 'acerto_reaberto', { mes }); return json({ ok: true });
      }
      if (fechado) return json({ erro: 'Este mês já está fechado. Reabra para mexer.' }, 400);
      if (p[2] === 'carregar' && m === 'POST') {
        const prazo = Date.now() + 7000;
        const [E] = await q(`select count(*)::int n from carteira.acerto_extrato where mes=$1`, [mes]);
        let n = E.n;
        if (body.recomecar || !n) n = await carregaExtrato(mes);
        const falta = await carregaPagamentos(mes, prazo);
        return json({ lancamentos: n, falta });
      }
      if (p[2] === 'cls' && m === 'POST') {
        const { id, cat, lembrar } = body;
        if (!CAT_E[cat] && !CAT_S[cat]) return json({ erro: 'Categoria inválida' }, 400);
        const [e] = await q(`select descricao, valor from carteira.acerto_extrato where mes=$1 and id=$2`, [mes, id]);
        if (!e) return json({ erro: 'Lançamento não encontrado' }, 404);
        await q(`insert into carteira.acerto_cls(id, cat, por) values($1,$2,'luis') on conflict (id) do update set cat=excluded.cat, em=now()`, [id, cat]);
        if (lembrar && +e.valor < 0 && CAT_S[cat] && cat !== 'revisar') await q(`insert into carteira.acerto_regras(nome, cat) values($1,$2) on conflict (nome) do update set cat=excluded.cat, em=now()`, [nm(beneficiario(e.descricao)), cat]);
        return json({ ok: true });
      }
      if (p[2] === 'cls' && m === 'DELETE') { await q(`delete from carteira.acerto_cls where id=$1`, [p[3]]); return json({ ok: true }); }
      if (p[2] === 'ajustes' && m === 'POST') {
        const aj = (body.ajustes || []).filter(a => a && a.descricao && isFinite(+a.valor) && ['servicos', 'acerto'].includes(a.bloco)).map(a => ({ bloco: a.bloco, descricao: String(a.descricao).slice(0, 120), valor: R2(a.valor) }));
        const sa = body.saldo_anterior === '' || body.saldo_anterior == null ? null : R2(body.saldo_anterior);
        await q(`insert into carteira.acerto_meses(mes, ajustes, saldo_anterior, texto) values($1,$2,$3,$4)
                 on conflict (mes) do update set ajustes=excluded.ajustes, saldo_anterior=excluded.saldo_anterior, texto=coalesce(excluded.texto, carteira.acerto_meses.texto)`,
          [mes, JSON.stringify(aj), sa, body.texto ?? null]);
        return json({ ok: true });
      }
      if (p[2] === 'texto' && m === 'POST') return json(await geraTexto(mes));
      if (p[2] === 'fechar' && m === 'POST') {
        const A = await calcula(mes);
        if (A.pendentes) return json({ erro: `Ainda há ${A.pendentes} lançamento(s) a classificar.` }, 400);
        if (A.entradas.some(x => x.provisorio)) return json({ erro: 'Há cobrança paga que ainda não foi lançada na parcela. Lance o pagamento no contrato (ou espere o lançamento automático) e atualize.' }, 400);
        if (A.entradas.some(x => x.sem_boleto)) return json({ erro: 'Há recebimentos sem o boleto identificado. Clique em "Atualizar do Asaas".' }, 400);
        if (mes >= new Date().toISOString().slice(0, 7)) return json({ erro: 'O mês ainda não terminou.' }, 400);
        await q(`update carteira.acerto_meses set fechado_em=now(), por='luis', saldo=$2, dados=$3 where mes=$1`, [mes, A.resultado, JSON.stringify(A)]);
        await q(`insert into carteira.acerto_hist values($1,$2,$3,$4,$5,$6,$7,$8) on conflict (mes) do update set recebido=excluded.recebido, boletos=excluded.boletos, mensais=excluded.mensais,
                 anuais=excluded.anuais, cobrancas=excluded.cobrancas, entradas=excluded.entradas, contratos=excluded.contratos`,
          [mes, A.totE, A.entradas.length, A.E.mensal.total, A.E.anual.total, A.E.cobranca.total, A.E.entrada.total, A.E.contrato.total]);
        await log('luis', 'acerto_fechado', { mes, resultado: A.resultado, recebido: A.totE });
        return json({ ok: true });
      }
      return json({ erro: 'Rota não encontrada' }, 404);
    } catch (e) { return json({ erro: e.message }, 500); }
  };
}
