// Simple API to persist inventory and cart to JSON files
// Usage: install dependencies and run `node server.js` in this folder

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const fs = require('fs').promises;
const path = require('path');
const { randomUUID, createHmac, randomBytes, createCipheriv } = require('crypto');
const http = require('http');
const https = require('https');
const os = require('os');
const dns = require('dns');
const multer = require('multer');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.resolve(__dirname);
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const INVENTORY_FILE = path.join(DATA_DIR, 'inventory.json');
const CART_FILE = path.join(DATA_DIR, 'cart.json');
const PICTURES_DIR = path.join(DATA_DIR, 'pictures');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const APPOINTMENTS_FILE = path.join(DATA_DIR, 'appointments.json');

const app = express();
// Dynamic CORS that allows configured origins and any localhost/127.0.0.1 origins (useful for dev on different ports)
const configuredOrigins = (process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
const corsOptions = {
  origin: function(origin, cb) {
    // Allow non-browser requests (curl, server-side)
    if (!origin) return cb(null, true);
    if (configuredOrigins.length && configuredOrigins.includes(origin)) return cb(null, true);
    try {
      const m = origin.match(/^https?:\/\/([^:/]+)(:\d+)?$/);
      if (m) {
        const host = m[1];
        if (host === 'localhost' || host === '127.0.0.1') return cb(null, true);
      }
    } catch (e) {
      // fallthrough to reject
    }
    console.warn('[CORS] blocked origin', origin);
    return cb(new Error('Not allowed by CORS'));
  },
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(helmet());
app.use(express.json());

// Make uncaught errors visible in logs so we can diagnose crashes
process.on('uncaughtException', (err) => { console.error('[FATAL] uncaughtException', err && err.stack ? err.stack : err); });
process.on('unhandledRejection', (reason) => { console.error('[FATAL] unhandledRejection', reason); });
// Incoming request logger with client info and start time
app.use((req, res, next) => {
  try {
    req._startTime = Date.now();
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const ua = req.headers['user-agent'] || '';
    console.log(`[IN] ${new Date().toISOString()} ${req.method} ${req.path} from=${ip} ua="${ua}" origin="${req.headers.origin||''}"`);
  } catch (e) {
    console.warn('[LOG] incoming logger failed', e && e.stack ? e.stack : e);
  }
  next();
});
// Handle preflight explicitly
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  next();
});

async function readJson(file, defaultValue) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return defaultValue;
  }
}

async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

function sanitizeForLog(obj) {
  try {
    const copy = JSON.parse(JSON.stringify(obj || {}));
    const LOG_KEY = process.env.LOG_KEY || 'dev-log-key';
    const LOG_METHOD = (process.env.LOG_METHOD || 'aes').toLowerCase();
    // redact common sensitive keys
    ['password','passwordHash','token','authorization','authToken'].forEach(k => { if (k in copy) copy[k] = '[REDACTED]'; });
    // obfuscate email/username using selected method (aes or hmac-sha1)
    if (copy.email) {
      try {
        const email = String(copy.email).toLowerCase();
        if (LOG_METHOD === 'aes' && LOG_KEY) {
          // AES-256-GCM encryption (non-reversible without LOG_KEY)
          const key = createHmac('sha256', LOG_KEY).digest(); // 32 bytes
          const iv = randomBytes(12);
          const cipher = createCipheriv('aes-256-gcm', key, iv);
          const encrypted = Buffer.concat([cipher.update(email, 'utf8'), cipher.final()]);
          const tag = cipher.getAuthTag();
          copy.email = `enc:${iv.toString('hex')}:${encrypted.toString('hex')}:${tag.toString('hex')}`;
        } else if (LOG_METHOD === 'hmac-sha1') {
          const h = createHmac('sha1', LOG_KEY).update(email).digest('hex').slice(0,16);
          copy.email = `h1:${h}`;
        } else {
          // fallback to HMAC-SHA256 short digest
          const h = createHmac('sha256', LOG_KEY).update(email).digest('hex').slice(0,16);
          copy.email = `h:${h}`;
        }
      } catch (e) {
        copy.email = '[obfuscate-error]';
      }
    }
    return copy;
  } catch (e) {
    return '[UNSERIALIZABLE]';
  }
}

// Detailed sanitized request logging (verbose for debugging)
app.use((req, res, next) => {
  try {
    const sbody = sanitizeForLog(req.body || {});
    const sHeaders = { authorization: req.headers.authorization ? '[REDACTED]' : undefined };
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    console.log(`[REQ] ${new Date().toISOString()} ${req.method} ${req.path} from=${ip} headers=${JSON.stringify(sHeaders)} body=${JSON.stringify(sbody)}`);
    // log response status and timing when request finishes
    res.on('finish', () => {
      const duration = (req._startTime ? (Date.now() - req._startTime) : 0);
      console.log(`[RES] ${new Date().toISOString()} ${req.method} ${req.path} from=${ip} status=${res.statusCode} duration=${duration}ms`);
    });
  } catch (e) {
    console.warn('[LOG] could not serialize request', e && e.stack ? e.stack : e);
  }
  next();
});

// Startup heartbeat (useful to verify server stays alive)
setInterval(() => console.log('[HEARTBEAT] server alive', new Date().toISOString()), 60 * 1000);

// Debug endpoints (disabled unless DEBUG_ALLOW=true in env)
app.get('/debug/info', (req, res) => {
  try {
    const nets = os.networkInterfaces();
    const addr = (typeof server !== 'undefined' && server && server.address) ? server.address() : null;
    const info = { uptime: process.uptime(), pid: process.pid, node: process.version, address: addr, networks: Object.keys(nets) };
    console.log('[DEBUG] info requested', info);
    res.json(info);
  } catch (e) {
    console.error('[DEBUG] info error', e && e.stack ? e.stack : e);
    res.status(500).json({ error: 'debug info failed' });
  }
});

app.post('/debug/check', async (req, res) => {
  if (!process.env.DEBUG_ALLOW) {
    console.log('[DEBUG] check blocked - DEBUG_ALLOW not set');
    return res.status(403).json({ error: 'debug disabled' });
  }
  const logs = [];
  logs.push('[DEBUG] starting connectivity checks');
  try {
    logs.push('[DEBUG] dns.lookup example.com');
    const dnsResult = await new Promise(resolve => dns.lookup('example.com', (err, address, family) => {
      if (err) { logs.push(`[DEBUG] dns.lookup FAILED: ${err.message}`); resolve({ ok: false, error: err.message }); }
      else { logs.push(`[DEBUG] dns.lookup OK -> ${address} (family ${family})`); resolve({ ok: true, address, family }); }
    }));

    logs.push('[DEBUG] https.get https://example.com');
    const httpResult = await new Promise(resolve => {
      const t = setTimeout(() => { logs.push('[DEBUG] https.get TIMEOUT'); resolve({ ok: false, error: 'timeout' }); }, 8000);
      const r = https.get('https://example.com', (resp) => {
        clearTimeout(t);
        logs.push(`[DEBUG] https.get status ${resp.statusCode}`);
        resp.on('data', () => {});
        resp.on('end', () => { logs.push('[DEBUG] https.get end'); resolve({ ok: true, status: resp.statusCode }); });
      });
      r.on('error', (e) => { clearTimeout(t); logs.push(`[DEBUG] https.get error ${e.message}`); resolve({ ok: false, error: e.message }); });
    });

    logs.push('[DEBUG] checks complete');
    console.log(logs.join('\n'));
    return res.json({ logs, dnsResult, httpResult });
  } catch (e) {
    console.error('[DEBUG] check exception', e && e.stack ? e.stack : e);
    return res.status(500).json({ error: 'debug failed', message: String(e) });
  }
});

// Handshake packet store (temporary nonces, short-lived)
const HANDSHAKE_STORE = new Map();
function issueHandshakePacket() {
  const pkt = {
    serverVersion: process.env.SERVER_VERSION || '1.0.0',
    serverType: process.env.SERVER_TYPE || 'dev-api',
    serverName: process.env.SERVER_NAME || 'SimpleAPI',
    timestamp: Date.now(),
    nonce: randomUUID(),
    features: ['inventory','auth','uploads']
  };
  HANDSHAKE_STORE.set(pkt.nonce, { packet: pkt, createdAt: Date.now() });
  // expire after 2 minutes
  setTimeout(() => HANDSHAKE_STORE.delete(pkt.nonce), 2 * 60 * 1000);
  return pkt;
}

app.get('/api/handshake', (req, res) => {
  try {
    const pkt = issueHandshakePacket();
    console.log('[HANDSHAKE] issued server packet', sanitizeForLog(pkt));
    res.json(pkt);
  } catch (e) {
    console.error('[HANDSHAKE] issue error', e && e.stack ? e.stack : e);
    res.status(500).json({ error: 'handshake issue failed' });
  }
});

app.post('/api/handshake/confirm', async (req, res) => {
  try {
    const body = req.body || {};
    console.log('[HANDSHAKE] confirm received', sanitizeForLog(body));
    const nonce = body.echoNonce || body.serverNonce;
    if (!nonce) {
      console.warn('[HANDSHAKE] confirm missing nonce');
      return res.status(400).json({ error: 'missing nonce' });
    }
    const entry = HANDSHAKE_STORE.get(nonce);
    if (!entry) {
      console.warn('[HANDSHAKE] confirm invalid/expired nonce', sanitizeForLog({ nonce }));
      return res.status(400).json({ error: 'invalid or expired nonce' });
    }
    // Optionally validate serverVersion or other echoed fields
    // Accept handshake and remove nonce
    HANDSHAKE_STORE.delete(nonce);
    console.log('[HANDSHAKE] success', { nonce, client: sanitizeForLog(body) });
    return res.json({ ok: true });
  } catch (e) {
    console.error('[HANDSHAKE] confirm error', e && e.stack ? e.stack : e);
    return res.status(500).json({ error: 'handshake confirm failed' });
  }
});

async function getUserFromAuth(req) {
  const auth = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token || '';
  if (!auth) return null;
  const sessions = await readJson(SESSIONS_FILE, {});
  const s = sessions[auth];
  if (!s) return null;
  // Expire sessions when past expiresAt to avoid long-lived tokens
  if (s.expiresAt && s.expiresAt < Date.now()) {
    delete sessions[auth];
    await writeJson(SESSIONS_FILE, sessions);
    return null;
  }
  const users = await readJson(USERS_FILE, []);
  return users.find(u => u.id === s.userId) || null;
}

// Ensure files exist with defaults
(async function ensureFiles(){
  const defaultInventory = [
    { id: randomUUID(), name: 'Warme Deken', price: '29.99', img: '/images/warme-deken.svg' },
    { id: randomUUID(), name: 'Relaxatiekaars', price: '14.99', img: '/images/relaxatiekaars.svg' },
    { id: randomUUID(), name: 'Comfortkussen', price: '39.99', img: '/images/comfortkussen.svg' },
    { id: randomUUID(), name: 'Vochtige Doekjes', price: '6.99', img: '/images/vochtige-doekjes.svg' },
    { id: randomUUID(), name: 'Soepele Sokken', price: '9.99', img: '/images/soepele-sokken.svg' },
    { id: randomUUID(), name: 'Massageolie', price: '19.99', img: '/images/massageolie.svg' }
  ];

  const inv = await readJson(INVENTORY_FILE, null);
  if (!inv) await writeJson(INVENTORY_FILE, defaultInventory);

  const cart = await readJson(CART_FILE, null);
  if (!cart) await writeJson(CART_FILE, { items: [] });

  // ensure users file exists with a default admin user
  const users = await readJson(USERS_FILE, null);
  if (!users) {
    const rawAdminPass = process.env.ADMIN_PASS || 'admin123';
    if (!process.env.ADMIN_PASS) console.warn('Default admin password used; set ADMIN_PASS environment variable to a strong password');
    const adminPass = bcrypt.hashSync(rawAdminPass, 10);
    await writeJson(USERS_FILE, [
      { id: randomUUID(), name: 'Administrator', email: 'admin@example.com', passwordHash: adminPass, role: 'admin' }
    ]);
  }
  const sessions = await readJson(SESSIONS_FILE, null);
  if (!sessions) await writeJson(SESSIONS_FILE, {});
  const appts = await readJson(APPOINTMENTS_FILE, null);
  if (!appts) await writeJson(APPOINTMENTS_FILE, []);

  // ensure uploads folder exists
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  // ensure pictures folder exists (so users can drop files there)
  await fs.mkdir(PICTURES_DIR, { recursive: true });
})();

// Serve static files from current directory (simple dev server)
app.use(express.static(DATA_DIR));
// Serve user pictures and uploaded images
app.use('/pictures', express.static(PICTURES_DIR));
app.use('/uploads', express.static(UPLOADS_DIR));

// Inventory API
app.get('/api/inventory', async (req, res) => {
  const inv = await readJson(INVENTORY_FILE, []);
  res.json(inv);
});

// List pictures that exist in the pictures folder (jpg/png)
app.get('/api/pictures', async (req, res) => {
  try {
    const files = await fs.readdir(PICTURES_DIR);
    const images = files.filter(f => /\.(jpe?g|png)$/i.test(f)).map(f => '/pictures/' + f);
    res.json(images);
  } catch (e) { res.json([]); }
});


app.post('/api/inventory', async (req, res) => {
  const user = await getUserFromAuth(req);
  if (!user || (user.role !== 'worker' && user.role !== 'admin')) return res.status(403).json({ error: 'Toegang geweigerd' });
  const body = req.body || {};
  const inv = await readJson(INVENTORY_FILE, []);
  const item = {
    id: randomUUID(),
    name: body.name || 'Nieuwe product',
    description: body.description || '',
    category: body.category || 'Algemeen',
    price: (body.price || '0.00').toString(),
    img: body.img || (body.imgFilename ? '/uploads/' + body.imgFilename : '')
  };
  inv.unshift(item);
  await writeJson(INVENTORY_FILE, inv);
  res.json(item);
});

// Upload image (jpg/png) - saves to /uploads and returns path
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const name = Date.now() + '-' + Math.round(Math.random()*1e6) + ext;
      cb(null, name);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if(!/image\/(jpeg|png)/.test(file.mimetype)) return cb(new Error('Only JPEG/PNG allowed'));
    cb(null, true);
  }
});

app.post('/api/upload', upload.single('image'), async (req, res) => {
  if(!req.file) return res.status(400).json({ error: 'no file' });
  res.json({ path: '/uploads/' + req.file.filename, filename: req.file.filename });
});

app.delete('/api/inventory/:id', async (req, res) => {
  const user = await getUserFromAuth(req);
  if (!user || (user.role !== 'worker' && user.role !== 'admin')) return res.status(403).json({ error: 'Toegang geweigerd' });
  const id = req.params.id;
  let inv = await readJson(INVENTORY_FILE, []);
  const before = inv.length;
  inv = inv.filter(i => i.id !== id);
  await writeJson(INVENTORY_FILE, inv);
  res.json({ deleted: before - inv.length });
});

// Cart API
app.get('/api/cart', async (req, res) => {
  const cart = await readJson(CART_FILE, { items: [] });
  res.json(cart);
});

app.post('/api/cart', async (req, res) => {
  const payload = req.body || {};
  const cart = await readJson(CART_FILE, { items: [] });
  const existing = cart.items.find(it => it.id === payload.id);
  if (existing) {
    existing.qty = (existing.qty || 1) + (payload.qty || 1);
  } else {
    cart.items.push({ id: payload.id, name: payload.name, price: payload.price, qty: payload.qty || 1, img: payload.img || '' });
  }
  await writeJson(CART_FILE, cart);
  res.json(cart);
});

app.delete('/api/cart/:id', async (req, res) => {
  const id = req.params.id;
  const cart = await readJson(CART_FILE, { items: [] });
  cart.items = cart.items.filter(it => it.id !== id);
  await writeJson(CART_FILE, cart);
  res.json(cart);
});

app.delete('/api/cart', async (req, res) => {
  await writeJson(CART_FILE, { items: [] });
  res.json({ items: [] });
});

// --- Simple user / session endpoints ---
app.post('/api/register', async (req, res) => {
  console.log('[AUTH] register request', req.method, req.path);
  const body = req.body || {};
  console.log('[AUTH] register body', sanitizeForLog(body));
  const name = (body.name || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const role = body.role || 'client'; // 'client' | 'worker' | 'admin'
  if (role === 'admin') return res.status(400).json({ error: 'Registratie als administrator niet toegestaan' });
  if (!email || !password) return res.status(400).json({ error: 'Email en wachtwoord zijn vereist' });
  const users = await readJson(USERS_FILE, []);
  if (users.find(u => u.email === email)) return res.status(400).json({ error: 'E-mail is al geregistreerd' });
  const passwordHash = bcrypt.hashSync(password, 10);
  const user = { id: randomUUID(), name: name || 'Gebruiker', email, passwordHash, role };
  users.push(user);
  await writeJson(USERS_FILE, users);
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

app.post('/api/login', async (req, res) => {
  console.log('[AUTH] login request', req.method, req.path);
  const body = req.body || {};
  console.log('[AUTH] login body', sanitizeForLog(body));
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const users = await readJson(USERS_FILE, []);
  const user = users.find(u => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Ongeldige inloggegevens' });
  }
  const sessions = await readJson(SESSIONS_FILE, {});
  const token = randomUUID();
  const expiresInMs = 24 * 60 * 60 * 1000; // 24 hours
  sessions[token] = { userId: user.id, createdAt: Date.now(), expiresAt: Date.now() + expiresInMs };
  await writeJson(SESSIONS_FILE, sessions);
  console.log('[AUTH] login success', { user: sanitizeForLog({ email: user.email }), userId: user.id, expiresAt: sessions[token].expiresAt });
  res.json({ token, expiresIn: 24*60*60, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.post('/api/logout', async (req, res) => {
  const auth = (req.headers.authorization || '').replace('Bearer ', '');
  if (!auth) return res.json({ ok: true });
  const sessions = await readJson(SESSIONS_FILE, {});
  delete sessions[auth];
  await writeJson(SESSIONS_FILE, sessions);
  res.json({ ok: true });
});

app.get('/api/me', async (req, res) => {
  const auth = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token || '';
  console.log('[HANDSHAKE] attempt', sanitizeForLog({ token: auth }));
  if (!auth) { console.warn('[HANDSHAKE] failed - no token'); return res.status(401).json({ error: 'Niet ingelogd' }); }
  const sessions = await readJson(SESSIONS_FILE, {});
  const s = sessions[auth];
  if (!s) { console.warn('[HANDSHAKE] failed - invalid token', sanitizeForLog({ token: auth })); return res.status(401).json({ error: 'Sessietoken ongelijk' }); }
  // Expire check already happens in getUserFromAuth, but double-check
  if (s.expiresAt && s.expiresAt < Date.now()) { console.warn('[HANDSHAKE] failed - expired token', sanitizeForLog({ token: auth })); delete sessions[auth]; await writeJson(SESSIONS_FILE, sessions); return res.status(401).json({ error: 'Sessie verlopen' }); }
  const users = await readJson(USERS_FILE, []);
  const user = users.find(u => u.id === s.userId);
  if (!user) { console.warn('[HANDSHAKE] failed - user missing for token', sanitizeForLog({ token: auth })); return res.status(404).json({ error: 'Gebruiker niet gevonden' }); }
  console.log('[HANDSHAKE] successful', { user: sanitizeForLog({ email: user.email }), userId: user.id, role: user.role });
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

// Appointments endpoints
app.get('/api/appointments', async (req, res) => {
  const user = await getUserFromAuth(req);
  if (!user) return res.status(401).json({ error: 'Niet ingelogd' });
  const appts = await readJson(APPOINTMENTS_FILE, []);
  if (user.role === 'client') return res.json(appts.filter(a => a.userId === user.id));
  res.json(appts);
});

app.post('/api/appointments', async (req, res) => {
  const user = await getUserFromAuth(req);
  if (!user) return res.status(401).json({ error: 'Niet ingelogd' });
  const body = req.body || {};
  const appts = await readJson(APPOINTMENTS_FILE, []);
  const appointment = { id: randomUUID(), userId: user.id, datetime: body.datetime || '', notes: body.notes || '', status: body.status || 'gepland' };
  appts.unshift(appointment);
  await writeJson(APPOINTMENTS_FILE, appts);
  res.json(appointment);
});

app.put('/api/appointments/:id', async (req, res) => {
  const user = await getUserFromAuth(req);
  if (!user) return res.status(401).json({ error: 'Niet ingelogd' });
  const id = req.params.id;
  const body = req.body || {};
  const appts = await readJson(APPOINTMENTS_FILE, []);
  const idx = appts.findIndex(a => a.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Afspraak niet gevonden' });
  const appt = appts[idx];
  if (user.role === 'client' && appt.userId !== user.id) return res.status(403).json({ error: 'Toegang geweigerd' });
  appt.datetime = body.datetime || appt.datetime;
  appt.notes = body.notes || appt.notes;
  appt.status = body.status || appt.status;
  appts[idx] = appt;
  await writeJson(APPOINTMENTS_FILE, appts);
  res.json(appt);
});

app.delete('/api/appointments/:id', async (req, res) => {
  const user = await getUserFromAuth(req);
  if (!user) return res.status(401).json({ error: 'Niet ingelogd' });
  const id = req.params.id;
  let appts = await readJson(APPOINTMENTS_FILE, []);
  const appt = appts.find(a => a.id === id);
  if (!appt) return res.status(404).json({ error: 'Afspraak niet gevonden' });
  if (user.role === 'client' && appt.userId !== user.id) return res.status(403).json({ error: 'Toegang geweigerd' });
  appts = appts.filter(a => a.id !== id);
  await writeJson(APPOINTMENTS_FILE, appts);
  res.json({ deleted: 1 });
});

// API to list users (admin only)
app.get('/api/users', async (req, res) => {
  const user = await getUserFromAuth(req);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Toegang geweigerd' });
  const users = await readJson(USERS_FILE, []);
  res.json(users.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role })));
});

// --- end user endpoints ---

const port = process.env.PORT || 3000;
const server = http.createServer(app);
server.on('connection', (socket) => {
  try {
    console.log(`[CONN] ${new Date().toISOString()} connection from ${socket.remoteAddress}:${socket.remotePort} family=${socket.remoteFamily}`);
  } catch (e) { console.warn('[CONN] connection log failed', e && e.stack ? e.stack : e); }
});
server.on('listening', () => {
  try {
    const addr = server.address();
    console.log(`[SERVER] listening on ${addr.address}:${addr.port} family=${addr.family}`);
    console.log(`[SERVER] pid=${process.pid} node=${process.version}`);
  } catch (e) { console.warn('[SERVER] listening handler failed', e && e.stack ? e.stack : e); }
});
server.on('error', (err) => { console.error('[SERVER] error', err && err.stack ? err.stack : err); });
server.listen(port, () => console.log(`Dev API server starting on http://localhost:${port}`));
