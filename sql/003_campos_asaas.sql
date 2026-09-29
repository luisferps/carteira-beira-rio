-- Campos do Asaas que faltavam no pagamento
alter table carteira.pagamentos
  add column if not exists id_asaas             text,     -- pay_XXXX: chave do pagamento no Asaas (integração)
  add column if not exists link_fatura          text,     -- https://www.asaas.com/i/XXXX
  add column if not exists nosso_numero         text,
  add column if not exists linha_digitavel      text,     -- código de barras / linha digitável do boleto
  add column if not exists valor_liquido        numeric,  -- o que caiu na conta, já descontada a taxa do Asaas
  add column if not exists vencimento_original  date,     -- vencimento antes de reemissão/prorrogação
  add column if not exists pago_cliente_em      date,     -- dia em que o cliente pagou
  add column if not exists juros_mes_pct        numeric,
  add column if not exists multa_pct            numeric,
  add column if not exists desconto_valor       numeric,
  add column if not exists id_cliente_asaas     text,     -- cus_XXXX
  add column if not exists id_parcelamento_asaas text;    -- quando o boleto faz parte de um parcelamento do Asaas
create index if not exists pagamentos_id_asaas on carteira.pagamentos(id_asaas);
