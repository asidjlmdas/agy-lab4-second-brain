'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fm = require('../src/frontmatter');

test('розбирає поля, лапки та інлайн-список тегів', () => {
  const { meta, body, hasFrontmatter } = fm.parse('---\ntitle: "Назва: з двокрапкою"\ntags: [a, b, "c d"]\nstatus: active\n---\n\n# Текст\n');
  assert.equal(hasFrontmatter, true);
  assert.equal(meta.title, 'Назва: з двокрапкою');
  assert.deepEqual(meta.tags, ['a', 'b', 'c d']);
  assert.equal(meta.status, 'active');
  assert.match(body, /^\n# Текст/);
});

test('підтримує CRLF і BOM (файли з Windows)', () => {
  const text = '﻿---\r\ntitle: "Win"\r\ntags: [x]\r\n---\r\n\r\nТекст\r\n';
  const { meta, body } = fm.parse(text);
  assert.equal(meta.title, 'Win');
  assert.deepEqual(meta.tags, ['x']);
  assert.ok(!body.includes('\r'));
});

test('порожній список тегів і файл без frontmatter', () => {
  assert.deepEqual(fm.parse('---\ntags: []\n---\n').meta.tags, []);
  const plain = fm.parse('# Просто текст');
  assert.equal(plain.hasFrontmatter, false);
  assert.equal(plain.body, '# Просто текст');
});

test('stringify → parse зберігає значення', () => {
  const meta = { title: 'Цитата "в лапках"', created: '2026-01-01', updated: '2026-01-01', type: 'idea', status: 'inbox', tags: ['a', 'b'], source: 'власний конспект' };
  assert.deepEqual(fm.parse(fm.stringify(meta)).meta, meta);
});
