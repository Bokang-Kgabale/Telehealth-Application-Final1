const express = require('express');
const fetch = require('node-fetch');
const app = express();

// Serve static files
app.use(express.static('public'));

// Endpoint to provide Firebase config (NOT RECOMMENDED for production)
// Better to use Firebase Admin SDK as shown in previous example
app.get('/firebase-config', (req, res) => {
  const firebaseConfig = {
    aapiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    measurementId: process.env.FIREBASE_MEASUREMENT_ID
  };
  res.json(firebaseConfig);
});

const METERED_API_KEY = process.env.METERED_API_KEY;
// Endpoint to get TURN credentials
app.get("/api/turn-credentials", async (req, res) => {
  try {
    const response = await fetch(`https://video-call-turn-server.metered.live/api/v1/turn/credentials?apiKey=${METERED_API_KEY}`);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("Error fetching TURN credentials:", err);
    res.status(500).json({ error: "Failed to fetch TURN credentials" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));