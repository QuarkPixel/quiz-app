#!/usr/bin/env node
// scripts/export-xml.js
// 将一份题库 JSON（{ mode?, state?, questions }）导出为 XML 格式
// 用法: pnpm export-xml [input.json] [output.xml]

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const inputPath = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolve(root, 'banks/questions.example.json');

const parsed = JSON.parse(readFileSync(inputPath, 'utf-8'));
const questions = Array.isArray(parsed) ? parsed : parsed.questions;

if (!Array.isArray(questions)) {
  console.error(`[export-xml] 找不到 questions 数组: ${inputPath}`);
  process.exit(1);
}

const outputPath = process.argv[3]
  ? resolve(process.cwd(), process.argv[3])
  : inputPath.replace(/\.json$/i, '.xml');

// ── helpers ──────────────────────────────────────────────────────────────────

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function indent(depth) {
  return '  '.repeat(depth);
}

// ── renderers ─────────────────────────────────────────────────────────────────

function renderJudgment(q, d) {
  return [
    `${indent(d)}<answer>${q.answer ? 'true' : 'false'}</answer>`,
  ].join('\n');
}

function renderBlank(q, d) {
  return `${indent(d)}<answer>${escapeXml(q.answer)}</answer>`;
}

function renderChoice(q, d) {
  const correctSet = new Set(q.answer);
  const lines = [];
  lines.push(`${indent(d)}<options>`);
  q.options.forEach((opt, i) => {
    const correct = correctSet.has(i) ? ' correct="true"' : '';
    lines.push(`${indent(d + 1)}<option index="${i}"${correct}>${escapeXml(opt.text)}</option>`);
  });
  lines.push(`${indent(d)}</options>`);
  return lines.join('\n');
}

// ── main ──────────────────────────────────────────────────────────────────────

const lines = [];
lines.push('<?xml version="1.0" encoding="UTF-8"?>');
lines.push('<questions>');

for (const q of questions) {
  lines.push(`${indent(1)}<question id="${escapeXml(q.id)}" type="${q.type}">`);
  lines.push(`${indent(2)}<stem>${escapeXml(q.question)}</stem>`);

  if (q.type === 'judgment') {
    lines.push(renderJudgment(q, 2));
  } else if (q.type === 'blank') {
    lines.push(renderBlank(q, 2));
  } else {
    // single / multiple
    lines.push(renderChoice(q, 2));
  }

  lines.push(`${indent(1)}</question>`);
}

lines.push('</questions>');
lines.push(''); // trailing newline

const xml = lines.join('\n');
writeFileSync(outputPath, xml, 'utf-8');

const relative = outputPath.replace(root + '/', '');
console.log(`✓ ${questions.length} questions exported → ${relative}`);
