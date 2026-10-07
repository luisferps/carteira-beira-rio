Importação de um contrato direto do Asaas (feita pelo Claude no navegador do Luis):
1. GET /api/asaas-contrato/NNNN  (pagamentos do cliente no Asaas)
2. correções pelos valores originais dos boletos; renegociações viram acordo de 1 parcela (só "NN/120", nunca datas);
3. pagamentos via POST /api/pagamento (obs "Lançado pelo Claude direto do Asaas");
4. vencidas sem pagamento -> situação em_atraso.
5. Entrada sem boleto no Asaas -> "Pagamento à construtora", valor = valor da entrada, todas as datas = vencimento (regra do Luis, igual contrato 0001).
6. Renegociação: um acordo por boleto; principal, multa 2%, juros 1% a.m. capitalizado ao dia até a data do acordo; o que sobra = custo de cobrança.
7. Quitadas direto com a construtora no legado (quitada_via incorporadora) -> pagamento à construtora com valor pela regra, marcado na observação.
8. Cessão -> evento de cessão a partir da 1ª mensal após a data; taxa fica nos dados do evento.
9. NÃO publicar a cada ajuste: juntar mudanças (créditos do Netlify).
