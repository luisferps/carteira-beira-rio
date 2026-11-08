import { criaHandlerMcp } from '../lib/mcp.mjs';

// O import só ocorre após autenticar e quando uma consulta é realmente chamada.
const consulta = async (nome, entrada) => {
  const { ferramentaIA, buscarRegistros } = await import('./api.mjs');
  if (nome === 'buscar_registros') return buscarRegistros(entrada);
  return ferramentaIA(nome, entrada);
};

export default criaHandlerMcp({ consulta, env: nome => Netlify.env.get(nome) });

export const config = {
  path: '/mcp',
  rateLimit: { windowSize: 60, windowLimit: 60, aggregateBy: ['ip', 'domain'] }
};
