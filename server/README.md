# Speedometer Team Server

Servidor opcional para compartilhar uso de Cursor/Trae com o time. Compatível com o protocolo da CodingUsage (`/api/health`, `/api/cursor-usage`, `/api/trae-usage`).

```bash
node server/index.js
```

Padrão: http://localhost:3847

Na extensão, configure:

- `speedometer.teamServerUrl` = `http://localhost:3847`
- `speedometer.enableReporting` = `true`

Nada é enviado se `enableReporting` estiver desligado ou a URL estiver vazia.
