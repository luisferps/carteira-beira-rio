-- O que foi efetivamente pago de encargos em cada pagamento
alter table carteira.pagamentos
  add column if not exists multa_paga      numeric,
  add column if not exists juros_pago      numeric,
  add column if not exists honorarios_pago numeric,
  add column if not exists desconto_dado   numeric;
