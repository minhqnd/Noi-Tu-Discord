const axios = require('axios');
const { GAME_CONSTANTS, setupLogger } = require('./utils');
const logger = setupLogger('topgg_service');

class TopggService {
    constructor() {
        this.botId = GAME_CONSTANTS.TOPGG_BOT_ID || '1076547168099385436';
        this.voteUrl = GAME_CONSTANTS.TOPGG_VOTE_URL || `https://top.gg/bot/${this.botId}/vote`;
        // In-memory cache: userId -> { hasVoted: boolean, expiresAt: number }
        this.cache = new Map();
        this.cacheTtlMs = 60 * 1000; // 1 minute cache
    }

    /**
     * Get the voting page URL on Top.gg
     * @returns {string}
     */
    getVoteUrl() {
        return this.voteUrl;
    }

    /**
     * Check whether a user has voted for this bot on Top.gg in the last 12 hours.
     * @param {string} userId
     * @returns {Promise<{ hasVoted: boolean, error?: string }>}
     */
    async checkUserVote(userId) {
        // [DEV MOCK] Luôn trả về true để test giao diện (comment dòng dưới lại khi chạy thật)
        // return { hasVoted: true };

        if (!userId) {
            return { hasVoted: false, error: 'MISSING_USER_ID' };
        }

        const uid = userId.toString();
        const now = Date.now();

        // Check cache first
        const cached = this.cache.get(uid);
        if (cached && cached.expiresAt > now) {
            return { hasVoted: cached.hasVoted };
        }

        const token = process.env.TOPGG_TOKEN;
        if (!token) {
            logger.warn('TOPGG_TOKEN is not configured in environment variables.');
            return { hasVoted: false, error: 'NO_TOKEN' };
        }

        const rawToken = token.trim();
        const authHeader = rawToken.startsWith('Bearer ') ? rawToken : `Bearer ${rawToken}`;

        try {
            const url = `https://top.gg/api/bots/${this.botId}/check?userId=${uid}`;
            let response;
            try {
                response = await axios.get(url, {
                    headers: {
                        Authorization: authHeader,
                        'User-Agent': `Noi-Tu-Discord-Bot/${this.botId}`
                    },
                    timeout: 5000
                });
            } catch (err) {
                // If 401 with Bearer, fallback to raw token (legacy v0 format)
                if (err.response?.status === 401 && !rawToken.startsWith('Bearer ')) {
                    response = await axios.get(url, {
                        headers: {
                            Authorization: rawToken,
                            'User-Agent': `Noi-Tu-Discord-Bot/${this.botId}`
                        },
                        timeout: 5000
                    });
                } else {
                    throw err;
                }
            }

            if (response && response.status === 200 && response.data) {
                // Top.gg returns { voted: 1 } or { voted: 0 }
                const hasVoted = Number(response.data.voted) === 1;

                this.cache.set(uid, {
                    hasVoted,
                    expiresAt: now + this.cacheTtlMs
                });

                return { hasVoted };
            }

            return { hasVoted: false, error: 'UNEXPECTED_RESPONSE' };
        } catch (error) {
            logger.error(`Error checking vote for user ${uid} on Top.gg:`, error.response?.data || error.message);
            return { hasVoted: false, error: error.message };
        }
    }

    /**
     * Clear cached vote statuses.
     */
    clearCache() {
        this.cache.clear();
    }
}

const topggService = new TopggService();
module.exports = topggService;
