/* Consultas compartilhadas entre o assistente da tela e o MCP.
   As dependências são as funções atuais da carteira, sem copiar cálculos financeiros. */
export function criaConsultasIA({ q, normNome, fonesDoCliente, digF, clientesDoContrato, dividas, hojeBR, ATIVOS_B }) {
  const compradores = ct => Array.isArray(ct.compradores) ? ct.compradores : [];
  const nomeNaCessao = (nome, texto) => !!normNome(nome) && (` ${normNome(texto)} `).includes(` ${normNome(nome)} `);
  const compradorOriginal = (c, ct) => compradores(ct).some(x =>
    (c.cpf && digF(x.cpf) === c.cpf) || (normNome(c.nome) && normNome(x.nome) === normNome(c.nome)));
  const cessoesAtuais = async numero => q(`select distinct on (contrato) contrato, data::text data, dados->>'novos_titulares' nt
    from carteira.eventos where tipo='cessao' and conferente='luis' and coalesce(dados->>'novos_titulares','')<>''
    ${numero ? 'and contrato=$1' : ''} order by contrato, data desc nulls last, id desc`, numero ? [numero] : []);
  return async function ferramentaIA(nome, ent, pagina) {
  if (nome === 'buscar_clientes') {
    const t = String(ent.texto || ''), d = t.replace(/\D/g, ''), tk = normNome(t).split(' ').filter(x => x.length >= 3);
    const cl = await q(`select id, cpf, nome, planilha, asaas, manual from carteira.clientes`);
    const cts = await q(`select numero, compradores from carteira.contratos`);
    const cess = new Map((await cessoesAtuais()).map(e => [e.contrato, e]));
    const camp = new Set((await q(`select contrato from carteira.cobranca_casos where encerrado_em is null`)).map(x => x.contrato));
    const hits = cl.map(c => {
      const nn = normNome(c.nome), fs = fonesDoCliente(c), em = [(c.manual || {}).email, (c.asaas || {}).email, (c.planilha || {}).email].filter(Boolean).join(' ').toLowerCase();
      let pts = tk.filter(x => nn.split(' ').includes(x)).length; if (d.length >= 6 && ((c.cpf || '').includes(d) || fs.some(f => f.includes(d.slice(-8))))) pts += 5; if (t.includes('@') && em.includes(t.toLowerCase().trim())) pts += 5;
      return { c, pts, fs };
    }).filter(x => x.pts > 0).sort((a, b) => b.pts - a.pts).slice(0, 8);
    return hits.map(({ c, fs }) => {
      const vinculos = cts.flatMap(k => {
        const e = cess.get(k.numero), original = compradorOriginal(c, k);
        const atual = e ? nomeNaCessao(c.nome, e.nt) : original;
        return original || atual ? [{ numero: k.numero, titular_atual: atual, comprador_original: original, cessao_em: e?.data || null, na_cobranca: camp.has(k.numero) }] : [];
      });
      const ks = vinculos.map(k => k.numero + (k.cessao_em ? k.titular_atual ? ' (titular atual)' : ' (comprador original; titularidade transferida)' : '') + (k.na_cobranca ? ' (na cobrança)' : ''));
      return { nome: c.nome, cpf: c.cpf, telefones: [...new Set(fs)], email_atual: (c.manual || {}).email || (c.asaas || {}).email || (c.planilha || {}).email || null, outros_emails: [...new Set([(c.manual || {}).email, (c.asaas || {}).email, (c.planilha || {}).email].filter(Boolean))], endereco: (c.manual || {}).endereco || null, contratos: ks, vinculos_contratos: vinculos }; });
  }
  if (nome === 'ver_contrato') {
    const n = String(ent.numero || '').replace(/\D/g, '').padStart(4, '0');
    const [ct] = await q(`select numero, quadra, lote, compradores from carteira.contratos where numero=$1`, [n]);
    if (!ct) return { erro: 'Contrato não existe' };
    const [cessao] = await cessoesAtuais(n);
    const cs = cessao
      ? (await q(`select id, cpf, nome, planilha, asaas, manual from carteira.clientes`)).filter(c => nomeNaCessao(c.nome, cessao.nt))
      : await clientesDoContrato(n);
    const titular = cessao?.nt || compradores(ct).map(c => c.nome).filter(Boolean).join(' e ');
    const clientes = cs.map(c => ({ nome: c.nome, cpf: c.cpf, telefones: [...new Set(fonesDoCliente(c))], email_atual: (c.manual || {}).email || (c.asaas || {}).email || (c.planilha || {}).email || null }));
    // Uma cessão sem cadastro correspondente não autoriza usar os contatos do cedente.
    if (cessao && !clientes.length) clientes.push({ nome: titular, cpf: null, telefones: [], email_atual: null, cadastro_localizado: false });
    const d = (await dividas([n]))[n];
    const fut = await q(`select rotulo, vencimento::text v, valor_face from carteira.titulos t where contrato=$1 and conferente is null and grupo<>'acordo' and vencimento >= $2::date and not exists (select 1 from carteira.pagamentos g where g.titulo_id=t.id and g.conferente='luis') order by vencimento limit 5`, [n, hojeBR()]);
    const props = await q(`select dados->>'termo' termo, dados->>'valor_acordado' valor, jsonb_array_length(coalesce(dados->'parcelas','[]'::jsonb)) parcelas from carteira.propostas where contrato=$1 and conferente='luis'`, [n]);
    const acs = await q(`select a.termo, a.data_acordo::text data, a.valor_acordado, count(t.id)::int total, count(t.id) filter (where exists (select 1 from carteira.pagamentos g where g.titulo_id=t.id and g.conferente='luis'))::int pagas from carteira.acordos a join carteira.titulos t on t.acordo_id=a.id where a.contrato=$1 and a.conferente='luis' group by a.id order by a.id desc limit 5`, [n]);
    const [caso] = await q(`select id, etapa, proximo_contato::text px, criado_em::date::text entrou, ia_situacao from carteira.cobranca_casos where contrato=$1 and encerrado_em is null`, [n]);
    const regs = caso ? await q(`select em::date::text dia, tipo, resultado, left(texto, 200) texto from carteira.cobranca_registros where caso_id=$1 order by em desc limit 6`, [caso.id]) : [];
    const bols = await q(`select b.valor, b.vencimento::text v, b.tipo, t.rotulo from carteira.boletos b left join carteira.titulos t on t.id=b.titulo_id where b.contrato=$1 and b.status = any($2)`, [n, ATIVOS_B]);
    return { contrato: n, quadra: ct.quadra, lote: ct.lote, titular_atual: titular, cessao_atual: cessao ? { data: cessao.data, novos_titulares: cessao.nt } : null,
      compradores_originais: compradores(ct).map(c => ({ nome: c.nome, cpf: c.cpf || null })), clientes,
      em_atraso: { total: d?.total || 0, parcelas: (d?.parcelas || []).map(x => `${x.rotulo} venc. ${x.vencimento} (${x.dias} dias) R$ ${x.total}`) },
      proximas_a_vencer: fut.map(x => `${x.rotulo} venc. ${x.v} R$ ${x.valor_face}`), propostas_pendentes: props, acordos: acs, boletos_em_aberto: bols.map(b => `${b.rotulo || b.tipo} venc. ${b.v} R$ ${b.valor}`),
      cobranca: caso ? { etapa: caso.etapa, proximo_contato: caso.px, entrou: caso.entrou, situacao_ia: caso.ia_situacao, ultimos_registros: regs } : 'não está na campanha de cobrança' };
  }
  if (nome === 'casos_cobranca') {
    const cs = await q(`select contrato, etapa, proximo_contato::text px from carteira.cobranca_casos where encerrado_em is null order by contrato`);
    const D = await dividas(cs.map(c => c.contrato));
    return cs.map(c => ({ contrato: c.contrato, cliente: D[c.contrato]?.titular || '', etapa: c.etapa, divida: D[c.contrato]?.total || 0, proximo_contato: c.px }));
  }
  return { erro: 'ferramenta desconhecida' };
};
}
