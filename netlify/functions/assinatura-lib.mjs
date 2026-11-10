/* Conferência das assinaturas digitais de um PDF (gov.br e ICP-Brasil), no padrão do validador do ITI:
   1) o documento não foi alterado depois de assinado (resumo do arquivo × assinatura);
   2) o certificado de quem assinou vem da cadeia oficial (gov.br ou ICP-Brasil) — a raiz é conferida pela impressão digital;
   3) quem assinou (nome e CPF) e quando. */
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import RAIZES_ICP from './raizes-icp.mjs';

pkijs.setEngine('node', new pkijs.CryptoEngine({ name: 'node', crypto: crypto.webcrypto }));

/* impressão digital (SHA-256) da raiz do gov.br — "AC Raiz do Governo Federal do Brasil v1" */
export const RAIZ_GOVBR_SHA256 = (process.env.RAIZ_GOVBR_SHA256 || '').toLowerCase().replace(/[^0-9a-f]/g, '');
const fp = der => crypto.createHash('sha256').update(Buffer.from(der)).digest('hex');
const ab = b => { const u = new Uint8Array(b); return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength); };
const certDe = der => new pkijs.Certificate({ schema: asn1js.fromBER(ab(der)).result });
const derDe = c => Buffer.from(c.toSchema(true).toBER(false));
const nomeDN = n => (n?.typesAndValues || []).map(t => t.type + '=' + String(t.value?.valueBlock?.value ?? '')).join(',');
const cnDe = n => String((n?.typesAndValues || []).find(t => t.type === '2.5.4.3')?.value?.valueBlock?.value || '');

const RAIZES = RAIZES_ICP.map(r => { try { const der = Buffer.from(r.der, 'base64'); return { nome: r.nome, cert: certDe(der), sha256: fp(der), tipo: 'ICP-Brasil' }; } catch (e) { return null; } }).filter(Boolean);

/* cadeia do gov.br (AC Final, AC Intermediária, AC Raiz) — baixada do repositório do ITI e guardada no banco */
let CADEIA_GOVBR = null;
async function cadeiaGovBr(q) {
  if (CADEIA_GOVBR) return CADEIA_GOVBR;
  await q(`create table if not exists carteira.cadeia_certificados(nome text primary key, der text not null, sha256 text, baixado_em timestamptz default now())`).catch(() => null);
  let L = await q(`select nome, der from carteira.cadeia_certificados where nome like 'govbr:%'`).catch(() => []);
  if (!L.length) {
    for (const u of ['https://repo.iti.br/docs/Cadeia_GovBr-der.p7b', 'http://repo.iti.br/docs/Cadeia_GovBr-der.p7b']) {
      try {
        const r = await fetch(u, { signal: AbortSignal.timeout(8000) }); if (!r.ok) continue;
        const sd = new pkijs.SignedData({ schema: new pkijs.ContentInfo({ schema: asn1js.fromBER(await r.arrayBuffer()).result }).content });
        for (const c of sd.certificates || []) { const der = derDe(c); await q(`insert into carteira.cadeia_certificados(nome, der, sha256) values ($1,$2,$3) on conflict (nome) do nothing`, ['govbr:' + cnDe(c.subject), der.toString('base64'), fp(der)]); }
        L = await q(`select nome, der from carteira.cadeia_certificados where nome like 'govbr:%'`); break;
      } catch (e) { }
    }
  }
  CADEIA_GOVBR = L.map(x => { const der = Buffer.from(x.der, 'base64'); return { cert: certDe(der), sha256: fp(der), nome: x.nome.slice(6) }; });
  return CADEIA_GOVBR;
}
/* ACs intermediárias da ICP-Brasil (pacote oficial do ITI). Só servem se encadearem até uma raiz conferida pela impressão digital. */
let INTER_ICP = null;
function unzip(buf) {
  const out = []; let i = buf.length - 22; while (i >= 0 && buf.readUInt32LE(i) !== 0x06054b50) i--; if (i < 0) return out;
  let p = buf.readUInt32LE(i + 16); const n = buf.readUInt16LE(i + 10);
  for (let k = 0; k < n; k++) {
    const met = buf.readUInt16LE(p + 10), csz = buf.readUInt32LE(p + 20), fl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const nome = buf.subarray(p + 46, p + 46 + fl).toString('latin1'); p += 46 + fl + el + cl;
    const lf = buf.readUInt16LE(off + 26), le = buf.readUInt16LE(off + 28); const dados = buf.subarray(off + 30 + lf + le, off + 30 + lf + le + csz);
    try { out.push({ nome, dados: met === 8 ? zlib.inflateRawSync(dados) : dados }); } catch (e) { }
  }
  return out;
}
async function intermediariasIcp(q) {
  if (INTER_ICP) return INTER_ICP;
  await q(`create table if not exists carteira.cadeia_certificados(nome text primary key, der text not null, sha256 text, baixado_em timestamptz default now())`).catch(() => null);
  let L = await q(`select nome, der from carteira.cadeia_certificados where nome like 'icp:%'`).catch(() => []);
  if (!L.length) {
    for (const u of ['https://acraiz.icpbrasil.gov.br/credenciadas/CertificadosAC-ICP-Brasil/ACcompactado.zip', 'http://acraiz.icpbrasil.gov.br/credenciadas/CertificadosAC-ICP-Brasil/ACcompactado.zip']) {
      try {
        const r = await fetch(u, { signal: AbortSignal.timeout(9000) }); if (!r.ok) continue;
        for (const f of unzip(Buffer.from(await r.arrayBuffer()))) {
          let der = f.dados; const t = der.toString('latin1'); if (t.includes('-----BEGIN')) der = Buffer.from(t.replace(/-----[^-]+-----|\s/g, ''), 'base64');
          try { const c = certDe(der); await q(`insert into carteira.cadeia_certificados(nome, der, sha256) values ($1,$2,$3) on conflict (nome) do nothing`, ['icp:' + f.nome, der.toString('base64'), fp(der)]); } catch (e) { }
        }
        L = await q(`select nome, der from carteira.cadeia_certificados where nome like 'icp:%'`); break;
      } catch (e) { }
    }
  }
  INTER_ICP = L.map(x => { try { return { cert: certDe(Buffer.from(x.der, 'base64')) }; } catch (e) { return null; } }).filter(Boolean);
  return INTER_ICP;
}
export async function infoCadeiaGovBr(q) { return (await cadeiaGovBr(q)).map(x => ({ nome: x.nome, sha256: x.sha256, raiz: nomeDN(x.cert.subject) === nomeDN(x.cert.issuer) })); }

/* CPF: no gov.br e no e-CPF vem no "outro nome" 2.16.76.1.3.1 (data de nascimento 8 dígitos + CPF 11 dígitos …) */
function cpfDe(cert) {
  const san = (cert.extensions || []).find(e => e.extnID === '2.5.29.17');
  for (const n of san?.parsedValue?.altNames || []) {
    if (n.type !== 0) continue;
    try {
      const v = n.value; const oid = v.valueBlock.value[0].valueBlock.toString();
      if (oid !== '2.16.76.1.3.1') continue;
      let x = v.valueBlock.value[1]; while (x?.valueBlock?.value && Array.isArray(x.valueBlock.value) && x.valueBlock.value[0]?.valueBlock) x = x.valueBlock.value[0];
      const raw = x?.valueBlock?.valueHexView ? Buffer.from(x.valueBlock.valueHexView).toString('latin1') : String(x?.valueBlock?.value || '');
      const d = raw.replace(/\D/g, ''); if (d.length >= 19) return d.slice(8, 19);
    } catch (e) { }
  }
  const cn = cnDe(cert.subject).match(/:(\d{11})\b/); return cn ? cn[1] : null;
}

async function confereCadeia(signer, extras, q) {
  const gov = await cadeiaGovBr(q).catch(() => []);
  const icp = /Governo Federal/i.test(cnDe(signer.issuer)) ? [] : await intermediariasIcp(q).catch(() => []);
  const pool = [...extras.map(c => ({ cert: c })), ...gov, ...RAIZES, ...icp];
  let cur = signer, passos = [];
  for (let i = 0; i < 8; i++) {
    const autoassinado = nomeDN(cur.subject) === nomeDN(cur.issuer);
    if (autoassinado) {
      const h = fp(derDe(cur)); const icp = RAIZES.find(r => r.sha256 === h);
      const govRaiz = gov.find(g => g.sha256 === h);
      if (icp) return { ok: true, tipo: 'ICP-Brasil', raiz: icp.nome, passos };
      if (govRaiz && (!RAIZ_GOVBR_SHA256 || RAIZ_GOVBR_SHA256 === h)) return { ok: true, tipo: 'gov.br', raiz: govRaiz.nome, passos };
      return { ok: false, motivo: 'A raiz da cadeia não é a do gov.br nem a da ICP-Brasil', passos };
    }
    const cand = pool.filter(p => nomeDN(p.cert.subject) === nomeDN(cur.issuer));
    let achou = null;
    for (const c of cand) { try { if (await cur.verify(c.cert)) { achou = c.cert; break; } } catch (e) { } }
    if (!achou) return { ok: false, motivo: `Não encontrei o certificado de quem emitiu (${cnDe(cur.issuer)})`, passos };
    passos.push(cnDe(achou.subject)); cur = achou;
  }
  return { ok: false, motivo: 'Cadeia longa demais', passos };
}

export async function verificaPdf(buf, q) {
  buf = Buffer.from(buf); const s = buf.toString('latin1');
  const re = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g; const out = []; let m;
  while ((m = re.exec(s))) {
    const [a, b, c, d] = m.slice(1).map(Number); const r = { ok: false };
    try {
      const hex = s.slice(a + b + 1, c - 1).replace(/[^0-9a-fA-F]/g, '');
      const sd = new pkijs.SignedData({ schema: new pkijs.ContentInfo({ schema: asn1js.fromBER(ab(Buffer.from(hex, 'hex'))).result }).content });
      const dados = Buffer.concat([buf.subarray(a, a + b), buf.subarray(c, c + d)]);
      const v = await sd.verify({ signer: 0, data: ab(dados), checkChain: false, extendedMode: true }).catch(e => ({ signatureVerified: false, message: e?.message || String(e) }));
      const cert = v.signerCertificate || (sd.certificates || [])[0];
      r.integra = !!v.signatureVerified;
      r.fim = c + d;
      if (cert) {
        r.nome = cnDe(cert.subject).replace(/:\d{11,14}$/, '').trim(); r.cpf = cpfDe(cert); r.emissor = cnDe(cert.issuer);
        r.validade = { de: cert.notBefore.value.toISOString().slice(0, 10), ate: cert.notAfter.value.toISOString().slice(0, 10) };
      }
      const st = (sd.signerInfos[0].signedAttrs?.attributes || []).find(x => x.type === '1.2.840.113549.1.9.5');
      let quando = st?.values?.[0]?.toDate ? st.values[0].toDate() : null;
      if (!quando) { const mm = s.slice(Math.max(0, m.index - 3000), m.index + 3000).match(/\/M\s*\(D:(\d{14})/); if (mm) { const t = mm[1]; quando = new Date(`${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(8, 10)}:${t.slice(10, 12)}:${t.slice(12, 14)}-03:00`); } }
      r.quando = quando ? quando.toISOString() : null;
      if (cert && quando) r.certValidoNaData = quando >= cert.notBefore.value && quando <= cert.notAfter.value;
      if (cert) { const ch = await confereCadeia(cert, (sd.certificates || []).filter(x => x !== cert), q); r.cadeia = ch.ok ? ch.tipo : null; r.cadeiaMotivo = ch.ok ? null : ch.motivo; }
      r.ok = r.integra && !!r.cadeia && r.certValidoNaData !== false;
      if (!r.integra) r.problema = 'A assinatura não confere com o conteúdo (documento alterado ou assinatura corrompida)';
      else if (!r.cadeia) r.problema = r.cadeiaMotivo || 'Certificado fora da cadeia oficial';
      else if (r.certValidoNaData === false) r.problema = 'O certificado estava vencido na data da assinatura';
    } catch (e) { r.problema = 'Não consegui ler esta assinatura: ' + (e.message || e); }
    out.push(r);
  }
  const ultimo = out.length ? Math.max(...out.map(x => x.fim || 0)) : 0;
  const resto = buf.subarray(ultimo).toString('latin1').replace(/\s|%%EOF/g, '');
  return { assinaturas: out.map(({ fim, ...x }) => x), alterado_depois: out.length > 0 && resto.length > 0, tamanho: buf.length };
}

/* compara quem assinou com os devedores (titulares) do contrato */
const norm = x => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
function mesmoNomeA(a, b) { const x = norm(a).split(' ').filter(w => w.length > 2), y = norm(b).split(' ').filter(w => w.length > 2); if (!x.length || !y.length) return false;
  if (x.join(' ') === y.join(' ')) return true; const [c, l] = x.length <= y.length ? [x, y] : [y, x]; return c[0] === l[0] && c[c.length - 1] === l[l.length - 1] && c.filter(w => l.includes(w)).length >= c.length - 1; }
export function comparaDevedores(res, devedores) {
  const A = res.assinaturas.filter(a => a.ok);
  const falta = [], presentes = [];
  for (const d of devedores) {
    const cpf = String(d.cpf || '').replace(/\D/g, '');
    const a = A.find(x => (cpf && x.cpf && x.cpf === cpf) || mesmoNomeA(x.nome, d.nome));
    (a ? presentes : falta).push({ nome: d.nome, cpf: cpf || null, ...(a ? { quando: a.quando } : {}) });
  }
  const outros = A.filter(a => !presentes.some(p => (p.cpf && p.cpf === a.cpf) || mesmoNomeA(p.nome, a.nome))).map(a => ({ nome: a.nome, cpf: a.cpf, quando: a.quando }));
  const problemas = res.assinaturas.filter(a => !a.ok);
  const status = !res.assinaturas.length ? 'sem_assinatura' : problemas.length || res.alterado_depois ? 'invalida' : falta.length ? 'falta_devedor' : 'ok';
  return { status, presentes, falta, outros, problemas: problemas.map(p => ({ nome: p.nome || '?', problema: p.problema })), alterado_depois: res.alterado_depois, total: res.assinaturas.length };
}
