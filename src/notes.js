'use strict';
/**
 * Сховище нотаток: читає .md-файли з notes/<Категорія>/, будує індекс,
 * виконує пошук, фільтрацію за тегами, зворотні посилання, створення й оновлення.
 */

const fs = require('node:fs');
const path = require('node:path');
const frontmatter = require('./frontmatter');
const { extractWikilinks } = require('./markdown');

const CATEGORIES = ['Inbox', 'Projects', 'Areas', 'Resources', 'Archives'];
const TYPES = ['resource', 'project', 'area', 'moc', 'idea', 'draft'];
const STATUSES = ['inbox', 'active', 'archived'];
const REQUIRED_FIELDS = ['title', 'created', 'updated', 'type', 'status', 'tags'];

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
  }
}

class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
    this.status = 404;
  }
}

const lower = (s) => String(s).toLocaleLowerCase('uk');

function today(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

function normalizeTag(tag) {
  return lower(String(tag).trim().replace(/^#/, '')).replace(/\s+/g, '-');
}

function normalizeTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags || '').split(',');
  return [...new Set(list.map(normalizeTag).filter(Boolean))];
}

function sanitizeFileName(title) {
  const cleaned = String(title)
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 100)
    .replace(/[.\s]+$/g, '');
  return cleaned || 'untitled';
}

function stripMarkdown(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s+.*$/gm, ' ')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t, a) => a || t)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`>#-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

class NoteStore {
  constructor(rootDir, { now = () => new Date() } = {}) {
    this.root = path.resolve(rootDir);
    this.now = now;
    this.notes = new Map();
    this.titleIndex = new Map();
  }

  /** Перечитує всі нотатки з диска. */
  refresh() {
    const notes = new Map();
    for (const category of CATEGORIES) {
      const dir = path.join(this.root, category);
      if (!fs.existsSync(dir)) continue;
      for (const file of this._walk(dir)) {
        const note = this._readNote(file, category);
        notes.set(note.id, note);
      }
    }
    this.notes = notes;
    this.titleIndex = new Map();
    for (const note of [...notes.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      for (const key of [lower(note.title), lower(path.basename(note.id))]) {
        if (!this.titleIndex.has(key)) this.titleIndex.set(key, note.id);
      }
    }
    return this;
  }

  _walk(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...this._walk(full));
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) out.push(full);
    }
    return out.sort();
  }

  _readNote(file, category) {
    const raw = fs.readFileSync(file, 'utf8');
    const { meta, body, hasFrontmatter } = frontmatter.parse(raw);
    const rel = path.relative(this.root, file).split(path.sep).join('/');
    const id = rel.replace(/\.md$/i, '');
    const missing = REQUIRED_FIELDS.filter((f) => !(f in meta) || meta[f] === '');
    return {
      id,
      category,
      title: meta.title || path.basename(id),
      created: meta.created || '',
      updated: meta.updated || '',
      type: meta.type || '',
      status: meta.status || '',
      tags: Array.isArray(meta.tags) ? meta.tags.map(normalizeTag) : normalizeTags(meta.tags),
      source: meta.source || '',
      meta,
      body,
      links: extractWikilinks(body),
      hasFrontmatter,
      missingFields: missing,
    };
  }

  /** Знаходить нотатку за назвою або іменем файлу (без урахування регістру). */
  resolve(target) {
    const id = this.titleIndex.get(lower(target.trim()));
    return id ? { id, exists: true } : { id: null, exists: false };
  }

  summary(note, tokens = []) {
    let snippet = stripMarkdown(note.body);
    const hay = lower(snippet);
    const first = tokens.map((t) => hay.indexOf(t)).filter((n) => n >= 0).sort((a, b) => a - b)[0];
    const LIMIT = 170;
    const start = first === undefined ? 0 : Math.max(0, first - 40);
    const piece = snippet.slice(start, start + LIMIT);
    const cut = start + LIMIT < snippet.length ? piece.replace(/\s+\S*$/, '') + '…' : piece;
    snippet = (start > 0 ? '…' : '') + cut;
    return {
      id: note.id,
      title: note.title,
      category: note.category,
      type: note.type,
      status: note.status,
      tags: note.tags,
      created: note.created,
      updated: note.updated,
      snippet,
    };
  }

  /** Список нотаток із пошуком (q) та фільтрами (tag, category, status, type). */
  list({ q = '', tag = '', category = '', status = '', type = '' } = {}) {
    const tokens = lower(q).split(/\s+/).filter(Boolean);
    const wantedTag = tag ? normalizeTag(tag) : '';
    const scored = [];

    for (const note of this.notes.values()) {
      if (category && note.category !== category) continue;
      if (status && note.status !== status) continue;
      if (type && note.type !== type) continue;
      if (wantedTag && !note.tags.includes(wantedTag)) continue;

      let score = 0;
      if (tokens.length) {
        const title = lower(note.title);
        const tags = lower(note.tags.join(' '));
        const body = lower(note.body);
        let all = true;
        for (const t of tokens) {
          const inTitle = title.includes(t);
          const inTags = tags.includes(t);
          const inBody = body.includes(t);
          if (!inTitle && !inTags && !inBody) {
            all = false;
            break;
          }
          score += (inTitle ? 3 : 0) + (inTags ? 2 : 0) + (inBody ? 1 : 0);
        }
        if (!all) continue;
      }
      scored.push({ note, score });
    }

    scored.sort(
      (a, b) =>
        b.score - a.score ||
        String(b.note.updated).localeCompare(String(a.note.updated)) ||
        a.note.title.localeCompare(b.note.title, 'uk'),
    );
    return scored.map(({ note }) => this.summary(note, tokens));
  }

  tags() {
    const counts = new Map();
    for (const note of this.notes.values()) for (const t of note.tags) counts.set(t, (counts.get(t) || 0) + 1);
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'uk'));
  }

  categories() {
    return CATEGORIES.map((name) => ({
      name,
      count: [...this.notes.values()].filter((n) => n.category === name).length,
    }));
  }

  get(id) {
    const note = this.notes.get(id);
    if (!note) throw new NotFoundError(`Нотатку «${id}» не знайдено`);
    return note;
  }

  backlinks(id) {
    const note = this.get(id);
    const keys = new Set([lower(note.title), lower(path.basename(note.id))]);
    return [...this.notes.values()]
      .filter((other) => other.id !== id && other.links.some((l) => keys.has(lower(l))))
      .map((other) => ({ id: other.id, title: other.title }));
  }

  outgoing(id) {
    return this.get(id).links.map((target) => {
      const hit = this.resolve(target);
      return { target, exists: hit.exists, id: hit.id, title: hit.exists ? this.notes.get(hit.id).title : target };
    });
  }

  /** Безпечно перетворює id на шлях усередині notes/ (захист від ../). */
  _fileFor(id) {
    const parts = String(id).split('/');
    if (parts.length < 2 || !CATEGORIES.includes(parts[0]) || parts.some((p) => p === '' || p === '.' || p === '..')) {
      throw new NotFoundError(`Нотатку «${id}» не знайдено`);
    }
    const file = path.resolve(this.root, `${id}.md`);
    if (!file.startsWith(this.root + path.sep)) throw new NotFoundError(`Нотатку «${id}» не знайдено`);
    return file;
  }

  _validate(data, { partial = false } = {}) {
    const out = {};
    if (!partial || data.title !== undefined) {
      const title = String(data.title ?? '').trim();
      if (!title) throw new ValidationError('Поле «title» обов’язкове');
      if (title.length > 200) throw new ValidationError('Заголовок задовгий (максимум 200 символів)');
      out.title = title;
    }
    if (data.category !== undefined || !partial) {
      const category = data.category || 'Inbox';
      if (!CATEGORIES.includes(category)) throw new ValidationError(`Невідома категорія: ${category}`);
      out.category = category;
    }
    if (data.type !== undefined || !partial) {
      const type = data.type || 'resource';
      if (!TYPES.includes(type)) throw new ValidationError(`Невідомий тип: ${type}`);
      out.type = type;
    }
    if (data.status !== undefined || !partial) {
      const status = data.status || (out.category === 'Inbox' ? 'inbox' : 'active');
      if (!STATUSES.includes(status)) throw new ValidationError(`Невідомий статус: ${status}`);
      out.status = status;
    }
    if (data.tags !== undefined || !partial) out.tags = normalizeTags(data.tags);
    if (data.body !== undefined || !partial) {
      const body = String(data.body ?? '');
      if (body.length > 200000) throw new ValidationError('Текст нотатки завеликий (максимум 200 000 символів)');
      out.body = body;
    }
    if (data.source !== undefined) out.source = String(data.source).slice(0, 300);
    return out;
  }

  create(data) {
    const v = this._validate(data);
    const date = today(this.now());
    const base = sanitizeFileName(v.title);
    let name = base;
    let n = 2;
    while (fs.existsSync(path.join(this.root, v.category, `${name}.md`))) name = `${base} (${n++})`;

    const dir = path.join(this.root, v.category);
    fs.mkdirSync(dir, { recursive: true });
    const meta = {
      title: v.title,
      created: date,
      updated: date,
      type: v.type,
      status: v.status,
      tags: v.tags,
      source: v.source || 'власний конспект',
    };
    const body = v.body.trim() ? `\n${v.body.replace(/\r\n?/g, '\n').trimEnd()}\n` : `\n# ${v.title}\n`;
    fs.writeFileSync(path.join(dir, `${name}.md`), frontmatter.stringify(meta) + body, { encoding: 'utf8', flag: 'wx' });
    this.refresh();
    return this.get(`${v.category}/${name}`);
  }

  /** Оновлює теги, статус, тип і текст. Заголовок і файл не перейменовуються (посилання тримаються на назві). */
  update(id, data) {
    const file = this._fileFor(id);
    const note = this.get(id);
    if (data.title !== undefined && String(data.title).trim() !== note.title) {
      throw new ValidationError('Зміна заголовка не підтримується: вікі-посилання прив’язані до назви');
    }
    const v = this._validate({ ...data, title: note.title }, { partial: true });
    const meta = { ...note.meta };
    for (const key of ['type', 'status', 'tags']) if (v[key] !== undefined) meta[key] = v[key];
    if (v.source !== undefined) meta.source = v.source;
    meta.updated = today(this.now());
    const body = v.body !== undefined ? v.body.replace(/\r\n?/g, '\n') : note.body;
    fs.writeFileSync(file, frontmatter.stringify(meta) + body, 'utf8');
    this.refresh();
    return this.get(id);
  }

  /** Переносить нотатку до Archives зі статусом archived (файл не видаляється). */
  archive(id) {
    const file = this._fileFor(id);
    const note = this.get(id);
    if (note.category === 'Archives') return note;
    const base = path.basename(file, '.md');
    let name = base;
    let n = 2;
    while (fs.existsSync(path.join(this.root, 'Archives', `${name}.md`))) name = `${base} (${n++})`;
    const meta = { ...note.meta, status: 'archived', updated: today(this.now()) };
    fs.mkdirSync(path.join(this.root, 'Archives'), { recursive: true });
    fs.writeFileSync(path.join(this.root, 'Archives', `${name}.md`), frontmatter.stringify(meta) + note.body, {
      encoding: 'utf8',
      flag: 'wx',
    });
    fs.unlinkSync(file);
    this.refresh();
    return this.get(`Archives/${name}`);
  }
}

module.exports = {
  NoteStore,
  ValidationError,
  NotFoundError,
  CATEGORIES,
  TYPES,
  STATUSES,
  REQUIRED_FIELDS,
  normalizeTag,
  normalizeTags,
  sanitizeFileName,
  today,
};
