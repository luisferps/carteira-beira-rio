Importação de um contrato direto do Asaas (feita pelo Claude no navegador do Luis):
1. GET /api/asaas-contrato/NNNN  (pagamentos do cliente no Asaas)
2. correções pelos valores originais dos boletos; renegociações viram acordo de 1 parcela (só "NN/120", nunca datas);
3. pagamentos via POST /api/pagamento (obs "Lançado pelo Claude direto do Asaas");
4. vencidas sem pagamento -> situação em_atraso.
