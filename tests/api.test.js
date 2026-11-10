'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/server');
const { makeVault, SAMPLE } = require('./helpers');

async function start(dir) {
  const server = createApp({ notesDir: dir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
}
const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('GET /api/notes, пошук, тег і порожній результат', async () => {
  const app = await start(makeVault(SAMPLE));
  try {
    assert.equal((await (await fetch(`${app.base}/api/notes`)).json()).length, 4);
    const found = await (await fetch(`${app.base}/api/notes?q=${encodeURIComponent('версій')}`)).json();
    assert.deepEqual(found.map((n) => n.title), ['Git']);
    const tagged = await (await fetch(`${app.base}/api/notes?tag=git`)).json();
    assert.equal(tagged.length, 2);
    const none = await fetch(`${app.base}/api/notes?q=zzzz`);
    assert.equal(none.status, 200);
    assert.deepEqual(await none.json(), []);
  } finally { await app.close(); }
});

test('відкриття нотатки з кириличним id, посиланнями й безпечним HTML', async () => {
  const app = await start(makeVault(SAMPLE));
  try {
    const res = await fetch(`${app.base}/api/notes/${encodeURIComponent('Projects')}/${encodeURIComponent('Лаба')}`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.match(data.html, /class="wikilink"/);
    assert.match(data.html, /wikilink broken/);
    assert.equal(data.links.filter((l) => !l.exists).length, 1);
  } finally { await app.close(); }
});

test('створення → читання → робота після «перезапуску» сервера', async () => {
  const dir = makeVault(SAMPLE);
  let app = await start(dir);
  try {
    const created = await fetch(`${app.base}/api/notes`, json({ title: 'Після перезапуску', tags: 'тест', body: 'Привіт [[Git]]' }));
    assert.equal(created.status, 201);
  } finally { await app.close(); }

  app = await start(dir); // новий процес-сервер над тим самим каталогом
  try {
    const list = await (await fetch(`${app.base}/api/notes?q=${encodeURIComponent('перезапуску')}`)).json();
    assert.equal(list.length, 1);
    const back = await (await fetch(`${app.base}/api/notes/Resources%2F..%2F..%2Fx`)).status;
    assert.equal(back, 404);
  } finally { await app.close(); }
});

test('помилки: 400 для поганого запиту, 404 для відсутньої нотатки, 403 для чужого Host', async () => {
  const app = await start(makeVault(SAMPLE));
  try {
    assert.equal((await fetch(`${app.base}/api/notes`, json({ title: '' }))).status, 400);
    assert.equal((await fetch(`${app.base}/api/notes`, { method: 'POST', body: 'title=x' })).status, 400); // не JSON
    assert.equal((await fetch(`${app.base}/api/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' })).status, 400);
    assert.equal((await fetch(`${app.base}/api/notes/Resources/Нема`)).status, 404);
    assert.equal((await fetch(`${app.base}/api/notes/%E0%A4%A`)).status, 400); // некоректне %-кодування
    const evil = await new Promise((resolve) => {
      const http = require('node:http');
      http.get(`${app.base}/api/notes`, { headers: { Host: 'evil.example' } }, (r) => resolve(r.statusCode));
    });
    assert.equal(evil, 403);
  } finally { await app.close(); }
});

test('статичний інтерфейс віддається, вихід за межі public заборонено', async () => {
  const app = await start(makeVault(SAMPLE));
  try {
    const page = await fetch(`${app.base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Second Brain/);
    const escape = await fetch(`${app.base}/%2e%2e/server.js`);
    assert.equal(escape.status, 404);
  } finally { await app.close(); }
});
