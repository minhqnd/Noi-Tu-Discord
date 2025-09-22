const fs = require('fs');
const path = require('path');
const { PATHS } = require('./utils');

class Database {
    constructor() {
        this.dataPath = path.join(__dirname, '..', PATHS.DATA_FILE);
        this.cache = null;
        this.lastModified = null;
    }

    _ensureDataLoaded() {
        try {
            const stats = fs.statSync(this.dataPath);
            const currentModified = stats.mtime.getTime();

            // Only reload if file has been modified or cache is empty
            if (!this.cache || this.lastModified !== currentModified) {
                const raw = fs.readFileSync(this.dataPath, 'utf8');
                this.cache = raw ? JSON.parse(raw) : this._getDefaultData();
                this.lastModified = currentModified;
            }
        } catch (error) {
            // File doesn't exist or corrupted, create default
            this.cache = this._getDefaultData();
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
        } catch (error) {
            console.error('Failed to save database:', error.message);
            throw error;
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
        this._ensureDataLoaded();
    }
}

// Export singleton instance
const db = new Database();

module.exports = db;