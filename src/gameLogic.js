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
    if (!playerWord || !idChannel || !idUser) {
        throw new Error('Missing required parameters: playerWord, idChannel, idUser');
    }
    
    idChannel = idChannel.toString();
    idUser = idUser.toString();

    try {
        const channels = db.read('channels') || {};
        const channelData = channels[idChannel] || {};

        const result = gameEngine.processMove({ ...channelData, id: idChannel }, playerWord, idUser, false);

        // Save updated game data if present
        if (result.gameData) {
            db.store('channels', { [idChannel]: result.gameData });
        }

        return result;
    } catch (error) {
        logger.error(`Error in checkChannel for channel ${idChannel}:`, error);
        throw error;
    }
}

function checkUser(playerWord, idUser) {
    if (!playerWord || !idUser) {
        throw new Error('Missing required parameters: playerWord, idUser');
    }
    
    idUser = idUser.toString();

    try {
        const users = db.read('users') || {};
        const userData = users[idUser] || {};

        const result = gameEngine.processMove({ ...userData, id: idUser }, playerWord, idUser, true);

        // Save updated game data if present
        if (result.gameData) {
            db.store('users', { [idUser]: result.gameData });
        }

        return result;
    } catch (error) {
        logger.error(`Error in checkUser for user ${idUser}:`, error);
        throw error;
    }
}

function resetUserGame(idUser) {
    if (!idUser) {
        throw new Error('Missing required parameter: idUser');
    }
    
    idUser = idUser.toString();

    try {
        const users = db.read('users') || {};
        const userData = users[idUser] || {};

        const newGameData = gameEngine.resetGame({ ...userData, id: idUser }, true);
        db.store('users', { [idUser]: newGameData });

        return newGameData.word;
    } catch (error) {
        logger.error(`Error resetting user game for user ${idUser}:`, error);
        throw error;
    }
}

function resetChannelGame(idChannel) {
    if (!idChannel) {
        throw new Error('Missing required parameter: idChannel');
    }
    
    idChannel = idChannel.toString();

    try {
        const channels = db.read('channels') || {};
        const channelData = channels[idChannel] || {};

        const newGameData = gameEngine.resetGame({ ...channelData, id: idChannel }, false);
        db.store('channels', { [idChannel]: newGameData });

        return newGameData.word;
    } catch (error) {
        logger.error(`Error resetting channel game for channel ${idChannel}:`, error);
        throw error;
    }
}

function storeFeedback(userId, username, content, channelId) {
    if (!userId || !username || !content) {
        throw new Error('Missing required parameters: userId, username, content');
    }
    
    try {
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
        
        // Sanitize content for logging - only log length and first few chars
        const sanitizedContent = content.length > 20 ? content.substring(0, 20) + '...' : content;
        logger.info(`New feedback from ${username} (${userId}): "${sanitizedContent}" (${content.length} chars)`);
        return feedback.id;
    } catch (error) {
        logger.error(`Error storing feedback from user ${userId}:`, error);
        throw error;
    }
}

function getAllFeedbacks() {
    return db.read('feedbacks') || [];
}

function markFeedbackAsReviewed(feedbackId) {
    if (!feedbackId) {
        throw new Error('Missing required parameter: feedbackId');
    }
    
    try {
        const feedbacks = db.read('feedbacks') || [];
        const feedback = feedbacks.find(f => f.id === feedbackId);
        if (feedback) {
            feedback.status = 'reviewed';
            db.store('feedbacks', feedbacks);
            logger.info(`Feedback ${feedbackId} marked as reviewed`);
            return true;
        }
        logger.warn(`Feedback ${feedbackId} not found`);
        return false;
    } catch (error) {
        logger.error(`Error marking feedback ${feedbackId} as reviewed:`, error);
        throw error;
    }
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