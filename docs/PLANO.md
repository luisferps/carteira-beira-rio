# Plano — Banco Novo da Carteira Beira Rio (conferência tripla)

Data: 29/09/2026 · Versão 2 (com as decisões do Luis) · Situação: PLANO (não executar ainda)

## 1. A ideia
Começar do zero, com um esqueleto tirado direto dos contratos assinados, e conferir cada parcela três vezes de forma independente: o banco antigo, o Luis (pelo print) e a secretária (na mão). Onde as três conferências batem, a parcela está aprovada. Onde não batem, Luis e secretária conferem juntos, na mão. O banco antigo fica só para comparação até a implantação final.

Conferência sempre **contrato por contrato, parcela por parcela**. Nada de planilha exportada do Asaas: é olhando o contrato inteiro na tela, com as parcelas verdes em volta de uma vermelha fora do padrão, que o erro aparece.

## 2. Decisões tomadas
| Assunto | Decisão |
|---|---|
| Onde fica | Repositório novo no GitHub → publica sozinho no Netlify. O próprio Netlify faz o papel de servidor (funções do Netlify), sem precisar de Railway |
| Banco | Projeto novo no Supabase, separado do atual |
| Quem lê o print | Inteligência artificial (Claude), usando a conta do Claude Console que já existe. A chave fica guardada no Netlify, nunca na tela |
| Conferência do Luis | Print + descrição colada, parcela por parcela. Sem planilha exportada |
| Data de corte | Não tem. Cada parcela salva guarda data e hora; o fechamento do contrato também |
| Contratos | Todos os ~250 entram como ativos. O encerramento é marcado durante a conferência |
| Total esperado | Calculado pelo próprio sistema e mostrado na tela do contrato. Ninguém digita |

## 3. As três fontes
| Fonte | Quem | Como |
|---|---|---|
| A — Legado | Já existe | Foto congelada do banco atual, convertida para o formato novo |
| B — Luis | Luis | Cola o print do Asaas e a descrição; a inteligência artificial preenche; Luis completa o que faltar |
| C — Secretária | Secretária | Olha no Asaas e digita |

Conferência cega: cada um entra com seu próprio acesso e não vê o que o outro lançou.

## 4. O que guardar — CONTRATO (lido da página de pagamento de cada contrato)
- Número do contrato (a chave de tudo)
- Quadra, lote, rua, área
- Compradores: nome e CPF (até 4)
- Data de assinatura
- Valor do imóvel
- Entrada: valor total e cada pedaço (valor, data, meio de pagamento)
- Mensais: quantidade, valor, 1º vencimento, dia de vencimento
- Anuais/balões: quantidade, valor, 1º vencimento
- Correção e juros (IGPM + 2% a.a. só para quem atrasou)
- Corretor e corretagem
- PDF do contrato anexado
- Observações (aditivos, mudança de dia, balão incorporado)

## 5. O que guardar — PARCELA (todas que o contrato gera, vencidas ou não)
- Contrato, tipo (sinal, entrada, mensal, anual), número (ex.: 34/120)
- Vencimento original
- Valor de face (do contrato) e valor do ano (com a correção anual daquele ano)
- Situação: paga · quitada por acordo · cancelada (encerramento/balão diluído) · em atraso · a vencer
- Conferida em (data e hora, gravadas sozinhas ao salvar) e conferida por

## 6. O que guardar — PAGAMENTO (tirado do print do Asaas)
- **Número da fatura** (ex.: 543018123) — liga as três conferências
- Situação (Recebida, Confirmada…)
- Valor da cobrança e valor pago
- Criada em, vencimento do boleto
- **Confirmada em** (data em que o dinheiro entrou — é a que vale)
- Saque disponível em
- Forma de pagamento: boleto (Asaas) · Pix (Asaas) · **pagamento à construtora** · dinheiro · transferência
- Cliente como está no Asaas (só referência)
- Descrição completa (colada como texto)
- Print anexado (conferência do Luis)
- Salvo em (data e hora) e salvo por

Sem número de fatura quando a forma não for Asaas (ex.: pagamento à construtora); nesse caso vale anexar o comprovante, se houver.

## 7. Tela do contrato

### 7.1 Cabeçalho
Número, quadra/lote, titular e os números **esperados** calculados pelo sistema:
- Parcelas que já venceram (quantidade) e quanto deveria ter entrado (R$)
- Parcelas lançadas como pagas/quitadas e quanto entrou (R$)
- Diferença

Botões do cabeçalho: **Adicionar acordo** · **Encerrar contrato** · **Cessão** · **Fechar conferência do contrato**

### 7.2 Botões das parcelas
- 1ª linha: Sinal · Entrada 1 · Entrada 2 …
- Mensais de 12 em 12 (cada linha = 1 ano do contrato), com a anual daquele ano no fim da linha
- Cores: cinza = a vencer · vermelho = vencida sem nada · verde = paga · amarelo = quitada por acordo · azul = cancelada

Clicar num botão abre a ficha do pagamento (seção 6). Ao **Salvar**, grava data e hora sozinho.

### 7.3 Acordos (renegociação)
1. Na grade, marcar as parcelas que entraram no acordo (ex.: 4, 5 e 6). Pode marcar também títulos de um acordo anterior que foram engolidos pelo novo.
2. Clicar em **Adicionar acordo**. Abre a janela do acordo:
   - Data do acordo
   - O sistema mostra o **valor calculado** (principal + multa + juros + custo de cobrança) — só como sugestão
   - Campo **valor acordado**, que já vem com o calculado e **pode ser editado** (ex.: calculou R$ 12.000, mas o acordo foi fechado por R$ 11.500 — vale o que foi fechado; o passado não se muda)
   - **Pagamento único ou parcelado** — se parcelado, em quantas vezes
   - O sistema divide em partes iguais e mostra cada título (valor e vencimento); **cada valor e cada vencimento pode ser editado** (ex.: primeira parcela do acordo maior que as outras)
   - A soma dos títulos tem que bater com o valor acordado, senão não deixa salvar
   - Depois de salvo, o acordo continua editável (com registro de quem mudou e quando)
3. O acordo vai para a **aba Acordos**, embaixo da grade, que abre e fecha. Ele aparece com seus próprios botões (título 1/3, 2/3, 3/3).
4. Criar o acordo **não quita nada**. As parcelas marcadas só ficam com um aviso "dentro do acordo X".
5. Quando chegar a vez de conferir o pagamento do acordo, clica no título dele e lança o pagamento normalmente (print/digitado).
6. Ao salvar o pagamento, as parcelas do acordo ficam **amarelas (quitadas por acordo)** automaticamente.

**Destrinchar o valor do acordo:** quem confere digita só o valor total pago. O sistema separa sozinho, pela cláusula 10 do contrato:
- **Principal** = soma do valor do ano das parcelas que entraram no acordo
- **Multa** = 2% sobre o principal
- **Juros** = 1% ao mês, proporcional aos dias, de cada vencimento até a data do acordo
- **Custo de cobrança (honorários)** = 10% sobre principal + multa + juros, quando o atraso passou de 30 dias
Quando o valor acordado for diferente do calculado:
- O **principal nunca diminui** — ele é a dívida
- Se acordou **menos**, a diferença sai dos encargos (multa, juros e custo de cobrança), proporcionalmente, e fica registrada como "desconto nos encargos"
- Se acordou **menos que o principal**, o sistema avisa em vermelho (desconto no principal — precisa de confirmação do Luis)
- Se acordou **mais**, a sobra entra como juros

Acordo em vários títulos: a separação é proporcional ao valor de cada título. Se o cliente pagou um título do acordo com atraso (valor pago maior que o título), o que passou entra como juros/multa do próprio acordo.

### 7.3-B Correção anual (evento manual)
A correção **não é calculada sozinha**. Ela é um evento, igual à parcela e ao acordo, lançado por quem confere quando percebe que o valor mudou.

1. Conferindo, percebe que a parcela 13 veio com valor diferente da 12.
2. Clica em **Adicionar correção**. Informa:
   - A partir de qual parcela vale (ex.: mensal 13/120) e a data da correção
   - Percentual de IGPM aplicado
   - Percentual de juros aplicado (2% ou 0%)
   - Novo valor da mensal (e da anual, se houver)
3. Ao salvar, **todas as parcelas dali em diante** passam a ter o valor novo, até a próxima correção.
4. A correção aparece na aba **Correções** do contrato (abre e fecha), com data e hora de quando foi lançada e por quem.
5. Pode ser editada ou apagada; ao mudar, as parcelas seguintes se recalculam.

O "valor do ano" de cada parcela vem sempre da última correção lançada antes dela (ou do valor do contrato, se ainda não houver correção). Esse é o valor usado no total esperado e no principal dos acordos. As correções também entram no cruzamento das três conferências.

### 7.4 Encerrar contrato
Botão **Encerrar contrato** → pergunta:
- Motivo: distrato · retomada · quitação antecipada
- **A partir de qual parcela?** (ex.: 30)
- Data do encerramento

Da parcela informada em diante, tudo fica azul (cancelada). As anteriores continuam conferidas normalmente. No distrato, anexa o termo.

### 7.5 Cessão
Botão **Cessão** → a partir de qual parcela, novo(s) titular(es), data. O contrato continua; só muda o dono das parcelas dali em diante.

### 7.6 Fechar a conferência do contrato
Só deixa fechar quando toda parcela vencida tiver situação (nenhuma vermelha sem justificativa). Uma parcela vermelha pode ser confirmada como "em atraso — conferido". Ao fechar, grava data e hora do fechamento.

## 8. Atualização depois da conferência
A conferência vai levar semanas. Nesse tempo entram pagamentos novos e parcelas novas vencem. Como cada parcela e cada contrato guardam **quando foram conferidos**, na hora de ligar o sistema:
- tudo o que o Asaas registrou **depois** da data de fechamento de cada contrato entra sozinho (identificado pelo número do contrato na descrição);
- o que o sistema não conseguir identificar vai para uma lista para vocês ligarem na mão.

## 9. Cruzamento das três conferências
- As três batem → aprovada sozinha
- Duas contra uma → mostra quem divergiu e em quê
- As três diferentes → manual
- Compara por: parcela + número da fatura + valor pago + data de confirmação + forma de pagamento
- Acordos: compara as parcelas que entraram, a data e o valor pago

Prova final: cada contrato fechado + total geral recebido no banco novo = total recebido no Asaas.

## 10. Etapas
1. Aprovar este plano (Luis)
2. Ler os ~250 contratos (página de pagamento), gerar todas as parcelas, comparar com a planilha de contratos e mostrar as diferenças para o Luis decidir — **precisa da pasta com os PDFs**
3. Criar o repositório no GitHub, o site no Netlify e o banco novo no Supabase
4. Montar a tela de conferência (login do Luis e da secretária)
5. Converter o banco antigo para o formato novo (fonte A)
6. Conferências do Luis e da secretária, em paralelo, contrato por contrato em ordem numérica
7. Tela de cruzamento e resolução manual das divergências
8. Ligar o sistema e puxar o que entrou depois de cada fechamento
9. Tela final do dia a dia, parecida com a atual, lendo só o banco novo
10. Desligar o banco antigo depois de um mês rodando junto
