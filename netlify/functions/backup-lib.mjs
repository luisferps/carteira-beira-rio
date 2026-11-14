/* cópia de segurança do banco: todas as tabelas da carteira em um arquivo compactado, guardado no Netlify (fora do banco); ficam as 8 últimas */
import { getStore } from '@netlify/blobs';
import zlib from 'node:zlib';

const loja = () => getStore('backups-carteira');

export async function fazBackup(q, origem = 'automatico') {
  const tabs = (await q(`select tablename from pg_tables where schemaname='carteira' order by tablename`)).map(t => t.tablename);
  const dados = {}, linhas = {};
  for (const t of tabs) { const r = await q(`select * from carteira."${t}"`); dados[t] = r; linhas[t] = r.length; }
  const corpo = zlib.gzipSync(Buffer.from(JSON.stringify({ gerado_em: new Date().toISOString(), origem, tabelas: dados })));
  const chave = `carteira-${new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 16).replace(':', 'h')}.json.gz`;
  const st = loja();
  await st.set(chave, corpo, { metadata: { origem, tabelas: tabs.length, bytes: corpo.length, linhas } });
  const { blobs } = await st.list();
  const velhos = blobs.map(b => b.key).sort().reverse().slice(8);
  for (const k of velhos) await st.delete(k);
  return { chave, tabelas: tabs.length, bytes: corpo.length, apagados: velhos.length };
}

export async function listaBackups() {
  const st = loja();
  const { blobs } = await st.list();
  const out = [];
  for (const b of blobs) { const m = await st.getMetadata(b.key); out.push({ chave: b.key, ...(m?.metadata || {}) }); }
  return out.sort((a, b) => b.chave.localeCompare(a.chave));
}

export async function baixaBackup(chave) {
  const buf = await loja().get(chave, { type: 'arrayBuffer' });
  return buf ? new Response(buf, { headers: { 'content-type': 'application/gzip', 'content-disposition': `attachment; filename="${chave}"` } }) : null;
}
