const fs = require('fs');
const wordPairs = JSON.parse(fs.readFileSync('./src/assets/wordPairs.json', 'utf8'));

const allSyllables = new Set(Object.keys(wordPairs));
let endSyllables = new Set();
let normalSyllables = new Set();

for (const [start, ends] of Object.entries(wordPairs)) {
    for (const end of ends) {
        allSyllables.add(end);
    }
}

for (const s of allSyllables) {
    if (!wordPairs[s] || wordPairs[s].length === 0) {
        endSyllables.add(s);
    } else {
        normalSyllables.add(s);
    }
}

console.log("Tổng số âm tiết:", allSyllables.size);
console.log("Số âm tiết ngõ cụt (End syllables):", endSyllables.size);
console.log("Tỉ lệ âm tiết ngõ cụt:", (endSyllables.size / allSyllables.size * 100).toFixed(2) + "%");

// Simulate Random Game
function simulateGame(randomPlayer = true) {
    let history = new Set();
    // Bot starts with a random word that doesn't immediately lead to dead end for itself
    const startSyllables = Object.keys(wordPairs).filter(s => wordPairs[s].length > 0);
    let currentSyllable = startSyllables[Math.floor(Math.random() * startSyllables.length)];
    
    // Actually Bot uses `newWord()` which guarantees `!uniqueWord(lastWord)`
    
    let turn = 1; // 1 = User, 0 = Bot
    while (true) {
        if (turn === 1) { // User turn
            let possible = wordPairs[currentSyllable] || [];
            possible = possible.filter(w => !history.has(currentSyllable + ' ' + w));
            if (possible.length === 0) return 0; // User loses (can't move)
            
            // Random move
            let move = possible[Math.floor(Math.random() * possible.length)];
            history.add(currentSyllable + ' ' + move);
            currentSyllable = move;
            turn = 0;
        } else { // Bot turn
            let possible = wordPairs[currentSyllable] || [];
            let available = possible.filter(w => !history.has(currentSyllable + ' ' + w));
            if (available.length === 0) return 1; // User wins (bot can't move)
            
            let valid = available.filter(w => wordPairs[w] && wordPairs[w].length > 0);
            if (valid.length === 0) return 1; // Bot has no valid continuations, returns false, User wins
            
            let nonRepeating = valid.filter(w => w !== currentSyllable);
            let choices = nonRepeating.length > 0 ? nonRepeating : valid;
            let move = choices[Math.floor(Math.random() * choices.length)];
            
            history.add(currentSyllable + ' ' + move);
            currentSyllable = move;
            
            // Bot uniqueWord check
            let botNextPossible = wordPairs[currentSyllable] || [];
            let botValidContinuations = botNextPossible.filter(w => {
                if (w === currentSyllable) return false;
                let nextNext = wordPairs[w] || [];
                return nextNext.length > 0;
            });
            if (botValidContinuations.length === 0) {
                return 0; // User loses
            }
            turn = 1;
        }
    }
}

let wins = 0;
let total = 10000;
for(let i=0; i<total; i++) {
    wins += simulateGame();
}
console.log(`Win rate (random play): ${(wins/total*100).toFixed(2)}%`);

