const { listWords, wordPairs, normalizeVietnamese } = require('./noitu');
const db = require('./db');
const { setupLogger } = require('./log');

const logger = setupLogger('noitu_bot');

function formatStatsLine(userId, { currentStreak = 0, bestStreak = 0, wins = 0, isDM = false, showWins = false }) {
    const heading = isDM ? 'Chuỗi hiện tại' : `<@${userId}> trả lời đúng! Chuỗi hiện tại`;
    const parts = [`${heading}: **${currentStreak}**`, `Kỷ lục: **${bestStreak}**`];
    if (showWins) parts.push(`Thắng: **${wins}**`);
    return `${parts.join(' | ')}`;
}

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

    // Lọc thêm: chỉ chọn từ mà từ cuối (secondWord) có từ tiếp theo
    const validWords = availableWords.filter(secondWord => {
        return wordPairs[secondWord] && wordPairs[secondWord].length > 0;
    });

    // Nếu không còn từ hợp lệ, trả về false
    if (validWords.length === 0) {
        return false;
    }

    // Tránh chọn từ giống nhau (ví dụ: "phới phới")
    const nonRepeatingWords = validWords.filter(secondWord => secondWord !== start);

    // Ưu tiên từ không lặp, nếu không có thì dùng từ có sẵn
    const wordsToChoose = nonRepeatingWords.length > 0 ? nonRepeatingWords : validWords;

    const secondWord = wordsToChoose[Math.floor(Math.random() * wordsToChoose.length)];
    return `${start} ${secondWord}`;
}

function uniqueWord(start) {
    const possibleWords = wordPairs[start] || [];
    if (possibleWords.length === 0) return true;
    
    // Check if all possible words lead to dead ends
    const validContinuations = possibleWords.filter(word => {
        // If word is same as start, it's a loop - dead end
        if (word === start) return false;
        
        const nextPossible = wordPairs[word] || [];
        return nextPossible.length > 0;
    });
    
    return validContinuations.length === 0;
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
        // Get current word from database if available
        const channels = db.read('channels') || {};
        const channelData = channels[idChannel] || {};
        const currentWord = channelData.word;
        return { type: 'error', message: 'Từ bắt buộc phải gồm 2 từ', currentWord: currentWord };
    }

    const channels = db.read('channels') || {};
    let channelData = channels[idChannel] || {};
    let currentWord = channelData.word;
    let history = channelData.history || [];
    let players = channelData.players || {};
    let userStats = players[idUser] || { currentStreak: 0, bestStreak: 0, wins: 0, wrongCount: 0 };

    if (!currentWord) {
        currentWord = newWord();
        channelData = { word: currentWord, history: [currentWord], players };
        db.store('channels', { [idChannel]: channelData });
        logger.info(`Channel [${idChannel}] NEW '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
        return { type: 'info', message: '', currentWord: currentWord };
    }

    if (lastWord(currentWord) !== firstWord(normalizedPlayer)) {
        logger.info(`Channel [${idChannel}] MISMATCH '${playerWord}' -> needs '${lastWord(currentWord)}' [${(Date.now() - startTime) / 1000}s]`);
        return { type: 'error', message: `**Từ đầu của bạn phải là "${lastWord(currentWord)}"!** Vui lòng thử lại.`, currentWord: currentWord };
    }

    // Kiểm tra từ đã được trả lời chưa
    if (history.includes(normalizedPlayer)) {
        userStats.wrongCount += 1;
        players[idUser] = userStats;
        if (userStats.wrongCount === 3) {
            const preserved = { bestStreak: userStats.bestStreak || 0, wins: userStats.wins || 0 };
            // reset only this user's counters, preserve best/wins, keep game going
            players[idUser] = { currentStreak: 0, bestStreak: preserved.bestStreak, wins: preserved.wins, wrongCount: 0 };
            channelData.players = players;
            db.store('channels', { [idChannel]: channelData });
            logger.info(`Channel [${idChannel}] USER_LOSS '${playerWord}' -> keep '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
            return { type: 'error', message: `Thua cuộc, từ đã được trả lời trước đó!\nChuỗi đạt được: **${userStats.currentStreak}**, kỷ lục: **${userStats.bestStreak}**`, currentWord: currentWord };
        } else {
            channelData.players = players;
            db.store('channels', { [idChannel]: channelData });
            logger.info(`Channel [${idChannel}] ERROR '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
            return { type: 'error', message: `**Từ này đã được trả lời trước đó!**. Bạn còn **${userStats.wrongCount}** lần đoán.`, currentWord: currentWord };
        }
    }

    // Kiểm tra từ có trong từ điển không
    if (!listWords.includes(normalizedPlayer)) {
        userStats.wrongCount += 1;
        players[idUser] = userStats;
        if (userStats.wrongCount === 3) {
            const preserved = { bestStreak: userStats.bestStreak || 0, wins: userStats.wins || 0 };
            players[idUser] = { currentStreak: 0, bestStreak: preserved.bestStreak, wins: preserved.wins, wrongCount: 0 };
            channelData.players = players;
            db.store('channels', { [idChannel]: channelData });
            logger.info(`Channel [${idChannel}] USER_LOSS '${playerWord}' -> keep '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
            return { type: 'error', message: `Thua cuộc, từ không có trong bộ từ điển! Chuỗi: **${userStats.currentStreak}**, kỷ lục: **${userStats.bestStreak}**`, currentWord: currentWord };
        } else {
            channelData.players = players;
            db.store('channels', { [idChannel]: channelData });
            logger.info(`Channel [${idChannel}] ERROR '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
            return { type: 'error', message: `**Từ không có trong bộ từ điển!** Bạn đã trả lời sai **${userStats.wrongCount}** lần.`, currentWord: currentWord };
        }
    }

    const nextWord = getWordStartingWith(lastWord(normalizedPlayer), history);
    currentWord = nextWord;

    if (!nextWord) {
        const nextStreak = (userStats.currentStreak || 0) + 1;
        const newStart = newWord();
        // update user's best and wins - USER WINS when bot can't continue!
        const best = Math.max(userStats.bestStreak || 0, nextStreak);
        const wins = (userStats.wins || 0) + 1;
        players[idUser] = { currentStreak: 0, bestStreak: best, wins, wrongCount: 0 };
        channelData = { word: newStart, history: [], players };
        db.store('channels', { [idChannel]: channelData });
        logger.info(`Channel [${idChannel}] WIN '${playerWord}' -> '${newStart}' [${(Date.now() - startTime) / 1000}s]`);
        const statsLine = formatStatsLine(idUser, { currentStreak: nextStreak, bestStreak: best });
        return { type: 'success', message: `${statsLine}\n**BẠN ĐÃ THẮNG!** Từ cuối "${lastWord(normalizedPlayer)}" không còn từ nào để nối tiếp.`, currentWord: newStart };
    }

    if (uniqueWord(lastWord(nextWord))) {
        const newStart = newWord();
        // terminal path: user loses because bot's word also ends the chain
        const preserved = { bestStreak: userStats.bestStreak || 0, wins: userStats.wins || 0 };
        players[idUser] = { currentStreak: 0, bestStreak: preserved.bestStreak, wins: preserved.wins, wrongCount: 0 };
        channelData = { word: newStart, history: [], players };
        db.store('channels', { [idChannel]: channelData });
        logger.info(`Channel [${idChannel}] LOSS '${playerWord}' -> '${newStart}' [${(Date.now() - startTime) / 1000}s]`);
        const statsLine = formatStatsLine(idUser, { currentStreak: userStats.currentStreak || 0, bestStreak: preserved.bestStreak });
        return { type: 'error', message: `${statsLine}\n**Thua cuộc!** Từ cuối "${lastWord(nextWord)}" cũng không còn từ nào để nối tiếp.`, currentWord: newStart };
    }

    history.push(normalizedPlayer, currentWord);
    channelData.word = currentWord;
    channelData.history = history;
    // Increase per-user current streak on success
    userStats.currentStreak = (userStats.currentStreak || 0) + 1;
    userStats.bestStreak = Math.max(userStats.bestStreak || 0, userStats.currentStreak);
    // Reset user's wrongCount after a correct answer
    userStats.wrongCount = 0;
    players[idUser] = userStats;
    channelData.players = players;
    db.store('channels', { [idChannel]: channelData });
    logger.info(`Channel [${idChannel}] NEXT '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
    const statsLine = formatStatsLine(idUser, { currentStreak: userStats.currentStreak || 0, bestStreak: userStats.bestStreak || 0 });
    return { type: 'success', message: statsLine, currentWord: currentWord };
}

function checkUser(playerWord, idUser) {
    const startTime = Date.now();
    idUser = idUser.toString();

    const normalizedPlayer = normalizeVietnamese(playerWord);

    if (normalizedPlayer.split(' ').length !== 2) {
        return { type: 'error', message: 'Từ bắt buộc phải gồm 2 từ' };
    }

    const users = db.read('users') || {};
    let userData = users[idUser] || {};
    let currentWord = userData.word;
    let history = userData.history || [];
    let currentStreak = userData.currentStreak || 0;
    let bestStreak = userData.bestStreak || 0;
    let wins = userData.wins || 0;
    let wrongCount = userData.wrongCount || 0;

    if (!currentWord) {
        currentWord = newWord();
        userData = { word: currentWord, history: [currentWord], currentStreak: 0, bestStreak: 0, wins: 0, wrongCount: 0 };
        db.store('users', { [idUser]: userData });
        logger.info(`DM: [${idUser}] NEW '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
        return { type: 'info', message: '', currentWord: currentWord };
    }

    if (lastWord(currentWord) !== firstWord(normalizedPlayer)) {
        logger.info(`DM: [${idUser}] MISMATCH '${playerWord}' -> needs '${lastWord(currentWord)}' [${(Date.now() - startTime) / 1000}s]`);
        return { type: 'error', message: `**Từ đầu của bạn phải là "${lastWord(currentWord)}"!** Vui lòng thử lại.`, currentWord: currentWord };
    }

    // Kiểm tra từ đã được trả lời chưa
    if (history.includes(normalizedPlayer)) {
        wrongCount += 1;
        if (wrongCount === 3) {
            const preserveBest = bestStreak || 0;
            const preserveWins = wins || 0;
            currentWord = newWord();
            userData = { word: currentWord, history: [], currentStreak: 0, bestStreak: preserveBest, wins: preserveWins, wrongCount: 0 };
            db.store('users', { [idUser]: userData });
            logger.info(`DM: [${idUser}] LOSS '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
            return { type: 'error', message: `Thua cuộc, từ đã được trả lời trước đó! Chuỗi đúng: **${currentStreak}**`, currentWord: currentWord };
        } else {
            userData.wrongCount = wrongCount;
            db.store('users', { [idUser]: userData });
            logger.info(`DM: [${idUser}] ERROR '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
            return { type: 'error', message: `**Từ này đã được trả lời trước đó!** Bạn đã trả lời sai **${wrongCount}** lần.`, currentWord: currentWord };
        }
    }

    // Kiểm tra từ có trong từ điển không
    if (!listWords.includes(normalizedPlayer)) {
        wrongCount += 1;
        if (wrongCount === 3) {
            const preserveBest = bestStreak || 0;
            const preserveWins = wins || 0;
            currentWord = newWord();
            userData = { word: currentWord, history: [], currentStreak: 0, bestStreak: preserveBest, wins: preserveWins, wrongCount: 0 };
            db.store('users', { [idUser]: userData });
            logger.info(`DM: [${idUser}] LOSS '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
            return { type: 'error', message: `Thua cuộc, từ không có trong bộ từ điển! Chuỗi đúng: **${currentStreak}**`, currentWord: currentWord };
        } else {
            userData.wrongCount = wrongCount;
            db.store('users', { [idUser]: userData });
            logger.info(`DM: [${idUser}] ERROR '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
            return { type: 'error', message: `**Từ không có trong bộ từ điển!** Bạn đã trả lời sai **${wrongCount}** lần.`, currentWord: currentWord };
        }
    }

    const nextWord = getWordStartingWith(lastWord(normalizedPlayer), history);
    currentWord = nextWord;

    if (!nextWord) {
        const nextStreak = (currentStreak || 0) + 1;
        // update best and wins - USER WINS when bot can't continue!
        bestStreak = Math.max(bestStreak || 0, nextStreak);
        wins = (wins || 0) + 1;
        currentWord = newWord();
        userData = { word: currentWord, history: [], currentStreak: 0, bestStreak, wins, wrongCount: 0 };
        db.store('users', { [idUser]: userData });
        logger.info(`DM: [${idUser}] WIN '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
        const statsLineDM = formatStatsLine(idUser, { currentStreak: nextStreak, bestStreak, isDM: true });
        return { type: 'success', message: `${statsLineDM}\n**BẠN ĐÃ THẮNG!** Từ cuối "${lastWord(normalizedPlayer)}" không còn từ nào để nối tiếp.`, currentWord: currentWord };
    }

    if (uniqueWord(lastWord(nextWord))) {
        const preserveBest = bestStreak || 0;
        const preserveWins = wins || 0;
        currentWord = newWord();
        userData = { word: currentWord, history: [], currentStreak: 0, bestStreak: preserveBest, wins: preserveWins, wrongCount: 0 };
        db.store('users', { [idUser]: userData });
        logger.info(`DM: [${idUser}] LOSS '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
        const statsLineDM = formatStatsLine(idUser, { currentStreak, bestStreak: preserveBest, isDM: true });
        return { type: 'error', message: `${statsLineDM}\n**Thua cuộc!** Từ cuối "${lastWord(nextWord)}" cũng không còn từ nào để nối tiếp.`, currentWord: currentWord };
    }

    history.push(normalizedPlayer, currentWord);
    userData.word = currentWord;
    userData.history = history;
    currentStreak = (currentStreak || 0) + 1;
    bestStreak = Math.max(bestStreak || 0, currentStreak);
    wrongCount = 0;
    userData.currentStreak = currentStreak;
    userData.bestStreak = bestStreak;
    userData.wrongCount = wrongCount;
    db.store('users', { [idUser]: userData });
    logger.info(`DM: [${idUser}] NEXT '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
    const statsLineDM = formatStatsLine(idUser, { currentStreak, bestStreak, isDM: true });
    return { type: 'success', message: statsLineDM, currentWord: currentWord };
}

async function tratu() {
    // Placeholder
    return "Chức năng tra từ";
}

function resetUserGame(idUser) {
    idUser = idUser.toString();
    const currentWord = newWord();
    const userData = { word: currentWord, history: [currentWord], currentStreak: 0, bestStreak: 0, wins: 0, wrongCount: 0 };
    db.store('users', { [idUser]: userData });
    logger.info(`Reset user game for [${idUser}], new word: ${currentWord}`);
    return currentWord;
}

function resetChannelGame(idChannel) {
    idChannel = idChannel.toString();
    const currentWord = newWord();
    // Keep existing players map if present to preserve per-user best/wins across resets
    const channels = db.read('channels') || {};
    const existing = channels[idChannel] || {};
    const channelData = { word: currentWord, history: [currentWord], players: existing.players || {} };
    db.store('channels', { [idChannel]: channelData });
    logger.info(`Reset channel game for [${idChannel}], new word: ${currentWord}`);
    return currentWord;
}

module.exports = { checkChannel, checkUser, tratu, resetUserGame, resetChannelGame, uniqueWord };