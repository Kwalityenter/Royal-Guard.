const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('./config.json');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

// Serve static elements out of the public folder
app.use(express.static(path.join(__dirname, 'public')));

// Secure Stats Retrieval API Endpoints
app.get('/api/stats', (req, res) => {
    try {
        if (!fs.existsSync(DB_FILE)) {
            return res.json({ serverCount: 0, totalVerified: 0, configuredGroupsCount: 0, database: {} });
        }

        const rawData = fs.readFileSync(DB_FILE, 'utf8').trim();
        const database = rawData ? JSON.parse(rawData) : {};

        let serverCount = Object.keys(database).length;
        let totalVerified = 0;
        let configuredGroupsCount = 0;

        Object.values(database).forEach(guildConfig => {
            if (guildConfig.verifiedUsers) {
                totalVerified += Object.keys(guildConfig.verifiedUsers).length;
            }
            if (guildConfig.groupId) {
                configuredGroupsCount++;
            }
        });

        res.json({
            serverCount,
            totalVerified,
            configuredGroupsCount,
            database
        });
    } catch (err) {
        console.error("Dashboard API Error:", err);
        res.status(500).json({ error: "Failed to load database status metadata parameters." });
    }
});

// FIXED: Using named wildcard *any to support modern path-to-regexp requirements
app.get('*any', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`===================================================`);
    console.log(` Web Dashboard live at: http://localhost:${PORT}`);
    console.log(`===================================================`);
});