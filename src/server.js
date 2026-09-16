require('dotenv').config();

const express = require('express');
const path = require('path');
const tiktokRouter = require('./routes/tiktok');

const app = express();
const PORT = process.env.PORT || 3000;

const requiredEnv = ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REDIRECT_URI', 'SESSION_SECRET'];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);

if (missingEnv.length > 0) {
    console.error(`Missing required env vars: ${missingEnv.join(', ')}`);
    console.error('Set these variables in the local .env or Vercel Project Settings.');
}

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

app.use('/', tiktokRouter);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/terms', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/terms.html'));
});

app.get('/privacy', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/privacy.html'));
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'TikTok API server is healthy.' });
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`TikTok API server running on http://localhost:${PORT}`);
        console.log(`Terms: https://mytiktokappbackends.vercel.app/terms`);
        console.log(`Privacy: https://mytiktokappbackends.vercel.app/privacy`);
    });
}

module.exports = app;