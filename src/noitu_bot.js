const { listWords, wordPairs, normalizeVietnamese } = require('./noitu');
const db = require('./db');
const { setupLogger } = require('./log');

const logger = setupLogger('noitu_bot');

function lastWord(word) {
  return word.split(' ')[word.split(' ').length - 1];
}

function firstWord(word) {
  return word.split(' ')[0];
}

function getWordStartingWith(start, history = []) {
  const possibleWords = wordPairs[start] || [];
  
  if (possibleWords.length === 0) {
    return false;
  }
  
  // Lọc các từ chưa được sử dụng trong lịch sử
  const availableWords = possibleWords.filter(secondWord => {
    const fullWord = `${start} ${secondWord}`;
    return !history.includes(fullWord);
  });
  
  // Nếu không còn từ nào có thể dùng, trả về false
  if (availableWords.length === 0) {
    return false;
  }
  
  // Tránh chọn từ giống nhau (ví dụ: "phới phới")
  const nonRepeatingWords = availableWords.filter(secondWord => secondWord !== start);
  
  // Ưu tiên từ không lặp, nếu không có thì dùng từ có sẵn
  const wordsToChoose = nonRepeatingWords.length > 0 ? nonRepeatingWords : availableWords;
  
  const secondWord = wordsToChoose[Math.floor(Math.random() * wordsToChoose.length)];
  return `${start} ${secondWord}`;
}

function uniqueWord(start) {
  const possibleWords = wordPairs[start] || [];
  return possibleWords.length === 0;
}

function newWord() {
  let word;
  do {
    word = listWords[Math.floor(Math.random() * listWords.length)];
  } while (uniqueWord(lastWord(word)));
  return word;
}

function checkChannel(playerWord, idChannel, idUser) {
  const startTime = Date.now();
  idChannel = idChannel.toString();

  const normalizedPlayer = normalizeVietnamese(playerWord);

  if (normalizedPlayer.split(' ').length !== 2) {
    return 'Từ bắt buộc phải gồm 2 từ';
  }

  const channels = db.read('channels') || {};
  let channelData = channels[idChannel] || {};
  let currentWord = channelData.word;
  let history = channelData.history || [];
  let streak = channelData.streak || 0;
  let sai = channelData.sai || 0;

  if (!currentWord) {
    currentWord = newWord();
    channelData = { word: currentWord, history: [currentWord], streak: 0, sai: 0 };
    db.store('channels', { [idChannel]: channelData });
    logger.info(`Channel [${idChannel}] NEW '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
    return `Từ hiện tại: **${currentWord}**`;
  }

  if (lastWord(currentWord) !== firstWord(normalizedPlayer)) {
    sai += 1;
    if (sai === 3) {
      currentWord = newWord();
      channelData = { word: currentWord, history: [], streak: 0, sai: 0 };
      db.store('channels', { [idChannel]: channelData });
      logger.info(`Channel [${idChannel}] LOSS '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
      return `> Thua cuộc, từ đầu không khớp với từ cuối! Chuỗi đúng: **${streak}** \nTừ mới: **${currentWord}**`;
    } else {
      channelData.sai = sai;
      db.store('channels', { [idChannel]: channelData });
      logger.info(`Channel [${idChannel}] ERROR '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
      return `> **Từ đầu của bạn phải là "${lastWord(currentWord)}"!** Vui lòng tìm từ khác. Bạn đã trả lời sai **${sai}** lần.\nTừ hiện tại: **${currentWord}**`;
    }
  }

  // Kiểm tra từ đã được trả lời chưa
  if (history.includes(normalizedPlayer)) {
    sai += 1;
    if (sai === 3) {
      currentWord = newWord();
      channelData = { word: currentWord, history: [], streak: 0, sai: 0 };
      db.store('channels', { [idChannel]: channelData });
      logger.info(`Channel [${idChannel}] LOSS '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
      return `> Thua cuộc, từ đã được trả lời trước đó! Chuỗi đúng: **${streak}** \nTừ mới: **${currentWord}**`;
    } else {
      channelData.sai = sai;
      db.store('channels', { [idChannel]: channelData });
      logger.info(`Channel [${idChannel}] ERROR '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
      return `> **Từ này đã được trả lời trước đó!** Vui lòng tìm từ khác. Bạn đã trả lời sai **${sai}** lần.\nTừ hiện tại: **${currentWord}**`;
    }
  }

  // Kiểm tra từ có trong từ điển không
  if (!listWords.includes(normalizedPlayer)) {
    sai += 1;
    if (sai === 3) {
      currentWord = newWord();
      channelData = { word: currentWord, history: [], streak: 0, sai: 0 };
      db.store('channels', { [idChannel]: channelData });
      logger.info(`Channel [${idChannel}] LOSS '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
      return `> Thua cuộc, từ không có trong bộ từ điển! Chuỗi đúng: **${streak}** \nTừ mới: **${currentWord}**`;
    } else {
      channelData.sai = sai;
      db.store('channels', { [idChannel]: channelData });
      logger.info(`Channel [${idChannel}] ERROR '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
      return `> **Từ không có trong bộ từ điển!** Vui lòng tìm từ khác. Bạn đã trả lời sai **${sai}** lần.\nTừ hiện tại: **${currentWord}**`;
    }
  }

  const nextWord = getWordStartingWith(lastWord(normalizedPlayer), history);
  currentWord = nextWord;

  if (!nextWord) {
    currentWord = newWord();
    channelData = { word: currentWord, history: [], streak: 0, sai: 0 };
    db.store('channels', { [idChannel]: channelData });
    logger.info(`Channel [${idChannel}] WIN '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
    return `**BẠN ĐÃ THẮNG!** \nChuỗi đúng: **${streak + 1}**\n Từ mới: **${currentWord}**`;
  }

  const response = `Từ tiếp theo: **${nextWord}**`;

  if (uniqueWord(lastWord(nextWord))) {
    currentWord = newWord();
    channelData = { word: currentWord, history: [], streak: 0, sai: 0 };
    db.store('channels', { [idChannel]: channelData });
    logger.info(`Channel [${idChannel}] LOSS '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
    return `${response}\n> Thua cuộc, đây là từ cuối trong từ điển của bot, Chuỗi đúng: **${streak}**\nTừ mới: **${currentWord}**`;
  }

  history.push(normalizedPlayer, currentWord);
  channelData.word = currentWord;
  channelData.history = history;
  channelData.streak = streak + 1;
  db.store('channels', { [idChannel]: channelData });
  logger.info(`Channel [${idChannel}] NEXT '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
  return response;
}

function checkUser(playerWord, idUser) {
  const startTime = Date.now();
  idUser = idUser.toString();

  if (playerWord.split(' ').length !== 2) {
    return 'Từ bắt buộc phải gồm 2 từ';
  }

  const users = db.read('users') || {};
  let userData = users[idUser] || {};
  let currentWord = userData.word;
  let history = userData.history || [];
  let streak = userData.streak || 0;
  let sai = userData.sai || 0;

  if (!currentWord) {
    currentWord = newWord();
    userData = { word: currentWord, history: [currentWord], streak: 0, sai: 0 };
    db.store('users', { [idUser]: userData });
    logger.info(`DM: [${idUser}] NEW '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
    return `Từ hiện tại: **${currentWord}**`;
  }

  if (lastWord(currentWord) !== firstWord(playerWord)) {
    sai += 1;
    if (sai === 3) {
      currentWord = newWord();
      userData = { word: currentWord, history: [], streak: 0, sai: 0 };
      db.store('users', { [idUser]: userData });
      logger.info(`DM: [${idUser}] LOSS '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
      return `> Thua cuộc, từ đầu không khớp với từ cuối! Chuỗi đúng: **${streak}** \nTừ mới: **${currentWord}**`;
    } else {
      userData.sai = sai;
      db.store('users', { [idUser]: userData });
      logger.info(`DM: [${idUser}] ERROR '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
      return `> **Từ đầu của bạn phải là "${lastWord(currentWord)}"!** Vui lòng tìm từ khác. Bạn đã trả lời sai **${sai}** lần.\nTừ hiện tại: **${currentWord}**`;
    }
  }

  // Kiểm tra từ đã được trả lời chưa
  if (history.includes(playerWord)) {
    sai += 1;
    if (sai === 3) {
      currentWord = newWord();
      userData = { word: currentWord, history: [], streak: 0, sai: 0 };
      db.store('users', { [idUser]: userData });
      logger.info(`DM: [${idUser}] LOSS '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
      return `> Thua cuộc, từ đã được trả lời trước đó! Chuỗi đúng: **${streak}** \nTừ mới: **${currentWord}**`;
    } else {
      userData.sai = sai;
      db.store('users', { [idUser]: userData });
      logger.info(`DM: [${idUser}] ERROR '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
      return `> **Từ này đã được trả lời trước đó!** Vui lòng tìm từ khác. Bạn đã trả lời sai **${sai}** lần.\nTừ hiện tại: **${currentWord}**`;
    }
  }

  // Kiểm tra từ có trong từ điển không
  if (!listWords.includes(playerWord)) {
    sai += 1;
    if (sai === 3) {
      currentWord = newWord();
      userData = { word: currentWord, history: [], streak: 0, sai: 0 };
      db.store('users', { [idUser]: userData });
      logger.info(`DM: [${idUser}] LOSS '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
      return `> Thua cuộc, từ không có trong bộ từ điển! Chuỗi đúng: **${streak}** \nTừ mới: **${currentWord}**`;
    } else {
      userData.sai = sai;
      db.store('users', { [idUser]: userData });
      logger.info(`DM: [${idUser}] ERROR '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
      return `> **Từ không có trong bộ từ điển!** Vui lòng tìm từ khác. Bạn đã trả lời sai **${sai}** lần.\nTừ hiện tại: **${currentWord}**`;
    }
  }

  const nextWord = getWordStartingWith(lastWord(playerWord), history);
  currentWord = nextWord;

  if (!nextWord) {
    currentWord = newWord();
    userData = { word: currentWord, history: [], streak: 0, sai: 0 };
    db.store('users', { [idUser]: userData });
    logger.info(`DM: [${idUser}] WIN '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
    return `**BẠN ĐÃ THẮNG!** \nChuỗi đúng: **${streak + 1}**\n Từ mới: **${currentWord}**`;
  }

  const response = `Từ tiếp theo: **${nextWord}**`;

  if (uniqueWord(lastWord(nextWord))) {
    currentWord = newWord();
    userData = { word: currentWord, history: [], streak: 0, sai: 0 };
    db.store('users', { [idUser]: userData });
    logger.info(`DM: [${idUser}] LOSS '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
    return `${response}\n> Thua cuộc, đây là từ cuối trong từ điển của bot, Chuỗi đúng: **${streak}**\nTừ mới: **${currentWord}**`;
  }

  history.push(playerWord, currentWord);
  userData.word = currentWord;
  userData.history = history;
  userData.streak = streak + 1;
  db.store('users', { [idUser]: userData });
  logger.info(`DM: [${idUser}] NEXT '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
  return response;
}

async function tratu() {
  // Placeholder
  return "Chức năng tra từ";
}

function resetUserGame(idUser) {
  idUser = idUser.toString();
  const currentWord = newWord();
  const userData = { word: currentWord, history: [currentWord], streak: 0, sai: 0 };
  db.store('users', { [idUser]: userData });
  logger.info(`Reset user game for [${idUser}], new word: ${currentWord}`);
  return currentWord;
}

function resetChannelGame(idChannel) {
  idChannel = idChannel.toString();
  const currentWord = newWord();
  const channelData = { word: currentWord, history: [currentWord], streak: 0, sai: 0 };
  db.store('channels', { [idChannel]: channelData });
  logger.info(`Reset channel game for [${idChannel}], new word: ${currentWord}`);
  return currentWord;
}

module.exports = { checkChannel, checkUser, tratu, resetUserGame, resetChannelGame };