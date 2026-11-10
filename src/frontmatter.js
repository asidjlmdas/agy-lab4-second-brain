'use strict';
/**
 * Мінімальний парсер YAML frontmatter без зовнішніх залежностей.
 * Підтримує: рядки (з лапками і без), дати як рядки, інлайн-списки [a, b],
 * CRLF-переноси рядків та BOM на початку файлу.
 */

const FM_RE = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/;

function stripQuotes(value) {
  const v = value.trim();
  if (v.length >= 2) {
    const first = v[0];
    const last = v[v.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return v.slice(1, -1).replace(/\\"/g, '"');
    }
  }
  return v;
}

function parseInlineList(value) {
  const inner = value.trim().slice(1, -1).trim();
  if (inner === '') return [];
  return inner
    .split(',')
    .map((item) => stripQuotes(item))
    .filter((item) => item !== '');
}

/** Повертає { meta, body, hasFrontmatter }. */
function parse(text) {
  const normalized = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const match = FM_RE.exec(normalized);
  if (!match) return { meta: {}, body: normalized, hasFrontmatter: false };

  const meta = {};
  for (const line of match[1].split('\n')) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const raw = line.slice(idx + 1).trim();
    meta[key] = raw.startsWith('[') && raw.endsWith(']') ? parseInlineList(raw) : stripQuotes(raw);
  }
  return { meta, body: normalized.slice(match[0].length), hasFrontmatter: true };
}

function quote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

const KEY_ORDER = ['title', 'created', 'updated', 'type', 'status', 'tags', 'source'];

/** Серіалізує meta у YAML frontmatter у стабільному порядку ключів. */
function stringify(meta) {
  const keys = [...KEY_ORDER.filter((k) => k in meta), ...Object.keys(meta).filter((k) => !KEY_ORDER.includes(k))];
  const lines = keys.map((key) => {
    const value = meta[key];
    if (Array.isArray(value)) return `${key}: [${value.map((t) => String(t)).join(', ')}]`;
    if (key === 'title' || key === 'source') return `${key}: ${quote(value)}`;
    return `${key}: ${value}`;
  });
  return `---\n${lines.join('\n')}\n---\n`;
}

module.exports = { parse, stringify };
