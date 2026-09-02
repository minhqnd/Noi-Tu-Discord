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
                players TEXT DEFAULT '{}',
                word_wrong_count INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS users (
                user_id TEXT PRIMARY KEY,
                word TEXT,
                history TEXT DEFAULT '[]',
                current_streak INTEGER DEFAULT 0,
                best_streak INTEGER DEFAULT 0,
                wins INTEGER DEFAULT 0,
                wrong_count INTEGER DEFAULT 0,
                word_wrong_count INTEGER DEFAULT 0,
                hints INTEGER DEFAULT 0,
                last_vote_claim INTEGER DEFAULT 0
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

            CREATE TABLE IF NOT EXISTS global_stats (
                key TEXT PRIMARY KEY,
                value INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS tracked_players (
                user_id TEXT PRIMARY KEY,
                first_seen TEXT DEFAULT CURRENT_TIMESTAMP,
                last_seen TEXT DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Migration: add replies column to feedbacks if not exists
        const feedbackCols = this.db.pragma('table_info(feedbacks)');
        if (!feedbackCols.find(c => c.name === 'replies')) {
            this.db.exec(`ALTER TABLE feedbacks ADD COLUMN replies TEXT DEFAULT '[]'`);
            logger.info('Migration: added replies column to feedbacks table');
        }

        // Migration: add word_wrong_count column to channels and users if not exists
        const channelCols = this.db.pragma('table_info(channels)');
        if (!channelCols.find(c => c.name === 'word_wrong_count')) {
            this.db.exec(`ALTER TABLE channels ADD COLUMN word_wrong_count INTEGER DEFAULT 0`);
            logger.info('Migration: added word_wrong_count column to channels table');
        }

        const userCols = this.db.pragma('table_info(users)');
        if (!userCols.find(c => c.name === 'word_wrong_count')) {
            this.db.exec(`ALTER TABLE users ADD COLUMN word_wrong_count INTEGER DEFAULT 0`);
            logger.info('Migration: added word_wrong_count column to users table');
        }
        if (!userCols.find(c => c.name === 'hints')) {
            this.db.exec(`ALTER TABLE users ADD COLUMN hints INTEGER DEFAULT 0`);
            logger.info('Migration: added hints column to users table');
        }
        if (!userCols.find(c => c.name === 'last_vote_claim')) {
            this.db.exec(`ALTER TABLE users ADD COLUMN last_vote_claim INTEGER DEFAULT 0`);
            logger.info('Migration: added last_vote_claim column to users table');
        }

        // Backfill tracked_players from existing channels and users data
        try {
            const { count: playerCount } = this.db.prepare('SELECT COUNT(*) as count FROM tracked_players').get();
            if (playerCount === 0) {
                const backfill = this.db.transaction(() => {
                    const channels = this.db.prepare('SELECT players FROM channels').all();
                    for (const ch of channels) {
                        try {
                            const players = JSON.parse(ch.players || '{}');
                            for (const uid of Object.keys(players)) {
                                this.db.prepare('INSERT OR IGNORE INTO tracked_players (user_id) VALUES (?)').run(uid.toString());
                            }
                        } catch (e) { }
                    }
                    const users = this.db.prepare('SELECT user_id FROM users').all();
                    for (const u of users) {
                        this.db.prepare('INSERT OR IGNORE INTO tracked_players (user_id) VALUES (?)').run(u.user_id.toString());
                    }
                });
                backfill();
                logger.info('Backfilled tracked_players from existing channels and users data');
            }
        } catch (e) {
            logger.error(`Error backfilling tracked_players: ${e.message}`);
        }

        // Prepare commonly used statements for performance
        this._stmts = {
            // Channels
            getChannel: this.db.prepare('SELECT * FROM channels WHERE channel_id = ?'),
            getAllChannels: this.db.prepare('SELECT * FROM channels'),
            upsertChannel: this.db.prepare(`
                INSERT INTO channels (channel_id, word, mode, history, players, word_wrong_count)
                VALUES (@channel_id, @word, @mode, @history, @players, @word_wrong_count)
                ON CONFLICT(channel_id) DO UPDATE SET
                    word = @word, mode = @mode, history = @history, players = @players, word_wrong_count = @word_wrong_count
            `),
            deleteChannel: this.db.prepare('DELETE FROM channels WHERE channel_id = ?'),

            // Users
            getUser: this.db.prepare('SELECT * FROM users WHERE user_id = ?'),
            getAllUsers: this.db.prepare('SELECT * FROM users'),
            upsertUser: this.db.prepare(`
                INSERT INTO users (user_id, word, history, current_streak, best_streak, wins, wrong_count, word_wrong_count, hints, last_vote_claim)
                VALUES (@user_id, @word, @history, @current_streak, @best_streak, @wins, @wrong_count, @word_wrong_count, @hints, @last_vote_claim)
                ON CONFLICT(user_id) DO UPDATE SET
                    word = @word, history = @history, current_streak = @current_streak,
                    best_streak = @best_streak, wins = @wins, wrong_count = @wrong_count, word_wrong_count = @word_wrong_count,
                    hints = @hints, last_vote_claim = @last_vote_claim
            `),
            getUserHints: this.db.prepare('SELECT hints FROM users WHERE user_id = ?'),
            addUserHint: this.db.prepare(`
                INSERT INTO users (user_id, hints) VALUES (@user_id, @amount)
                ON CONFLICT(user_id) DO UPDATE SET hints = MIN(hints + @amount, @max_hints)
            `),
            useUserHint: this.db.prepare(`
                UPDATE users SET hints = hints - 1 WHERE user_id = ? AND hints > 0
            `),
            getUserLastVoteClaim: this.db.prepare('SELECT last_vote_claim FROM users WHERE user_id = ?'),
            setUserLastVoteClaim: this.db.prepare(`
                INSERT INTO users (user_id, last_vote_claim) VALUES (?, ?)
                ON CONFLICT(user_id) DO UPDATE SET last_vote_claim = excluded.last_vote_claim
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

            // Global Stats
            incrementStat: this.db.prepare(`
                INSERT INTO global_stats (key, value) VALUES (@key, @amount)
                ON CONFLICT(key) DO UPDATE SET value = value + excluded.value
            `),
            getAllGlobalStats: this.db.prepare('SELECT key, value FROM global_stats'),
            getStat: this.db.prepare('SELECT value FROM global_stats WHERE key = ?'),

            // Tracked Players
            trackPlayer: this.db.prepare(`
                INSERT INTO tracked_players (user_id, first_seen, last_seen)
                VALUES (@user_id, datetime('now'), datetime('now'))
                ON CONFLICT(user_id) DO UPDATE SET last_seen = datetime('now')
            `),
            countTrackedPlayers: this.db.prepare('SELECT COUNT(*) as count FROM tracked_players'),
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
            wordWrongCount: row.word_wrong_count || 0,
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
            wordWrongCount: row.word_wrong_count || 0,
            hints: row.hints || 0,
            lastVoteClaim: row.last_vote_claim || 0,
        };
    }

    _channelDataToRow(channelId, data) {
        return {
            channel_id: channelId,
            word: data.word || null,
            mode: data.mode || 'bot',
            history: JSON.stringify((data.history || []).slice(-DB_CONSTANTS.MAX_HISTORY_PER_GAME)),
            players: JSON.stringify(data.players || {}),
            word_wrong_count: data.wordWrongCount || 0,
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
            word_wrong_count: data.wordWrongCount || 0,
            hints: data.hints || 0,
            last_vote_claim: data.lastVoteClaim || data.last_vote_claim || 0,
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
     * Increment a global stat counter by amount (default 1).
     * @param {string} key
     * @param {number} amount
     */
    incrementStat(key, amount = 1) {
        try {
            this._stmts.incrementStat.run({ key, amount });
        } catch (error) {
            logger.error(`Error incrementing stat ${key}:`, error);
        }
    }

    /**
     * Get all global stats as key-value object.
     * @returns {Object.<string, number>}
     */
    getGlobalStats() {
        try {
            const rows = this._stmts.getAllGlobalStats.all();
            const stats = {};
            for (const row of rows) {
                stats[row.key] = row.value;
            }
            return stats;
        } catch (error) {
            logger.error('Error fetching global stats:', error);
            return {};
        }
    }

    /**
     * Get a single global stat value.
     * @param {string} key
     * @returns {number}
     */
    getStat(key) {
        try {
            const row = this._stmts.getStat.get(key);
            return row ? row.value : 0;
        } catch (error) {
            logger.error(`Error fetching stat ${key}:`, error);
            return 0;
        }
    }

    /**
     * Track a user interaction (records first seen / last seen).
     * @param {string} userId
     */
    trackPlayer(userId) {
        if (!userId) return;
        try {
            this._stmts.trackPlayer.run({ user_id: userId.toString() });
        } catch (error) {
            logger.error(`Error tracking player ${userId}:`, error);
        }
    }

    /**
     * Get total count of unique tracked players.
     * @returns {number}
     */
    getTotalTrackedPlayers() {
        try {
            const { count } = this._stmts.countTrackedPlayers.get();
            return count || 0;
        } catch (error) {
            logger.error('Error fetching tracked players count:', error);
            return 0;
        }
    }

    /**
     * Get user hints count.
     * @param {string} userId
     * @returns {number}
     */
    getUserHints(userId) {
        if (!userId) return 0;
        try {
            const row = this._stmts.getUserHints.get(userId.toString());
            return row ? (row.hints || 0) : 0;
        } catch (error) {
            logger.error(`Error fetching hints for user ${userId}:`, error);
            return 0;
        }
    }

    /**
     * Add hints for a user (capped at maxHints).
     * @param {string} userId
     * @param {number} amount
     * @param {number} maxHints
     * @returns {{ added: boolean, hints: number }}
     */
    addUserHint(userId, amount = 1, maxHints = 3) {
        if (!userId) return { added: false, hints: 0 };
        try {
            const current = this.getUserHints(userId);
            if (current >= maxHints) {
                return { added: false, hints: current };
            }
            this._stmts.addUserHint.run({
                user_id: userId.toString(),
                amount: amount,
                max_hints: maxHints
            });
            const updated = this.getUserHints(userId);
            return { added: updated > current, hints: updated };
        } catch (error) {
            logger.error(`Error adding hints for user ${userId}:`, error);
            return { added: false, hints: 0 };
        }
    }

    /**
     * Consume 1 hint from user if available.
     * @param {string} userId
     * @returns {boolean}
     */
    useUserHint(userId) {
        if (!userId) return false;
        try {
            const result = this._stmts.useUserHint.run(userId.toString());
            return result.changes > 0;
        } catch (error) {
            logger.error(`Error using hint for user ${userId}:`, error);
            return false;
        }
    }

    /**
     * Get user's last vote claim timestamp.
     * @param {string} userId
     * @returns {number}
     */
    getUserLastVoteClaim(userId) {
        if (!userId) return 0;
        try {
            const row = this._stmts.getUserLastVoteClaim.get(userId.toString());
            return row ? (row.last_vote_claim || 0) : 0;
        } catch (error) {
            logger.error(`Error fetching last_vote_claim for user ${userId}:`, error);
            return 0;
        }
    }

    /**
     * Set user's last vote claim timestamp or state.
     * @param {string} userId
     * @param {number} timestamp
     */
    setUserLastVoteClaim(userId, timestamp = Date.now()) {
        if (!userId) return;
        try {
            this._stmts.setUserLastVoteClaim.run(userId.toString(), timestamp);
        } catch (error) {
            logger.error(`Error updating last_vote_claim for user ${userId}:`, error);
        }
    }

    getUserVoteClaimed(userId) {
        return this.getUserLastVoteClaim(userId);
    }

    setUserVoteClaimed(userId, claimed = 1) {
        this.setUserLastVoteClaim(userId, claimed);
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
