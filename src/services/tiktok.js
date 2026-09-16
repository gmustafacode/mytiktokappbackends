const axios = require("axios");
const {
    randomUUID,
    createCipheriv,
    createDecipheriv,
    createHash,
    randomBytes
} = require("crypto");

// ======================================================
// TikTok API URLs
// ======================================================

const TIKTOK_AUTHORIZE_URL =
    "https://www.tiktok.com/v2/auth/authorize/";

const TIKTOK_TOKEN_URL =
    "https://open.tiktokapis.com/v2/oauth/token/";

const TIKTOK_CREATOR_INFO_URL =
    "https://open.tiktokapis.com/v2/post/publish/creator_info/query/";

const TIKTOK_VIDEO_INIT_URL =
    "https://open.tiktokapis.com/v2/post/publish/video/init/";

const TIKTOK_STATUS_URL =
    "https://open.tiktokapis.com/v2/post/publish/status/fetch/";

// ======================================================
// Default settings
// ======================================================

// IMPORTANT:
// For an unaudited TikTok app in Sandbox,
// SELF_ONLY/private-account posting is required.
const DEFAULT_PRIVACY_LEVEL = "SELF_ONLY";

// TikTok recommends keeping individual chunks
// within the allowed upload size.
const MAX_CHUNK_SIZE = 64 * 1024 * 1024;

// ======================================================
// Temporary in-memory token store
// ======================================================

// This is okay for your current prototype/testing.
// DO NOT use this as the final SaaS architecture.
const tokenStore = {
    accessToken: null,
    refreshToken: null,
    expiresAt: null,
    openId: null,
    scope: null
};

// ======================================================
// OAuth state
// ======================================================

const stateStore = new Set();

const tokenCookieName = "tiktok_session";
const stateCookieName = "tiktok_oauth_state";

// ======================================================
// Encryption
// ======================================================

function getSessionKey() {
    if (!process.env.SESSION_SECRET) {
        throw new Error("SESSION_SECRET is missing in environment variables.");
    }

    return createHash("sha256")
        .update(process.env.SESSION_SECRET)
        .digest();
}

function encrypt(value) {
    const iv = randomBytes(12);

    const cipher = createCipheriv(
        "aes-256-gcm",
        getSessionKey(),
        iv
    );

    const encrypted = Buffer.concat([
        cipher.update(
            JSON.stringify(value),
            "utf8"
        ),
        cipher.final()
    ]);

    const authTag = cipher.getAuthTag();

    return [
        iv.toString("base64url"),
        authTag.toString("base64url"),
        encrypted.toString("base64url")
    ].join(".");
}

function decrypt(value) {
    try {
        const parts = value.split(".");

        if (parts.length !== 3) {
            return null;
        }

        const [ivText, tagText, encryptedText] = parts;

        const decipher = createDecipheriv(
            "aes-256-gcm",
            getSessionKey(),
            Buffer.from(ivText, "base64url")
        );

        decipher.setAuthTag(
            Buffer.from(tagText, "base64url")
        );

        const decrypted = Buffer.concat([
            decipher.update(
                Buffer.from(
                    encryptedText,
                    "base64url"
                )
            ),
            decipher.final()
        ]);

        return JSON.parse(
            decrypted.toString("utf8")
        );
    } catch {
        return null;
    }
}

// ======================================================
// Cookie helpers
// ======================================================

function parseCookies(req) {
    const cookieHeader = req.headers.cookie || "";

    if (!cookieHeader) {
        return {};
    }

    const cookies = {};

    for (const part of cookieHeader.split(";")) {
        const index = part.indexOf("=");

        if (index === -1) {
            continue;
        }

        const name = part
            .slice(0, index)
            .trim();

        const value = part
            .slice(index + 1)
            .trim();

        cookies[name] = decodeURIComponent(value);
    }

    return cookies;
}

function appendCookie(
    res,
    name,
    value,
    maxAge
) {
    const cookie =
        `${name}=${encodeURIComponent(value)}; ` +
        `Max-Age=${maxAge}; ` +
        `Path=/; ` +
        `HttpOnly; ` +
        `SameSite=Lax` +
        (
            process.env.NODE_ENV === "production"
                ? "; Secure"
                : ""
        );

    const existing =
        res.getHeader("Set-Cookie");

    if (existing) {
        res.setHeader(
            "Set-Cookie",
            [].concat(existing, cookie)
        );
    } else {
        res.setHeader(
            "Set-Cookie",
            cookie
        );
    }
}

// ======================================================
// Token cookie
// ======================================================

function saveTokenCookie(
    res,
    payload
) {
    const session = {
        accessToken:
            payload.access_token,

        refreshToken:
            payload.refresh_token || null,

        expiresAt:
            payload.expires_in
                ? Date.now() +
                Number(payload.expires_in) *
                1000
                : null,

        openId:
            payload.open_id || null,

        scope:
            payload.scope || null
    };

    appendCookie(
        res,
        tokenCookieName,
        encrypt(session),
        30 * 24 * 60 * 60
    );

    // Also keep it in memory for prototype testing.
    setTokenData(payload);
}

// ======================================================
// OAuth state cookie
// ======================================================

function saveStateCookie(
    res,
    state
) {
    appendCookie(
        res,
        stateCookieName,
        encrypt({ state }),
        10 * 60
    );
}

function getTokenFromRequest(req) {
    const cookies = parseCookies(req);

    const session =
        cookies[tokenCookieName]
            ? decrypt(
                cookies[tokenCookieName]
            )
            : null;

    return (
        session?.accessToken ||
        tokenStore.accessToken ||
        null
    );
}

function getStateFromRequest(req) {
    const cookies = parseCookies(req);

    const saved =
        cookies[stateCookieName]
            ? decrypt(
                cookies[stateCookieName]
            )
            : null;

    return saved?.state || null;
}

// ======================================================
// Token store
// ======================================================

function setTokenData(payload = {}) {
    if (!payload.access_token) {
        return;
    }

    tokenStore.accessToken =
        payload.access_token;

    tokenStore.refreshToken =
        payload.refresh_token || null;

    tokenStore.expiresAt =
        payload.expires_in
            ? Date.now() +
            Number(payload.expires_in) *
            1000
            : null;

    tokenStore.openId =
        payload.open_id || null;

    tokenStore.scope =
        payload.scope || null;
}

function getStoredToken(req) {
    if (req) {
        return getTokenFromRequest(req);
    }

    return tokenStore.accessToken;
}

function getTokenData(req) {
    if (req) {
        const cookies = parseCookies(req);

        const session =
            cookies[tokenCookieName]
                ? decrypt(
                    cookies[tokenCookieName]
                )
                : null;

        if (session) {
            return session;
        }
    }

    return {
        accessToken:
            tokenStore.accessToken,

        refreshToken:
            tokenStore.refreshToken,

        expiresAt:
            tokenStore.expiresAt,

        openId:
            tokenStore.openId,

        scope:
            tokenStore.scope
    };
}

function isAuthenticated(req) {
    return Boolean(
        getStoredToken(req)
    );
}

// ======================================================
// OAuth State
// ======================================================

function createAndStoreState() {
    const state = randomUUID();

    stateStore.add(state);

    return state;
}

function validateState(state) {
    const isValid =
        typeof state === "string" &&
        stateStore.has(state);

    if (isValid) {
        stateStore.delete(state);
    }

    return isValid;
}

function validateRequestState(
    req,
    state
) {
    return (
        validateState(state) ||
        getStateFromRequest(req) === state
    );
}

// ======================================================
// TikTok OAuth URL
// ======================================================

function getTikTokAuthRequest() {
    const clientKey =
        process.env.TIKTOK_CLIENT_KEY;

    const redirectUri =
        process.env.TIKTOK_REDIRECT_URI;

    if (!clientKey) {
        throw new Error(
            "TIKTOK_CLIENT_KEY is missing."
        );
    }

    if (!redirectUri) {
        throw new Error(
            "TIKTOK_REDIRECT_URI is missing."
        );
    }

    const state =
        createAndStoreState();

    const params =
        new URLSearchParams({
            client_key: clientKey,

            response_type: "code",

            scope:
                "user.info.basic,video.publish",

            redirect_uri:
                redirectUri,

            state
        });

    const url =
        `${TIKTOK_AUTHORIZE_URL}?${params.toString()}`;

    return {
        state,
        url
    };
}

function getTikTokAuthUrl() {
    return getTikTokAuthRequest().url;
}

// ======================================================
// Exchange authorization code for token
// ======================================================

async function exchangeCodeForToken(
    code
) {
    if (!code) {
        throw new Error(
            "TikTok authorization code is missing."
        );
    }

    const params =
        new URLSearchParams();

    params.append(
        "client_key",
        process.env.TIKTOK_CLIENT_KEY
    );

    params.append(
        "client_secret",
        process.env.TIKTOK_CLIENT_SECRET
    );

    params.append(
        "code",
        code
    );

    params.append(
        "grant_type",
        "authorization_code"
    );

    params.append(
        "redirect_uri",
        process.env.TIKTOK_REDIRECT_URI
    );

    const response =
        await axios.post(
            TIKTOK_TOKEN_URL,
            params.toString(),
            {
                headers: {
                    "Content-Type":
                        "application/x-www-form-urlencoded"
                },

                timeout: 30000
            }
        );

    setTokenData(
        response.data
    );

    return response.data;
}

// ======================================================
// Creator Information
// ======================================================

async function getCreatorInfo(req) {
    const accessToken =
        getStoredToken(req);

    if (!accessToken) {
        throw new Error(
            "No TikTok access token available. Complete OAuth first."
        );
    }

    const response =
        await axios.post(
            TIKTOK_CREATOR_INFO_URL,
            {},
            {
                headers: {
                    Authorization:
                        `Bearer ${accessToken}`,

                    "Content-Type":
                        "application/json; charset=UTF-8"
                },

                timeout: 30000
            }
        );

    return response.data;
}

// ======================================================
// Initialize TikTok File Upload
// ======================================================

async function initializeFileUpload(
    req,
    {
        title,
        privacyLevel,
        disableDuet,
        disableComment,
        disableStitch,
        videoSize,
        chunkSize,
        totalChunkCount
    }
) {
    const accessToken =
        getStoredToken(req);

    if (!accessToken) {
        throw new Error(
            "TikTok is not connected. Complete OAuth first."
        );
    }

    if (!videoSize) {
        throw new Error(
            "Video size is missing."
        );
    }

    if (!chunkSize) {
        throw new Error(
            "Chunk size is missing."
        );
    }

    if (!totalChunkCount) {
        throw new Error(
            "Total chunk count is missing."
        );
    }

    const payload = {
        post_info: {
            title:
                title ||
                "Posted from CortexAI",

            // For your current unaudited Sandbox.
            privacy_level:
                privacyLevel ||
                DEFAULT_PRIVACY_LEVEL,

            disable_duet:
                Boolean(disableDuet),

            disable_comment:
                Boolean(disableComment),

            disable_stitch:
                Boolean(disableStitch)
        },

        source_info: {
            source: "FILE_UPLOAD",

            video_size:
                videoSize,

            chunk_size:
                chunkSize,

            total_chunk_count:
                totalChunkCount
        }
    };

    console.log(
        "TikTok publish initialization:",
        JSON.stringify(
            payload,
            null,
            2
        )
    );

    return axios.post(
        TIKTOK_VIDEO_INIT_URL,
        payload,
        {
            headers: {
                Authorization:
                    `Bearer ${accessToken}`,

                "Content-Type":
                    "application/json; charset=UTF-8"
            },

            timeout: 30000
        }
    );
}

// ======================================================
// Upload Video
// ======================================================

async function uploadVideoToTikTok(
    file,
    postOptions = {},
    req
) {
    const accessToken =
        getStoredToken(req);

    if (!accessToken) {
        throw new Error(
            "No TikTok access token available. Complete OAuth first."
        );
    }

    if (!file?.buffer?.length) {
        throw new Error(
            "A video file is required."
        );
    }

    const videoSize =
        file.buffer.length;

    // TikTok allows chunks up to 64 MB.
    // For bigger videos we use 10 MB chunks.
    const chunkSize =
        videoSize <= MAX_CHUNK_SIZE
            ? videoSize
            : 10 * 1024 * 1024;

    const totalChunkCount =
        Math.ceil(
            videoSize / chunkSize
        );

    console.log(
        "TikTok upload information:",
        {
            videoSize,
            chunkSize,
            totalChunkCount,
            mimeType: file.mimetype
        }
    );

    // ==================================================
    // Step 1: Initialize upload
    // ==================================================

    const initResponse =
        await initializeFileUpload(
            req,
            {
                title:
                    postOptions.title,

                // IMPORTANT:
                // For current unaudited sandbox,
                // SELF_ONLY is required.
                privacyLevel:
                    postOptions.privacyLevel ||
                    DEFAULT_PRIVACY_LEVEL,

                disableDuet:
                    postOptions.disableDuet,

                disableComment:
                    postOptions.disableComment,

                disableStitch:
                    postOptions.disableStitch,

                // REQUIRED by TikTok
                videoSize,

                chunkSize,

                totalChunkCount
            }
        );

    const initData =
        initResponse.data;

    console.log(
        "TikTok init response:",
        JSON.stringify(
            initData,
            null,
            2
        )
    );

    if (
        initData?.error?.code &&
        initData.error.code !== "ok"
    ) {
        const error =
            new Error(
                initData.error.message ||
                "TikTok upload initialization failed."
            );

        error.response = {
            data: initData,
            status:
                initResponse.status ||
                400
        };

        throw error;
    }

    const publishId =
        initData?.data?.publish_id;

    const uploadUrl =
        initData?.data?.upload_url;

    if (!publishId) {
        throw new Error(
            "TikTok did not return publish_id."
        );
    }

    if (!uploadUrl) {
        throw new Error(
            "TikTok did not return upload_url."
        );
    }

    // ==================================================
    // Step 2: Upload video chunks
    // ==================================================

    let uploadedBytes = 0;

    for (
        let start = 0;
        start < videoSize;
        start += chunkSize
    ) {
        const end =
            Math.min(
                start + chunkSize,
                videoSize
            );

        const chunk =
            file.buffer.subarray(
                start,
                end
            );

        console.log(
            `Uploading chunk: ${start}-${end - 1}/${videoSize}`
        );

        await axios.put(
            uploadUrl,
            chunk,
            {
                headers: {
                    "Content-Type":
                        file.mimetype ||
                        "video/mp4",

                    "Content-Length":
                        chunk.length,

                    "Content-Range":
                        `bytes ${start}-${end - 1}/${videoSize}`
                },

                maxBodyLength:
                    Infinity,

                maxContentLength:
                    Infinity,

                timeout:
                    120000
            }
        );

        uploadedBytes +=
            chunk.length;
    }

    // ==================================================
    // Step 3: Return publish information
    // ==================================================

    return {
        publishId,

        videoSize,

        totalChunkCount,

        uploadedBytes,

        status: "PROCESSING"
    };
}

// ======================================================
// Publish Status
// ======================================================

async function getPublishStatus(
    publishId,
    req
) {
    const accessToken =
        getStoredToken(req);

    if (!accessToken) {
        throw new Error(
            "No TikTok access token available."
        );
    }

    if (!publishId) {
        throw new Error(
            "publishId is required."
        );
    }

    const response =
        await axios.post(
            TIKTOK_STATUS_URL,
            {
                publish_id:
                    publishId
            },
            {
                headers: {
                    Authorization:
                        `Bearer ${accessToken}`,

                    "Content-Type":
                        "application/json; charset=UTF-8"
                },

                timeout: 30000
            }
        );

    return response.data;
}

// ======================================================
// Legacy / direct init helper
// ======================================================

async function initVideoPublish(
    req,
    options = {}
) {
    if (!options.videoSize) {
        throw new Error(
            "videoSize is required."
        );
    }

    const chunkSize =
        options.chunkSize ||
        (
            options.videoSize <=
                MAX_CHUNK_SIZE
                ? options.videoSize
                : 10 * 1024 * 1024
        );

    const totalChunkCount =
        options.totalChunkCount ||
        Math.ceil(
            options.videoSize /
            chunkSize
        );

    const response =
        await initializeFileUpload(
            req,
            {
                title:
                    options.title,

                privacyLevel:
                    options.privacyLevel ||
                    DEFAULT_PRIVACY_LEVEL,

                disableDuet:
                    options.disableDuet,

                disableComment:
                    options.disableComment,

                disableStitch:
                    options.disableStitch,

                videoSize:
                    options.videoSize,

                chunkSize,

                totalChunkCount
            }
        );

    return response.data;
}

// ======================================================
// Exports
// ======================================================

module.exports = {
    getTikTokAuthUrl,

    getTikTokAuthRequest,

    exchangeCodeForToken,

    saveTokenCookie,

    saveStateCookie,

    validateRequestState,

    getCreatorInfo,

    initVideoPublish,

    uploadVideoToTikTok,

    getPublishStatus,

    getStoredToken,

    getTokenData,

    isAuthenticated,

    validateState
};