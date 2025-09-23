const axios = require('axios');
const fs = require('fs');
const path = require('path');

function normalizeVietnamese(text) {
  let normalized = text.toLowerCase().trim();

  const applyRules = [
    {
      pattern: /o[àáảãạ](?=$|[^\p{L}])/gu,
      replace: (m) => ({ 'oà': 'òa', 'oá': 'óa', 'oả': 'ỏa', 'oã': 'õa', 'oạ': 'ọa' }[m])
    },
    {
      pattern: /u[ýỳỷỹỵ](?=$|[^\p{L}])/gu,
      replace: (m, offset, str) => {
        const prev = offset > 0 ? str[offset - 1] : '';
        if (prev === 'q') return m;
        const map = { 'uý': 'úy', 'uỳ': 'ùy', 'uỷ': 'ủy', 'uỹ': 'ũy', 'uỵ': 'ụy' };
        return map[m] || m;
      }
    },
    { pattern: /hoà(?=$|[^\p{L}])/gu, replace: () => 'hòa' },
    { pattern: /toà(?=$|[^\p{L}])/gu, replace: () => 'tòa' },
  ];

  for (const rule of applyRules) {
    normalized = normalized.replace(rule.pattern, (...args) => rule.replace(...args));
  }

  return normalized;
}

const rawWordPairs = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'wordPairs.json'), 'utf8'));

// Build normalized, merged wordPairs
const wordPairs = {};
for (const [k, arr] of Object.entries(rawWordPairs)) {
  const nk = normalizeVietnamese(k);
  if (!wordPairs[nk]) wordPairs[nk] = [];
  for (const v of arr) {
    const nv = normalizeVietnamese(v);
    if (!wordPairs[nk].includes(nv)) wordPairs[nk].push(nv);
  }
}

// Rebuild listWords from normalized pairs
const listWords = [];
for (const firstWord in wordPairs) {
  for (const secondWord of wordPairs[firstWord]) {
    listWords.push(`${firstWord} ${secondWord}`);
  }
}

function getnoitu(playerWord) {
  if (!playerWord || typeof playerWord !== 'string') {
    return 'Từ không hợp lệ';
  }
  
  const normalizedInput = normalizeVietnamese(playerWord.trim());
  if (normalizedInput.split(' ').length !== 2) {
    return 'Từ bắt buộc phải gồm 2 từ ';
  } else {
    const lastWord = normalizedInput.split(' ')[1];
    const possibleSecondWords = wordPairs[lastWord] || [];
    if (possibleSecondWords.length > 0) {
      const secondWord = possibleSecondWords[Math.floor(Math.random() * possibleSecondWords.length)];
      return `${lastWord} ${secondWord}`;
    } else {
      return null;
    }
  }
}

async function tratu(word) {
  if (!word || typeof word !== 'string') {
    return 'Từ không hợp lệ để tra cứu';
  }
  
  const trimmedWord = word.trim();
  if (trimmedWord.length === 0) {
    return 'Từ không được để trống';
  }
  
  try {
    const response = await axios.get(`https://minhqnd.com/api/dictionary/lookup?word=${encodeURIComponent(trimmedWord)}`);
    if (response.status === 200 && response.data) {
      const data = response.data;
      if (data.error || !data.meanings || data.meanings.length === 0) {
        return `Không tìm thấy định nghĩa cho từ "${trimmedWord}", đây có thể là một từ ghép hán việt, vui lòng tra cứu ở các nguồn khác.`;
      }
      // Format similar to the React component
      let formatted = `**Giải nghĩa:**\n`;
      data.meanings.forEach((m, idx) => {
        formatted += `• **${m.definition}**\n`;
        let details = [];
        if (m.pos) details.push(`**Loại:** ${m.pos}`);
        if (m.sub_pos) details.push(`**Nhóm:** ${m.sub_pos}`);
        if (details.length > 0) {
          formatted += `  ${details.join(' · ')}\n`;
        }
        if (m.example) {
          formatted += `  **VD:** ${m.example}\n`;
        }
        formatted += '\n';
      });
      return `**Từ tra cứu: "${data.word || trimmedWord}"**\n\n${formatted.trim()}`;
    } else {
      return "Không thể lấy dữ liệu từ API";
    }
  } catch (error) {
    return "Không thể lấy dữ liệu từ API";
  }
}

module.exports = { getnoitu, tratu, listWords, wordPairs, normalizeVietnamese };