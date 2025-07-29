const express = require('express');
const path = require('path');
const app = express();

// Serve Landing Page
app.use('/', express.static(path.join(__dirname, 'landing-page')));

// Serve Doctor App
app.use('/doctor', express.static(path.join(__dirname, 'doctor', 'frontend2')));

// Serve Patient App
app.use('/patient', express.static(path.join(__dirname, 'patient', 'frontend1')));

// Catch-all for unmatched routes
app.use('*', (req, res) => {
  res.status(404).send('Page not found');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
