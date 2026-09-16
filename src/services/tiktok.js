const axios = require("axios");
const { randomUUID } = require("crypto");

// ============================================================
// TIKTOK TOKEN STORE
// ============================================================
// NOTE:
// Ye temporary in-memory storage hai.
// Production mein tokens database mein store karna chahiye.
// ============================================================

const tokenStore = {
    accessToken: null,
    refreshToken: null,
    expiresAt: null,
    openId: null,
    scope: null,
};

const stateStore = new Set();


// ============================================================
// SAVE TOKEN DATA
// ============================================================

function setTokenData(payload = {}) {
    if (!payload.access_token) {
        return;
    }

    tokenStore.accessToken = payload.access_token;
    tokenStore.refreshToken = payload.refresh_token || null;

    tokenStore.expiresAt = payload.expires_in
        ? Date.now() + Number(payload.expires_in) * 1000
        : null;

    tokenStore.openId = payload.open_id || null;
    tokenStore.scope = payload.scope || null;
}


// ============================================================
// GET STORED ACCESS TOKEN
// ============================================================

function getStoredToken() {
    return tokenStore.accessToken;
}


// ============================================================
// CREATE OAUTH STATE
// ============================================================

function createAndStoreState() {
    const state = randomUUID();

    stateStore.add(state);

    return state;
}


// ============================================================
// VALIDATE OAUTH STATE
// ============================================================

function validateState(state) {
    const isValid =
        typeof state === "string" &&
        stateStore.has(state);

    if (isValid) {
        // One-time use
        stateStore.delete(state);
    }

    return isValid;
}


// ============================================================
// GET TIKTOK AUTHORIZATION URL
// ============================================================

function getTikTokAuthUrl() {
    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const redirectUri = process.env.TIKTOK_REDIRECT_URI;

    if (!clientKey) {
        throw new Error("TIKTOK_CLIENT_KEY is missing in .env");
    }

    if (!redirectUri) {
        throw new Error("TIKTOK_REDIRECT_URI is missing in .env");
    }

    const state = createAndStoreState();

    const params = new URLSearchParams({
        client_key: clientKey,
        response_type: "code",
        scope: "user.info.basic,video.publish",
        redirect_uri: redirectUri,
        state: state,
    });

    const authUrl =
        `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;

    console.log("========================================");
    console.log("TikTok OAuth Authorization");
    console.log("========================================");
    console.log("Client Key:", clientKey);
    console.log("Redirect URI:", redirectUri);
    console.log("State:", state);
    console.log("Auth URL:", authUrl);
    console.log("========================================");

    return authUrl;
}


// ============================================================
// EXCHANGE AUTHORIZATION CODE FOR ACCESS TOKEN
// ============================================================

async function exchangeCodeForToken(code) {
    if (!code) {
        throw new Error("TikTok authorization code is missing");
    }

    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
    const redirectUri = process.env.TIKTOK_REDIRECT_URI;

    // --------------------------------------------------------
    // Validate ENV
    // --------------------------------------------------------

    if (!clientKey) {
        throw new Error("TIKTOK_CLIENT_KEY is missing in .env");
    }

    if (!clientSecret) {
        throw new Error("TIKTOK_CLIENT_SECRET is missing in .env");
    }

    if (!redirectUri) {
        throw new Error("TIKTOK_REDIRECT_URI is missing in .env");
    }


    // --------------------------------------------------------
    // TikTok authorization code may be URL encoded.
    // Decode it before sending it to token endpoint.
    // --------------------------------------------------------

    let decodedCode;

    try {
        decodedCode = decodeURIComponent(code);
    } catch (error) {
        decodedCode = code;
    }


    // --------------------------------------------------------
    // Build form-urlencoded request
    // --------------------------------------------------------

    const params = new URLSearchParams();

    params.append("client_key", clientKey);
    params.append("client_secret", clientSecret);
    params.append("code", decodedCode);
    params.append("grant_type", "authorization_code");
    params.append("redirect_uri", redirectUri);


    // --------------------------------------------------------
    // Debug
    // NEVER print client_secret or access token.
    // --------------------------------------------------------

    console.log("========================================");
    console.log("TikTok Token Exchange");
    console.log("========================================");
    console.log("Client Key:", clientKey);
    console.log("Code received:", Boolean(code));
    console.log("Code length:", decodedCode.length);
    console.log("Grant Type:", "authorization_code");
    console.log("Redirect URI:", redirectUri);
    console.log("========================================");


    try {
        const response = await axios.post(
            "https://open.tiktokapis.com/v2/oauth/token/",
            params.toString(),
            {
                headers: {
                    "Content-Type":
                        "application/x-www-form-urlencoded",
                },

                timeout: 15000,
            }
        );


        const payload = response.data;


        console.log("========================================");
        console.log("TikTok Token Response");
        console.log("========================================");

        console.log({
            hasAccessToken: Boolean(payload?.access_token),
            hasRefreshToken: Boolean(payload?.refresh_token),
            openId: payload?.open_id || null,
            scope: payload?.scope || null,
            expiresIn: payload?.expires_in || null,
            error: payload?.error || null,
            errorDescription:
                payload?.error_description || null,
        });

        console.log("========================================");


        // ----------------------------------------------------
        // Handle TikTok OAuth error
        // ----------------------------------------------------

        if (payload?.error) {
            throw new Error(
                payload.error_description ||
                payload.error ||
                "TikTok OAuth token exchange failed"
            );
        }


        // ----------------------------------------------------
        // Make sure access token exists
        // ----------------------------------------------------

        if (!payload?.access_token) {
            throw new Error(
                "TikTok did not return an access token"
            );
        }


        // ----------------------------------------------------
        // Save token
        // ----------------------------------------------------

        setTokenData(payload);


        return payload;

    } catch (error) {

        const tiktokError =
            error.response?.data || error.message;

        console.error("========================================");
        console.error("TikTok Token Exchange ERROR");
        console.error("========================================");
        console.error(tiktokError);
        console.error("========================================");

        throw error;
    }
}


// ============================================================
// GET CREATOR INFO
// ============================================================

async function getCreatorInfo() {
    const accessToken = getStoredToken();

    if (!accessToken) {
        throw new Error(
            "No TikTok access token available. Complete OAuth first."
        );
    }


    try {
        const response = await axios.post(
            "https://open.tiktokapis.com/v2/post/publish/creator_info/query/",
            {},
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                },
            }
        );

        return response.data;

    } catch (error) {

        console.error(
            "TikTok Creator Info Error:",
            error.response?.data || error.message
        );

        throw error;
    }
}


// ============================================================
// INITIALIZE VIDEO PUBLISH
// ============================================================

async function initVideoPublish(postPayload) {
    const accessToken = getStoredToken();

    if (!accessToken) {
        throw new Error(
            "No TikTok access token available. Complete OAuth first."
        );
    }

    if (!postPayload || typeof postPayload !== "object") {
        throw new Error(
            "TikTok video publish payload is required"
        );
    }


    try {
        const response = await axios.post(
            "https://open.tiktokapis.com/v2/post/publish/video/init/",
            postPayload,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                },
            }
        );

        return response.data;

    } catch (error) {

        console.error(
            "TikTok Video Init Error:",
            error.response?.data || error.message
        );

        throw error;
    }
}


// ============================================================
// GET VIDEO PUBLISH STATUS
// ============================================================

async function getPublishStatus(publishId) {
    const accessToken = getStoredToken();

    if (!accessToken) {
        throw new Error(
            "No TikTok access token available. Complete OAuth first."
        );
    }

    if (!publishId) {
        throw new Error(
            "TikTok publish_id is required"
        );
    }


    try {
        const response = await axios.post(
            "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
            {
                publish_id: publishId,
            },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                },
            }
        );

        return response.data;

    } catch (error) {

        console.error(
            "TikTok Publish Status Error:",
            error.response?.data || error.message
        );

        throw error;
    }
}


// ============================================================
// GET TOKEN INFORMATION
// ============================================================

function getTokenData() {
    return {
        accessToken: tokenStore.accessToken,
        refreshToken: tokenStore.refreshToken,
        expiresAt: tokenStore.expiresAt,
        openId: tokenStore.openId,
        scope: tokenStore.scope,
    };
}


// ============================================================
// CHECK WHETHER TOKEN EXISTS
// ============================================================

function isAuthenticated() {
    return Boolean(tokenStore.accessToken);
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
    getTikTokAuthUrl,
    exchangeCodeForToken,
    getCreatorInfo,
    initVideoPublish,
    getPublishStatus,
    getStoredToken,
    getTokenData,
    isAuthenticated,
    validateState,
};