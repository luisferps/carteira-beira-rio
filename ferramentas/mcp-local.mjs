import http from 'node:http';
import { criaHandlerMcp } from '../netlify/lib/mcp.mjs';

const handler = criaHandlerMcp({
  env: nome => process.env[nome],
  consulta: async (nome, ent) => (await import('../netlify/functions/api.mjs')).ferramentaIA(nome, ent)
});
const port = Number(process.env.MCP_PORT || 8888);
http.createServer(async (req, res) => {
  try {
    if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) {
      res.writeHead(403).end(); return;
    }
    if (req.url !== '/mcp') { res.writeHead(404).end(); return; }
    const url = `http://127.0.0.1:${port}/mcp`;
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 65536) { res.writeHead(413).end(); return; }
      chunks.push(chunk);
    }
    const response = await handler(new Request(url, { method: req.method, headers: req.headers, ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500).end('Falha no servidor local'); }
}).listen(port, '127.0.0.1', () => console.info(`MCP local em http://127.0.0.1:${port}/mcp`));
