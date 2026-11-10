'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { NoteStore, ValidationError, NotFoundError, sanitizeFileName } = require('../src/notes');
const { makeVault, note, SAMPLE } = require('./helpers');

const fixedNow = () => new Date(2026, 10, 10, 12, 0, 0);
const store = (files = SAMPLE) => new NoteStore(makeVault(files), { now: fixedNow }).refresh();

test('завантажує всі нотатки та категорії', () => {
  const s = store();
  assert.equal(s.notes.size, 4);
  assert.deepEqual(s.categories().map((c) => [c.name, c.count]), [['Inbox', 0], ['Projects', 1], ['Areas', 0], ['Resources', 2], ['Archives', 1]]);
});

test('пошук за словом: регістр, кирилиця, заголовок, тіло', () => {
  const s = store();
  // «Git» теж містить слово у тексті ([[Хмара]]), але збіг у заголовку має йти першим
  assert.deepEqual(s.list({ q: 'ХМАРА' }).map((n) => n.title), ['Хмара', 'Git']);
  assert.deepEqual(s.list({ q: 'версій' }).map((n) => n.title), ['Git']);
  assert.deepEqual(s.list({ q: 'iaas saas' }).map((n) => n.title), ['Хмара']);
});

test('збіг у заголовку піднімає нотатку вище, ніж збіг лише в тексті', () => {
  const titles = store().list({ q: 'git' }).map((n) => n.title);
  assert.equal(titles[0], 'Git');
  assert.ok(titles.includes('Лаба'));
});

test('фільтр за тегом, категорією та статусом', () => {
  const s = store();
  assert.deepEqual(s.list({ tag: 'git' }).map((n) => n.title).sort(), ['Git', 'Лаба']);
  assert.deepEqual(s.list({ tag: '#GIT' }).length, 2);
  assert.deepEqual(s.list({ category: 'Archives' }).map((n) => n.title), ['Стара']);
  assert.deepEqual(s.list({ status: 'archived' }).map((n) => n.title), ['Стара']);
  assert.deepEqual(s.list({ tag: 'git', q: 'версій' }).map((n) => n.title), ['Git']);
});

test('порожній результат — порожній масив, а не помилка', () => {
  assert.deepEqual(store().list({ q: 'такого-слова-немає' }), []);
  assert.deepEqual(store().list({ tag: 'неіснуючий' }), []);
});

test('вихідні та зворотні посилання; бите посилання позначене', () => {
  const s = store();
  const out = s.outgoing('Projects/Лаба');
  assert.deepEqual(out.map((l) => [l.target, l.exists]), [['Git', true], ['Не існує', false]]);
  assert.deepEqual(s.backlinks('Resources/Git').map((b) => b.title).sort(), ['Лаба', 'Хмара']);
});

test('створення нотатки: файл, frontmatter, унікальні імена', () => {
  const s = store();
  const a = s.create({ title: 'Нова ідея', tags: 'Один, Два  слова', body: 'Текст [[Git]]' });
  assert.equal(a.id, 'Inbox/Нова ідея');
  assert.equal(a.status, 'inbox');
  assert.deepEqual(a.tags, ['один', 'два-слова']);
  assert.equal(a.created, '2026-11-10');
  const b = s.create({ title: 'Нова ідея' });
  assert.equal(b.id, 'Inbox/Нова ідея (2)');
  assert.ok(fs.existsSync(path.join(s.root, 'Inbox', 'Нова ідея.md')));
});

test('валідація: порожня назва, невідома категорія, завеликий текст', () => {
  const s = store();
  assert.throws(() => s.create({ title: '   ' }), ValidationError);
  assert.throws(() => s.create({ title: 'x', category: 'Hack' }), ValidationError);
  assert.throws(() => s.create({ title: 'x', body: 'a'.repeat(200001) }), ValidationError);
});

test('назва з небезпечними символами не виходить за межі каталогу', () => {
  assert.equal(sanitizeFileName('../../etc/passwd'), 'etc passwd');
  assert.equal(sanitizeFileName('a:b*c?"d"'), 'a b c d');
  const s = store();
  const created = s.create({ title: '../../hack' });
  assert.ok(path.resolve(s.root, `${created.id}.md`).startsWith(s.root + path.sep));
});

test('захист від path traversal у get/update/archive', () => {
  const s = store();
  for (const id of ['../x', 'Resources/../../x', '/etc/passwd', 'Resources/', 'Невідома/Файл', 'Git']) {
    assert.throws(() => s.update(id, { body: 'x' }), NotFoundError, id);
    assert.throws(() => s.archive(id), NotFoundError, id);
  }
});

test('оновлення змінює updated і не чіпає created; назву змінити не можна', () => {
  const s = store();
  const updated = s.update('Resources/Git', { tags: ['git', 'vcs'], body: '\n# Git\nНовий текст\n' });
  assert.equal(updated.created, '2026-01-01');
  assert.equal(updated.updated, '2026-11-10');
  assert.deepEqual(updated.tags, ['git', 'vcs']);
  assert.match(updated.body, /Новий текст/);
  assert.throws(() => s.update('Resources/Git', { title: 'Інша' }), ValidationError);
});

test('архівування переносить файл, а не видаляє', () => {
  const s = store();
  const moved = s.archive('Resources/Хмара');
  assert.equal(moved.id, 'Archives/Хмара');
  assert.equal(moved.status, 'archived');
  assert.ok(fs.existsSync(path.join(s.root, 'Archives', 'Хмара.md')));
  assert.ok(!fs.existsSync(path.join(s.root, 'Resources', 'Хмара.md')));
  assert.match(moved.body, /Огляд IaaS/); // зміст збережено
});

test('нотатка з CRLF і без frontmatter не ламає завантаження', () => {
  const s = store({
    'Inbox/Win.md': note({ title: 'Win', tags: ['win'], body: 'Текст' }).replace(/\n/g, '\r\n'),
    'Inbox/Без метаданих.md': '# Просто текст\n',
  });
  assert.equal(s.get('Inbox/Win').title, 'Win');
  assert.deepEqual(s.get('Inbox/Win').tags, ['win']);
  assert.equal(s.get('Inbox/Без метаданих').title, 'Без метаданих');
  assert.ok(s.get('Inbox/Без метаданих').missingFields.includes('tags'));
});
