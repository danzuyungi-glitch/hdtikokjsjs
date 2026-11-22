const express = require('express');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { patch } = require('./patcher.cjs');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || '';
const COOKIES = process.env.TIKTOK_COOKIES || '[]';
const USE_HOOKS = process.env.USE_HOOKS !== '0';
const UPLOAD_URL = 'https://www.tiktok.com/tiktokstudio/upload?from=upload';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 500 * 1024 * 1024 }
});

let queue = Promise.resolve();
function enqueue(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

function normalizeCookies(raw) {
  return JSON.parse(raw).map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain || '.tiktok.com',
    path: c.path || '/',
    secure: c.secure !== false,
    httpOnly: !!c.httpOnly,
    sameSite: ['Strict', 'Lax', 'None'].includes(c.sameSite) ? c.sameSite : 'Lax',
    ...(c.expirationDate ? { expires: Math.floor(c.expirationDate) } : {})
  }));
}

async function postToTikTok(filePath, caption) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled']
  });
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1280, height: 900 },
    locale: 'en-US'
  });
  await context.addCookies(normalizeCookies(COOKIES));
  if (USE_HOOKS) await context.addInitScript({ path: path.join(__dirname, 'soundsafe-hook.js') });

  const page = await context.newPage();
  try {
    await page.goto(UPLOAD_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (/login/i.test(page.url())) throw new Error('Cookie expired / belum login');

    // TikTok Studio kadang menaruh form di iframe
    const findFrame = async () => {
      for (let i = 0; i < 40; i++) {
        for (const f of page.frames()) {
          if (await f.locator('input[type="file"]').count()) return f;
        }
        await page.waitForTimeout(1000);
      }
      throw new Error('Input upload tidak ketemu');
    };
    const frame = await findFrame();

    await frame.locator('input[type="file"]').first().setInputFiles(filePath);

    // tunggu tombol Post aktif (upload selesai)
    const postBtn = frame.locator('button[data-e2e="post_video_button"]');
    await postBtn.waitFor({ state: 'visible', timeout: 120000 });
    await page.waitForFunction(
      (el) => el && !el.disabled && el.getAttribute('aria-disabled') !== 'true',
      await postBtn.elementHandle(),
      { timeout: 600000 }
    );

    if (caption) {
      const editor = frame.locator('div[contenteditable="true"]').first();
      await editor.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.insertText(caption);
    }

    await postBtn.click();

    // konfirmasi kalau ada dialog "Post now"
    const confirm = frame.locator('button:has-text("Post now")');
    if (await confirm.count()) await confirm.first().click().catch(() => {});

    await page.waitForURL(/tiktokstudio\/content/, { timeout: 120000 });
    return { ok: true };
  } catch (err) {
    const shot = path.join(os.tmpdir(), `fail-${Date.now()}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    err.screenshot = shot;
    throw err;
  } finally {
    await browser.close();
  }
}

const app = express();

app.use((req, res, next) => {
  if (!API_KEY) return next();
  if (req.headers['x-api-key'] === API_KEY) return next();
  res.status(401).json({ ok: false, error: 'API key salah' });
});

app.get('/', (_, res) => res.json({ ok: true, service: 'tiktok-hd-api' }));

app.post('/upload', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'field "video" wajib' });
  const caption = (req.body && req.body.caption) || '';
  const patched = req.file.path + '.mp4';
  try {
    const { bytes, report } = patch(new Uint8Array(fs.readFileSync(req.file.path)));
    fs.writeFileSync(patched, bytes);
    const result = await enqueue(() => postToTikTok(patched, caption));
    res.json({ ...result, report });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, screenshot: err.screenshot || null });
  } finally {
    fs.unlink(req.file.path, () => {});
    fs.unlink(patched, () => {});
  }
});

app.get('/debug/:name', (req, res) => {
  const f = path.join(os.tmpdir(), path.basename(req.params.name));
  if (!fs.existsSync(f)) return res.status(404).end();
  res.sendFile(f);
});

app.listen(PORT, () => console.log('tiktok-hd-api on :' + PORT));
