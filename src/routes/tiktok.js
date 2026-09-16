const express = require('express');
const multer = require('multer');
const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 500 * 1024 * 1024 },
    fileFilter: (req, file, callback) => {
        if (!file.mimetype.startsWith('video/')) {
            callback(new Error('Only video files are allowed.'));
            return;
        }

        callback(null, true);
    }
});

const {
    getTikTokAuthUrl,
    exchangeCodeForToken,
    getCreatorInfo,
    uploadVideoToTikTok,
    getPublishStatus,
    validateState
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

    if (!state || !validateState(state)) {
        return res.status(400).json({
            error: 'Invalid OAuth state. Please restart the TikTok login flow.'
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
            open_id: tokenData.open_id,
            scope: tokenData.scope,
            expires_in: tokenData.expires_in
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

router.post('/tiktok/post', upload.single('video'), async (req, res) => {
    const { title, privacy_level, disable_duet, disable_comment, disable_stitch } = req.body;

    if (!req.file) {
        return res.status(400).json({ error: 'Please select a video file.' });
    }

    try {
        const response = await uploadVideoToTikTok(req.file, {
            title,
            privacyLevel: privacy_level,
            disableDuet: disable_duet === 'true',
            disableComment: disable_comment === 'true',
            disableStitch: disable_stitch === 'true'
        });

        return res.json({
            message: 'Video uploaded to TikTok successfully',
            publish_id: response.publishId,
            video_size: response.videoSize,
            total_chunks: response.totalChunkCount,
            uploaded_bytes: response.uploadedBytes,
            status: response.status
        });
    } catch (error) {
        console.error('TikTok init publish failed:', error.response?.data || error.message);
        return res.status(error.response?.status || 500).json({
            error: 'Failed to initialize TikTok video publishing',
            detail: error.response?.data || error.message
        });
    }
});

router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        return res.status(400).json({ error: `Upload failed: ${error.message}` });
    }

    if (error) {
        return res.status(400).json({ error: error.message });
    }

    return next();
});

router.get('/tiktok/status/:publishId', async (req, res) => {
    const { publishId } = req.params;

    try {
        const statusResponse = await getPublishStatus(publishId);
        return res.json(statusResponse);
    } catch (error) {
        console.error('TikTok publish status failed:', error.response?.data || error.message);
        return res.status(error.response?.status || 500).json({
            error: 'Failed to fetch TikTok publish status',
            detail: error.response?.data || error.message
        });
    }
});

module.exports = router;
