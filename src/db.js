const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, '..', 'data.json');

function read(key) {
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  return data[key];
}

function store(key, newData) {
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  if (!data[key]) data[key] = {};
  Object.assign(data[key], newData);
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = { read, store };