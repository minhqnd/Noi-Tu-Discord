const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { GAME_CONSTANTS } = require('./utils');

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

const customWordsPath = path.join(__dirname, 'assets', 'customWords.json');
let rawCustomWords = {};
try {
  if (fs.existsSync(customWordsPath)) {
    rawCustomWords = JSON.parse(fs.readFileSync(customWordsPath, 'utf8'));
  }
} catch (err) {
  rawCustomWords = {};
}

const rawWordPairs = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'wordPairs.json'), 'utf8'));

// Build normalized, merged wordPairs
const wordPairs = {};
function mergePairs(source) {
  for (const [k, arr] of Object.entries(source)) {
    const nk = normalizeVietnamese(k);
    if (!wordPairs[nk]) wordPairs[nk] = [];
    for (const v of arr) {
      const nv = normalizeVietnamese(v);
      if (!wordPairs[nk].includes(nv)) wordPairs[nk].push(nv);
    }
  }
}

mergePairs(rawWordPairs);
mergePairs(rawCustomWords);

// Rebuild listWords from normalized pairs
const listWords = [];
for (const firstWord in wordPairs) {
  for (const secondWord of wordPairs[firstWord]) {
    listWords.push(`${firstWord} ${secondWord}`);
  }
}
const listWordSet = new Set(listWords);

function addWord(input) {
  if (!input || typeof input !== 'string') {
    return { success: false, message: 'Từ không hợp lệ.' };
  }

  const rawItems = input.split(/[,，\n]+/).map(s => s.trim()).filter(Boolean);
  if (rawItems.length === 0) {
    return { success: false, message: 'Vui lòng nhập ít nhất một từ.' };
  }

  const added = [];
  const existing = [];
  const invalid = [];

  // Read current customData once
  let customData = {};
  if (fs.existsSync(customWordsPath)) {
    try {
      customData = JSON.parse(fs.readFileSync(customWordsPath, 'utf8'));
    } catch {
      customData = {};
    }
  }

  for (const rawItem of rawItems) {
    const normalized = normalizeVietnamese(rawItem);
    const parts = normalized.split(/\s+/);

    if (parts.length !== 2) {
      invalid.push(rawItem);
      continue;
    }

    if (listWordSet.has(normalized) || added.includes(normalized)) {
      existing.push(normalized);
      continue;
    }

    const [firstWord, secondWord] = parts;

    // 1. Update in-memory structures
    if (!wordPairs[firstWord]) wordPairs[firstWord] = [];
    if (!wordPairs[firstWord].includes(secondWord)) wordPairs[firstWord].push(secondWord);
    listWords.push(normalized);
    listWordSet.add(normalized);

    // 2. Prepare customData
    if (!customData[firstWord]) customData[firstWord] = [];
    if (!customData[firstWord].includes(secondWord)) {
      customData[firstWord].push(secondWord);
    }

    added.push(normalized);
  }

  if (added.length > 0) {
    try {
      fs.writeFileSync(customWordsPath, JSON.stringify(customData, null, 2), 'utf8');
      return {
        success: true,
        word: added.length === 1 ? added[0] : added.join(', '),
        added,
        existing,
        invalid
      };
    } catch (error) {
      return { success: false, message: `Lỗi khi lưu file: ${error.message}`, added: [], existing, invalid };
    }
  } else {
    return {
      success: false,
      message: 'Không có từ nào được thêm.',
      added: [],
      existing,
      invalid
    };
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
  if (trimmedWord.length > GAME_CONSTANTS.DICTIONARY_LOOKUP_MAX_WORD_LENGTH) {
    return `Từ tra cứu không được vượt quá ${GAME_CONSTANTS.DICTIONARY_LOOKUP_MAX_WORD_LENGTH} ký tự`;
  }
  
  try {
    const response = await axios.get(`https://dict.minhqnd.com/api/v1/lookup?word=${encodeURIComponent(trimmedWord)}`, {
      timeout: GAME_CONSTANTS.DICTIONARY_LOOKUP_TIMEOUT_MS,
      maxContentLength: GAME_CONSTANTS.DICTIONARY_LOOKUP_MAX_CONTENT_LENGTH,
      maxBodyLength: GAME_CONSTANTS.DICTIONARY_LOOKUP_MAX_CONTENT_LENGTH,
    });
    if (response.status === 200 && response.data) {
      const data = response.data;
      if (!data.exists || !data.results || data.results.length === 0) {
        return `Không tìm thấy định nghĩa cho từ "${trimmedWord}", đây có thể là một từ ghép hán việt, vui lòng tra cứu ở các nguồn khác.`;
      }

      let formatted = '';

      for (const langResult of data.results) {

        // Meanings
        if (langResult.meanings && langResult.meanings.length > 0) {
          formatted += `**Giải nghĩa:**\n`;
          langResult.meanings.forEach((m) => {
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
        }

        // Translations
        if (langResult.translations && langResult.translations.length > 0) {
          const trans = langResult.translations.map(t => `${t.translation} *(${t.lang_name})*`).join(', ');
          formatted += `🌐 **Dịch:** ${trans}\n\n`;
        }

        // Relations (synonyms, antonyms)
        if (langResult.relations && langResult.relations.length > 0) {
          const rels = langResult.relations.map(r => `${r.related_word} *(${r.relation_type})*`).join(', ');
          formatted += `🔗 **Từ liên quan:** ${rels}\n\n`;
        }
      }

      return `**Từ tra cứu: "${data.word || trimmedWord}"**\n\n${formatted.trim()}`;
    } else {
      return "Không thể lấy dữ liệu từ API";
    }
  } catch (error) {
    if (error.response && error.response.status === 404) {
      return `Không tìm thấy định nghĩa cho từ "${trimmedWord}", đây có thể là một từ ghép hán việt, vui lòng tra cứu ở các nguồn khác.`;
    }
    return "Không thể lấy dữ liệu từ API";
  }
}

module.exports = { getnoitu, tratu, listWords, listWordSet, wordPairs, normalizeVietnamese, addWord };
