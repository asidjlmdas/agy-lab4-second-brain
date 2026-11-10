'use strict';
/**
 * Невеликий безпечний рендерер Markdown → HTML.
 * Увесь HTML із нотаток екранується; підтримуються заголовки, списки, цитати,
 * блоки коду, жирний/курсив, посилання http(s)/mailto та вікі-посилання [[Назва]] / [[Назва|текст]].
 */

const WIKILINK_RE = /\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Прибирає блоки коду та інлайн-код, щоб не шукати в них посилання. */
function stripCode(body) {
  return body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

/** Повертає унікальні цілі вікі-посилань у порядку появи. */
function extractWikilinks(body) {
  const seen = new Set();
  const out = [];
  for (const m of stripCode(body).matchAll(WIKILINK_RE)) {
    const target = m[1].trim();
    if (target && !seen.has(target)) {
      seen.add(target);
      out.push(target);
    }
  }
  return out;
}

function isSafeUrl(url) {
  return /^(https?:\/\/|mailto:|#)/i.test(url.trim());
}

function renderInline(text, resolveLink) {
  const slots = [];
  const hold = (html) => `\u0000${slots.push(html) - 1}\u0000`;

  let s = String(text);
  s = s.replace(/`([^`\n]+)`/g, (_, code) => hold(`<code>${escapeHtml(code)}</code>`));
  s = s.replace(WIKILINK_RE, (_, target, alias) => {
    const label = (alias || target).trim();
    const hit = resolveLink ? resolveLink(target.trim()) : null;
    if (hit && hit.exists) {
      const href = `#/note/${encodeURIComponent(hit.id)}`;
      return hold(`<a class="wikilink" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`);
    }
    return hold(`<span class="wikilink broken" title="Нотатку не знайдено">${escapeHtml(label)}</span>`);
  });
  // URL може містити один рівень дужок, наприклад https://uk.wikipedia.org/wiki/Git_(програма)
  s = s.replace(/\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (_, label, url) => {
    if (!isSafeUrl(url)) return hold(escapeHtml(label));
    return hold(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`);
  });

  s = escapeHtml(s);
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(?<![\p{L}\p{N}_])__([^_\n]+)__(?![\p{L}\p{N}_])/gu, '<strong>$1</strong>');
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  s = s.replace(/(?<![\p{L}\p{N}_])_([^_\n]+)_(?![\p{L}\p{N}_])/gu, '<em>$1</em>');

  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]);
}

function render(body, resolveLink) {
  const lines = String(body).replace(/\r\n?/g, '\n').split('\n');
  const html = [];
  let i = 0;

  const startsBlock = (line) =>
    /^(#{1,6}\s|```|>\s?|[-*]\s+|\d+\.\s+|(-{3,}|\*{3,})\s*$)/.test(line);

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    if (line.startsWith('```')) {
      const buf = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
      i += 1; // закриваючий ```
      html.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2].trim(), resolveLink)}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      html.push('<hr>');
      i += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      html.push(`<blockquote>${renderInline(buf.join(' '), resolveLink)}</blockquote>`);
      continue;
    }

    const ul = /^[-*]\s+/;
    const ol = /^\d+\.\s+/;
    if (ul.test(line) || ol.test(line)) {
      const ordered = ol.test(line);
      const marker = ordered ? ol : ul;
      const items = [];
      while (i < lines.length && marker.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].replace(marker, ''), resolveLink)}</li>`);
        i += 1;
      }
      html.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }

    const buf = [];
    while (i < lines.length && lines[i].trim() !== '' && !(buf.length > 0 && startsBlock(lines[i]))) {
      buf.push(lines[i++].trim());
    }
    html.push(`<p>${renderInline(buf.join(' '), resolveLink)}</p>`);
  }

  return html.join('\n');
}

module.exports = { render, renderInline, escapeHtml, extractWikilinks, WIKILINK_RE };
