'use strict';
/**
 * Локальний HTTP-сервер Second Brain (лише стандартна бібліотека Node.js).
 * Слухає тільки 127.0.0.1, віддає статичний інтерфейс і JSON API.
 *
 * Безпека: перевірка заголовка Host (захист від DNS rebinding), запис лише для
 * application/json (кросдоменні форми не пройдуть), без CORS, CSP default-src 'self',
 * шляхи до нотаток обмежені каталогом notes/, видалення через API відсутнє (є лише архівування).
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { NoteStore, ValidationError, NotFoundError, CATEGORIES, TYPES, STATUSES } = require('./notes');
const { render } = require('./markdown');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
const MAX_BODY = 1024 * 1024;

function send(res, status, payload, headers = {}) {
  const isBuffer = Buffer.isBuffer(payload) || typeof payload === 'string';
  const body = isBuffer ? payload : JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': isBuffer ? headers['Content-Type'] || 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'",
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '');
    if (!type.toLowerCase().startsWith('application/json')) {
      reject(new ValidationError('Очікується Content-Type: application/json'));
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new ValidationError('Запит завеликий'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
        resolve(parsed);
      } catch {
        reject(new ValidationError('Некоректний JSON'));
      }
    });
    req.on('error', reject);
  });
}

function hostAllowed(req) {
  const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

function noteView(store, note) {
  return {
    id: note.id,
    title: note.title,
    category: note.category,
    type: note.type,
    status: note.status,
    tags: note.tags,
    created: note.created,
    updated: note.updated,
    source: note.source,
    body: note.body,
    html: render(note.body, (target) => store.resolve(target)),
    links: store.outgoing(note.id),
    backlinks: store.backlinks(note.id),
  };
}

function createApp({ notesDir, publicDir = path.join(__dirname, 'public'), now } = {}) {
  const store = new NoteStore(notesDir, now ? { now } : undefined);
  store.refresh();
  const publicRoot = path.resolve(publicDir);

  async function handleApi(req, res, url) {
    store.refresh();
    const segments = url.pathname.split('/').slice(2).map((s) => decodeURIComponent(s));
    const method = req.method;

    if (segments[0] === 'meta' && method === 'GET') {
      return send(res, 200, { categories: CATEGORIES, types: TYPES, statuses: STATUSES });
    }
    if (segments[0] === 'tags' && method === 'GET') return send(res, 200, store.tags());
    if (segments[0] === 'categories' && method === 'GET') return send(res, 200, store.categories());

    if (segments[0] === 'notes') {
      if (segments.length === 1 && method === 'GET') {
        const q = Object.fromEntries(url.searchParams);
        return send(res, 200, store.list(q));
      }
      if (segments.length === 1 && method === 'POST') {
        const data = await readJson(req);
        return send(res, 201, noteView(store, store.create(data)));
      }
      // id нотатки має вигляд Категорія/Назва, тому збираємо всі сегменти після «notes»
      const archive = segments[segments.length - 1] === 'archive' && method === 'POST';
      const id = (archive ? segments.slice(1, -1) : segments.slice(1)).join('/');
      if (archive) return send(res, 200, noteView(store, store.archive(id)));
      if (method === 'GET') return send(res, 200, noteView(store, store.get(id)));
      if (method === 'PUT') {
        const data = await readJson(req);
        return send(res, 200, noteView(store, store.update(id, data)));
      }
    }
    throw new NotFoundError('Невідомий маршрут API');
  }

  function serveStatic(req, res, url) {
    let rel = url.pathname === '/' ? '/index.html' : url.pathname;
    rel = decodeURIComponent(rel);
    const file = path.resolve(publicRoot, '.' + path.normalize('/' + rel));
    if (!file.startsWith(publicRoot + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return send(res, 404, { error: 'Не знайдено' });
    }
    return send(res, 200, fs.readFileSync(file), { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (!hostAllowed(req)) return send(res, 403, { error: 'Недопустимий заголовок Host' });
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Метод не дозволено' });
      return serveStatic(req, res, url);
    } catch (err) {
      if (err instanceof URIError) return send(res, 400, { error: 'Некоректне кодування URL' });
      if (err.status) return send(res, err.status, { error: err.message });
      console.error(err);
      return send(res, 500, { error: 'Внутрішня помилка сервера' });
    }
  });
  server.store = store;
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const notesDir = process.env.NOTES_DIR || path.join(__dirname, '..', 'notes');
  const server = createApp({ notesDir });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Second Brain: http://localhost:${port}  (нотатки: ${path.resolve(notesDir)})`);
  });
}

module.exports = { createApp };
