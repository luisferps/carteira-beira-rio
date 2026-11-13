# Rateio do custo de cobrança entre Inerente e FCA

Regra operacional confirmada em 12/11/2026 para acordos, reparcelamentos, repactuações e o acerto mensal da Carteira Beira Rio.

## Cálculo

1. Apure cada parcela de origem na data da negociação, com principal corrigido quando aplicável, multa e juros de atraso. Para a revisão dos acordos desde outubro de 2026, aplique a cobrança nova de 10% às origens com **mais de 60 dias** de atraso. A base é o valor atualizado da parcela antes da cobrança nova, incluindo multa e juros e o custo antigo que já fazia parte dela.
2. Quando a origem for uma parcela de acordo anterior, recupere a parte comprovada da cobrança antiga que ficou em aberto. Atribua à Inerente também a fração da multa e dos juros de atraso dessa parte. Repita o rastreio se houver mais de um acordo de origem. Parcelas já pagas do acordo anterior ficam fora desse saldo. Se o histórico divergir, confira termos, baixas e acertos anteriores e registre a divergência antes de tratar a estimativa como valor definitivo.
3. A parte da Inerente é a soma da **cobrança atual**, da **cobrança antiga em aberto com seus encargos proporcionais** e de **10% dos juros do novo parcelamento**, quando houver. Atribua os juros do parcelamento às parcelas efetivamente financiadas. Se a entrada ficou sem juros, ela recebe apenas sua fração da cobrança do acordo. Distribua o custo pelas parcelas conforme o valor que cada uma amortiza e ajuste os centavos para fechar o total. A parte da FCA é o restante.

### Exemplo

Uma parcela antiga de R$ 550,00 contém R$ 50,00 de cobrança. Na renegociação, ela passa para R$ 572,00 com multa e juros, dos quais R$ 52,00 correspondem à cobrança antiga atualizada. Se a parcela estiver na régua de cobrança, os novos 10% sobre R$ 572,00 dão R$ 57,20. O cliente deve R$ 629,20. Na divisão interna, R$ 109,20 ficam com a Inerente e R$ 520,00 com a FCA. Em duas parcelas iguais sem financiamento, cada pagamento de R$ 314,60 tem R$ 54,60 para a Inerente.

## Registro e conferência no acerto

- No relatório de atraso, exiba apenas o custo de cobrança atual. A cobrança herdada já está dentro do saldo da parcela de origem. Na baixa e no acerto, some as origens no campo existente **Custo de cobrança**, com o detalhamento disponível internamente.
- Em parcelas em aberto, grave o rateio interno que será usado quando houver pagamento. Em parcelas pagas que ainda não entraram em acerto fechado com a FCA, ajuste o custo de cobrança pago e compense a diferença na parte da FCA, preservando valor pago, multa, juros, datas e situação da baixa. O valor negociado e os boletos do Asaas permanecem os mesmos numa correção de rateio.
- Cruze a fatura e o valor com o extrato do Asaas. O acerto usa a **data do crédito**. Pagamento confirmado com crédito futuro fica identificado como previsto até aparecer no extrato. Preserve baixas e valores que já compõem um acerto fechado com a FCA.
- Antes de concluir uma revisão, confira por fatura que a soma Inerente + FCA fecha o valor original, que o rateio salvo reaparece após a consulta e que os créditos do mês aberto aparecem no acerto. Informe por titular o custo já creditado, o confirmado a creditar e o saldo projetado das parcelas em aberto.

Os rateios históricos em [rateio-acordos-lib.mjs](../netlify/functions/rateio-acordos-lib.mjs) registram bases conferidas por termo. Alguns ainda refletem a composição histórica adotada na ocasião. Este documento é a referência para novas revisões e para mudanças na rotina de cálculo.
