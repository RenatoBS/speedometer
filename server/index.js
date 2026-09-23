const http = require('http');
const reports = [];

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

function html(res, body) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/api/health') {
    return json(res, 200, { service: 'speedometer', status: 'ok' });
  }
  if (req.method === 'GET' && (req.url === '/' || req.url === '/api/reports')) {
    if (req.url === '/api/reports') return json(res, 200, reports);
    const rows = reports
      .slice()
      .reverse()
      .map(
        (r) =>
          `<tr><td>${r.kind}</td><td>${r.email || ''}</td><td>${r.membership_type || ''}</td><td>${JSON.stringify(r)}</td></tr>`
      )
      .join('');
    return html(
      res,
      `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><title>Speedometer Team</title>
      <style>body{font-family:sans-serif;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px;font-size:13px}</style>
      </head><body><h1>Speedometer Team Server</h1><p>${reports.length} relatórios</p>
      <table><thead><tr><th>Tipo</th><th>Email</th><th>Plano</th><th>Payload</th></tr></thead><tbody>${rows}</tbody></table></body></html>`
    );
  }
  if (req.method === 'POST' && (req.url === '/api/cursor-usage' || req.url === '/api/trae-usage')) {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        reports.push({ kind: req.url.includes('cursor') ? 'cursor' : 'trae', receivedAt: new Date().toISOString(), ...body });
        if (reports.length > 500) reports.shift();
        json(res, 200, { ok: true });
      } catch {
        json(res, 400, { ok: false });
      }
    });
    return;
  }
  json(res, 404, { error: 'not found' });
});

const port = Number(process.env.PORT || 3847);
server.listen(port, () => {
  console.log(`Speedometer team server em http://localhost:${port}`);
});
