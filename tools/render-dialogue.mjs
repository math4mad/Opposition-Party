#!/usr/bin/env node
// Render a Qwen-style chat export (JSON) into a Quarto markdown page.
// Usage: node tools/render-dialogue.mjs <input.json> <output.qmd>
//
// Roles: assistant -> qwen, user -> math4mad

import fs from 'node:fs';
import path from 'node:path';

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error('usage: render-dialogue.mjs <input.json> <output.qmd>');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const chats = Array.isArray(raw) ? raw : [raw];

const AGENT = 'qwen';
const HUMAN = 'math4mad';

function textOf(msg) {
  const parts = (msg.content_list || [])
    .filter((c) => c.phase === 'answer' && typeof c.content === 'string' && c.content.trim())
    .map((c) => c.content);
  if (parts.length) return parts.join('\n\n');
  return typeof msg.content === 'string' ? msg.content : '';
}

function thinkingOf(msg) {
  const c = (msg.content_list || []).find((x) => x.phase === 'thinking_summary');
  if (!c) return '';
  const thoughts = c.extra?.summary_thought?.content || [];
  const titles = c.extra?.summary_title?.content || [];
  const body = [...titles, ...thoughts].filter(Boolean).join('\n\n');
  if (!body.trim()) return '';
  return body;
}

function attachmentsOf(msg) {
  return (msg.files || []).map((f) => f.name || f.file?.filename).filter(Boolean);
}

function orderMessages(chat) {
  const msgs = chat.chat?.history?.messages || {};
  const list = Object.values(msgs);
  const byId = new Map(list.map((m) => [m.id, m]));
  const roots = list.filter((m) => !m.parentId || !byId.has(m.parentId));
  const seen = new Set();
  const out = [];
  const walk = (m) => {
    if (!m || seen.has(m.id)) return;
    seen.add(m.id);
    out.push(m);
    for (const cid of m.childrenIds || []) walk(byId.get(cid));
  };
  roots.forEach(walk);
  // include any orphans (cycles / dangling parents) at the end
  list.forEach((m) => walk(m));
  return out;
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function fence(text) {
  // Guard against content that could break out of a fenced div / code fence.
  return text.replace(/^\s*:::\s*$/gm, '`\\:`');
}

const chunks = [];
chunks.push('---');
chunks.push('title: "Idea"');
chunks.push('subtitle: "Paper Review — Concept Formation and Alignment in Language Models"');
chunks.push('author: "math4mad × qwen"');
chunks.push('date: last-modified');
chunks.push('toc: true');
chunks.push('number-sections: false');
chunks.push('format:');
chunks.push('  html:');
chunks.push('    toc-depth: 3');
chunks.push('---');
chunks.push('');
chunks.push('> Conversation transcript exported from a Qwen chat session.');
chunks.push('> The human side is **math4mad**; the model side is **qwen**.');
chunks.push('');

let turn = 0;
for (const chat of chats) {
  const title = chat.title || 'Untitled';
  chunks.push(`## ${title}`);
  chunks.push('');
  const messages = orderMessages(chat);
  for (const msg of messages) {
    const isUser = msg.role === 'user';
    const who = isUser ? HUMAN : AGENT;
    const body = textOf(msg);
    const think = thinkingOf(msg);
    const files = attachmentsOf(msg);
    if (!body.trim() && !think.trim() && !files.length) continue;
    turn += 1;
    const cls = isUser ? 'chat-user' : 'chat-agent';
    chunks.push(`::: {.${cls} #turn-${turn}}`);
    chunks.push(`**${who}**`);
    chunks.push('');
    if (files.length) {
      chunks.push(`*Attachments:* ${files.map((f) => `\`${f}\``).join(', ')}`);
      chunks.push('');
    }
    if (think.trim()) {
      chunks.push('<details markdown="1">');
      chunks.push('<summary><strong>Reasoning summary (qwen)</strong></summary>');
      chunks.push('');
      chunks.push(fence(think.trim()));
      chunks.push('');
      chunks.push('</details>');
      chunks.push('');
    }
    if (body.trim()) {
      chunks.push(fence(body.trim()));
      chunks.push('');
    }
    chunks.push(':::');
    chunks.push('');
  }
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, chunks.join('\n'), 'utf8');
console.log(`wrote ${outputPath} (${turn} turns)`);
