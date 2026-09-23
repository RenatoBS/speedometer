# Speedometer — uso de IA na status bar

Extensão para VS Code, Cursor, Windsurf e VSCodium que mostra **limites oficiais** de:

- **Claude Code** — OAuth local (`~/.claude`) + endpoint Anthropic `api/oauth/usage` (janelas 5h e 7d)
- **Codex CLI** — `rate_limits` em `~/.codex/sessions/**/*.jsonl`
- **Cursor** — token em `state.vscdb` + `cursor.com/api/usage-summary` (API + Auto + on-demand)
- **Trae** — `storage.json` + entitlements oficiais
- **Antigravity** — cotas locais no `state.vscdb`

Há um **dashboard** com barras de % do limite e gasto USD do Cursor (modelos). Clique na status bar para o menu (ligar/desligar ferramentas, abrir dashboard, configurações).

Baseado em [claude-codex-usage](https://github.com/jun1485/claude-codex-usage) e [CodingUsage](https://github.com/lasoons/CodingUsage) (MIT). Tokens ficam na sua máquina; a única rede é para as APIs oficiais (e, se você ligar, o Team Server que você hospeda).

## Instalar

```bash
npm install
npm run build
npm run install:editor
```

Ou `F5` no VS Code/Cursor para abrir o Extension Development Host.

## Contas extras

1. Carregue a extensão de browser em `browser/` (Chrome → Extensões → Carregar sem compactação).
2. Abra o dashboard do Cursor ou a página de uso do Trae; o token vai para a área de transferência.
3. Volte ao IDE; a Speedometer pergunta se deve adicionar a conta (máx. 3).

Ou cole o token em `speedometer.additionalSessionTokens`.

## Configurações principais

| Setting | Padrão | Função |
|---|---|---|
| `speedometer.displayMode` | full | status bar: 5h + 7d (Claude/Codex) e Auto + API (Cursor) |
| `speedometer.warningThreshold` / `errorThreshold` | 80 / 95 | fundo laranja / vermelho |
| `speedometer.showAllProviders` | false | mostrar Cursor+Trae+Antigravity em qualquer IDE |
| `speedometer.claude.enabled` etc. | true | ligar/desligar cada ferramenta |
| `speedometer.enableReporting` | false | enviar ao Team Server (opt-in) |

## Team Server

Desligado por padrão. Não há descoberta automática de servidores de terceiros.

```bash
node server/index.js
```

Depois, em Settings: `speedometer.teamServerUrl` = `http://localhost:3847` e `speedometer.enableReporting` = `true`.

## Empacotar

```bash
npm run package
```
