const express = require('express');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { patch } = require('./patcher.cjs');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || '';
const MAX_MB = Number(process.env.MAX_MB || 200);

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: MAX_MB * 1024 * 1024 }
});

const app = express();

app.use((req, res, next) => {
  if (!API_KEY) return next();
  if (req.headers['x-api-key'] === API_KEY) return next();
  res.status(401).json({ ok: false, error: 'API key salah' });
});

app.get('/', (_, res) => res.json({ ok: true, service: 'tiktok-hd-patch', endpoint: 'POST /patch (field: video)' }));

app.post('/patch', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'field "video" wajib' });

  const cleanup = () => {
    fs.unlink(req.file.path, () => {});
    fs.unlink(req.file.path + '.hd.mp4', () => {});
  };

  try {
    const input = new Uint8Array(fs.readFileSync(req.file.path));
    const { bytes, report } = patch(input);
    const out = req.file.path + '.hd.mp4';
    fs.writeFileSync(out, bytes);

    const base = path.parse(req.file.originalname || 'video.mp4').name;
    res.setHeader('x-patch-report', encodeURIComponent(JSON.stringify(report || {})).slice(0, 1000));
    res.download(out, `${base}_hd.mp4`, cleanup);
  } catch (err) {
    cleanup();
    res.status(422).json({ ok: false, error: err.message || 'Patch gagal' });
  }
});

app.use((err, req, res, next) => {
  res.status(400).json({ ok: false, error: err.message });
});

app.listen(PORT, () => console.log('tiktok-hd-patch on :' + PORT));
