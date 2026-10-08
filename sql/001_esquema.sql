-- Carteira Beira Rio — banco novo (esquema "carteira")
-- Não toca em nenhuma tabela antiga. Pode ser rodado mais de uma vez.

create schema if not exists carteira;

create table if not exists carteira.contratos (
  numero            text primary key,
  quadra            text,
  lote              text,
  rua               text,
  area              numeric,
  valor_imovel      numeric,
  data_assinatura   date,
  entrada_total     numeric,
  indice            text,
  juros_aa          numeric,
  corretor          text,
  corretagem        numeric,
  compradores       jsonb not null default '[]',
  itens             jsonb not null default '[]',
  fonte             text,
  arquivo           text,
  alertas           jsonb not null default '[]',
  nome_planilha     text,
  status_planilha   text,
  obs_planilha      text,
  criado_em         timestamptz not null default now()
);

create table if not exists carteira.titulos (
  id           bigserial primary key,
  contrato     text not null references carteira.contratos(numero) on delete cascade,
  grupo        text not null check (grupo in ('entrada','mensal','anual','outra','acordo')),
  numero       int  not null,
  total        int  not null,
  rotulo       text not null,
  vencimento   date,
  valor_face   numeric,
  meio         text,
  conferente   text,
  acordo_id    bigint,
  criado_em    timestamptz not null default now()
);
create index if not exists titulos_contrato on carteira.titulos(contrato);

create table if not exists carteira.conferencia_titulo (
  conferente  text not null,
  titulo_id   bigint not null references carteira.titulos(id) on delete cascade,
  situacao    text not null check (situacao in ('paga','em_atraso','cancelada','quitada_acordo')),
  obs         text,
  salvo_em    timestamptz not null default now(),
  primary key (conferente, titulo_id)
);

create table if not exists carteira.pagamentos (
  id                bigserial primary key,
  conferente        text not null,
  titulo_id         bigint not null references carteira.titulos(id) on delete cascade,
  forma             text,
  fatura            text,
  situacao_asaas    text,
  valor_cobranca    numeric,
  valor_pago        numeric,
  criada_em         date,
  vencimento_boleto date,
  confirmada_em     date,
  saque_em          date,
  cliente_asaas     text,
  descricao         text,
  obs               text,
  tem_print         boolean not null default false,
  salvo_em          timestamptz not null default now()
);
create index if not exists pagamentos_titulo on carteira.pagamentos(titulo_id);
create index if not exists pagamentos_fatura on carteira.pagamentos(fatura);

create table if not exists carteira.prints (
  pagamento_id bigint primary key references carteira.pagamentos(id) on delete cascade,
  tipo         text,
  conteudo     text
);

create table if not exists carteira.acordos (
  id                bigserial primary key,
  contrato          text not null references carteira.contratos(numero) on delete cascade,
  conferente        text not null,
  data_acordo       date not null,
  titulos_origem    bigint[] not null,
  principal         numeric,
  multa             numeric,
  juros             numeric,
  honorarios        numeric,
  valor_calculado   numeric,
  valor_acordado    numeric,
  desconto_encargos numeric,
  qtd_parcelas      int not null default 1,
  obs               text,
  salvo_em          timestamptz not null default now()
);

create table if not exists carteira.correcoes (
  id            bigserial primary key,
  contrato      text not null references carteira.contratos(numero) on delete cascade,
  conferente    text not null,
  grupo         text not null check (grupo in ('mensal','anual')),
  a_partir      int  not null,
  data          date,
  igpm_pct      numeric,
  juros_pct     numeric,
  novo_valor    numeric not null,
  obs           text,
  salvo_em      timestamptz not null default now()
);

create table if not exists carteira.eventos (
  id            bigserial primary key,
  contrato      text not null references carteira.contratos(numero) on delete cascade,
  conferente    text not null,
  tipo          text not null check (tipo in ('encerramento','cessao','repactuacao')),
  motivo        text,
  a_partir_titulo bigint references carteira.titulos(id) on delete cascade,
  data          date,
  dados         jsonb not null default '{}',
  obs           text,
  salvo_em      timestamptz not null default now()
);

create table if not exists carteira.fechamentos (
  contrato    text not null references carteira.contratos(numero) on delete cascade,
  conferente  text not null,
  fechado_em  timestamptz not null default now(),
  primary key (contrato, conferente)
);

create table if not exists carteira.historico (
  id          bigserial primary key,
  conferente  text,
  acao        text,
  detalhe     jsonb,
  em          timestamptz not null default now()
);

-- Gera todas as parcelas de um contrato a partir dos itens lidos do documento
create or replace function carteira.gerar_titulos(p_numero text) returns int
language plpgsql as $$
declare
  c record; it jsonb; i int; n_ent int; k_ent int := 0; g text; passo interval; d0 date; qtd int; tot int := 0;
begin
  select * into c from carteira.contratos where numero = p_numero;
  delete from carteira.titulos where contrato = p_numero and conferente is null;
  select coalesce(sum((x->>'qtd')::int),0) into n_ent from jsonb_array_elements(c.itens) x where x->>'secao' = 'entrada';
  for it in select * from jsonb_array_elements(c.itens) loop
    qtd := coalesce((it->>'qtd')::int, 1);
    d0 := case when it->>'primeiro_venc' = 'ASSINATURA' then c.data_assinatura
               when it->>'primeiro_venc' ~ '^\d{4}-\d{2}-\d{2}$' then (it->>'primeiro_venc')::date end;
    passo := case when it->>'periodicidade' like 'anua%' then interval '1 year'
                  when it->>'periodicidade' like 'a cada %' then make_interval(days => (regexp_replace(it->>'periodicidade','\D','','g'))::int)
                  else interval '1 month' end;
    if it->>'secao' = 'entrada' then g := 'entrada';
    elsif it->>'periodicidade' like 'anua%' then g := 'anual';
    elsif it->>'periodicidade' like 'mens%' then g := 'mensal';
    else g := 'outra'; end if;
    for i in 1..qtd loop
      if g = 'entrada' then k_ent := k_ent + 1; end if;
      insert into carteira.titulos(contrato, grupo, numero, total, rotulo, vencimento, valor_face, meio)
      values (p_numero, g,
              case when g='entrada' then k_ent else i end,
              case when g='entrada' then n_ent else qtd end,
              case g when 'entrada' then 'Entrada ' || k_ent || '/' || n_ent
                     when 'mensal' then 'Mensal ' || i || '/' || qtd
                     when 'anual' then 'Anual ' || i || '/' || qtd
                     else 'Parcela ' || i || '/' || qtd end,
              case when d0 is null then null else (d0 + passo * (i-1))::date end,
              nullif(it->>'valor','')::numeric, it->>'meio');
      tot := tot + 1;
    end loop;
  end loop;
  return tot;
end $$;

-- ninguém de fora acessa: só o servidor (Netlify) com a senha do banco
revoke all on schema carteira from anon, authenticated;
