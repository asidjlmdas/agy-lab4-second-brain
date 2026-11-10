'use strict';
/* Перевірка реальної бази notes/ проєкту: вимоги лабораторної та цілісність даних
 * (захист від того, що агент щось пошкодив або «вигадав»). */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { NoteStore } = require('../src/notes');
const { validateStore } = require('../src/validate');

const store = new NoteStore(path.join(__dirname, '..', 'notes')).refresh();

test('у базі щонайменше 8 нотаток і всі п’ять категорій існують', () => {
  assert.ok(store.notes.size >= 8, `нотаток: ${store.notes.size}`);
  for (const c of ['Inbox', 'Projects', 'Areas', 'Resources', 'Archives']) {
    assert.ok([...store.notes.values()].some((n) => n.category === c), `порожня категорія ${c}`);
  }
});

test('є MOC-нотатка, архівована нотатка та пара взаємно пов’язаних нотаток', () => {
  const all = [...store.notes.values()];
  assert.ok(all.some((n) => n.type === 'moc'));
  assert.ok(all.some((n) => n.status === 'archived' && n.category === 'Archives'));
  const mutual = all.some((a) => a.links.some((t) => {
    const hit = store.resolve(t);
    return hit.exists && store.get(hit.id).links.some((back) => store.resolve(back).id === a.id);
  }));
  assert.ok(mutual, 'немає двох нотаток, що посилаються одна на одну');
});

test('валідатор: усі обов’язкові поля є, биті посилання відсутні', () => {
  const { errors } = validateStore(store);
  assert.deepEqual(errors, []);
});

test('жодна нотатка не містить схожого на секрет рядка', () => {
  const suspicious = /(ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|password\s*[:=]\s*\S+)/i;
  for (const n of store.notes.values()) assert.ok(!suspicious.test(n.body), `схоже на секрет у ${n.id}`);
});
