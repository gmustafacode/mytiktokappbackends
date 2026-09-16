const axios = require('axios');
const { randomUUID } = require('crypto');

const tokenStore = {
    accessToken: null,
    refreshToken: null,
    expiresAt: null,
    openId: null,
    scope: null
};

function setTokenData(payload = {}) {
    if (!payload.access_token) {
        return;
    }

    tokenStore.accessToken = payload.access_token;
    tokenStore.refreshToken = payload.refresh_token || null;
    tokenStore.expiresAt = payload.expires_in ? Date.now() + payload.expires_in * 1000 : null;
    tokenStore.openId = payload.open_id || null;
    tokenStore.scope = payload.scope || null;
}

function getStoredToken() {
    return tokenStore.accessToken;
}

function getTikTokAuthUrl() {
    const state = randomUUID();
    const params = new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY,
        scope: 'video.publish',
        response_type: 'code',
        redirect_uri: process.env.TIKTOK_REDIRECT_URI,
        state
    });

    return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
}

async function exchangeCodeForToken(code) {
    const params = new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY,
        client_secret: process.env.TIKTOK_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: process.env.TIKTOK_REDIRECT_URI
    });

    const response = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', params.toString(), {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
        }
    });

    const payload = response.data?.data || response.data;
    setTokenData(payload);

    return payload;
}

async function getCreatorInfo() {
    const accessToken = getStoredToken();

    if (!accessToken) {
        throw new Error('No TikTok access token available. Complete the OAuth flow first.');
    }

    const response = await axios.post(
        'https://open.tiktokapis.com/v2/post/publish/creator_info/query/',
        {},
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        }
    );

    return response.data;
}

async function initVideoPublish(postPayload) {
    const accessToken = getStoredToken();

    if (!accessToken) {
        throw new Error('No TikTok access token available. Complete the OAuth flow first.');
    }

    const response = await axios.post(
        'https://open.tiktokapis.com/v2/post/publish/video/init/',
        postPayload,
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        }
    );

    return response.data;
}

async function getPublishStatus(publishId) {
    const accessToken = getStoredToken();

    if (!accessToken) {
        throw new Error('No TikTok access token available. Complete the OAuth flow first.');
    }

    const response = await axios.post(
        'https://open.tiktokapis.com/v2/post/publish/status/fetch/',
        { publish_id: publishId },
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        }
    );

    return response.data;
}

module.exports = {
    getTikTokAuthUrl,
    exchangeCodeForToken,
    getCreatorInfo,
    initVideoPublish,
    getPublishStatus,
    getStoredToken
};
