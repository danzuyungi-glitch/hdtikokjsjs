const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { patch } = require('./patcher.cjs');

/* ============================================================
 *  WORKER THREAD — patch dijalankan di thread terpisah supaya
 *  server tetap bisa menjawab polling progress selama proses.
 * ============================================================ */
if (!isMainThread) {
  try {
    parentPort.postMessage({ type: 'progress', stage: 'reading', progress: 10 });
    const input = new Uint8Array(fs.readFileSync(workerData.input));

    parentPort.postMessage({ type: 'progress', stage: 'patching', progress: 25 });
    const { bytes, report } = patch(input);

    parentPort.postMessage({ type: 'progress', stage: 'writing', progress: 85 });
    fs.writeFileSync(workerData.output, bytes);

    parentPort.postMessage({ type: 'done', report: report || {}, outSize: bytes.length });
  } catch (err) {
    parentPort.postMessage({ type: 'error', error: (err && err.message) || 'Patch gagal' });
  }
  return;
}

/* ============================================================
 *  SERVER UTAMA
 * ============================================================ */
const express = require('express');
const multer = require('multer');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || '';
const TOKEN_SECRET = process.env.TOKEN_SECRET || ''; // sama dengan TIKTOK_HD_TOKEN_SECRET di Vercel
const MAX_MB = Number(process.env.MAX_MB || 200);
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';           // contoh: https://danzclean.arisu.biz.id
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT || 2); // jumlah video diproses bersamaan
const JOB_TTL_MS = Number(process.env.JOB_TTL_MIN || 15) * 60 * 1000;

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: MAX_MB * 1024 * 1024 }
});

const app = express();

/* ---------- CORS (wajib supaya bisa dipanggil dari browser) ---------- */
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, x-token');
  res.setHeader('Access-Control-Expose-Headers', 'x-patch-report, x-platform, Content-Disposition, Content-Length');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* ---------- Auth: token dari Vercel (TOKEN_SECRET) atau API key (API_KEY) ---------- */
function validToken(t) {
  if (!TOKEN_SECRET || typeof t !== 'string') return false;
  const parts = t.split('.');
  const exp = Number(parts[0]);
  if (!exp || exp * 1000 < Date.now()) return false;
  if (exp * 1000 - Date.now() > 60 * 60 * 1000) return false; // token terlalu panjang umurnya = tolak
  const good = crypto.createHmac('sha256', TOKEN_SECRET).update(String(exp)).digest('hex');
  const a = Buffer.from(parts[1] || '');
  const b = Buffer.from(good);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.use((req, res, next) => {
  if (req.method === 'GET' && (req.path === '/' || req.path === '/health')) return next(); // cek status publik
  if (!API_KEY && !TOKEN_SECRET) return next(); // tidak ada proteksi diatur
  if (API_KEY && req.headers['x-api-key'] === API_KEY) return next();
  if (validToken(req.headers['x-token'])) return next();
  res.status(401).json({ ok: false, error: 'Izin upload tidak valid / kedaluwarsa' });
});

const PLATFORMS = ['android', 'ios'];
const LEGACY_PATHS = ['/upload/android', '/upload/ios', '/upload', '/patch'];

function platformOf(p) {
  return p.endsWith('/ios') ? 'ios' : p.endsWith('/android') ? 'android' : 'generic';
}

app.get('/', (_, res) =>
  res.json({
    ok: true,
    service: 'tiktok-hd-patch',
    maxMb: MAX_MB,
    platforms: PLATFORMS,
    endpoints: [
      'POST /jobs/android | /jobs/ios (field: video) -> { id }',
      'GET /jobs/:id -> { status, stage, progress }',
      'GET /jobs/:id/download',
      'DELETE /jobs/:id',
      'POST ' + LEGACY_PATHS.join(' | ') + ' (field: video) -> langsung file hasil'
    ]
  })
);
app.get('/health', (_, res) => res.json({ ok: true, service: 'tiktok-hd-patch' }));

function outName(original) {
  const base = path.parse(original || 'video.mp4').name.replace(/_hd$/i, '') || 'video';
  return base + '_hd.mp4';
}

/* ============================================================
 *  JOB + ANTRIAN
 * ============================================================ */
const jobs = new Map();
const queue = [];
let running = 0;

const STAGE_LABEL = {
  queued: 'Menunggu antrian',
  reading: 'Membaca video',
  patching: 'Memproses HD',
  writing: 'Menyimpan hasil',
  done: 'Selesai',
  error: 'Gagal'
};

function removeFiles(job) {
  if (job.input) fs.unlink(job.input, () => {});
  if (job.output) fs.unlink(job.output, () => {});
}

function dropJob(id) {
  const job = jobs.get(id);
  if (!job) return;
  if (job.worker) { try { job.worker.terminate(); } catch (e) {} }
  removeFiles(job);
  jobs.delete(id);
}

function publicJob(job) {
  const position = job.status === 'queued' ? queue.indexOf(job.id) + 1 : 0;
  return {
    ok: true,
    id: job.id,
    status: job.status,            // queued | processing | done | error
    stage: job.stage,              // queued | reading | patching | writing | done | error
    label: STAGE_LABEL[job.stage] || job.stage,
    progress: job.progress,        // 0-100 (khusus tahap proses di server)
    position,
    platform: job.platform,
    name: job.name,
    size: job.size,
    outSize: job.outSize || 0,
    error: job.error || null
  };
}

function pump() {
  while (running < MAX_CONCURRENT && queue.length) {
    const id = queue.shift();
    const job = jobs.get(id);
    if (!job || job.status !== 'queued') continue;
    runJob(job);
  }
}

function finish(job, patchFields) {
  Object.assign(job, patchFields);
  job.finishedAt = Date.now();
  job.worker = null;
  if (job.input) { fs.unlink(job.input, () => {}); job.input = null; }
  running = Math.max(0, running - 1);
  pump();
}

function runJob(job) {
  running++;
  job.status = 'processing';
  job.stage = 'reading';
  job.progress = 5;
  job.output = job.input + '.hd.mp4';

  let settled = false;
  const worker = new Worker(__filename, { workerData: { input: job.input, output: job.output } });
  job.worker = worker;

  worker.on('message', (m) => {
    if (settled) return;
    if (m.type === 'progress') {
      job.stage = m.stage;
      job.progress = m.progress;
    } else if (m.type === 'done') {
      settled = true;
      job.report = m.report;
      job.outSize = m.outSize;
      finish(job, { status: 'done', stage: 'done', progress: 100 });
    } else if (m.type === 'error') {
      settled = true;
      if (job.output) fs.unlink(job.output, () => {});
      finish(job, { status: 'error', stage: 'error', error: m.error });
    }
  });
  worker.on('error', (err) => {
    if (settled) return;
    settled = true;
    finish(job, { status: 'error', stage: 'error', error: (err && err.message) || 'Patch gagal' });
  });
  worker.on('exit', (code) => {
    if (settled) return;
    settled = true;
    finish(job, { status: 'error', stage: 'error', error: 'Proses berhenti tak terduga (kode ' + code + ')' });
  });
}

/* ---------- Bersihkan job lama ---------- */
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    const age = now - (job.finishedAt || job.createdAt);
    if (age > JOB_TTL_MS) dropJob(id);
  }
}, 60 * 1000).unref();

/* ============================================================
 *  ENDPOINT BARU (dengan progress)
 * ============================================================ */

// 1) Upload video -> langsung dapat id, proses jalan di belakang
app.post(['/jobs', '/jobs/android', '/jobs/ios'], upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'field "video" wajib' });
  const platform = platformOf(req.path);
  if (platform === 'generic') {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ ok: false, error: 'Pilih platform: Android atau iOS' });
  }

  const id = crypto.randomBytes(8).toString('hex');
  const job = {
    id,
    status: 'queued',
    stage: 'queued',
    progress: 0,
    platform,
    name: req.file.originalname || 'video.mp4',
    size: req.file.size,
    input: req.file.path,
    output: null,
    report: null,
    outSize: 0,
    error: null,
    createdAt: Date.now(),
    finishedAt: 0,
    worker: null
  };
  jobs.set(id, job);
  queue.push(id);
  res.status(202).json({ ok: true, id });
  pump();
});

// 2) Cek progress
app.get('/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ ok: false, error: 'Job tidak ditemukan / sudah kedaluwarsa' });
  res.setHeader('Cache-Control', 'no-store');
  res.json(publicJob(job));
});

// 3) Unduh hasil
app.get('/jobs/:id/download', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ ok: false, error: 'Job tidak ditemukan / sudah kedaluwarsa' });
  if (job.status !== 'done' || !job.output) return res.status(409).json({ ok: false, error: 'Video belum selesai diproses' });

  res.setHeader('x-platform', job.platform);
  res.setHeader('x-patch-report', encodeURIComponent(JSON.stringify(job.report || {})).slice(0, 1000));
  res.download(job.output, outName(job.name), (err) => {
    if (err && !res.headersSent) res.status(500).json({ ok: false, error: 'Gagal mengirim file' });
  });
});

// 4) Batalkan / hapus
app.delete('/jobs/:id', (req, res) => {
  const i = queue.indexOf(req.params.id);
  if (i >= 0) queue.splice(i, 1);
  const job = jobs.get(req.params.id);
  if (job && job.status === 'processing') running = Math.max(0, running - 1);
  dropJob(req.params.id);
  pump();
  res.json({ ok: true });
});

/* ============================================================
 *  ENDPOINT LAMA (tetap jalan, tanpa progress)
 * ============================================================ */
app.post(LEGACY_PATHS, upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'field "video" wajib' });
  res.setHeader('x-platform', platformOf(req.path));

  const out = req.file.path + '.hd.mp4';
  const cleanup = () => {
    fs.unlink(req.file.path, () => {});
    fs.unlink(out, () => {});
  };

  try {
    const { bytes, report } = patch(new Uint8Array(fs.readFileSync(req.file.path)));
    fs.writeFileSync(out, bytes);

    res.setHeader('x-patch-report', encodeURIComponent(JSON.stringify(report || {})).slice(0, 1000));
    res.download(out, outName(req.file.originalname), cleanup);
  } catch (err) {
    cleanup();
    res.status(422).json({ ok: false, error: err.message || 'Patch gagal' });
  }
});

app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ ok: false, error: `File terlalu besar (maks ${MAX_MB} MB)` });
  }
  res.status(400).json({ ok: false, error: err.message });
});

app.listen(PORT, () => console.log('tiktok-hd-patch on :' + PORT));
