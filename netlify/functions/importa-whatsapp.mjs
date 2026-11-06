import { importaWhatsPasso, processaWhatsPendentes } from './api.mjs';

export default async () => {
  try { const r = await importaWhatsPasso(2000); if (!r?.fim) console.log('importa-whatsapp', JSON.stringify(r)); }
  catch (e) { console.error('importa-whatsapp', e.message); }
  try { const r = await processaWhatsPendentes(6000); if (r.length) console.log('cobranca-tempo-real', JSON.stringify(r)); }
  catch (e) { console.error('cobranca-tempo-real', e.message); }
};

export const config = { schedule: '* * * * *' };
