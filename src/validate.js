'use strict';
/**
 * Валідатор бази нотаток: `npm run validate`.
 * Перевіряє обов’язкові поля frontmatter, допустимі значення, биті вікі-посилання,
 * відповідність каталогу та статусу (Archives ↔ archived). Код виходу 1, якщо є помилки.
 */

const path = require('node:path');
const { NoteStore, CATEGORIES, TYPES, STATUSES } = require('./notes');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateStore(store) {
  const errors = [];
  const warnings = [];

  for (const note of store.notes.values()) {
    const where = note.id;
    if (!note.hasFrontmatter) errors.push(`${where}: відсутній YAML frontmatter`);
    for (const field of note.missingFields) errors.push(`${where}: немає обов’язкового поля «${field}»`);
    if (note.type && !TYPES.includes(note.type)) errors.push(`${where}: невідомий type «${note.type}»`);
    if (note.status && !STATUSES.includes(note.status)) errors.push(`${where}: невідомий status «${note.status}»`);
    for (const field of ['created', 'updated']) {
      if (note[field] && !DATE_RE.test(note[field])) errors.push(`${where}: поле ${field} має бути у форматі РРРР-ММ-ДД`);
    }
    if (note.created && note.updated && note.updated < note.created) errors.push(`${where}: updated раніше за created`);
    if (note.category === 'Archives' && note.status !== 'archived') errors.push(`${where}: у Archives статус має бути archived`);
    if (note.category !== 'Archives' && note.status === 'archived') errors.push(`${where}: status archived поза каталогом Archives`);
    if (!CATEGORIES.includes(note.category)) errors.push(`${where}: невідома категорія`);
    for (const target of note.links) {
      if (!store.resolve(target).exists) errors.push(`${where}: бите посилання [[${target}]]`);
    }
    if (note.links.length === 0 && note.type !== 'idea') warnings.push(`${where}: немає вихідних посилань`);
  }
  return { errors, warnings, count: store.notes.size };
}

if (require.main === module) {
  const dir = process.argv[2] || path.join(__dirname, '..', 'notes');
  const store = new NoteStore(dir).refresh();
  const { errors, warnings, count } = validateStore(store);
  console.log(`Перевірено нотаток: ${count}`);
  for (const w of warnings) console.log(`  попередження: ${w}`);
  for (const e of errors) console.log(`  ПОМИЛКА: ${e}`);
  console.log(errors.length ? `Знайдено помилок: ${errors.length}` : 'Помилок немає ✔');
  process.exit(errors.length ? 1 : 0);
}

module.exports = { validateStore };
