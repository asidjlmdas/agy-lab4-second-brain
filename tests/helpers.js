'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CATEGORIES = ['Inbox', 'Projects', 'Areas', 'Resources', 'Archives'];

/** Створює тимчасовий каталог notes/ із невеликим набором нотаток. */
function makeVault(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-test-'));
  for (const c of CATEGORIES) fs.mkdirSync(path.join(root, c));
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
  }
  return root;
}

function note({ title, tags = [], type = 'resource', status = 'active', body = '' }) {
  return `---\ntitle: "${title}"\ncreated: 2026-01-01\nupdated: 2026-01-02\ntype: ${type}\nstatus: ${status}\ntags: [${tags.join(', ')}]\nsource: "тест"\n---\n\n${body}\n`;
}

const SAMPLE = {
  'Resources/Хмара.md': note({ title: 'Хмара', tags: ['cloud', 'хмара'], body: 'Огляд IaaS і SaaS. Див. [[Git]].' }),
  'Resources/Git.md': note({ title: 'Git', tags: ['git'], body: 'Система контролю версій. Повертається до [[Хмара]].' }),
  'Projects/Лаба.md': note({ title: 'Лаба', type: 'project', tags: ['git', 'навчання'], body: 'Пишемо про [[Git]] і [[Не існує]].' }),
  'Archives/Стара.md': note({ title: 'Стара', status: 'archived', tags: ['архів'], body: 'Нічого цікавого.' }),
};

module.exports = { makeVault, note, SAMPLE, CATEGORIES };
