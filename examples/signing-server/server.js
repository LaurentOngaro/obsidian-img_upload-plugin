// Minimal Express server example to generate Cloudinary upload signatures
// Usage:
//   CLOUDINARY_API_SECRET=your_secret node server.js
// Expose only to trusted clients and use HTTPS in production.

const express = require('express');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
app.use(express.json());
// Allow cross-origin requests in dev; lock this down in production
app.use(cors());

app.post('/sign', (req, res) => {
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'Server not configured with CLOUDINARY_API_SECRET' });
  }

  // Minimal signing example: sign timestamp only.
  // Adjust to include other params (folder, public_id...) if your client needs them.
  const timestamp = Math.floor(Date.now() / 1000);
  const toSign = `timestamp=${timestamp}${secret}`;
  const signature = crypto.createHash('sha1').update(toSign).digest('hex');

  return res.json({ timestamp, signature });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Signing server listening on port ${port}`);
});
