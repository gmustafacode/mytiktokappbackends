const express = require("express");
const multer = require("multer");

const router = express.Router();

// ======================================================
// Multer configuration
// ======================================================

const upload = multer({
    storage: multer.memoryStorage(),

    limits: {
        fileSize: 500 * 1024 * 1024
    },

    fileFilter: (
        req,
        file,
        callback
    ) => {
        if (
            !file.mimetype ||
            !file.mimetype.startsWith("video/")
        ) {
            return callback(
                new Error(
                    "Only video files are allowed."
                )
            );
        }

        callback(null, true);
    }
});

// ======================================================
// TikTok service
// ======================================================

const {
    getTikTokAuthRequest,
    exchangeCodeForToken,
    saveTokenCookie,
    saveStateCookie,
    getCreatorInfo,
    uploadVideoToTikTok,
    getPublishStatus,
    validateRequestState
} = require("../services/tiktok");

// ======================================================
// TikTok OAuth
// ======================================================

router.get(
    "/auth/tiktok",
    (req, res) => {
        try {
            const authRequest =
                getTikTokAuthRequest();

            // Save OAuth state in cookie.
            saveStateCookie(
                res,
                authRequest.state
            );

            return res.redirect(
                authRequest.url
            );
        } catch (error) {
            console.error(
                "TikTok OAuth start failed:",
                error.message
            );

            return res.status(500).json({
                error:
                    "Failed to start TikTok OAuth.",
                detail:
                    error.message
            });
        }
    }
);

// ======================================================
// TikTok OAuth callback
// ======================================================

router.get(
    "/auth/tiktok/callback",
    async (req, res) => {
        const {
            code,
            state,
            error
        } = req.query;

        // TikTok returned an OAuth error.
        if (error) {
            return res.status(400).json({
                error:
                    "TikTok authorization failed.",

                detail:
                    error
            });
        }

        // Validate OAuth state.
        if (
            !state ||
            !validateRequestState(
                req,
                state
            )
        ) {
            return res.status(400).json({
                error:
                    "Invalid OAuth state. Please restart the TikTok login flow."
            });
        }

        if (!code) {
            return res.status(400).json({
                error:
                    "No authorization code received from TikTok."
            });
        }

        try {
            const tokenData =
                await exchangeCodeForToken(
                    code
                );

            // Save encrypted token in cookie.
            saveTokenCookie(
                res,
                tokenData
            );

            return res.json({
                message:
                    "TikTok OAuth successful.",

                state,

                open_id:
                    tokenData.open_id,

                scope:
                    tokenData.scope,

                expires_in:
                    tokenData.expires_in
            });
        } catch (error) {
            console.error(
                "TikTok token exchange failed:",
                error.response?.data ||
                error.message
            );

            return res.status(
                error.response?.status ||
                500
            ).json({
                error:
                    "Failed to exchange TikTok authorization code.",

                detail:
                    error.response?.data ||
                    error.message
            });
        }
    }
);

// ======================================================
// Creator information
// ======================================================

router.get(
    "/tiktok/creator",
    async (req, res) => {
        try {
            const creatorInfo =
                await getCreatorInfo(req);

            return res.json(
                creatorInfo
            );
        } catch (error) {
            console.error(
                "TikTok creator query failed:",
                error.response?.data ||
                error.message
            );

            return res.status(
                error.response?.status ||
                500
            ).json({
                error:
                    "Failed to fetch TikTok creator information.",

                detail:
                    error.response?.data ||
                    error.message
            });
        }
    }
);

// ======================================================
// Publish TikTok video
// ======================================================

router.post(
    "/tiktok/post",
    upload.single("video"),
    async (req, res) => {
        const {
            title,
            privacy_level,
            disable_duet,
            disable_comment,
            disable_stitch
        } = req.body;

        // Check uploaded file.
        if (!req.file) {
            return res.status(400).json({
                error:
                    "Please select a video file."
            });
        }

        try {
            /*
             * IMPORTANT:
             *
             * For your current unaudited TikTok
             * Sandbox app, SELF_ONLY is used.
             *
             * Do not try to bypass TikTok's
             * unaudited-client restriction.
             */

            const response =
                await uploadVideoToTikTok(
                    req.file,
                    {
                        title,

                        privacyLevel:
                            privacy_level ||
                            "SELF_ONLY",

                        disableDuet:
                            disable_duet ===
                            "true",

                        disableComment:
                            disable_comment ===
                            "true",

                        disableStitch:
                            disable_stitch ===
                            "true"
                    },
                    req
                );

            return res.json({
                success: true,

                message:
                    "Video uploaded to TikTok successfully.",

                publish_id:
                    response.publishId,

                video_size:
                    response.videoSize,

                total_chunks:
                    response.totalChunkCount,

                uploaded_bytes:
                    response.uploadedBytes,

                status:
                    response.status
            });
        } catch (error) {
            const tiktokError =
                error.response?.data?.error;

            // ==================================================
            // TikTok unaudited client restriction
            // ==================================================

            if (
                tiktokError?.code ===
                "unaudited_client_can_only_post_to_private_accounts"
            ) {
                return res.status(403).json({
                    success: false,

                    error:
                        "TikTok Sandbox requires a private creator account for this unaudited app.",

                    detail:
                        "Keep the authorized TikTok account private and use SELF_ONLY until the app is approved for the required publishing capability.",

                    tiktok_code:
                        tiktokError.code,

                    log_id:
                        tiktokError.log_id
                });
            }

            // ==================================================
            // Invalid parameters
            // ==================================================

            if (
                tiktokError?.code ===
                "invalid_params"
            ) {
                return res.status(
                    error.response?.status ||
                    400
                ).json({
                    success: false,

                    error:
                        "TikTok rejected the publishing parameters.",

                    detail:
                        error.response?.data ||
                        error.message
                });
            }

            console.error(
                "TikTok video publish failed:",
                error.response?.data ||
                error.message
            );

            return res.status(
                error.response?.status ||
                500
            ).json({
                success: false,

                error:
                    "Failed to initialize TikTok video publishing.",

                detail:
                    error.response?.data ||
                    error.message
            });
        }
    }
);

// ======================================================
// Publish status
// ======================================================

router.get(
    "/tiktok/status/:publishId",
    async (req, res) => {
        const {
            publishId
        } = req.params;

        if (!publishId) {
            return res.status(400).json({
                error:
                    "publishId is required."
            });
        }

        try {
            const statusResponse =
                await getPublishStatus(
                    publishId,
                    req
                );

            return res.json(
                statusResponse
            );
        } catch (error) {
            console.error(
                "TikTok publish status failed:",
                error.response?.data ||
                error.message
            );

            return res.status(
                error.response?.status ||
                500
            ).json({
                error:
                    "Failed to fetch TikTok publish status.",

                detail:
                    error.response?.data ||
                    error.message
            });
        }
    }
);

// ======================================================
// Multer / upload errors
// ======================================================

router.use(
    (error, req, res, next) => {
        if (
            error instanceof
            multer.MulterError
        ) {
            return res.status(400).json({
                success: false,

                error:
                    `Upload failed: ${error.message}`
            });
        }

        if (error) {
            return res.status(400).json({
                success: false,

                error:
                    error.message
            });
        }

        return next();
    }
);

module.exports = router;