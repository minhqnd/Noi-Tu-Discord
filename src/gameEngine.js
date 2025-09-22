const { listWords, wordPairs, normalizeVietnamese } = require('./wordProcessing');
const db = require('./db');
const { setupLogger, GAME_CONSTANTS, RESPONSE_CODES, RESPONSE_TYPES, GAME_MODES } = require('./utils');

const logger = setupLogger('game_engine');

class GameEngine {
    constructor() {
        this.logger = logger;
    }

    // Utility functions
    lastWord(word) {
        return word.split(' ').slice(-1)[0];
    }

    firstWord(word) {
        return word.split(' ')[0];
    }

    formatStatsLine(userId, { currentStreak = 0, bestStreak = 0, wins = 0, isDM = false, showWins = false }) {
        const heading = isDM ? 'Chuỗi hiện tại' : `<@${userId}> trả lời đúng! Chuỗi hiện tại`;
        const parts = [`${heading}: **${currentStreak}**`, `Kỷ lục: **${bestStreak}**`];
        if (showWins) parts.push(`Thắng: **${wins}**`);
        return `${parts.join(' | ')}`;
    }

    getWordStartingWith(start, history = []) {
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

    uniqueWord(start) {
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

    newWord() {
        let word;
        do {
            word = listWords[Math.floor(Math.random() * listWords.length)];
        } while (this.uniqueWord(this.lastWord(word)));
        return word;
    }

    // Validation methods
    validateWordFormat(playerWord) {
        const normalized = normalizeVietnamese(playerWord);
        return normalized.split(' ').length === GAME_CONSTANTS.WORD_LENGTH;
    }

    validateWordMatch(currentWord, playerWord) {
        const normalizedPlayer = normalizeVietnamese(playerWord);
        return this.lastWord(currentWord) === this.firstWord(normalizedPlayer);
    }

    validateWordInDictionary(playerWord) {
        const normalized = normalizeVietnamese(playerWord);
        return listWords.includes(normalized);
    }

    validateWordNotRepeated(history, playerWord) {
        const normalized = normalizeVietnamese(playerWord);
        return !history.includes(normalized);
    }

    // Core game logic
    processMove(gameData, playerWord, userId, isDM = false) {
        const startTime = Date.now();
        const normalizedPlayer = normalizeVietnamese(playerWord);

        // Validate format
        if (!this.validateWordFormat(playerWord)) {
            const currentWord = gameData.word;
            const lw = currentWord ? this.lastWord(currentWord) : 'từ';
            return {
                type: RESPONSE_TYPES.ERROR,
                code: RESPONSE_CODES.INVALID_FORMAT,
                message: `Từ bắt buộc phải gồm ${GAME_CONSTANTS.WORD_LENGTH} âm tiết và bắt đầu bằng **"${lw}"**`,
                currentWord: currentWord
            };
        }

        let { word: currentWord, history = [], players = {}, mode = GAME_MODES.BOT } = gameData;
        let userStats = (isDM ? gameData : players[userId]) || {
            currentStreak: 0,
            bestStreak: 0,
            wins: 0,
            wrongCount: 0
        };

        // Initialize game if no current word
        if (!currentWord) {
            currentWord = this.newWord();
            const newGameData = {
                word: currentWord,
                history: [currentWord],
                ...(isDM ? {
                    currentStreak: 0,
                    bestStreak: 0,
                    wins: 0,
                    wrongCount: 0
                } : { players: { ...players } })
            };

            this.logger.info(`${isDM ? 'DM' : 'Channel'}: [${isDM ? userId : gameData.id}] NEW '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
            return { type: RESPONSE_TYPES.INFO, message: '', currentWord: currentWord, gameData: newGameData };
        }

        // Validate word match
        if (!this.validateWordMatch(currentWord, playerWord)) {
            this.logger.info(`${isDM ? 'DM' : 'Channel'}: [${isDM ? userId : gameData.id}] MISMATCH '${playerWord}' -> needs '${this.lastWord(currentWord)}' [${(Date.now() - startTime) / 1000}s]`);
            return {
                type: RESPONSE_TYPES.ERROR,
                code: RESPONSE_CODES.MISMATCH,
                message: `**Từ đầu của bạn phải là "${this.lastWord(currentWord)}"!** Vui lòng thử lại.`,
                currentWord: currentWord
            };
        }

        // Validate not repeated
        if (!this.validateWordNotRepeated(history, playerWord)) {
            userStats.wrongCount += 1;

            if (userStats.wrongCount >= GAME_CONSTANTS.MAX_WRONG_COUNT) {
                // User loses
                const preserved = {
                    bestStreak: userStats.bestStreak || 0,
                    wins: userStats.wins || 0
                };

                const newWord = this.newWord();
                const newGameData = {
                    word: newWord,
                    history: [],
                    mode: mode,
                    ...(isDM ? {
                        currentStreak: 0,
                        bestStreak: preserved.bestStreak,
                        wins: preserved.wins,
                        wrongCount: 0
                    } : {
                        players: {
                            ...players,
                            [userId]: {
                                currentStreak: 0,
                                bestStreak: preserved.bestStreak,
                                wins: preserved.wins,
                                wrongCount: 0
                            }
                        }
                    })
                };

                this.logger.info(`${isDM ? 'DM' : 'Channel'}: [${isDM ? userId : gameData.id}] USER_LOSS '${playerWord}' -> '${newWord}' [${(Date.now() - startTime) / 1000}s]`);
                return {
                    type: RESPONSE_TYPES.ERROR,
                    code: RESPONSE_CODES.REPEATED,
                    message: `Thua cuộc, từ đã được trả lời trước đó!\nChuỗi đạt được: **${userStats.currentStreak}**, kỷ lục: **${userStats.bestStreak}**`,
                    currentWord: newWord,
                    gameData: newGameData
                };
            } else {
                // Update wrong count
                const newGameData = {
                    ...gameData,
                    ...(isDM ? { wrongCount: userStats.wrongCount } : {
                        players: { ...players, [userId]: userStats }
                    })
                };

                this.logger.info(`${isDM ? 'DM' : 'Channel'}: [${isDM ? userId : gameData.id}] ERROR '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
                return {
                    type: RESPONSE_TYPES.ERROR,
                    code: RESPONSE_CODES.REPEATED,
                    message: `**Từ này đã được trả lời trước đó!**. Bạn còn **${GAME_CONSTANTS.MAX_WRONG_COUNT - userStats.wrongCount}** lần đoán.`,
                    currentWord: currentWord,
                    gameData: newGameData
                };
            }
        }

        // Validate in dictionary
        if (!this.validateWordInDictionary(playerWord)) {
            userStats.wrongCount += 1;

            if (userStats.wrongCount >= GAME_CONSTANTS.MAX_WRONG_COUNT) {
                // User loses
                const preserved = {
                    bestStreak: userStats.bestStreak || 0,
                    wins: userStats.wins || 0
                };

                const newWord = this.newWord();
                const newGameData = {
                    word: newWord,
                    history: [],
                    mode: mode,
                    ...(isDM ? {
                        currentStreak: 0,
                        bestStreak: preserved.bestStreak,
                        wins: preserved.wins,
                        wrongCount: 0
                    } : {
                        players: {
                            ...players,
                            [userId]: {
                                currentStreak: 0,
                                bestStreak: preserved.bestStreak,
                                wins: preserved.wins,
                                wrongCount: 0
                            }
                        }
                    })
                };

                this.logger.info(`${isDM ? 'DM' : 'Channel'}: [${isDM ? userId : gameData.id}] USER_LOSS '${playerWord}' -> '${newWord}' [${(Date.now() - startTime) / 1000}s]`);
                return {
                    type: RESPONSE_TYPES.ERROR,
                    code: RESPONSE_CODES.NOT_IN_DICT,
                    message: `Thua cuộc, từ không có trong bộ từ điển! Chuỗi: **${userStats.currentStreak}**, kỷ lục: **${userStats.bestStreak}**`,
                    currentWord: newWord,
                    gameData: newGameData
                };
            } else {
                // Update wrong count
                const newGameData = {
                    ...gameData,
                    ...(isDM ? { wrongCount: userStats.wrongCount } : {
                        players: { ...players, [userId]: userStats }
                    })
                };

                this.logger.info(`${isDM ? 'DM' : 'Channel'}: [${isDM ? userId : gameData.id}] ERROR '${playerWord}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
                return {
                    type: RESPONSE_TYPES.ERROR,
                    code: RESPONSE_CODES.NOT_IN_DICT,
                    message: `**Từ không có trong bộ từ điển!** Bạn đã trả lời sai **${userStats.wrongCount}** lần.`,
                    currentWord: currentWord,
                    gameData: newGameData
                };
            }
        }

        // Valid move - process based on mode
        return this.processValidMove(gameData, normalizedPlayer, userId, isDM, startTime);
    }

    processValidMove(gameData, normalizedPlayer, userId, isDM, startTime) {
        let { word: currentWord, history = [], players = {}, mode = GAME_MODES.BOT } = gameData;
        let userStats = (isDM ? gameData : players[userId]) || {
            currentStreak: 0,
            bestStreak: 0,
            wins: 0,
            wrongCount: 0
        };

        // PvP mode: just accept and update
        if (mode === GAME_MODES.PVP && !isDM) {
            history.push(normalizedPlayer);
            userStats.currentStreak = (userStats.currentStreak || 0) + 1;
            userStats.bestStreak = Math.max(userStats.bestStreak || 0, userStats.currentStreak);
            userStats.wrongCount = 0;

            const newGameData = {
                word: normalizedPlayer,
                history: history,
                players: { ...players, [userId]: userStats },
                mode: mode
            };

            this.logger.info(`Channel: [${gameData.id}] PVP_OK '${normalizedPlayer}' [${(Date.now() - startTime) / 1000}s]`);
            const statsLine = this.formatStatsLine(userId, {
                currentStreak: userStats.currentStreak || 0,
                bestStreak: userStats.bestStreak || 0
            });

            return {
                type: RESPONSE_TYPES.SUCCESS,
                code: RESPONSE_CODES.OK,
                message: statsLine,
                gameData: newGameData
            };
        }

        // Bot mode: find next word
        const nextWord = this.getWordStartingWith(this.lastWord(normalizedPlayer), history);
        currentWord = nextWord;

        if (!nextWord) {
            // User wins
            const nextStreak = (userStats.currentStreak || 0) + 1;
            const best = Math.max(userStats.bestStreak || 0, nextStreak);
            const wins = (userStats.wins || 0) + 1;

            const newWord = this.newWord();
            const newGameData = {
                word: newWord,
                history: [],
                mode: mode,
                ...(isDM ? {
                    currentStreak: nextStreak,
                    bestStreak: best,
                    wins: wins,
                    wrongCount: 0
                } : {
                    players: {
                        ...players,
                        [userId]: {
                            currentStreak: nextStreak,
                            bestStreak: best,
                            wins: wins,
                            wrongCount: 0
                        }
                    }
                })
            };

            this.logger.info(`${isDM ? 'DM' : 'Channel'}: [${isDM ? userId : gameData.id}] WIN '${normalizedPlayer}' -> '${newWord}' [${(Date.now() - startTime) / 1000}s]`);
            const statsLine = this.formatStatsLine(userId, {
                currentStreak: nextStreak,
                bestStreak: best,
                isDM: isDM
            });

            return {
                type: RESPONSE_TYPES.SUCCESS,
                code: RESPONSE_CODES.OK,
                message: `${statsLine}\n**BẠN ĐÃ THẮNG!** Từ cuối "${this.lastWord(normalizedPlayer)}" không còn từ nào để nối tiếp.`,
                currentWord: newWord,
                gameData: newGameData
            };
        }

        if (this.uniqueWord(this.lastWord(nextWord))) {
            // User loses - bot's word ends the chain
            const preserved = {
                bestStreak: userStats.bestStreak || 0,
                wins: userStats.wins || 0
            };

            const newWord = this.newWord();
            const newGameData = {
                word: newWord,
                history: [],
                mode: mode,
                ...(isDM ? {
                    currentStreak: 0,
                    bestStreak: preserved.bestStreak,
                    wins: preserved.wins,
                    wrongCount: 0
                } : {
                    players: {
                        ...players,
                        [userId]: {
                            currentStreak: 0,
                            bestStreak: preserved.bestStreak,
                            wins: preserved.wins,
                            wrongCount: 0
                        }
                    }
                })
            };

            this.logger.info(`${isDM ? 'DM' : 'Channel'}: [${isDM ? userId : gameData.id}] LOSS '${normalizedPlayer}' -> '${newWord}' [${(Date.now() - startTime) / 1000}s]`);
            const statsLine = this.formatStatsLine(userId, {
                currentStreak: userStats.currentStreak || 0,
                bestStreak: preserved.bestStreak,
                isDM: isDM
            });

            return {
                type: RESPONSE_TYPES.ERROR,
                code: RESPONSE_CODES.LOSS,
                message: `${statsLine}\n**Thua cuộc!** Từ cuối "${this.lastWord(nextWord)}" cũng không còn từ nào để nối tiếp.`,
                currentWord: newWord,
                gameData: newGameData
            };
        }

        // Normal move
        history.push(normalizedPlayer, currentWord);
        userStats.currentStreak = (userStats.currentStreak || 0) + 1;
        userStats.bestStreak = Math.max(userStats.bestStreak || 0, userStats.currentStreak);
        userStats.wrongCount = 0;

        const newGameData = {
            word: currentWord,
            history: history,
            mode: mode,
            ...(isDM ? {
                currentStreak: userStats.currentStreak,
                bestStreak: userStats.bestStreak,
                wins: userStats.wins,
                wrongCount: 0
            } : {
                players: { ...players, [userId]: userStats }
            })
        };

        this.logger.info(`${isDM ? 'DM' : 'Channel'}: [${isDM ? userId : gameData.id}] NEXT '${normalizedPlayer}' -> '${currentWord}' [${(Date.now() - startTime) / 1000}s]`);
        const statsLine = this.formatStatsLine(userId, {
            currentStreak: userStats.currentStreak,
            bestStreak: userStats.bestStreak,
            isDM: isDM
        });

        return {
            type: RESPONSE_TYPES.SUCCESS,
            code: RESPONSE_CODES.OK,
            message: statsLine,
            currentWord: currentWord,
            gameData: newGameData
        };
    }

    resetGame(gameData, isDM = false) {
        const currentWord = this.newWord();
        const newGameData = {
            word: currentWord,
            history: [currentWord],
            mode: gameData.mode,
            ...(isDM ? {
                currentStreak: 0,
                bestStreak: 0,
                wins: 0,
                wrongCount: 0
            } : {
                players: gameData.players || {}
            })
        };

        this.logger.info(`Reset ${isDM ? 'user' : 'channel'} game for [${isDM ? gameData.id : gameData.id}], new word: ${currentWord}`);
        return newGameData;
    }
}

module.exports = GameEngine;