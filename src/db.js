const path = require('path');
const Database = require('better-sqlite3');
const { PATHS, setupLogger } = require('./utils');

const logger = setupLogger('database');

const DB_CONSTANTS = {
    MAX_FEEDBACKS: 1000,
    MAX_HISTORY_PER_GAME: 100,
};

class DB {
    constructor() {
        this.dbPath = path.join(__dirname, '..', 'data.db');
        this.db = null;
    }

    /**
     * Initialize SQLite database and create tables if they don't exist.
     * Must be called once before any other operations.
     */
    initialize() {
        this.db = new Database(this.dbPath);
        // Enable WAL mode for better concurrent read performance
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('busy_timeout = 5000');

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS channels (
                channel_id TEXT PRIMARY KEY,
                word TEXT,
                mode TEXT DEFAULT 'bot',
                history TEXT DEFAULT '[]',
                players TEXT DEFAULT '{}'
            );

            CREATE TABLE IF NOT EXISTS users (
                user_id TEXT PRIMARY KEY,
                word TEXT,
                history TEXT DEFAULT '[]',
                current_streak INTEGER DEFAULT 0,
                best_streak INTEGER DEFAULT 0,
                wins INTEGER DEFAULT 0,
                wrong_count INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS channel_allowlist (
                channel_id TEXT PRIMARY KEY
            );

            CREATE TABLE IF NOT EXISTS feedbacks (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                username TEXT NOT NULL,
                content TEXT NOT NULL,
                channel_id TEXT,
                timestamp TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                replies TEXT DEFAULT '[]'
            );
        `);

        // Migration: add replies column to feedbacks if not exists
        const feedbackCols = this.db.pragma('table_info(feedbacks)');
        if (!feedbackCols.find(c => c.name === 'replies')) {
            this.db.exec(`ALTER TABLE feedbacks ADD COLUMN replies TEXT DEFAULT '[]'`);
            logger.info('Migration: added replies column to feedbacks table');
        }

        // Prepare commonly used statements for performance
        this._stmts = {
            // Channels
            getChannel: this.db.prepare('SELECT * FROM channels WHERE channel_id = ?'),
            getAllChannels: this.db.prepare('SELECT * FROM channels'),
            upsertChannel: this.db.prepare(`
                INSERT INTO channels (channel_id, word, mode, history, players)
                VALUES (@channel_id, @word, @mode, @history, @players)
                ON CONFLICT(channel_id) DO UPDATE SET
                    word = @word, mode = @mode, history = @history, players = @players
            `),
            deleteChannel: this.db.prepare('DELETE FROM channels WHERE channel_id = ?'),

            // Users
            getUser: this.db.prepare('SELECT * FROM users WHERE user_id = ?'),
            getAllUsers: this.db.prepare('SELECT * FROM users'),
            upsertUser: this.db.prepare(`
                INSERT INTO users (user_id, word, history, current_streak, best_streak, wins, wrong_count)
                VALUES (@user_id, @word, @history, @current_streak, @best_streak, @wins, @wrong_count)
                ON CONFLICT(user_id) DO UPDATE SET
                    word = @word, history = @history, current_streak = @current_streak,
                    best_streak = @best_streak, wins = @wins, wrong_count = @wrong_count
            `),

            // Channel Allowlist
            getAllowlist: this.db.prepare('SELECT channel_id FROM channel_allowlist'),
            addToAllowlist: this.db.prepare('INSERT OR IGNORE INTO channel_allowlist (channel_id) VALUES (?)'),
            removeFromAllowlist: this.db.prepare('DELETE FROM channel_allowlist WHERE channel_id = ?'),
            clearAllowlist: this.db.prepare('DELETE FROM channel_allowlist'),

            // Feedbacks
            getAllFeedbacks: this.db.prepare('SELECT * FROM feedbacks ORDER BY timestamp DESC'),
            insertFeedback: this.db.prepare(`
                INSERT INTO feedbacks (id, user_id, username, content, channel_id, timestamp, status, replies)
                VALUES (@id, @user_id, @username, @content, @channel_id, @timestamp, @status, @replies)
            `),
            updateFeedbackStatus: this.db.prepare('UPDATE feedbacks SET status = ? WHERE id = ?'),
            countFeedbacks: this.db.prepare('SELECT COUNT(*) as count FROM feedbacks'),
            deleteOldFeedbacks: this.db.prepare(`
                DELETE FROM feedbacks WHERE id NOT IN (
                    SELECT id FROM feedbacks ORDER BY timestamp DESC LIMIT ?
                )
            `),
        };

        logger.info('SQLite database initialized');
    }

    // ─── Internal helpers ───────────────────────────────────────────

    _rowToChannelData(row) {
        if (!row) return null;
        return {
            word: row.word,
            mode: row.mode || 'bot',
            history: JSON.parse(row.history || '[]'),
            players: JSON.parse(row.players || '{}'),
        };
    }

    _rowToUserData(row) {
        if (!row) return null;
        return {
            word: row.word,
            history: JSON.parse(row.history || '[]'),
            currentStreak: row.current_streak || 0,
            bestStreak: row.best_streak || 0,
            wins: row.wins || 0,
            wrongCount: row.wrong_count || 0,
        };
    }

    _channelDataToRow(channelId, data) {
        return {
            channel_id: channelId,
            word: data.word || null,
            mode: data.mode || 'bot',
            history: JSON.stringify((data.history || []).slice(-DB_CONSTANTS.MAX_HISTORY_PER_GAME)),
            players: JSON.stringify(data.players || {}),
        };
    }

    _userDataToRow(userId, data) {
        return {
            user_id: userId,
            word: data.word || null,
            history: JSON.stringify((data.history || []).slice(-DB_CONSTANTS.MAX_HISTORY_PER_GAME)),
            current_streak: data.currentStreak || 0,
            best_streak: data.bestStreak || 0,
            wins: data.wins || 0,
            wrong_count: data.wrongCount || 0,
        };
    }

    // ─── Public API (compatible with old JSON-based db) ─────────────

    /**
     * Read data by key. Returns the same shape as the old JSON db.
     * @param {'channels'|'users'|'channelAllowlist'|'feedbacks'} key
     */
    read(key) {
        switch (key) {
            case 'channels': {
                const rows = this._stmts.getAllChannels.all();
                const result = {};
                for (const row of rows) {
                    result[row.channel_id] = this._rowToChannelData(row);
                }
                return result;
            }
            case 'users': {
                const rows = this._stmts.getAllUsers.all();
                const result = {};
                for (const row of rows) {
                    result[row.user_id] = this._rowToUserData(row);
                }
                return result;
            }
            case 'channelAllowlist': {
                return this._stmts.getAllowlist.all().map(r => r.channel_id);
            }
            case 'feedbacks': {
                return this._stmts.getAllFeedbacks.all().map(row => ({
                    id: row.id,
                    user_id: row.user_id,
                    userId: row.user_id,
                    username: row.username,
                    content: row.content,
                    channelId: row.channel_id,
                    timestamp: row.timestamp,
                    status: row.status,
                    replies: JSON.parse(row.replies || '[]'),
                }));
            }
            default:
                logger.warn(`Unknown read key: ${key}`);
                return null;
        }
    }

    /**
     * Store/merge data by key.
     * Channels & users: merges provided entries (like Object.assign).
     * channelAllowlist: replaces the entire list.
     * feedbacks: replaces the entire list.
     * @param {'channels'|'users'|'channelAllowlist'|'feedbacks'} key
     * @param {*} newData
     */
    store(key, newData) {
        switch (key) {
            case 'channels': {
                if (typeof newData === 'object' && !Array.isArray(newData)) {
                    const upsertMany = this.db.transaction((entries) => {
                        for (const [channelId, data] of Object.entries(entries)) {
                            // Merge with existing data
                            const existing = this._rowToChannelData(this._stmts.getChannel.get(channelId)) || {};
                            const merged = { ...existing, ...data };
                            this._stmts.upsertChannel.run(this._channelDataToRow(channelId, merged));
                        }
                    });
                    upsertMany(newData);
                }
                break;
            }
            case 'users': {
                if (typeof newData === 'object' && !Array.isArray(newData)) {
                    const upsertMany = this.db.transaction((entries) => {
                        for (const [userId, data] of Object.entries(entries)) {
                            const existing = this._rowToUserData(this._stmts.getUser.get(userId)) || {};
                            const merged = { ...existing, ...data };
                            this._stmts.upsertUser.run(this._userDataToRow(userId, merged));
                        }
                    });
                    upsertMany(newData);
                }
                break;
            }
            case 'channelAllowlist': {
                if (Array.isArray(newData)) {
                    const replaceAll = this.db.transaction((list) => {
                        this._stmts.clearAllowlist.run();
                        for (const id of list) {
                            this._stmts.addToAllowlist.run(id);
                        }
                    });
                    replaceAll(newData);
                }
                break;
            }
            case 'feedbacks': {
                if (Array.isArray(newData)) {
                    // Replace all feedbacks
                    const replaceAll = this.db.transaction((feedbacks) => {
                        this.db.exec('DELETE FROM feedbacks');
                        for (const f of feedbacks) {
                            this._stmts.insertFeedback.run({
                                id: f.id,
                                user_id: f.userId || f.user_id,
                                username: f.username,
                                content: f.content,
                                channel_id: f.channelId || null,
                                timestamp: f.timestamp,
                                status: f.status || 'pending',
                                replies: JSON.stringify(f.replies || []),
                            });
                        }
                    });
                    replaceAll(newData);
                    // Cleanup: keep only MAX_FEEDBACKS
                    const { count } = this._stmts.countFeedbacks.get();
                    if (count > DB_CONSTANTS.MAX_FEEDBACKS) {
                        this._stmts.deleteOldFeedbacks.run(DB_CONSTANTS.MAX_FEEDBACKS);
                        logger.info(`Cleaned up feedbacks, kept ${DB_CONSTANTS.MAX_FEEDBACKS} latest entries`);
                    }
                }
                break;
            }
            default:
                logger.warn(`Unknown store key: ${key}`);
        }
    }

    /**
     * Replace data entirely for a key.
     * @param {'channels'|'users'|'channelAllowlist'|'feedbacks'} key
     * @param {*} newData
     */
    replace(key, newData) {
        switch (key) {
            case 'channels': {
                const replaceAll = this.db.transaction((entries) => {
                    this.db.exec('DELETE FROM channels');
                    for (const [channelId, data] of Object.entries(entries)) {
                        this._stmts.upsertChannel.run(this._channelDataToRow(channelId, data));
                    }
                });
                replaceAll(newData);
                break;
            }
            case 'users': {
                const replaceAll = this.db.transaction((entries) => {
                    this.db.exec('DELETE FROM users');
                    for (const [userId, data] of Object.entries(entries)) {
                        this._stmts.upsertUser.run(this._userDataToRow(userId, data));
                    }
                });
                replaceAll(newData);
                break;
            }
            case 'channelAllowlist':
            case 'feedbacks':
                // Same behavior as store for arrays
                this.store(key, newData);
                break;
            default:
                logger.warn(`Unknown replace key: ${key}`);
        }
    }

    /**
     * Get all data (same shape as old JSON).
     */
    getAll() {
        return {
            channels: this.read('channels'),
            users: this.read('users'),
            channelAllowlist: this.read('channelAllowlist'),
            feedbacks: this.read('feedbacks'),
        };
    }

    /**
     * No-op for compatibility. SQLite doesn't need cache reload.
     */
    reload() {
        logger.debug('reload() called (no-op for SQLite)');
    }

    /**
     * No-op for compatibility. SQLite doesn't use in-memory cache.
     */
    clearCache() {
        logger.debug('clearCache() called (no-op for SQLite)');
    }

    /**
     * Close the database connection gracefully.
     */
    close() {
        if (this.db) {
            this.db.close();
            logger.info('SQLite database closed');
        }
    }
}

// Export singleton instance
const db = new DB();
db.initialize();

module.exports = db;
