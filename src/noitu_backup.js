const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Load từ điển từ wordPairs.json để tra cứu nhanh hơn
const wordPairs = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'wordPairs.json'), 'utf8'));

// Load danh sách các từ có 2 từ vào một list (để kiểm tra tồn tại)
const listWords = fs.readFileSync(path.join(__dirname, 'assets', 'tudien.txt'), 'utf8')
  .split('\n')
  .map(word => word.trim().toLowerCase())
  .filter(word => word);

function getnoitu(playerWord) {
  if (playerWord.split(' ').length !== 2) {
    return 'Từ bắt buộc phải gồm 2 từ';
  } else {
    const lastWord = playerWord.split(' ')[1];
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
  try {
    const response = await axios.post('http://tudientv.com/dictfunctions.php', {
      action: 'getmeaning',
      entry: word
    }, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept-Encoding': 'gzip, deflate, br'
      }
    });
    if (response.status === 200) {
      if (response.data.length < 5) {
        return 'Không tìm thấy từ trong api tudientv, có thể từ ở nguồn khác.';
      } else {
        // Simple text extraction, since no cheerio
        return response.data.replace(/<[^>]*>/g, '').replace(/\n+/g, '\n');
      }
    } else {
      return "Không thể lấy dữ liệu từ API";
    }
  } catch (error) {
    return "Không thể lấy dữ liệu từ API";
  }
}

module.exports = { getnoitu, tratu, listWords, wordPairs };
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept-Encoding': 'gzip, deflate, br'
      }
    });
    if (response.status === 200) {
      if (response.data.length < 5) {
        return 'Không tìm thấy từ trong api tudientv, có thể từ ở nguồn khác.';
      } else {
        // Simple text extraction, since no cheerio
        return response.data.replace(/<[^>]*>/g, '').replace(/\n+/g, '\n');
      }
    } else {
      return "Không thể lấy dữ liệu từ API";
    }
  } catch (error) {
    return "Không thể lấy dữ liệu từ API";
  }
}

module.exports = { getnoitu, tratu, listWords };