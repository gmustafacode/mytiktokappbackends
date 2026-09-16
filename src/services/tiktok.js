const axios = require("axios");

const {
    randomUUID,
    randomBytes,
    createCipheriv,
    createDecipheriv,
    createHash
} = require("crypto");

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

const TOKEN_COOKIE = "tiktok_session";
const STATE_COOKIE = "tiktok_oauth_state";

/*
|--------------------------------------------------------------------------
| Testing configuration
|--------------------------------------------------------------------------
|
| Unaudited TikTok applications can be restricted to private accounts.
|
| Keep SELF_ONLY while testing.
|
| After TikTok approves the required product/scopes,
| this can be changed according to the approved configuration.
|
*/

const DEFAULT_PRIVACY_LEVEL =
    process.env.TIKTOK_PRIVACY_LEVEL || "SELF_ONLY";

/*
|--------------------------------------------------------------------------
| Encryption key
|--------------------------------------------------------------------------
*/

function getEncryptionKey() {
    if (!process.env.SESSION_SECRET) {
        throw new Error(
            "SESSION_SECRET is missing."
        );
    }

    return createHash("sha256")
        .update(process.env.SESSION_SECRET)
        .digest();
}

/*
|--------------------------------------------------------------------------
| Encrypt
|--------------------------------------------------------------------------
*/

function encrypt(data) {
    const key = getEncryptionKey();

    const iv = randomBytes(12);

    const cipher = createCipheriv(
        "aes-256-gcm",
        key,
        iv
    );

    const encrypted = Buffer.concat([
        cipher.update(
            JSON.stringify(data),
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

/*
|--------------------------------------------------------------------------
| Decrypt
|--------------------------------------------------------------------------
*/

function decrypt(value) {
    try {
        if (!value) {
            return null;
        }

        const [
            ivText,
            authTagText,
            encryptedText
        ] = value.split(".");

        if (
            !ivText ||
            !authTagText ||
            !encryptedText
        ) {
            return null;
        }

        const key = getEncryptionKey();

        const decipher = createDecipheriv(
            "aes-256-gcm",
            key,
            Buffer.from(
                ivText,
                "base64url"
            )
        );

        decipher.setAuthTag(
            Buffer.from(
                authTagText,
                "base64url"
            )
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

/*
|--------------------------------------------------------------------------
| Cookie parser
|--------------------------------------------------------------------------
*/

function parseCookies(req) {
    const cookieHeader =
        req.headers.cookie || "";

    if (!cookieHeader) {
        return {};
    }

    const cookies = {};

    for (const part of cookieHeader.split(";")) {
        const index = part.indexOf("=");

        if (index === -1) {
            continue;
        }

        const name =
            part
                .slice(0, index)
                .trim();

        const value =
            part
                .slice(index + 1)
                .trim();

        try {
            cookies[name] =
                decodeURIComponent(value);
        } catch {
            cookies[name] = value;
        }
    }

    return cookies;
}

/*
|--------------------------------------------------------------------------
| Set cookie
|--------------------------------------------------------------------------
*/

function setCookie(
    res,
    name,
    value,
    maxAge
) {
    const secure =
        process.env.NODE_ENV === "production"
            ? "; Secure"
            : "";

    const cookie =
        `${name}=${encodeURIComponent(value)}` +
        `; Max-Age=${maxAge}` +
        `; Path=/` +
        `; HttpOnly` +
        `; SameSite=Lax` +
        secure;

    const existing =
        res.getHeader("Set-Cookie");

    if (existing) {
        res.setHeader(
            "Set-Cookie",
            Array.isArray(existing)
                ? [...existing, cookie]
                : [existing, cookie]
        );
    } else {
        res.setHeader(
            "Set-Cookie",
            cookie
        );
    }
}

/*
|--------------------------------------------------------------------------
| Clear cookie
|--------------------------------------------------------------------------
*/

function clearCookie(res, name) {
    setCookie(
        res,
        name,
        "",
        0
    );
}

/*
|--------------------------------------------------------------------------
| Save OAuth state
|--------------------------------------------------------------------------
*/

function saveStateCookie(
    res,
    state
) {
    setCookie(
        res,
        STATE_COOKIE,
        encrypt({
            state,
            createdAt: Date.now()
        }),
        10 * 60
    );
}

/*
|--------------------------------------------------------------------------
| Save TikTok session
|--------------------------------------------------------------------------
*/

function saveTokenCookie(
    res,
    token
) {
    const expiresAt =
        token.expires_in
            ? Date.now() +
              Number(token.expires_in) * 1000
            : null;

    const session = {
        accessToken:
            token.access_token,

        refreshToken:
            token.refresh_token || null,

        expiresAt,

        openId:
            token.open_id || null,

        scope:
            token.scope || null
    };

    setCookie(
        res,
        TOKEN_COOKIE,
        encrypt(session),
        30 * 24 * 60 * 60
    );
}

/*
|--------------------------------------------------------------------------
| Read TikTok session
|--------------------------------------------------------------------------
*/

function getSession(req) {
    const cookies =
        parseCookies(req);

    if (!cookies[TOKEN_COOKIE]) {
        return null;
    }

    return decrypt(
        cookies[TOKEN_COOKIE]
    );
}

/*
|--------------------------------------------------------------------------
| Access token
|--------------------------------------------------------------------------
*/

function getStoredToken(req) {
    const session =
        getSession(req);

    return (
        session?.accessToken ||
        null
    );
}

/*
|--------------------------------------------------------------------------
| OAuth state validation
|--------------------------------------------------------------------------
*/

function validateRequestState(
    req,
    state
) {
    if (!state) {
        return false;
    }

    const cookies =
        parseCookies(req);

    const saved =
        cookies[STATE_COOKIE]
            ? decrypt(
                cookies[STATE_COOKIE]
            )
            : null;

    if (!saved?.state) {
        return false;
    }

    const valid =
        saved.state === state;

    return valid;
}

/*
|--------------------------------------------------------------------------
| Authorization URL
|--------------------------------------------------------------------------
*/

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
        randomUUID();

    const params =
        new URLSearchParams({
            client_key: clientKey,
            response_type: "code",

            scope:
                "user.info.basic,video.publish,video.upload",

            redirect_uri:
                redirectUri,

            state
        });

    return {
        state,

        url:
            `${TIKTOK_AUTHORIZE_URL}?${params.toString()}`
    };
}

/*
|--------------------------------------------------------------------------
| Exchange code
|--------------------------------------------------------------------------
*/

async function exchangeCodeForToken(
    code
) {
    if (!code) {
        throw new Error(
            "Authorization code is missing."
        );
    }

    const clientKey =
        process.env.TIKTOK_CLIENT_KEY;

    const clientSecret =
        process.env.TIKTOK_CLIENT_SECRET;

    const redirectUri =
        process.env.TIKTOK_REDIRECT_URI;

    if (!clientKey) {
        throw new Error(
            "TIKTOK_CLIENT_KEY is missing."
        );
    }

    if (!clientSecret) {
        throw new Error(
            "TIKTOK_CLIENT_SECRET is missing."
        );
    }

    if (!redirectUri) {
        throw new Error(
            "TIKTOK_REDIRECT_URI is missing."
        );
    }

    const params =
        new URLSearchParams();

    params.append(
        "client_key",
        clientKey
    );

    params.append(
        "client_secret",
        clientSecret
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
        redirectUri
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

                timeout: 15000
            }
        );

    const data =
        response.data;

    if (data?.error) {
        const error =
            new Error(
                data.error_description ||
                data.error ||
                "TikTok token exchange failed."
            );

        error.response = {
            data,
            status:
                response.status
        };

        throw error;
    }

    if (!data?.access_token) {
        throw new Error(
            "TikTok did not return an access token."
        );
    }

    return data;
}

/*
|--------------------------------------------------------------------------
| Creator information
|--------------------------------------------------------------------------
*/

async function getCreatorInfo(req) {
    const accessToken =
        getStoredToken(req);

    if (!accessToken) {
        throw new Error(
            "TikTok is not connected."
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
                        "application/json"
                },

                timeout: 15000
            }
        );

    return response.data;
}

/*
|--------------------------------------------------------------------------
| Initialize FILE_UPLOAD Direct Post
|--------------------------------------------------------------------------
*/

async function initializeFileUpload(
    req,
    {
        title,
        privacyLevel,
        disableDuet,
        disableComment,
        disableStitch
    }
) {
    const accessToken =
        getStoredToken(req);

    if (!accessToken) {
        throw new Error(
            "TikTok is not connected."
        );
    }

    const payload = {
        post_info: {
            title:
                title ||
                "Posted from CortexAI",

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
            source:
                "FILE_UPLOAD"
        }
    };

    return axios.post(
        TIKTOK_VIDEO_INIT_URL,
        payload,
        {
            headers: {
                Authorization:
                    `Bearer ${accessToken}`,

                "Content-Type":
                    "application/json"
            },

            timeout: 30000
        }
    );
}

/*
|--------------------------------------------------------------------------
| Upload video
|--------------------------------------------------------------------------
*/

async function uploadVideoToTikTok(
    file,
    options,
    req
) {
    if (!file?.buffer?.length) {
        throw new Error(
            "Video file is required."
        );
    }

    const videoSize =
        file.buffer.length;

    const MAX_CHUNK_SIZE =
        64 * 1024 * 1024;

    let chunkSize;

    if (
        videoSize <= MAX_CHUNK_SIZE
    ) {
        chunkSize =
            videoSize;
    } else {
        chunkSize =
            10 * 1024 * 1024;
    }

    const totalChunkCount =
        Math.ceil(
            videoSize /
            chunkSize
        );

    const initResponse =
        await initializeFileUpload(
            req,
            {
                title:
                    options.title,

                privacyLevel:
                    options.privacyLevel,

                disableDuet:
                    options.disableDuet,

                disableComment:
                    options.disableComment,

                disableStitch:
                    options.disableStitch
            }
        );

    const initData =
        initResponse.data;

    if (
        initData?.error?.code &&
        initData.error.code !== "ok"
    ) {
        const error =
            new Error(
                initData.error.message ||
                "TikTok initialization failed."
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

    return {
        publishId,
        videoSize,
        totalChunkCount,
        uploadedBytes,

        status:
            "PROCESSING"
    };
}

/*
|--------------------------------------------------------------------------
| Publish status
|--------------------------------------------------------------------------
*/

async function getPublishStatus(
    publishId,
    req
) {
    if (!publishId) {
        throw new Error(
            "publish_id is required."
        );
    }

    const accessToken =
        getStoredToken(req);

    if (!accessToken) {
        throw new Error(
            "TikTok is not connected."
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
                        "application/json"
                },

                timeout: 15000
            }
        );

    return response.data;
}

/*
|--------------------------------------------------------------------------
| Logout / disconnect
|--------------------------------------------------------------------------
*/

function logout(res) {
    clearCookie(
        res,
        TOKEN_COOKIE
    );

    clearCookie(
        res,
        STATE_COOKIE
    );
}

module.exports = {
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
};