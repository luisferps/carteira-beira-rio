/* Documentos do contrato e dos compradores: checklist (tem / falta) e arquivos anexados. */
import { destinoArquivo } from './onedrive-lib.mjs';
export const ITENS_CONTRATO = [['contrato_assinado', 'Contrato assinado'], ['firma', 'Firma reconhecida em cartório'], ['testemunhas', 'Testemunhas assinaram'], ['proposta', 'Proposta']];
const VALIDACAO_ASSINATURA = ['contrato_validacao_assinatura', 'Validação da assinatura eletrônica'];
export const ITENS_PESSOA = [['rg', 'RG ou CNH'], ['cpf', 'CPF'], ['endereco', 'Comprovante de endereço'], ['estado_civil', 'Certidão de estado civil']];
const itensPessoa = fonte => fonte === 'emissão pelo sistema' ? ITENS_PESSOA.filter(([k]) => k !== 'estado_civil') : ITENS_PESSOA;
export const chaveRascunhoCompra = id => typeof id === 'string' && /^[\da-f-]{36}$/i.test(id) ? 'compra-rascunho:' + id : null;
export function preparaArquivoOneDrive(q) {
  return async b => {
    const {contrato,rascunho,chave,nome}=b;
    if (!/^\d{4}$/.test(contrato) || typeof chave!=='string' || typeof nome!=='string' || nome.length>240)
      throw Object.assign(new Error('Dados do anexo incompletos.'),{status:400});
    const parte=/^p([0-3])_/.exec(chave);
    let dados;
    if (rascunho) {
      if (!chaveRascunhoCompra(rascunho) || !/^\d{1,3}$/.test(b.imovel?.quadra) || !/^\d{1,3}[a-z]?$/i.test(b.imovel?.lote))
        throw Object.assign(new Error('Quadra e lote inválidos.'),{status:400});
      dados=b.imovel;
    } else {
      [dados]=await q('select quadra,lote,compradores from carteira.contratos where numero=$1',[contrato]);
      if(!dados) throw Object.assign(new Error('Contrato não encontrado.'),{status:404});
    }
    const comprador=rascunho ? (parte ? dados.comprador : null) : dados.compradores?.[parte?+parte[1]:0]?.nome;
    const destino=destinoArquivo({chave,nome,numero:contrato,quadra:dados.quadra,lote:dados.lote,comprador});
    return {destino,contexto:{contrato,rascunho:rascunho||null,chave,nome}};
  };
}
export function criaDocumentos({ q, json, log, verificaTermo, infoCadeia, onedrive }) {
  let ok = false;
  async function garante() {
    if (ok) return;
    await q(`create table if not exists carteira.documentos(id serial primary key, contrato text not null, chave text not null, nome text, mime text, tamanho int, b64 text not null, por text, enviado_em timestamptz default now())`);
    await q(`alter table carteira.documentos add column if not exists verificacao jsonb`).catch(() => null);
    await q(`create table if not exists carteira.doc_check(contrato text not null, chave text not null, status text, obs text, por text, em timestamptz default now(), primary key(contrato, chave))`);
    ok = true;
  }
  return async function rotasDocumentos(p, m, body, real, url, ator = real) {
    if (p[0] !== 'documentos' && p[0] !== 'documento') return null;
    if (!['luis', 'assistente'].includes(real)) return json({ erro: 'Sem permissão' }, 403);
    await garante();
    try {
      if (p[0] === 'documentos' && p[1] === 'pendencias' && m === 'GET') {
        const cts = await q(`select c.numero, c.quadra, c.lote, c.compradores, c.fonte from carteira.contratos c
                             where not exists (select 1 from carteira.eventos e where e.contrato=c.numero and e.tipo='encerramento' and e.conferente='luis') order by c.numero`);
        const ck = await q(`select contrato, chave, status from carteira.doc_check`);
        const ar = await q(`select contrato, chave, count(*)::int n, bool_or(verificacao->>'inclui_cpf'='true') inclui_cpf
          from carteira.documentos group by 1,2`);
        const K = {}; for (const x of ck) K[x.contrato + '|' + x.chave] = x.status;
        const A = {}; for (const x of ar) {
          A[x.contrato + '|' + x.chave] = x.n;
          if (x.inclui_cpf) A[x.contrato + '|' + x.chave.replace(/_rg$/,'_cpf')] = x.n;
        }
        const out = cts.map(c => {
          const pes = (Array.isArray(c.compradores) ? c.compradores : []).map((x, i) => ({ i, nome: x.nome }));
          const chaves = [...ITENS_CONTRATO.map(([k, l]) => ({ k, l })), ...pes.flatMap(pp => itensPessoa(c.fonte).map(([k, l]) => ({ k: `p${pp.i}_${k}`, l: `${l} — ${pp.nome}` })))];
          const falta = chaves.filter(x => !(K[c.numero + '|' + x.k] === 'ok' || A[c.numero + '|' + x.k]) && K[c.numero + '|' + x.k] !== 'dispensado');
          return { contrato: c.numero, quadra: c.quadra, lote: c.lote, titular: pes.map(x => x.nome).join(' e '), total: chaves.length, falta: falta.map(x => x.l), marcados: chaves.filter(x => K[c.numero + '|' + x.k] || A[c.numero + '|' + x.k]).length };
        });
        return json(out);
      }
      if (p[0] === 'documentos' && m === 'GET' && p[1] !== 'cadeia') {
        const n = url.searchParams.get('contrato');
        const [c] = await q(`select numero, compradores, fonte from carteira.contratos where numero=$1`, [n]);
        if (/^(compra-rascunho|venda-excluida):/.test(n || '')) return json({ erro:'Contrato não encontrado' }, 404);
        const arquivos = await q(`select id, chave, nome, mime, tamanho, por, enviado_em, verificacao from carteira.documentos where contrato=$1 order by enviado_em`, [n]);
        const itens_contrato = [...ITENS_CONTRATO];
        itens_contrato.splice(1, 0, VALIDACAO_ASSINATURA);
        if (arquivos.some(a => a.chave === 'contrato_minuta')) itens_contrato.push(['contrato_minuta','Minuta emitida em Word']);
        if (arquivos.some(a => a.chave === 'contrato_minuta_pdf')) itens_contrato.push(['contrato_minuta_pdf','Contrato retificado em PDF']);
        if (arquivos.some(a => a.chave === 'outro')) itens_contrato.push(['outro','Outros anexos']);
        if (arquivos.some(a => a.chave === 'pacote_original')) itens_contrato.push(['pacote_original','PDF original do envio']);
        for(const a of arquivos.filter(x=>/^termo_(word|pdf)_/.test(x.chave)))
          if(!itens_contrato.some(([k])=>k===a.chave)) itens_contrato.push([a.chave,'Termo '+a.chave.split('_').slice(2).join('_')+(a.chave.startsWith('termo_pdf')?' (PDF)':' (Word)')]);
        return json({ itens_contrato, itens_pessoa: itensPessoa(c?.fonte), pessoas: (Array.isArray(c?.compradores) ? c.compradores : []).map((x, i) => ({ i, nome: x.nome })),
          check: await q(`select chave, status, obs, por, em from carteira.doc_check where contrato=$1`, [n]),
          arquivos });
      }
      if (p[0] === 'documentos' && p[1] === 'importar' && m === 'POST') {
        /* planilha "Controle de Documentos": linhas por quadra e lote; marca só o que ainda não tem marcação */
        if (real !== 'luis') return json({ erro: 'Só o administrador' }, 403);
        const cts = await q(`select c.numero, c.quadra, c.lote from carteira.contratos c where not exists (select 1 from carteira.eventos e where e.contrato=c.numero and e.tipo='encerramento' and e.conferente='luis')`);
        const porLote = {}; for (const c of cts) (porLote[(+c.quadra) + '-' + (+c.lote)] = porLote[(+c.quadra) + '-' + (+c.lote)] || []).push(c.numero);
        let marcados = 0; const sem = [];
        for (const r of body.linhas || []) {
          const ns = porLote[(+r.quadra) + '-' + (+r.lote)] || []; if (ns.length !== 1) { sem.push(r.quadra + '/' + r.lote); continue; }
          for (const k of r.ok || []) { if (body.previa) { marcados++; continue; }
            const x = await q(`insert into carteira.doc_check(contrato, chave, status, obs, por) values ($1,$2,'ok','planilha Controle de Documentos',$3) on conflict do nothing returning chave`, [ns[0], k, real]); marcados += x.length; }
          if (r.obs && !body.previa) await q(`insert into carteira.doc_check(contrato, chave, status, obs, por) values ($1,'obs_planilha','nota',$2,$3) on conflict (contrato, chave) do update set obs=excluded.obs`, [ns[0], r.obs, real]);
        }
        if (!body.previa) await log(real, 'documentos_importados', { marcados, sem });
        return json({ marcados, sem_contrato_unico: sem });
      }
      if (p[0] === 'documentos' && p[1] === 'check' && m === 'PUT') {
        const b = body;
        if (!b.status) await q(`delete from carteira.doc_check where contrato=$1 and chave=$2`, [b.contrato, b.chave]);
        else await q(`insert into carteira.doc_check(contrato, chave, status, obs, por) values ($1,$2,$3,$4,$5) on conflict (contrato, chave) do update set status=excluded.status, obs=excluded.obs, por=excluded.por, em=now()`, [b.contrato, b.chave, b.status, b.obs || null, real]);
        return json({ ok: true });
      }
      if (p[0] === 'documento' && !p[1] && m === 'POST') {
        const b = body; if (!b.contrato || !b.chave || (!b.b64 && !b.onedrive)) return json({ erro: 'Arquivo incompleto' }, 400);
        if (b.chave === 'contrato_minuta' && !b.rascunho)
          return json({erro:'Use a emissão ou a revisão de compra e venda para guardar esta minuta.'},409);
        if (b.chave === 'contrato_minuta_pdf' && (real !== 'luis' || !b.rascunho || b.contrato !== '0252'))
          return json({erro:'Envie o PDF pela retificação da venda.'},409);
        const cloud = b.onedrive ? await onedrive.confirmaArquivo(b.onedrive.ticket,b.onedrive.id,ator,
          {contrato:b.contrato,rascunho:b.rascunho||null,chave:b.chave,nome:b.nome}) : null;
        if (!cloud && await onedrive?.temConexao()) return json({erro:'Envie o arquivo pelo OneDrive.'},409);
        const bin = cloud ? '' : b.b64;
        const tam = cloud?.tamanho || Math.round(bin.length * 3 / 4);
        if (!cloud && tam > 4.2e6) return json({ erro: 'Arquivo grande demais (máximo 4 MB)' }, 400);
        if (!b.rascunho && /^(compra-rascunho|venda-excluida):/.test(String(b.contrato))) return json({ erro:'Destino inválido' },400);
        let r, metadata = cloud ? {onedrive:cloud} : null;
        const destino = b.rascunho ? chaveRascunhoCompra(b.rascunho) : b.contrato;
        if (b.rascunho) {
          const parte = /^p([0-3])_(rg|cpf|endereco|outro)$/.exec(b.chave);
          if (!destino || !/^\d{4}$/.test(b.contrato) || !(parte || ['proposta','contrato_minuta','contrato_minuta_pdf','outro','pacote_original'].includes(b.chave)))
            return json({ erro:'O anexo não corresponde a esta venda.' }, 400);
          metadata = {...metadata,numero:b.contrato, inclui_cpf:!!(b.inclui_cpf && parte?.[2] === 'rg')};
          [r] = await q(`select id from carteira.documentos where contrato=$1 and chave=$2 and nome=$3 and b64=$4 and verificacao=$5 and por=$6 limit 1`,
            [destino,b.chave,b.nome,bin,metadata,ator]);
          if (b.chave === 'contrato_minuta')
            await q(`delete from carteira.documentos where contrato like 'compra-rascunho:%' and enviado_em < now() - interval '1 day'`);
        }
        if (cloud && !r) [r]=await q(`select id from carteira.documentos where contrato=$1 and chave=$2 and verificacao->'onedrive'->>'id'=$3 limit 1`,[destino,b.chave,cloud.id]);
        if (!r) {
          [r] = await q(`insert into carteira.documentos(contrato, chave, nome, mime, tamanho, b64, por, verificacao) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`, [destino, b.chave, b.nome || null, b.mime || cloud?.mime || null, tam, bin, b.rascunho ? ator : real, metadata]);
          if (!b.rascunho) await log(real, 'documento_anexado', { contrato: b.contrato, chave: b.chave, nome:b.nome });
        }
        let verificacao = null;
        if (verificaTermo && String(b.chave).startsWith('termo_assinado_') && (/pdf/i.test(b.mime || '') || /\.pdf$/i.test(b.nome || ''))) {
          verificacao = await Promise.resolve().then(async()=>verificaTermo(b.contrato, cloud?await onedrive.lerBytes(cloud):bin,b.chave)).catch(e => ({ status: 'erro', erro: e.message }));
          await q(`update carteira.documentos set verificacao=$2 where id=$1`, [r.id, {...metadata,...verificacao}]);
        }
        return json({ ...r, verificacao });
      }
      if (p[0] === 'documento' && p[1] && p[2] === 'verificacao') {
        const [d] = await q(`select id, contrato, chave, nome, mime, b64, verificacao from carteira.documentos
          where id=$1 and contrato not like 'compra-rascunho:%' and contrato not like 'venda-excluida:%'`, [p[1]]); if (!d) return json({ erro: 'Não encontrado' }, 404);
        if (d.verificacao && m === 'GET' && !url.searchParams.get('refaz')) return json(d.verificacao);
        if (!(/pdf/i.test(d.mime || '') || /\.pdf$/i.test(d.nome || ''))) return json({ status: 'nao_pdf' });
        const ref=d.verificacao?.onedrive;
        const v = await Promise.resolve().then(async()=>verificaTermo(d.contrato,ref?await onedrive.lerBytes(ref):d.b64,d.chave)).catch(e => ({ status: 'erro', erro: e.message }));
        await q(`update carteira.documentos set verificacao=$2 where id=$1`, [d.id, {...d.verificacao,...v}]); return json(v);
      }
      /* liga os arquivos que já estão no OneDrive aos contratos, sem copiar nada para o banco: guarda só a referência.
         etapas: contratos (Contratos/Assinados), propostas (Propostas), compradores (Compradores/<nome>, em lotes) */
      if (p[0] === 'documentos' && p[1] === 'ligar-onedrive' && m === 'POST') {
        if (real !== 'luis') return json({ erro: 'Só o administrador' }, 403);
        if (!onedrive?.listarFilhos || !(await onedrive.temConexao())) return json({ erro: 'Conecte o OneDrive em Documentos primeiro.' }, 409);
        const sem = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
        const cts = await q(`select numero, quadra, lote, compradores from carteira.contratos`);
        const ja = new Set((await q(`select verificacao->'onedrive'->>'id' id from carteira.documentos where verificacao ? 'onedrive'`)).map(x => x.id));
        const novos = [], ignorados = [];
        const liga = async (contrato, chave, drive, x) => {
          if (ja.has(x.id + '|' + contrato + '|' + chave) || (await q(`select 1 from carteira.documentos where contrato=$1 and chave=$2 and verificacao->'onedrive'->>'id'=$3`, [contrato, chave, x.id])).length) return;
          ja.add(x.id + '|' + contrato + '|' + chave);
          await q(`insert into carteira.documentos(contrato, chave, nome, mime, tamanho, b64, por, verificacao) values ($1,$2,$3,$4,$5,'',$6,$7)`,
            [contrato, chave, x.nome, x.mime, x.tamanho, 'onedrive (ligado)', { onedrive: { drive, id: x.id, nome: x.nome, tamanho: x.tamanho, mime: x.mime }, ligado: true }]);
          novos.push(contrato + ' · ' + chave + ' · ' + x.nome);
        };
        const nums = new Set(cts.map(c => c.numero));
        const etapa = body.etapa || 'contratos';
        if (etapa === 'contratos') {
          const { drive, itens } = await onedrive.listarFilhos(['Contratos', 'Assinados']);
          for (const x of itens.filter(i => !i.pasta)) {
            const n = (/^(\d{4})\b/.exec(x.nome) || [])[1];
            if (!n || !nums.has(n)) { ignorados.push(x.nome); continue; }
            await liga(n, /valida[cç][aã]o/i.test(x.nome) ? 'contrato_validacao_assinatura' : 'contrato_assinado', drive, x);
          }
          return json({ etapa, novos, ignorados });
        }
        if (etapa === 'propostas') {
          const { drive, itens } = await onedrive.listarFilhos(['Propostas']);
          const porQL = {}; for (const c of cts) { const k = (+c.quadra) + '-' + String(c.lote).replace(/^0+/, '').toUpperCase(); (porQL[k] = porQL[k] || []).push(c.numero); }
          for (const x of itens.filter(i => !i.pasta)) {
            const n = (/^(\d{4})\b/.exec(x.nome) || [])[1];
            if (n && nums.has(n)) { await liga(n, 'proposta', drive, x); continue; }
            const m2 = /Q\s*D?\s*0*(\d{1,2})\s*L\s*T?\s*0*(\d{1,3})/i.exec(x.nome);
            const cs = m2 ? porQL[(+m2[1]) + '-' + m2[2]] || [] : [];
            /* lote vendido mais de uma vez: sem letra é a 1ª venda (contrato mais antigo), "B" a 2ª, "C" a 3ª */
            const suf = (/L\s*T?\s*\d{1,3}\s*[-_ ]?\s*([BC])\b/i.exec(x.nome) || [])[1];
            const idx = suf ? (suf.toUpperCase() === 'B' ? 1 : 2) : 0;
            const ord = [...cs].sort(); const ix = Math.min(idx, ord.length - 1);
            if (ix >= 0 && ord[ix]) await liga(ord[ix], 'proposta', drive, x); else ignorados.push(x.nome + (cs.length ? ' (não sei de qual contrato: ' + cs.join(', ') + ')' : ' (nenhum contrato com essa quadra e lote)'));
          }
          return json({ etapa, novos, ignorados });
        }
        if (etapa === 'compradores') {
          const { drive, itens } = await onedrive.listarFilhos(['Compradores']);
          const pastas = itens.filter(i => i.pasta).sort((a, b) => a.nome.localeCompare(b.nome));
          const de = Math.max(0, +body.de || 0), ate = Math.min(pastas.length, de + Math.min(25, Math.max(1, +body.lote || 8)));
          const pessoa = {}; for (const c of cts) (Array.isArray(c.compradores) ? c.compradores : []).forEach((k, i) => { const s = sem(k.nome); if (s) (pessoa[s] = pessoa[s] || []).push({ n: c.numero, i }); });
          const tipo = nome => { const s = sem(nome);
            if (/\b(RG|CNH|IDENTIDADE|HABILITACAO|DOCUMENTO PESSOAL|DOC PESSOAL)\b/.test(s)) return 'rg';
            if (/\bCPF\b/.test(s)) return 'cpf';
            if (/(ENDERECO|COMPROVANTE DE RES|RESIDENCIA|CONTA DE (LUZ|AGUA|ENERGIA)|FATURA)/.test(s)) return 'endereco';
            if (/(CERTIDAO|CASAMENTO|NASCIMENTO|ESTADO CIVIL|DIVORCIO|AVERBACAO|UNIAO ESTAVEL)/.test(s)) return 'estado_civil';
            return 'outro'; };
          for (const f of pastas.slice(de, ate)) {
            const quem = pessoa[sem(f.nome)] || [];
            if (!quem.length) { ignorados.push('pasta sem comprador no sistema: ' + f.nome); continue; }
            const { itens: arqs } = await onedrive.listarFilhos(['Compradores', f.nome]);
            for (const x of arqs.filter(i => !i.pasta)) {
              const t = tipo(x.nome);
              for (const w of quem) await liga(w.n, `p${w.i}_${t}`, drive, x);
            }
          }
          return json({ etapa, novos, ignorados, de, ate, total: pastas.length, fim: ate >= pastas.length });
        }
        return json({ erro: 'Etapa inválida' }, 400);
      }
      if (p[0] === 'documentos' && p[1] === 'cadeia' && m === 'GET' && infoCadeia) return json(await infoCadeia());
      if (p[0] === 'documento' && p[1] && m === 'GET') {
        const [r] = await q(`select nome,mime,b64,verificacao->'onedrive' onedrive from carteira.documentos
          where id=$1 and contrato not like 'compra-rascunho:%' and contrato not like 'venda-excluida:%'`, [p[1]]);
        if(!r)return json({erro:'Não encontrado'},404);
        if(r.onedrive){const res=json(await onedrive.abrirRef(r.onedrive));res.headers.set('Cache-Control','no-store');return res;}
        return json({nome:r.nome,mime:r.mime,b64:r.b64});
      }
      if (p[0] === 'documento' && p[1] && m === 'DELETE') {
        const [apagado] = await q(`delete from carteira.documentos where id=$1 and contrato not like 'compra-rascunho:%'
          and contrato not like 'venda-excluida:%'
          and chave not in ('contrato_minuta','contrato_minuta_pdf') returning id`, [p[1]]);
        if (!apagado) return json({erro:'Documento inexistente ou minuta protegida pelo histórico da venda.'},409);
        await log(real, 'documento_apagado', { id:p[1] });
        return json({ok:true});
      }
      return json({ erro: 'Rota não encontrada' }, 404);
    } catch (e) { return json({ erro: e.message }, e.status || 500); }
  };
}
