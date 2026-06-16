import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './src/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const port = Number(process.env.PORT || 4173);

export function createServer(db = openDatabase()) {
  db.applyMigrations();
  db.bootstrap();

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url, db);
        return;
      }
      serveStatic(url.pathname, res);
    } catch (error) {
      sendJson(res, error.statusCode || 500, { error: error.message || 'Internal server error' });
    }
  });
}

async function handleApi(req, res, url, db) {
  const actor = {
    user: req.headers['x-crms-user'] || 'local-operator',
    role: req.headers['x-crms-role'] || 'records-officer',
    device: req.headers['x-crms-device'] || 'station-main',
    ip: req.socket.remoteAddress
  };

  if (req.method === 'GET' && url.pathname === '/api/health') return sendJson(res, 200, { ok: true });
  if (req.method === 'GET' && url.pathname === '/api/stats') return sendJson(res, 200, db.stats());
  if (req.method === 'GET' && url.pathname === '/api/audit') return sendJson(res, 200, db.auditLog());
  if (req.method === 'GET' && url.pathname === '/api/devices') return sendJson(res, 200, db.devices());

  if (req.method === 'GET' && url.pathname === '/api/records') {
    return sendJson(res, 200, db.listRecords({
      search: url.searchParams.get('search') || '',
      status: url.searchParams.get('status') || 'all',
      risk: url.searchParams.get('risk') || 'all'
    }));
  }

  if (req.method === 'POST' && url.pathname === '/api/records') {
    const body = await readBody(req);
    return sendJson(res, 201, db.createRecord(body, actor));
  }

  const recordMatch = url.pathname.match(/^\/api\/records\/([^/]+)(?:\/([^/]+))?$/);
  if (recordMatch) {
    const [, id, child] = recordMatch;
    if (req.method === 'GET' && !child) {
      const record = db.getRecord(id);
      if (!record) throw httpError(404, 'Record not found');
      db.audit(actor, 'view', 'records', id, {});
      return sendJson(res, 200, record);
    }
    if (req.method === 'PATCH' && !child) {
      const updated = db.updateRecord(id, await readBody(req), actor);
      if (!updated) throw httpError(404, 'Record not found');
      return sendJson(res, 200, updated);
    }
    if (req.method === 'DELETE' && !child) {
      const deleted = db.deleteRecord(id, actor);
      if (!deleted) throw httpError(404, 'Record not found');
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && child) {
      const table = child.endsWith('s') ? child : `${child}s`;
      return sendJson(res, 201, db.createChild(table, id, await readBody(req), actor));
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/sync/export') {
    const since = Number(url.searchParams.get('since') || 0);
    const deviceId = url.searchParams.get('device') || actor.device;
    return sendJson(res, 200, db.exportChanges(since, deviceId));
  }

  if (req.method === 'POST' && url.pathname === '/api/sync/import') {
    return sendJson(res, 200, db.importChanges(await readBody(req), actor));
  }

  throw httpError(404, 'Route not found');
}

function serveStatic(requestPath, res) {
  const safePath = requestPath === '/' ? '/index.html' : requestPath;
  const filePath = path.normalize(path.join(publicDir, safePath));
  if (!filePath.startsWith(publicDir)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }
  const ext = path.extname(filePath);
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createServer();
  server.listen(port, () => {
    console.log(`CRMS running at http://localhost:${port}`);
  });
}
