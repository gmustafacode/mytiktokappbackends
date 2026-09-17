require("dotenv").config();

const express = require("express");
const path = require("path");

const tiktokRouter =
    require("./routes/tiktok");

const app = express();

const PORT =
    process.env.PORT || 3000;

// ======================================================
// Environment validation
// ======================================================

const requiredEnv = [
    "TIKTOK_CLIENT_KEY",
    "TIKTOK_CLIENT_SECRET",
    "TIKTOK_REDIRECT_URI",
    "SESSION_SECRET"
];

const missingEnv =
    requiredEnv.filter(
        (key) => !process.env[key]
    );

if (missingEnv.length > 0) {
    console.error(
        `Missing required env vars: ${missingEnv.join(", ")}`
    );
}

// ======================================================
// Middleware
// ======================================================

app.use(
    express.json({
        limit: "50mb"
    })
);

app.use(
    express.urlencoded({
        extended: true
    })
);

// ======================================================
// Static files
// ======================================================

app.use(
    express.static(
        path.join(
            __dirname,
            "../public"
        )
    )
);

// ======================================================
// TikTok routes
// ======================================================

app.use(
    "/",
    tiktokRouter
);

// ======================================================
// Home
// ======================================================

app.get(
    "/",
    (req, res) => {
        res.sendFile(
            path.join(
                __dirname,
                "../public/index.html"
            )
        );
    }
);

// ======================================================
// Terms
// ======================================================

app.get(
    "/terms",
    (req, res) => {
        res.sendFile(
            path.join(
                __dirname,
                "../public/terms.html"
            )
        );
    }
);

// ======================================================
// Privacy
// ======================================================

app.get(
    "/privacy",
    (req, res) => {
        res.sendFile(
            path.join(
                __dirname,
                "../public/privacy.html"
            )
        );
    }
);

app.get(
    "/facebook/privacy",
    (req, res) => {
        res.sendFile(
            path.join(
                __dirname,
                "../public/facebook/privacy.html"
            )
        );
    }
);

// ======================================================
// Health
// ======================================================

app.get(
    "/health",
    (req, res) => {
        res.json({
            status: "ok",

            message:
                "TikTok API server is healthy."
        });
    }
);

// ======================================================
// Local server
// ======================================================

if (require.main === module) {

    app.listen(
        PORT,
        () => {

            console.log(
                `TikTok API server running on http://localhost:${PORT}`
            );

            console.log(
                `Terms: ${process.env.TIKTOK_BASE_URL || "https://mytiktokappbackends.vercel.app"}/terms`
            );

            console.log(
                `Privacy: ${process.env.TIKTOK_BASE_URL || "https://mytiktokappbackends.vercel.app"}/privacy`
            );
        }
    );
}

module.exports = app;