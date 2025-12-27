/*
Example Express server to create an unsigned Cloudinary upload preset.

Usage:
  1. Set environment variables: CLOUD_NAME, API_KEY, API_SECRET
     e.g. export CLOUD_NAME=your_cloud; export API_KEY=abc; export API_SECRET=xyz
  2. Run: node src/server/create-preset-example.js
  3. POST to /create-preset (JSON body optional: { name: "obsidian_auto_unsigned" })

Note: This script demonstrates a small server-side approach to avoid doing preset creation from the renderer (which may be blocked by CORS).
*/

const express = require('express');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());

const CLOUD_NAME = process.env.CLOUD_NAME;
const API_KEY = process.env.API_KEY;
const API_SECRET = process.env.API_SECRET;

if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
  console.warn('Warning: CLOUD_NAME, API_KEY and API_SECRET env vars should be set to use this example server.');
}

app.post('/create-preset', async (req, res) => {
  const name = (req.body && req.body.name) || 'obsidian_auto_unsigned';
  if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
    return res.status(400).json({ error: 'Missing CLOUD_NAME/API_KEY/API_SECRET env vars' });
  }

  const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/upload_presets`;
  const body = JSON.stringify({ name, unsigned: true });
  const auth = Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64');

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body,
    });

    const text = await r.text();
    if (!r.ok) return res.status(r.status).send(text);

    // Try to parse JSON and return it. Cloudinary responds with JSON describing the preset.
    try {
      const json = JSON.parse(text);
      return res.status(200).json(json);
    } catch (parseErr) {
      // If response isn't valid JSON, return it as text with a message
      return res.status(200).json({ result: text });
    }
  } catch (e) {
    console.error('Failed to create preset', e);
    return res.status(500).json({ error: 'Failed to create preset', message: String(e) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Preset creation server listening on http://localhost:${port}`));
