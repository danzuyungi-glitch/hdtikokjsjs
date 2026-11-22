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

function auth(req, res, next) {
  if (!API_KEY) return next();
  if (req.headers['x-api-key'] === API_KEY) return next();
  res.status(401).json({ ok: false, error: 'API key salah' });
}

const PATCH_PATHS = ['/upload/android', '/upload/ios', '/upload', '/patch'];

app.get('/', (_, res) =>
  res.json({ ok: true, service: 'tiktok-hd-patch', routes: PATCH_PATHS.map((p) => 'POST ' + p) })
);
app.get('/health', (_, res) => res.json({ ok: true, service: 'tiktok-hd-patch' }));

app.post(PATCH_PATHS, auth, upload.single('video'), (req, res) => {
  const platform = req.path.endsWith('/ios') ? 'ios' : req.path.endsWith('/android') ? 'android' : 'generic';
  res.setHeader('x-platform', platform);

  if (!req.file) return res.status(400).json({ ok: false, error: 'field "video" wajib' });

  const out = req.file.path + '.hd.mp4';
  const cleanup = () => {
    fs.unlink(req.file.path, () => {});
    fs.unlink(out, () => {});
  };

  try {
    const { bytes, report } = patch(new Uint8Array(fs.readFileSync(req.file.path)));
    fs.writeFileSync(out, bytes);

    const base = path.parse(req.file.originalname || 'video.mp4').name.replace(/_hd$/i, '');
    res.setHeader('x-patch-report', encodeURIComponent(JSON.stringify(report || {})).slice(0, 1000));
    res.download(out, base + '_hd.mp4', cleanup);
  } catch (err) {
    cleanup();
    res.status(422).json({ ok: false, error: err.message || 'Patch gagal' });
  }
});

app.use((err, req, res, next) => {
  res.status(400).json({ ok: false, error: err.message });
});

app.listen(PORT, () => console.log('tiktok-hd-patch on :' + PORT));
