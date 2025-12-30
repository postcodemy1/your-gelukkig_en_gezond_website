// Simple API to persist inventory and cart to JSON files
// Usage: install dependencies and run `node server.js` in this folder

const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const { randomUUID } = require('crypto');
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
app.use(cors());
app.use(express.json());
// Log incoming requests (helps debug 405s)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});
// Handle preflight explicitly
app.options('*', cors());
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

async function getUserFromAuth(req) {
  const auth = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token || '';
  if (!auth) return null;
  const sessions = await readJson(SESSIONS_FILE, {});
  const s = sessions[auth];
  if (!s) return null;
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
    const adminPass = bcrypt.hashSync('admin123', 10);
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
  console.log('[AUTH] register body', body);
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
  console.log('[AUTH] login body', body);
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const users = await readJson(USERS_FILE, []);
  const user = users.find(u => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Ongeldige inloggegevens' });
  }
  const sessions = await readJson(SESSIONS_FILE, {});
  const token = randomUUID();
  sessions[token] = { userId: user.id, createdAt: Date.now() };
  await writeJson(SESSIONS_FILE, sessions);
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
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
  if (!auth) return res.status(401).json({ error: 'Niet ingelogd' });
  const sessions = await readJson(SESSIONS_FILE, {});
  const s = sessions[auth];
  if (!s) return res.status(401).json({ error: 'Sessietoken ongeldig' });
  const users = await readJson(USERS_FILE, []);
  const user = users.find(u => u.id === s.userId);
  if (!user) return res.status(404).json({ error: 'Gebruiker niet gevonden' });
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
app.listen(port, () => console.log(`Dev API server running on http://localhost:${port}`));
