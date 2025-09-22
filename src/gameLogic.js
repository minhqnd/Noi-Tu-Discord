const axios = require('axios');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const GameEngine = require('./gameEngine');
const { setupLogger } = require('./utils');
const { tratu } = require('./wordProcessing');

const logger = setupLogger('game_logic');
const gameEngine = new GameEngine();

// Game logic functions from noitu_bot.js
function checkChannel(playerWord, idChannel, idUser) {
    idChannel = idChannel.toString();
    idUser = idUser.toString();

    const channels = db.read('channels') || {};
    const channelData = channels[idChannel] || {};

    const result = gameEngine.processMove({ ...channelData, id: idChannel }, playerWord, idUser, false);

    // Save updated game data if present
    if (result.gameData) {
        db.store('channels', { [idChannel]: result.gameData });
    }

    return result;
}

function checkUser(playerWord, idUser) {
    idUser = idUser.toString();

    const users = db.read('users') || {};
    const userData = users[idUser] || {};

    const result = gameEngine.processMove({ ...userData, id: idUser }, playerWord, idUser, true);

    // Save updated game data if present
    if (result.gameData) {
        db.store('users', { [idUser]: result.gameData });
    }

    return result;
}

function resetUserGame(idUser) {
    idUser = idUser.toString();

    const users = db.read('users') || {};
    const userData = users[idUser] || {};

    const newGameData = gameEngine.resetGame({ ...userData, id: idUser }, true);
    db.store('users', { [idUser]: newGameData });

    return newGameData.word;
}

function resetChannelGame(idChannel) {
    idChannel = idChannel.toString();

    const channels = db.read('channels') || {};
    const channelData = channels[idChannel] || {};

    const newGameData = gameEngine.resetGame({ ...channelData, id: idChannel }, false);
    db.store('channels', { [idChannel]: newGameData });

    return newGameData.word;
}

function storeFeedback(userId, username, content, channelId) {
    const feedbacks = db.read('feedbacks') || [];
    const feedback = {
        id: Date.now().toString(),
        userId: userId.toString(),
        username: username,
        content: content,
        channelId: channelId ? channelId.toString() : null,
        timestamp: new Date().toISOString(),
        status: 'pending' // pending, reviewed, resolved
    };
    feedbacks.push(feedback);
    db.store('feedbacks', feedbacks);
    logger.info(`New feedback from ${username} (${userId}): ${content.substring(0, 50)}...`);
    return feedback.id;
}

function getAllFeedbacks() {
    return db.read('feedbacks') || [];
}

function markFeedbackAsReviewed(feedbackId) {
    const feedbacks = db.read('feedbacks') || [];
    const feedback = feedbacks.find(f => f.id === feedbackId);
    if (feedback) {
        feedback.status = 'reviewed';
        db.store('feedbacks', feedbacks);
        return true;
    }
    return false;
}

function saveFeedbacks(feedbacks) {
    db.store('feedbacks', feedbacks);
}

module.exports = {
    // Game logic functions
    checkChannel,
    checkUser,
    resetUserGame,
    resetChannelGame,
    storeFeedback,
    getAllFeedbacks,
    markFeedbackAsReviewed,
    saveFeedbacks,
    tratu
};