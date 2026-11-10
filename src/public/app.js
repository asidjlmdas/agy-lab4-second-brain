'use strict';
/* Клієнтська частина Second Brain: список, фільтри, пошук, перегляд, створення й редагування.
 * Увесь текст із нотаток вставляється через textContent; innerHTML використовується лише для
 * HTML, який сервер уже екранував і зібрав у markdown.js. */

const state = { q: '', tag: '', category: '', status: '', meta: null };
const $ = (sel) => document.querySelector(sel);
const main = $('#main');

async function api(path, options = {}) {
  const init = { method: options.method || 'GET', headers: {} };
  if (options.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Помилка ${res.status}`);
  return data;
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'text') node.textContent = value;
    else if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

const noteHref = (id) => `#/note/${encodeURIComponent(id)}`;
const parseId = (hashPart) => decodeURIComponent(hashPart);

/* ---------- бічна панель ---------- */

function filterButton(label, count, pressed, onClick) {
  return el('li', {}, el('button', { type: 'button', 'aria-pressed': String(pressed), onclick: onClick }, [
    el('span', { text: label }),
    count === null ? null : el('span', { class: 'count', text: String(count) }),
  ]));
}

async function renderSidebar() {
  const [cats, tags, all] = await Promise.all([api('/api/categories'), api('/api/tags'), api('/api/notes')]);
  const cl = $('#categories');
  cl.replaceChildren(filterButton('Усі', all.length, !state.category, () => setFilter({ category: '' })),
    ...cats.map((c) => filterButton(c.name, c.count, state.category === c.name, () => setFilter({ category: state.category === c.name ? '' : c.name }))));

  const statusCounts = ['inbox', 'active', 'archived'].map((s) => [s, all.filter((n) => n.status === s).length]);
  $('#statuses').replaceChildren(...statusCounts.map(([s, n]) =>
    filterButton(s, n, state.status === s, () => setFilter({ status: state.status === s ? '' : s }))));

  $('#tags').replaceChildren(...tags.map((t) =>
    el('button', { type: 'button', class: 'tag', 'aria-pressed': String(state.tag === t.tag), text: `#${t.tag} · ${t.count}`,
      onclick: () => setFilter({ tag: state.tag === t.tag ? '' : t.tag }) })));
}

function setFilter(patch) {
  Object.assign(state, patch);
  if (location.hash !== '' && location.hash !== '#/') location.hash = '#/';
  else route();
}

/* ---------- список ---------- */

function describeFilters() {
  const parts = [];
  if (state.q) parts.push(`запит «${state.q}»`);
  if (state.tag) parts.push(`тег #${state.tag}`);
  if (state.category) parts.push(`категорія ${state.category}`);
  if (state.status) parts.push(`статус ${state.status}`);
  return parts.join(', ');
}

async function renderList() {
  const params = new URLSearchParams();
  for (const key of ['q', 'tag', 'category', 'status']) if (state[key]) params.set(key, state[key]);
  const notes = await api(`/api/notes?${params}`);
  await renderSidebar();

  const filters = describeFilters();
  const summary = el('p', { class: 'summary-line', role: 'status', text: filters ? `Знайдено: ${notes.length} (${filters})` : `Усього нотаток: ${notes.length}` });

  if (notes.length === 0) {
    main.replaceChildren(summary, el('div', { class: 'empty' }, [
      el('h3', { text: 'Нічого не знайдено' }),
      el('p', { text: filters ? `За умовами (${filters}) нотаток немає.` : 'У базі ще немає нотаток.' }),
      el('button', { class: 'btn', type: 'button', text: 'Скинути фільтри', onclick: resetFilters }),
    ]));
    return;
  }

  main.replaceChildren(summary, el('div', { class: 'cards' }, notes.map((n) =>
    el('a', { class: 'card', href: noteHref(n.id) }, [
      el('h3', { text: n.title }),
      el('div', { class: 'meta' }, [
        el('span', { class: 'badge', text: n.category }),
        el('span', { class: n.status === 'archived' ? 'badge archived' : 'badge', text: n.status }),
        el('span', { text: `оновлено ${n.updated}` }),
        el('span', { text: n.tags.map((t) => `#${t}`).join(' ') }),
      ]),
      el('p', { text: n.snippet }),
    ]))));
}

function resetFilters() {
  Object.assign(state, { q: '', tag: '', category: '', status: '' });
  $('#search').value = '';
  if (location.hash !== '' && location.hash !== '#/') location.hash = '#/';
  else route();
}

/* ---------- перегляд нотатки ---------- */

async function renderNote(id) {
  const note = await api(`/api/notes/${id.split('/').map(encodeURIComponent).join('/')}`);
  await renderSidebar();

  const body = el('div', { class: 'note-body' });
  body.innerHTML = note.html; // HTML зібраний і екранований на сервері (markdown.js)

  const linkList = (items, render, emptyText) =>
    items.length ? el('ul', {}, items.map(render)) : el('p', { class: 'hint', text: emptyText });

  const outgoing = linkList(note.links, (l) => el('li', {}, l.exists
    ? el('a', { href: noteHref(l.id), text: l.title })
    : el('span', { class: 'broken', title: 'Нотатки не існує', text: `${l.target} (не знайдено)` })), 'Немає вихідних посилань.');
  const backlinks = linkList(note.backlinks, (b) => el('li', {}, el('a', { href: noteHref(b.id), text: b.title })), 'Ніхто не посилається на цю нотатку.');

  const actions = el('div', { class: 'note-actions' }, [
    el('a', { class: 'btn', href: `#/edit/${encodeURIComponent(note.id)}`, text: 'Редагувати' }),
    note.category === 'Archives' ? null : el('button', { class: 'btn danger', type: 'button', text: 'Архівувати', onclick: async () => {
      if (!confirm(`Перенести «${note.title}» до Archives? Файл не буде видалено.`)) return;
      try {
        const moved = await api(`/api/notes/${note.id.split('/').map(encodeURIComponent).join('/')}/archive`, { method: 'POST', body: {} });
        location.hash = noteHref(moved.id);
      } catch (err) { alert(err.message); }
    } }),
    el('a', { class: 'btn ghost', href: '#/', text: '← До списку' }),
  ]);

  const meta = el('div', { class: 'meta' }, [
    el('span', { class: 'badge', text: note.category }),
    el('span', { class: note.status === 'archived' ? 'badge archived' : 'badge', text: note.status }),
    el('span', { text: `тип: ${note.type}` }),
    el('span', { text: `створено ${note.created}, оновлено ${note.updated}` }),
    ...note.tags.map((t) => el('button', { type: 'button', class: 'tag', text: `#${t}`, onclick: () => setFilter({ tag: t }) })),
  ]);

  main.replaceChildren(el('article', { class: 'note' }, [
    meta, actions, body,
    el('div', { class: 'links' }, [
      el('section', {}, [el('h2', { text: 'Вихідні посилання' }), outgoing]),
      el('section', {}, [el('h2', { text: 'Зворотні посилання' }), backlinks]),
    ]),
  ]));
  document.title = `${note.title} — Second Brain`;
}

/* ---------- створення та редагування ---------- */

function select(name, values, selected) {
  return el('select', { name }, values.map((v) => { const o = el('option', { value: v, text: v }); if (v === selected) o.selected = true; return o; }));
}

async function renderEditor(id) {
  state.meta = state.meta || (await api('/api/meta'));
  const existing = id ? await api(`/api/notes/${id.split('/').map(encodeURIComponent).join('/')}`) : null;
  await renderSidebar();

  const error = el('p', { class: 'error', role: 'alert' });
  const title = el('input', { name: 'title', required: '', maxlength: '200', value: existing ? existing.title : '' });
  if (existing) title.readOnly = true;
  const category = select('category', state.meta.categories, existing ? existing.category : 'Inbox');
  if (existing) category.disabled = true;
  const type = select('type', state.meta.types, existing ? existing.type : 'resource');
  const status = select('status', state.meta.statuses, existing ? existing.status : 'inbox');
  const tags = el('input', { name: 'tags', value: existing ? existing.tags.join(', ') : '', placeholder: 'git, linux, приватність' });
  const bodyArea = el('textarea', { name: 'body', placeholder: '# Заголовок\n\n## Короткий зміст\n…\n\nПосилання на іншу нотатку: [[Назва нотатки]]' });
  bodyArea.value = existing ? existing.body.replace(/^\n/, '') : '';

  const form = el('form', { class: 'editor' }, [
    el('h2', { text: existing ? `Редагування: ${existing.title}` : 'Нова нотатка' }),
    el('label', {}, ['Назва', title, existing ? el('span', { class: 'hint', text: 'Назву не можна змінити: вікі-посилання прив’язані до неї.' }) : null]),
    el('div', { class: 'row' }, [el('label', {}, ['Категорія', category]), el('label', {}, ['Тип', type]), el('label', {}, ['Статус', status])]),
    el('label', {}, ['Теги (через кому)', tags]),
    el('label', {}, ['Текст (Markdown)', bodyArea]),
    error,
    el('div', { class: 'form-actions' }, [
      el('button', { class: 'btn primary', type: 'submit', text: 'Зберегти' }),
      el('a', { class: 'btn ghost', href: existing ? noteHref(existing.id) : '#/', text: 'Скасувати' }),
    ]),
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    const payload = { type: type.value, status: status.value, tags: tags.value, body: bodyArea.value };
    try {
      const saved = existing
        ? await api(`/api/notes/${existing.id.split('/').map(encodeURIComponent).join('/')}`, { method: 'PUT', body: payload })
        : await api('/api/notes', { method: 'POST', body: { ...payload, title: title.value, category: category.value } });
      location.hash = noteHref(saved.id);
    } catch (err) {
      error.textContent = err.message;
    }
  });

  main.replaceChildren(form);
  title.focus();
}

/* ---------- маршрутизація ---------- */

async function route() {
  const hash = location.hash || '#/';
  document.title = 'Second Brain';
  try {
    if (hash.startsWith('#/note/')) await renderNote(parseId(hash.slice(7)));
    else if (hash === '#/new') await renderEditor(null);
    else if (hash.startsWith('#/edit/')) await renderEditor(parseId(hash.slice(7)));
    else await renderList();
  } catch (err) {
    main.replaceChildren(el('div', { class: 'empty' }, [
      el('h3', { text: 'Не вдалося відкрити' }),
      el('p', { text: err.message }),
      el('a', { class: 'btn', href: '#/', text: 'До списку' }),
    ]));
  }
  window.scrollTo(0, 0);
}

let timer;
$('#search').addEventListener('input', (event) => {
  clearTimeout(timer);
  timer = setTimeout(() => setFilter({ q: event.target.value.trim() }), 200);
});
$('#reset').addEventListener('click', resetFilters);
window.addEventListener('hashchange', route);
route();
