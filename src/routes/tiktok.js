const express = require('express');
const router = express.Router();

const {
    getTikTokAuthUrl,
    exchangeCodeForToken,
    getCreatorInfo,
    initVideoPublish,
    getPublishStatus,
    getStoredToken
} = require('../services/tiktok');

router.get('/auth/tiktok', (req, res) => {
    const authUrl = getTikTokAuthUrl();
    return res.redirect(authUrl);
});

router.get('/auth/tiktok/callback', async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
        return res.status(400).json({
            error: 'TikTok authorization failed',
            detail: error
        });
    }

    if (!code) {
        return res.status(400).json({ error: 'No authorization code received from TikTok.' });
    }

    try {
        const tokenData = await exchangeCodeForToken(code);

        return res.json({
            message: 'TikTok OAuth successful',
            state,
            token: tokenData
        });
    } catch (error) {
        console.error('TikTok callback exchange failed:', error.response?.data || error.message);
        return res.status(500).json({
            error: 'Failed to exchange TikTok authorization code',
            detail: error.response?.data || error.message
        });
    }
});

router.get('/tiktok/creator', async (req, res) => {
    try {
        const creatorInfo = await getCreatorInfo();
        return res.json(creatorInfo);
    } catch (error) {
        console.error('TikTok creator query failed:', error.response?.data || error.message);
        return res.status(500).json({
            error: 'Failed to fetch TikTok creator information',
            detail: error.response?.data || error.message
        });
    }
});

router.post('/tiktok/post', async (req, res) => {
    const { video_url, title, privacy_level, disable_duet, disable_comment, disable_stitch } = req.body;

    if (!video_url) {
        return res.status(400).json({ error: 'video_url is required.' });
    }

    const payload = {
        post_info: {
            title: title || 'My TikTok video',
            privacy_level: privacy_level || 'SELF_ONLY',
            disable_duet: disable_duet ?? false,
            disable_comment: disable_comment ?? false,
            disable_stitch: disable_stitch ?? false
        },
        source_info: {
            source: 'PULL_FROM_URL',
            video_url
        }
    };

    try {
        const response = await initVideoPublish(payload);
        return res.json({
            message: 'TikTok publish initialized',
            accessToken: getStoredToken(),
            data: response
        });
    } catch (error) {
        console.error('TikTok init publish failed:', error.response?.data || error.message);
        return res.status(500).json({
            error: 'Failed to initialize TikTok video publishing',
            detail: error.response?.data || error.message
        });
    }
});

router.get('/tiktok/status/:publishId', async (req, res) => {
    const { publishId } = req.params;

    try {
        const statusResponse = await getPublishStatus(publishId);
        return res.json(statusResponse);
    } catch (error) {
        console.error('TikTok publish status failed:', error.response?.data || error.message);
        return res.status(500).json({
            error: 'Failed to fetch TikTok publish status',
            detail: error.response?.data || error.message
        });
    }
});

module.exports = router;
