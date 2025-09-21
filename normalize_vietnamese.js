const fs = require('fs');
const path = require('path');

// Mapping các ký tự có dấu tương đương
const vietnameseNormalization = {
  // òa variants
  'òa': ['òa', 'oà'],
  'óa': ['óa', 'oá'],
  'ỏa': ['ỏa', 'oả'],
  'õa': ['õa', 'oã'],
  'ọa': ['ọa', 'oạ'],
  
  // úy variants
  'úy': ['úy', 'uý'],
  'ùy': ['ùy', 'uỳ'],
  'ủy': ['ủy', 'uỷ'],
  'ũy': ['ũy', 'uỹ'],
  'ụy': ['ụy', 'uỵ'],
  
  // iê variants
  'iê': ['iê', 'iế', 'iề', 'iể', 'iễ', 'iệ'],
  'yê': ['yê', 'yế', 'yề', 'yể', 'yễ', 'yệ'],
  
  // ươ variants
  'ươ': ['ươ', 'ướ', 'ườ', 'ưở', 'ưỡ', 'ượ'],
  
  // oa variants
  'oa': ['oa', 'oá', 'oà', 'oả', 'oã', 'oạ'],
  
  // ia variants  
  'ia': ['ia', 'iá', 'ià', 'iả', 'iã', 'iạ'],
  
  // ua variants
  'ua': ['ua', 'uá', 'uà', 'uả', 'uã', 'uạ']
};

function normalizeVietnamese(text) {
  let normalized = text.toLowerCase();
  
  // Chuẩn hóa các cặp ký tự đặc biệt
  for (const [standard, variants] of Object.entries(vietnameseNormalization)) {
    for (const variant of variants) {
      if (variant !== standard) {
        const regex = new RegExp(variant, 'gi');
        normalized = normalized.replace(regex, standard);
      }
    }
  }
  
  return normalized;
}

function mergeWordPairs() {
  console.log('🔄 Bắt đầu chuẩn hóa wordPairs.json...');
  
  const wordPairsPath = path.join(__dirname, 'src', 'assets', 'wordPairs.json');
  const wordPairs = JSON.parse(fs.readFileSync(wordPairsPath, 'utf8'));
  
  const normalizedPairs = {};
  let mergedCount = 0;
  let totalWords = 0;
  
  // Đầu tiên, chuẩn hóa tất cả các key
  for (const [firstWord, secondWords] of Object.entries(wordPairs)) {
    totalWords++;
    const normalizedFirst = normalizeVietnamese(firstWord);
    
    if (!normalizedPairs[normalizedFirst]) {
      normalizedPairs[normalizedFirst] = new Set();
    }
    
    // Chuẩn hóa và gộp các second words
    for (const secondWord of secondWords) {
      const normalizedSecond = normalizeVietnamese(secondWord);
      normalizedPairs[normalizedFirst].add(normalizedSecond);
    }
    
    // Kiểm tra xem có merge không
    if (normalizedFirst !== firstWord) {
      mergedCount++;
      console.log(`🔗 Merged: "${firstWord}" -> "${normalizedFirst}"`);
    }
  }
  
  // Convert Set back to Array
  const finalPairs = {};
  for (const [key, valueSet] of Object.entries(normalizedPairs)) {
    finalPairs[key] = Array.from(valueSet).sort();
  }
  
  // Backup file gốc
  const backupPath = wordPairsPath + '.backup.' + Date.now();
  fs.copyFileSync(wordPairsPath, backupPath);
  console.log(`💾 Backup created: ${backupPath}`);
  
  // Ghi file mới
  fs.writeFileSync(wordPairsPath, JSON.stringify(finalPairs, null, 2), 'utf8');
  
  console.log(`✅ Hoàn thành chuẩn hóa!`);
  console.log(`📊 Thống kê:`);
  console.log(`   - Tổng từ gốc: ${totalWords}`);
  console.log(`   - Tổng từ sau merge: ${Object.keys(finalPairs).length}`);
  console.log(`   - Số từ đã merge: ${mergedCount}`);
  console.log(`   - Tiết kiệm: ${totalWords - Object.keys(finalPairs).length} từ trùng lặp`);
}

function testNormalization() {
  console.log('\n🧪 Test chuẩn hóa:');
  const testCases = [
    'thỏa', 'thoả',
    'thúy', 'thuý', 
    'òa', 'oà',
    'úy', 'uý',
    'ùy', 'uỳ',
    'ủy', 'uỷ'
  ];
  
  for (const test of testCases) {
    console.log(`"${test}" -> "${normalizeVietnamese(test)}"`);
  }
}

// Chạy script
if (require.main === module) {
  testNormalization();
  mergeWordPairs();
}

module.exports = { normalizeVietnamese, mergeWordPairs };