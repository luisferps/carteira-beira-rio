# Carteira Beira Rio

Banco novo e telas de conferência da carteira do Condomínio Beira Rio.

- Plano: docs/PLANO.md
- Banco: esquema `carteira` (sql/)
- Tela: public/index.html
- Servidor: netlify/functions/api.mjs

Dados de clientes e senhas NUNCA vão para este repositório.

## MCP da carteira

Implementação de consulta em `netlify/functions/mcp.mjs`, reaproveitando as ferramentas do assistente atual. Configuração, testes e limites em [docs/MCP.md](docs/MCP.md).

Mapa documental, recuperação de fontes e integração do RAG local com os registros atuais: [docs/RAG.md](docs/RAG.md).
