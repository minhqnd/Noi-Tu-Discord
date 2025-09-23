const fs = require('fs');
const path = require('path');
const { PATHS, setupLogger } = require('./utils');

const logger = setupLogger('database');

// Database constants
const DB_CONSTANTS = {
    MAX_CACHE_AGE_MS: 5 * 60 * 1000, // 5 minutes
    MAX_FEEDBACKS: 1000, // Limit feedback storage
    MAX_HISTORY_PER_GAME: 100, // Limit game history
};

class Database {
    constructor() {
        this.dataPath = path.join(__dirname, '..', PATHS.DATA_FILE);
        this.cache = null;
        this.lastModified = null;
        this.cacheTimestamp = null;
    }

    _ensureDataLoaded() {
        try {
            const now = Date.now();
            
            // Check if cache has expired
            if (this.cache && this.cacheTimestamp && 
                (now - this.cacheTimestamp) > DB_CONSTANTS.MAX_CACHE_AGE_MS) {
                logger.debug('Cache expired, clearing');
                this.cache = null;
            }
            
            const stats = fs.statSync(this.dataPath);
            const currentModified = stats.mtime.getTime();

            // Only reload if file has been modified or cache is empty
            if (!this.cache || this.lastModified !== currentModified) {
                const raw = fs.readFileSync(this.dataPath, 'utf8');
                this.cache = raw ? JSON.parse(raw) : this._getDefaultData();
                this.lastModified = currentModified;
                this.cacheTimestamp = now;
                logger.debug('Data loaded into cache');
            }
        } catch (error) {
            // File doesn't exist or corrupted, create default
            logger.warn('Failed to load data file, creating default:', error.message);
            this.cache = this._getDefaultData();
            this.cacheTimestamp = Date.now();
            this._saveData();
        }
    }

    _getDefaultData() {
        return {
            channels: {},
            users: {},
            channelAllowlist: [],
            feedbacks: []
        };
    }

    _saveData() {
        try {
            // Clean up data before saving
            this._cleanupData();
            
            // Ensure directory exists
            const dir = path.dirname(this.dataPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            fs.writeFileSync(this.dataPath, JSON.stringify(this.cache, null, 2), 'utf8');
            // Update last modified time
            if (fs.existsSync(this.dataPath)) {
                this.lastModified = fs.statSync(this.dataPath).mtime.getTime();
            }
            logger.debug('Data saved successfully');
        } catch (error) {
            logger.error('Failed to save database:', error.message);
            throw error;
        }
    }

    _cleanupData() {
        if (!this.cache) return;
        
        // Cleanup feedbacks - keep only latest feedbacks
        if (this.cache.feedbacks && Array.isArray(this.cache.feedbacks)) {
            if (this.cache.feedbacks.length > DB_CONSTANTS.MAX_FEEDBACKS) {
                // Sort by timestamp and keep latest
                this.cache.feedbacks.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                this.cache.feedbacks = this.cache.feedbacks.slice(0, DB_CONSTANTS.MAX_FEEDBACKS);
                logger.info(`Cleaned up feedbacks, kept ${DB_CONSTANTS.MAX_FEEDBACKS} latest entries`);
            }
        }
        
        // Cleanup game history
        if (this.cache.channels) {
            Object.keys(this.cache.channels).forEach(channelId => {
                const channel = this.cache.channels[channelId];
                if (channel.history && Array.isArray(channel.history) && 
                    channel.history.length > DB_CONSTANTS.MAX_HISTORY_PER_GAME) {
                    channel.history = channel.history.slice(-DB_CONSTANTS.MAX_HISTORY_PER_GAME);
                }
            });
        }
        
        if (this.cache.users) {
            Object.keys(this.cache.users).forEach(userId => {
                const user = this.cache.users[userId];
                if (user.history && Array.isArray(user.history) && 
                    user.history.length > DB_CONSTANTS.MAX_HISTORY_PER_GAME) {
                    user.history = user.history.slice(-DB_CONSTANTS.MAX_HISTORY_PER_GAME);
                }
            });
        }
    }

    _migrateLegacyData() {
        let migrated = false;

        // Migrate legacy shapes
        if (!this.cache.channels || typeof this.cache.channels !== 'object') {
            if (Array.isArray(this.cache.channels)) {
                // Preserve old allowlist
                if (!this.cache.channelAllowlist) {
                    this.cache.channelAllowlist = this.cache.channels.slice();
                }
            }
            this.cache.channels = {};
            migrated = true;
        }

        if (!this.cache.users || typeof this.cache.users !== 'object') {
            this.cache.users = {};
            migrated = true;
        }

        if (!Array.isArray(this.cache.channelAllowlist)) {
            this.cache.channelAllowlist = this.cache.channelAllowlist ? [this.cache.channelAllowlist].flat() : [];
            migrated = true;
        }

        if (!Array.isArray(this.cache.feedbacks)) {
            this.cache.feedbacks = [];
            migrated = true;
        }

        if (migrated) {
            this._saveData();
        }
    }

    read(key) {
        this._ensureDataLoaded();
        this._migrateLegacyData();
        return this.cache[key];
    }

    store(key, newData) {
        this._ensureDataLoaded();
        this._migrateLegacyData();

        if (!this.cache[key] || typeof this.cache[key] !== 'object') {
            this.cache[key] = {};
        }

        Object.assign(this.cache[key], newData);
        this._saveData();
    }

    getAll() {
        this._ensureDataLoaded();
        this._migrateLegacyData();
        return { ...this.cache };
    }

    // Force reload cache
    reload() {
        this.cache = null;
        this.lastModified = null;
        this.cacheTimestamp = null;
        this._ensureDataLoaded();
        logger.debug('Cache reloaded');
    }
    
    // Clear expired cache entries
    clearCache() {
        this.cache = null;
        this.cacheTimestamp = null;
        logger.debug('Cache cleared');
    }
}

// Export singleton instance
const db = new Database();

module.exports = db;