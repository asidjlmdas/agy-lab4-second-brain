'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { render, extractWikilinks } = require('../src/markdown');

const resolve = (t) => (t === 'Git' ? { id: 'Resources/Git', exists: true } : { id: null, exists: false });

test('екранує HTML і не виконує скрипти', () => {
  const html = render('<script>alert(1)</script> <img src=x onerror=alert(1)>', resolve);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.match(html, /&lt;script&gt;/);
});

test('вікі-посилання: існуюче, псевдонім і бите', () => {
  const html = render('[[Git]] [[Git|гіт]] [[Нема]]', resolve);
  assert.match(html, /<a class="wikilink" href="#\/note\/Resources%2FGit">Git<\/a>/);
  assert.match(html, />гіт<\/a>/);
  assert.match(html, /class="wikilink broken"[^>]*>Нема</);
});

test('javascript:-посилання знешкоджується', () => {
  const html = render('[клік](javascript:alert(1))', resolve);
  assert.ok(!html.includes('href="javascript'));
  assert.ok(!html.includes('<a '));
});

test('URL із дужками не «протікає» в текст (регресія)', () => {
  const html = render('[git](https://uk.wikipedia.org/wiki/Git_(програма)) кінець', resolve);
  assert.match(html, /href="https:\/\/uk\.wikipedia\.org\/wiki\/Git_\(програма\)"/);
  assert.ok(!html.includes('</a>)'));
});

test('заголовки, списки, код, цитата', () => {
  const html = render('# Н\n\n- a\n- b\n\n1. x\n\n```\n<b>\n```\n\n> цитата', resolve);
  assert.match(html, /<h1>Н<\/h1>/);
  assert.match(html, /<ul><li>a<\/li><li>b<\/li><\/ul>/);
  assert.match(html, /<ol><li>x<\/li><\/ol>/);
  assert.match(html, /<pre><code>&lt;b&gt;<\/code><\/pre>/);
  assert.match(html, /<blockquote>цитата<\/blockquote>/);
});

test('extractWikilinks ігнорує код і дублікати', () => {
  const links = extractWikilinks('[[A]] `[[B]]` [[A]] [[C|псевдонім]]\n```\n[[D]]\n```');
  assert.deepEqual(links, ['A', 'C']);
});
