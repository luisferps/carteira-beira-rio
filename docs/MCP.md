# Primeiro MCP da carteira Beira Rio

Versão 0.1.0, implementada localmente em 07/11/2026. Ainda não publicada nem conectada ao Codex.

## O que foi reaproveitado

A carteira atual é a aplicação Netlify deste repositório. O backend `gestao-ativos` do Railway é outro componente, não uma versão para substituir a carteira. O assistente flutuante já usa ferramentas da API Anthropic. As três consultas desse assistente foram extraídas, sem mudar o corpo das consultas, para `netlify/functions/consultas-ia-lib.mjs`. A tela e o MCP usam a mesma função `ferramentaIA` e as mesmas dependências de `api.mjs`:

- `buscar_clientes`: cadastro por nome, CPF, telefone ou e-mail, até oito candidatos.
- `ver_contrato`: titulares, dívida atualizada, vencimentos, propostas, acordos, boletos e histórico recente da campanha.
- `casos_cobranca`: campanha atual, com filtro por etapa e paginação de até 100 casos.

`dividas`, `abertas`, `ajustaValores`, `compoAtraso` e as demais funções de cálculo continuam no código existente. Não há uma segunda implementação dos juros ou encargos no MCP. Valores e registros das referências históricas não são usados como se fossem dados atuais.

## Arquitetura e limites

Cliente MCP → POST `/mcp` → autenticação → consultas compartilhadas → banco atual.

O MCP não faz uma chamada adicional ao Claude. Ele entrega dados ao assistente que o chamou. A sessão não persiste na função Netlify. O servidor usa o SDK oficial, Streamable HTTP e resposta JSON. Origem de navegador diferente da origem do endpoint é recusada; esta versão destina-se a clientes nativos, não a conectores web OAuth.

É uma versão pessoal do administrador, com um token exclusivo. Quem possui esse token consegue ler dados pessoais e financeiros retornados pelas três ferramentas. Não reutilizar PIN de acesso, chave Asaas ou chave Anthropic como token MCP. Não distribuir essa credencial a usuários comuns.

As ferramentas só consultam. Não passam pelo handler REST, que faz manutenção de esquema, nem por rotinas de atualização da campanha. Importar `api.mjs` cria o pool, mas não executa o handler ou cron. As dependências das consultas foram inspecionadas para leitura. Não há envio WhatsApp, emissão de boleto, aprovação de ações, lançamento ou fechamento.

A lista da campanha não é a lista de todos os inadimplentes. O resumo de contrato expõe até cinco próximos títulos e cinco acordos, seis registros de cobrança, conforme o assistente existente. Para homônimos, o assistente deve identificar o cliente antes de escolher o contrato.

As decisões de cobrança mudaram ao longo dos meses, inclusive em novembro. Antes de adicionar ações financeiras, conferir memória recente, contrato e código atual. Não transportar regras de um fechamento antigo para outro período. O acerto Beira Rio é distinto do caixa mensal da imobiliária. A integração Evolution e o bot já existem; ampliar a automação deve reutilizá-los.

## Configuração para publicar

1. Gerar token aleatório de 32 bytes ou mais e cadastrar `MCP_BEARER_TOKEN` como segredo no escopo Functions do site correto. Nada disso foi gravado em produção nesta implementação.
2. Manter `DATABASE_URL` e `DB_PASSWORD` existentes. O conector confirmou que estão cadastrados, mas devolve valores mascarados; por isso não houve teste local contra o banco de produção.
3. Publicar esta branch após revisão. Endpoint previsto: `https://papaya-cocada-88fc90.netlify.app/mcp`.
4. Fazer teste remoto autenticado com o cliente oficial: conectar, listar ferramentas e consultar um contrato conhecido, confrontando com a tela.
5. Configurar no cliente o URL e o token por variável de ambiente ou armazenamento de segredos.

Configuração TOML para conectar o Codex, conforme a [documentação oficial](https://learn.chatgpt.com/docs/extend/mcp), conferida em 07/11/2026:

```toml
[mcp_servers.inerente_carteira]
url = "https://papaya-cocada-88fc90.netlify.app/mcp"
bearer_token_env_var = "INERENTE_MCP_TOKEN"
```

O segredo `INERENTE_MCP_TOKEN` no computador deve ter o mesmo valor de `MCP_BEARER_TOKEN` no servidor. O token não deve ser escrito neste documento, em comandos de histórico ou no repositório. Remover/rotacionar o segredo do servidor revoga o acesso; configurar o cliente só depois do teste remoto.

## Verificação local

`npm ci` instala o lockfile; `npm test` executa os testes com o cliente oficial do SDK, passando pelo handler HTTP real e usando dados sintéticos. Testa autenticação, origens, métodos, conexão, listagem, chamadas, normalização de contrato, paginação, validação de parâmetros, erros sem vazamento e compartilhamento das consultas.

`npm run mcp:local` disponibiliza o handler em `127.0.0.1:8888/mcp`. Requer `MCP_BEARER_TOKEN` e as variáveis do banco no ambiente do processo. O servidor local recusa hosts diferentes de localhost/127.0.0.1 e limita o corpo a 64 KiB. Não carregar credenciais em arquivos versionados.

O limite declarativo de 60 requisições por minuto está no config da função, aplicado pelo Netlify após deploy. Não é simulado como contador em memória.

## Evolução prevista

Após validar a consulta real: expor preparação de ações pelo mecanismo existente de proposta/aprovação; integrar leitura atual de WhatsApp; coordenar contatos pela Evolution e encaminhar a negociação ao Luis. O MCP fornece as ferramentas; a coordenação contínua depende do agente e do agendador. Esta versão não implementa essa coordenação.

Referência técnica: [SDK MCP oficial](https://ts.sdk.modelcontextprotocol.io/server).
