-- Cruzamento: registro das decisões do administrador (versão final)
create table if not exists carteira.decisoes (
  contrato  text not null references carteira.contratos(numero) on delete cascade,
  item      text not null,
  de        text,
  por       text,
  em        timestamptz not null default now(),
  primary key (contrato, item)
);
alter table carteira.decisoes enable row level security;
