const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, '..', 'data.json');

function ensureData() {
    let data;
    try {
        if (!fs.existsSync(dataPath)) {
            data = { channels: {}, users: {} };
            fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
            return data;
        }
        const raw = fs.readFileSync(dataPath, 'utf8');
        data = raw ? JSON.parse(raw) : { channels: {}, users: {} };
    } catch (e) {
        data = { channels: {}, users: {} };
    }

        // Migrate legacy shapes
        if (!data.channels || Array.isArray(data.channels)) {
            if (Array.isArray(data.channels)) {
                // Preserve old allowlist
                if (!data.channelAllowlist) data.channelAllowlist = data.channels.slice();
            }
            data.channels = {};
        }
    if (!data.users || Array.isArray(data.users)) {
        data.users = {};
    }

    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
    return data;
}

function read(key) {
    const data = ensureData();
    return data[key];
}

function store(key, newData) {
    const data = ensureData();
    if (!data[key] || Array.isArray(data[key])) data[key] = {};
    Object.assign(data[key], newData);
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = { read, store };