#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function normalizeVietnamese(text) {
  let normalized = text.toLowerCase().trim();
  const applyRules = [
    { pattern: /o[àáảãạ](?=$|[^\p{L}])/gu, replace: (m) => ({ 'oà': 'òa', 'oá': 'óa', 'oả': 'ỏa', 'oã': 'õa', 'oạ': 'ọa' }[m]) },
    { pattern: /u[ýỳỷỹỵ](?=$|[^\p{L}])/gu, replace: (m, offset, str) => { const prev = offset > 0 ? str[offset - 1] : ''; if (prev === 'q') return m; const map = { 'uý': 'úy', 'uỳ': 'ùy', 'uỷ': 'ủy', 'uỹ': 'ũy', 'uỵ': 'ụy' }; return map[m] || m; } },
    { pattern: /hoà(?=$|[^\p{L}])/gu, replace: () => 'hòa' },
    { pattern: /toà(?=$|[^\p{L}])/gu, replace: () => 'tòa' },
  ];
  for (const rule of applyRules) normalized = normalized.replace(rule.pattern, (...args) => rule.replace(...args));
  return normalized;
}

function main() {
  const assetsDir = path.join(__dirname, '..', 'src', 'assets');
  const srcFile = path.join(assetsDir, 'wordPairs.json');
  const backupFile = path.join(assetsDir, 'wordPairs.backup.json');
  const outFile = path.join(assetsDir, 'wordPairs.normalized.json');

  const raw = JSON.parse(fs.readFileSync(srcFile, 'utf8'));
  const normalized = {};
  for (const [k, arr] of Object.entries(raw)) {
    const nk = normalizeVietnamese(k);
    if (!normalized[nk]) normalized[nk] = [];
    for (const v of arr) {
      const nv = normalizeVietnamese(v);
      if (!normalized[nk].includes(nv)) normalized[nk].push(nv);
    }
  }

  // Write normalized output and a backup
  fs.writeFileSync(outFile, JSON.stringify(normalized, null, 2), 'utf8');
  if (!fs.existsSync(backupFile)) fs.writeFileSync(backupFile, JSON.stringify(raw, null, 2), 'utf8');

  // Optionally replace original (uncomment next two lines if desired by user)
  // fs.writeFileSync(srcFile, JSON.stringify(normalized, null, 2), 'utf8');
  // console.log('Replaced original with normalized data.');

  console.log('Wrote:', outFile);
  // basic duplicate report
  let dupKeys = 0, dupVals = 0;
  for (const [k, arr] of Object.entries(normalized)) {
    const set = new Set(arr);
    if (set.size !== arr.length) dupVals++;
  }
  console.log('Duplicate value lists after normalization:', dupVals);
}

main();
