const express = require("express");
const multer = require("multer");

const router =
    express.Router();

const upload =
    multer({
        storage:
            multer.memoryStorage(),

        limits: {
            fileSize:
                500 * 1024 * 1024
        },

        fileFilter:
            (req, file, callback) => {
                if (
                    !file.mimetype.startsWith(
                        "video/"
                    )
                ) {
                    return callback(
                        new Error(
                            "Only video files are allowed."
                        )
                    );
                }

                callback(
                    null,
                    true
                );
            }
    });

const {
    getTikTokAuthRequest,
    exchangeCodeForToken,

    saveTokenCookie,
    saveStateCookie,

    validateRequestState,

    getSession,
    getStoredToken,

    getCreatorInfo,

    uploadVideoToTikTok,

    getPublishStatus,

    logout
} = require("../services/tiktok");

/*
|--------------------------------------------------------------------------
| Connect TikTok
|--------------------------------------------------------------------------
*/

router.get(
    "/auth/tiktok",
    (req, res) => {
        try {
            const auth =
                getTikTokAuthRequest();

            saveStateCookie(
                res,
                auth.state
            );

            return res.redirect(
                auth.url
            );
        } catch (error) {
            console.error(
                "TikTok auth error:",
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

/*
|--------------------------------------------------------------------------
| OAuth callback
|--------------------------------------------------------------------------
*/

router.get(
    "/auth/tiktok/callback",
    async (req, res) => {
        const {
            code,
            state,
            error,
            error_description
        } = req.query;

        if (error) {
            return res.status(400).json({
                error:
                    "TikTok authorization failed.",

                detail:
                    error_description ||
                    error
            });
        }

        if (
            !state ||
            !validateRequestState(
                req,
                state
            )
        ) {
            return res.status(400).json({
                error:
                    "Invalid OAuth state. Please restart TikTok login."
            });
        }

        if (!code) {
            return res.status(400).json({
                error:
                    "No authorization code received."
            });
        }

        try {
            const token =
                await exchangeCodeForToken(
                    code
                );

            saveTokenCookie(
                res,
                token
            );

            return res.json({
                success: true,

                message:
                    "TikTok OAuth successful.",

                open_id:
                    token.open_id ||
                    null,

                scope:
                    token.scope ||
                    null,

                expires_in:
                    token.expires_in ||
                    null
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

/*
|--------------------------------------------------------------------------
| Current connection
|--------------------------------------------------------------------------
*/

router.get(
    "/tiktok/me",
    (req, res) => {
        const session =
            getSession(req);

        if (!session?.accessToken) {
            return res.json({
                connected: false
            });
        }

        return res.json({
            connected: true,

            open_id:
                session.openId ||
                null,

            scope:
                session.scope ||
                null,

            expires_at:
                session.expiresAt ||
                null
        });
    }
);

/*
|--------------------------------------------------------------------------
| Creator info
|--------------------------------------------------------------------------
*/

router.get(
    "/tiktok/creator",
    async (req, res) => {
        try {
            const creator =
                await getCreatorInfo(
                    req
                );

            return res.json({
                success: true,
                data: creator
            });
        } catch (error) {
            console.error(
                "Creator info error:",
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

/*
|--------------------------------------------------------------------------
| Video Direct Post
|--------------------------------------------------------------------------
*/

router.post(
    "/tiktok/post",
    upload.single("video"),

    async (req, res) => {
        if (!req.file) {
            return res.status(400).json({
                error:
                    "Please select a video file."
            });
        }

        const {
            title,
            privacy_level,
            disable_duet,
            disable_comment,
            disable_stitch
        } = req.body;

        try {
            const result =
                await uploadVideoToTikTok(
                    req.file,

                    {
                        title,

                        privacyLevel:
                            privacy_level,

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
                    result.publishId,

                video_size:
                    result.videoSize,

                total_chunks:
                    result.totalChunkCount,

                uploaded_bytes:
                    result.uploadedBytes,

                status:
                    result.status
            });
        } catch (error) {
            const tiktokError =
                error.response?.data?.error;

            if (
                tiktokError?.code ===
                "unaudited_client_can_only_post_to_private_accounts"
            ) {
                return res.status(403).json({
                    success: false,

                    error:
                        "TikTok sandbox currently allows posting only to private creator accounts.",

                    detail:
                        "Set the authorized TikTok creator account to Private and authorize the account again.",

                    tiktok_code:
                        tiktokError.code,

                    log_id:
                        tiktokError.log_id ||
                        null
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

/*
|--------------------------------------------------------------------------
| Publish status
|--------------------------------------------------------------------------
*/

router.get(
    "/tiktok/status/:publishId",
    async (req, res) => {
        const {
            publishId
        } = req.params;

        try {
            const result =
                await getPublishStatus(
                    publishId,
                    req
                );

            return res.json({
                success: true,
                data: result
            });
        } catch (error) {
            console.error(
                "TikTok status error:",
                error.response?.data ||
                error.message
            );

            return res.status(
                error.response?.status ||
                500
            ).json({
                success: false,

                error:
                    "Failed to fetch TikTok publish status.",

                detail:
                    error.response?.data ||
                    error.message
            });
        }
    }
);

/*
|--------------------------------------------------------------------------
| Disconnect
|--------------------------------------------------------------------------
*/

router.post(
    "/auth/tiktok/logout",
    (req, res) => {
        logout(res);

        return res.json({
            success: true,
            message:
                "TikTok connection removed from this browser session."
        });
    }
);

/*
|--------------------------------------------------------------------------
| Multer / upload errors
|--------------------------------------------------------------------------
*/

router.use(
    (error, req, res, next) => {
        if (
            error instanceof
            multer.MulterError
        ) {
            return res.status(400).json({
                error:
                    `Upload failed: ${error.message}`
            });
        }

        if (error) {
            return res.status(400).json({
                error:
                    error.message
            });
        }

        next();
    }
);

module.exports = router;