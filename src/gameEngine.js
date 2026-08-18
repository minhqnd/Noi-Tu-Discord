const { listWords, listWordSet, wordPairs, normalizeVietnamese } = require('./wordProcessing');
const { setupLogger, GAME_CONSTANTS, RESPONSE_CODES, RESPONSE_TYPES, GAME_MODES } = require('./utils');
const db = require('./db');
const fs = require('fs');
const path = require('path');
const logger = setupLogger('game_engine');

class GameEngine {
    constructor() {
        this.logger = logger;
    }

    // Build /newgame hint suffix when wordWrongCount reaches threshold
    getNewGameHint(wordWrongCount) {
        if (wordWrongCount >= GAME_CONSTANTS.WORD_WRONG_HINT_THRESHOLD) {
            return '\n-# 🔄 Từ này quá khó? Gõ `/newgame` để đổi từ mới!';
        }
        return '';
    }

    getLogPrefix(isDM, userId, gameData, context) {
        if (context) {
            if (isDM) {
                return `[DM | @${context.userName || userId}]`;
            }
            const guild = context.guildName || 'Guild';
            const channel = context.channelName ? `#${context.channelName}` : (gameData?.id || 'Channel');
            const user = context.userName ? `@${context.userName}` : userId;
            return `[${guild} > ${channel} | ${user}]`;
        }
        return isDM ? `[DM | ${userId}]` : `[Channel: ${gameData?.id}]`;
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
        const historySet = history instanceof Set ? history : new Set(history);

        if (possibleWords.length === 0) {
            return false;
        }

        // Lọc các từ chưa được sử dụng trong lịch sử
        const availableWords = possibleWords.filter(secondWord => {
            const fullWord = `${start} ${secondWord}`;
            return !historySet.has(fullWord);
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
        return listWordSet.has(normalized);
    }

    validateWordNotRepeated(history, playerWord) {
        const normalized = normalizeVietnamese(playerWord);
        return !(history instanceof Set ? history : new Set(history)).has(normalized);
    }

    // Core game logic
    processMove(gameData, playerWord, userId, isDM = false, context = null) {
        // Input validation
        if (!gameData || typeof gameData !== 'object') {
            throw new Error('Invalid gameData parameter');
        }
        if (!playerWord || typeof playerWord !== 'string') {
            throw new Error('Invalid playerWord parameter');
        }
        if (!userId) {
            throw new Error('Invalid userId parameter');
        }

        // Track player interaction
        db.trackPlayer(userId);
        
        const startTime = Date.now();
        const normalizedPlayer = normalizeVietnamese(playerWord.trim());
        const logPfx = this.getLogPrefix(isDM, userId, gameData, context);

        // Validate format
        if (!this.validateWordFormat(playerWord)) {
            db.incrementStat('total_wrong_guesses', 1);
            const currentWord = gameData.word;
            const lw = currentWord ? this.lastWord(currentWord) : 'từ';
            return {
                type: RESPONSE_TYPES.ERROR,
                code: RESPONSE_CODES.INVALID_FORMAT,
                message: `Từ bắt buộc phải gồm ${GAME_CONSTANTS.WORD_LENGTH} âm tiết và bắt đầu bằng **"${lw}"**`,
                currentWord: currentWord
            };
        }

        let { word: currentWord, history = [], players = {}, mode = GAME_MODES.BOT, wordWrongCount = 0 } = gameData;
        let userStats = (isDM ? gameData : players[userId]) || {
            currentStreak: 0,
            bestStreak: 0,
            wins: 0,
            wrongCount: 0
        };

        // Initialize game if no current word
        if (!currentWord) {
            db.incrementStat('total_games', 1);
            currentWord = this.newWord();
            const newGameData = {
                word: currentWord,
                history: [currentWord],
                wordWrongCount: 0,
                ...(isDM ? {
                    currentStreak: 0,
                    bestStreak: 0,
                    wins: 0,
                    wrongCount: 0
                } : { players: { ...players } })
            };

            this.logger.info(`${logPfx} [${mode}] NEW '${playerWord}' -> '${currentWord}'`);
            return { type: RESPONSE_TYPES.INFO, message: '', currentWord: currentWord, gameData: newGameData };
        }

        // Validate word match
        if (!this.validateWordMatch(currentWord, playerWord)) {
            db.incrementStat('total_wrong_guesses', 1);
            this.logger.info(`${logPfx} [${mode}] ERROR MISMATCH '${playerWord}' (cần: '${this.lastWord(currentWord)}')`);
            return {
                type: RESPONSE_TYPES.ERROR,
                code: RESPONSE_CODES.MISMATCH,
                message: `Từ đầu của bạn phải là **"${this.lastWord(currentWord)}"!** Vui lòng thử lại.`,
                currentWord: currentWord
            };
        }

        // Validate not repeated
        if (!this.validateWordNotRepeated(history, playerWord)) {
            db.incrementStat('total_wrong_guesses', 1);
            userStats.wrongCount += 1;
            wordWrongCount += 1;

            if (userStats.wrongCount >= GAME_CONSTANTS.MAX_WRONG_COUNT) {
                // User loses
                const preserved = {
                    bestStreak: userStats.bestStreak || 0,
                    wins: userStats.wins || 0
                };

                // In channel mode (both PVP and Bot): reset streak but keep current word and history
                if (!isDM) {
                    const newGameData = {
                        word: currentWord,
                        history: history,
                        mode: mode,
                        wordWrongCount: wordWrongCount,
                        players: {
                            ...players,
                            [userId]: {
                                currentStreak: 0,
                                bestStreak: preserved.bestStreak,
                                wins: preserved.wins,
                                wrongCount: 0
                            }
                        }
                    };

                    this.logger.info(`${logPfx} [${mode}] ERROR STREAK_RESET REPEATED '${playerWord}'`);
                    return {
                        type: RESPONSE_TYPES.ERROR,
                        code: RESPONSE_CODES.REPEATED,
                        streakReset: true,
                        message: `Chuỗi của <@${userId}> đã **bị reset** (từ đã được trả lời). Chuỗi đạt được: **${userStats.currentStreak}**, kỷ lục: **${userStats.bestStreak}**${this.getNewGameHint(wordWrongCount)}`,
                        currentWord: currentWord,
                        gameData: newGameData
                    };
                }

                // DM only: reset everything
                db.incrementStat('total_games', 1);
                const newWord = this.newWord();
                const newGameData = {
                    word: newWord,
                    history: [],
                    mode: mode,
                    wordWrongCount: 0,
                    currentStreak: 0,
                    bestStreak: preserved.bestStreak,
                    wins: preserved.wins,
                    wrongCount: 0
                };

                this.logger.info(`${logPfx} [${mode}] ERROR LOSS REPEATED '${playerWord}' -> '${newWord}'`);
                return {
                    type: RESPONSE_TYPES.ERROR,
                    code: RESPONSE_CODES.REPEATED,
                    streakReset: true,
                    message: `Thua cuộc, từ đã được trả lời trước đó!\nChuỗi đạt được: **${userStats.currentStreak}**, kỷ lục: **${userStats.bestStreak}**`,
                    currentWord: newWord,
                    gameData: newGameData
                };
            } else {
                // Update wrong count
                const newGameData = {
                    ...gameData,
                    wordWrongCount: wordWrongCount,
                    ...(isDM ? { wrongCount: userStats.wrongCount } : {
                        players: { ...players, [userId]: userStats }
                    })
                };

                this.logger.info(`${logPfx} [${mode}] ERROR REPEATED '${playerWord}' (còn: ${GAME_CONSTANTS.MAX_WRONG_COUNT - userStats.wrongCount})`);
                return {
                    type: RESPONSE_TYPES.ERROR,
                    code: RESPONSE_CODES.REPEATED,
                    message: `**Từ này đã được trả lời trước đó!**. Bạn còn **${GAME_CONSTANTS.MAX_WRONG_COUNT - userStats.wrongCount}** lần đoán.${this.getNewGameHint(wordWrongCount)}`,
                    currentWord: currentWord,
                    gameData: newGameData
                };
            }
        }

        // Validate in dictionary
        if (!this.validateWordInDictionary(playerWord)) {
            db.incrementStat('total_wrong_guesses', 1);
            
            try {
                // Lưu từ sai vào file wrong_words.txt ở thư mục gốc (hoặc thư mục data)
                const logPath = path.join(__dirname, '..', 'wrong_words.txt');
                fs.appendFile(logPath, playerWord + '\n', 'utf8', (err) => {
                    if (err) this.logger.error('Lỗi khi lưu từ sai:', err);
                });
            } catch (err) {
                this.logger.error('Lỗi try-catch khi lưu từ sai:', err);
            }
            
            userStats.wrongCount += 1;
            wordWrongCount += 1;

            if (userStats.wrongCount >= GAME_CONSTANTS.MAX_WRONG_COUNT) {
                // User loses
                const preserved = {
                    bestStreak: userStats.bestStreak || 0,
                    wins: userStats.wins || 0
                };

                // In channel mode (both PVP and Bot): reset streak but keep current word and history
                if (!isDM) {
                    const newGameData = {
                        word: currentWord,
                        history: history,
                        mode: mode,
                        wordWrongCount: wordWrongCount,
                        players: {
                            ...players,
                            [userId]: {
                                currentStreak: 0,
                                bestStreak: preserved.bestStreak,
                                wins: preserved.wins,
                                wrongCount: 0
                            }
                        }
                    };

                    this.logger.info(`${logPfx} [${mode}] ERROR STREAK_RESET NOT_IN_DICT '${playerWord}'`);
                    return {
                        type: RESPONSE_TYPES.ERROR,
                        code: RESPONSE_CODES.NOT_IN_DICT,
                        streakReset: true,
                        message: `Chuỗi của <@${userId}> **bị reset** (không có trong bộ từ).\nChuỗi đạt được: **${userStats.currentStreak}**, kỷ lục: **${userStats.bestStreak}**\n-# 💡 Nếu bạn nghĩ từ này tồn tại, hãy dùng \`/feedback\` để báo cho chúng mình!${this.getNewGameHint(wordWrongCount)}`,
                        currentWord: currentWord,
                        gameData: newGameData
                    };
                }

                // DM only: reset everything
                db.incrementStat('total_games', 1);
                const newWord = this.newWord();
                const newGameData = {
                    word: newWord,
                    history: [],
                    mode: mode,
                    wordWrongCount: 0,
                    currentStreak: 0,
                    bestStreak: preserved.bestStreak,
                    wins: preserved.wins,
                    wrongCount: 0
                };

                this.logger.info(`${logPfx} [${mode}] ERROR LOSS NOT_IN_DICT '${playerWord}' -> '${newWord}'`);
                return {
                    type: RESPONSE_TYPES.ERROR,
                    code: RESPONSE_CODES.NOT_IN_DICT,
                    streakReset: true,
                    message: `Thua cuộc, từ không có trong bộ từ điển! Chuỗi: **${userStats.currentStreak}**, kỷ lục: **${userStats.bestStreak}**\n-# 💡 Nếu bạn nghĩ từ này tồn tại, hãy dùng \`/feedback\` để báo cho chúng mình!`,
                    currentWord: newWord,
                    gameData: newGameData
                };
            } else {
                // Update wrong count
                const newGameData = {
                    ...gameData,
                    wordWrongCount: wordWrongCount,
                    ...(isDM ? { wrongCount: userStats.wrongCount } : {
                        players: { ...players, [userId]: userStats }
                    })
                };

                this.logger.info(`${logPfx} [${mode}] ERROR NOT_IN_DICT '${playerWord}' (còn: ${GAME_CONSTANTS.MAX_WRONG_COUNT - userStats.wrongCount})`);
                return {
                    type: RESPONSE_TYPES.ERROR,
                    code: RESPONSE_CODES.NOT_IN_DICT,
                    message: `**Từ không có trong bộ từ điển!** Bạn còn **${GAME_CONSTANTS.MAX_WRONG_COUNT - userStats.wrongCount}** lần đoán.\n-# 💡 Nếu bạn nghĩ từ này tồn tại, hãy dùng \`/feedback\` để báo cho chúng mình!${this.getNewGameHint(wordWrongCount)}`,
                    currentWord: currentWord,
                    gameData: newGameData
                };
            }
        }

        // Valid move - process based on mode
        return this.processValidMove(gameData, normalizedPlayer, userId, isDM, startTime, logPfx);
    }

    processValidMove(gameData, normalizedPlayer, userId, isDM, startTime, logPfx) {
        let { word: currentWord, history = [], players = {}, mode = GAME_MODES.BOT } = gameData;
        let userStats = (isDM ? gameData : players[userId]) || {
            currentStreak: 0,
            bestStreak: 0,
            wins: 0,
            wrongCount: 0
        };

        // User played a valid word
        db.incrementStat('total_words_guessed', 1);

        // PvP mode: just accept and update, but check for endword
        if (mode === GAME_MODES.PVP && !isDM) {
            history.push(normalizedPlayer);
            userStats.currentStreak = (userStats.currentStreak || 0) + 1;
            userStats.bestStreak = Math.max(userStats.bestStreak || 0, userStats.currentStreak);
            userStats.wrongCount = 0;
            const wordWrongCount = 0; // Reset on valid move

            // Check if this is an endword (no next word available)
            const nextWordAvailable = this.getWordStartingWith(this.lastWord(normalizedPlayer), history);
            
            if (!nextWordAvailable) {
                // User wins - they found an endword -> starts new game
                db.incrementStat('total_games', 1);
                const wins = (userStats.wins || 0) + 1;
                userStats.wins = wins;

                const newWord = this.newWord();
                const newGameData = {
                    word: newWord,
                    history: [],
                    wordWrongCount: 0,
                    players: { 
                        ...players, 
                        [userId]: {
                            ...userStats,
                            currentStreak: userStats.currentStreak,
                            bestStreak: userStats.bestStreak,
                            wins: wins,
                            wrongCount: 0
                        }
                    },
                    mode: mode
                };

                this.logger.info(`${logPfx} [${mode}] WIN '${normalizedPlayer}' -> '${newWord}'`);
                const statsLine = this.formatStatsLine(userId, {
                    currentStreak: userStats.currentStreak || 0,
                    bestStreak: userStats.bestStreak || 0,
                    wins: wins,
                    showWins: true
                });

                return {
                    type: RESPONSE_TYPES.SUCCESS,
                    code: RESPONSE_CODES.WIN,
                    message: `${statsLine}\n🏆 **THẮNG!** Từ "${this.lastWord(normalizedPlayer)}" không còn từ nào để nối tiếp!`,
                    currentWord: newWord,
                    gameData: newGameData
                };
            }

            const newGameData = {
                word: normalizedPlayer,
                history: history,
                wordWrongCount: wordWrongCount,
                players: { ...players, [userId]: userStats },
                mode: mode
            };

            this.logger.info(`${logPfx} [${mode}] OK '${normalizedPlayer}'`);
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
            // User wins -> starts new game
            db.incrementStat('total_games', 1);
            const nextStreak = (userStats.currentStreak || 0) + 1;
            const best = Math.max(userStats.bestStreak || 0, nextStreak);
            const wins = (userStats.wins || 0) + 1;

            const newWord = this.newWord();
            const newGameData = {
                word: newWord,
                history: [],
                mode: mode,
                wordWrongCount: 0,
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

            this.logger.info(`${logPfx} [${mode}] WIN '${normalizedPlayer}' -> '${newWord}'`);
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
            db.incrementStat('total_words_guessed', 1); // Bot played a word
            db.incrementStat('total_games', 1); // Starts new game
            const preserved = {
                bestStreak: userStats.bestStreak || 0,
                wins: userStats.wins || 0
            };

            const newWord = this.newWord();
            const newGameData = {
                word: newWord,
                history: [],
                mode: mode,
                wordWrongCount: 0,
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

            this.logger.info(`${logPfx} [${mode}] ERROR LOSS '${normalizedPlayer}' -> '${newWord}'`);
            const statsLine = this.formatStatsLine(userId, {
                currentStreak: userStats.currentStreak || 0,
                bestStreak: preserved.bestStreak,
                isDM: isDM
            });

            return {
                type: RESPONSE_TYPES.ERROR,
                code: RESPONSE_CODES.LOSS,
                message: `${statsLine}\n**Thua cuộc!** Từ tiếp theo: **"${nextWord}"** không còn từ nào để nối tiếp.`,
                currentWord: newWord,
                gameData: newGameData
            };
        }

        // Normal move: Bot successfully plays nextWord
        db.incrementStat('total_words_guessed', 1);
        history.push(normalizedPlayer, currentWord);
        userStats.currentStreak = (userStats.currentStreak || 0) + 1;
        userStats.bestStreak = Math.max(userStats.bestStreak || 0, userStats.currentStreak);
        userStats.wrongCount = 0;

        const newGameData = {
            word: currentWord,
            history: history,
            mode: mode,
            wordWrongCount: 0,
            ...(isDM ? {
                currentStreak: userStats.currentStreak,
                bestStreak: userStats.bestStreak,
                wins: userStats.wins,
                wrongCount: 0
            } : {
                players: { ...players, [userId]: userStats }
            })
        };

        this.logger.info(`${logPfx} [${mode}] OK '${normalizedPlayer}' -> '${currentWord}'`);
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

    resetGame(gameData, isDM = false, context = null) {
        db.incrementStat('total_games', 1);
        const currentWord = this.newWord();
        const newGameData = {
            word: currentWord,
            history: [currentWord],
            mode: gameData.mode,
            wordWrongCount: 0,
            ...(isDM ? {
                currentStreak: 0,
                bestStreak: 0,
                wins: 0,
                wrongCount: 0
            } : {
                players: gameData.players || {}
            })
        };

        const logPfx = this.getLogPrefix(isDM, isDM ? gameData.id : null, gameData, context);
        this.logger.info(`${logPfx} Reset game -> '${currentWord}'`);
        return newGameData;
    }
}

module.exports = GameEngine;
