// Pour l'essai en local : fait comme le Caddy du VPS, qui sert PowerSync sous /ps/ (préfixe retiré).
//   node prefixe.cjs     puis lancer le serveur avec POWERSYNC_URL=http://localhost:8081/ps
const http = require('node:http');

http.createServer((q, r) => {
  if (!q.url.startsWith('/ps/')) { r.writeHead(404).end(); return; }
  const p = http.request({ host: 'localhost', port: 8080, path: q.url.slice(3), method: q.method, headers: q.headers },
    (x) => { r.writeHead(x.statusCode, x.headers); x.pipe(r); });
  p.on('error', () => r.writeHead(502).end());
  q.pipe(p);
}).listen(8081);
