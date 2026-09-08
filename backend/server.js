import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const configuredOrigin = process.env.CLIENT_ORIGIN;
  const localOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');
  if (origin && (origin === configuredOrigin || (!configuredOrigin && localOrigin))) res.header('Access-Control-Allow-Origin', origin);
  else res.header('Access-Control-Allow-Origin', configuredOrigin || 'http://localhost:5173');
  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const databasePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'collection.sqlite');
let database;

async function initializeDatabase(){
  await fs.mkdir(path.dirname(databasePath), { recursive: true });
  database = open({ filename: databasePath, driver: sqlite3.Database });
  const db = await database;
  await db.exec(`
    CREATE TABLE IF NOT EXISTS collection (
      id TEXT PRIMARY KEY,
      card_json TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS wishlist (
      id TEXT PRIMARY KEY,
      card_json TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
      added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS decks (
      id TEXT PRIMARY KEY,
      deck_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try { await db.exec('ALTER TABLE wishlist ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0)'); } catch(err) {
    if(!String(err.message).includes('duplicate column name')) throw err;
  }
}

async function readCollection(){
  const db = await database;
  const rows = await db.all('SELECT card_json, quantity FROM collection ORDER BY json_extract(card_json, \'$.name\') COLLATE NOCASE');
  return rows.map(row => ({ ...JSON.parse(row.card_json), quantity: row.quantity }));
}

async function readCard(id){
  const db = await database;
  const row = await db.get('SELECT card_json, quantity FROM collection WHERE id = ?', id);
  return row ? { ...JSON.parse(row.card_json), quantity: row.quantity } : null;
}

app.get('/api/health', async (req, res) => {
  try {
    const db = await database;
    await db.get('SELECT 1 AS ok');
    res.json({ status: 'ok' });
  } catch(err) {
    res.status(503).json({ status: 'error', error: String(err) });
  }
});

function validQuantity(value){
  const quantity = Number(value);
  return Number.isInteger(quantity) && quantity > 0 ? quantity : null;
}

async function updateCardRecord(table, id, quantity, card){
  const db = await database;
  const nextId = card?.id || id;
  const cardJson = card ? JSON.stringify({ ...card, id: nextId }) : null;
  await db.run('BEGIN TRANSACTION');
  try {
    const source = await db.get(`SELECT id FROM ${table} WHERE id = ?`, id);
    if (!source) {
      await db.run('ROLLBACK');
      return null;
    }
    if (nextId !== id) {
      const target = await db.get(`SELECT id FROM ${table} WHERE id = ?`, nextId);
      if (target) {
        await db.run(`UPDATE ${table} SET quantity = quantity + ?, card_json = ? WHERE id = ?`, quantity, cardJson, nextId);
        await db.run(`DELETE FROM ${table} WHERE id = ?`, id);
      } else {
        await db.run(`UPDATE ${table} SET id = ?, quantity = ?, card_json = COALESCE(?, card_json) WHERE id = ?`, nextId, quantity, cardJson, id);
      }
    } else {
      await db.run(`UPDATE ${table} SET quantity = ?, card_json = COALESCE(?, card_json) WHERE id = ?`, quantity, cardJson, id);
    }
    await db.run('COMMIT');
  } catch(error) {
    await db.run('ROLLBACK');
    throw error;
  }
  const row = await db.get(`SELECT card_json, quantity FROM ${table} WHERE id = ?`, nextId);
  return row ? { ...JSON.parse(row.card_json), quantity: row.quantity } : null;
}

async function readWishlist(){
  const db = await database;
  const rows = await db.all('SELECT card_json, quantity FROM wishlist ORDER BY json_extract(card_json, \'$.name\') COLLATE NOCASE');
  return rows.map(row => ({ ...JSON.parse(row.card_json), quantity: row.quantity }));
}

// Search Scryfall (proxy)
app.get('/api/search', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: 'q (query) is required' });
  try{
    const r = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}`);
    const json = await r.json();
    res.json(json);
  }catch(err){
    res.status(500).json({ error: String(err) });
  }
});

// Filter helper endpoint (optional, for backend-side filtering)
app.get('/api/cards/filter', async (req, res) => {
  const { colors, types, rarity, manaMax, name } = req.query;
  const queryParts = [];
  
  if(name) queryParts.push(name);
  if(colors) queryParts.push(`c:${colors}`);
  if(types) {
    const typeArray = Array.isArray(types) ? types : [types];
    typeArray.forEach(t => queryParts.push(`t:${t}`));
  }
  if(rarity) queryParts.push(`r:${rarity}`);
  if(manaMax) queryParts.push(`cmc<=${manaMax}`);
  
  const q = queryParts.join(' ');
  
  if(!q) return res.status(400).json({ error: 'at least one filter is required' });
  
  try{
    const r = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}`);
    const json = await r.json();
    res.json(json);
  }catch(err){
    res.status(500).json({ error: String(err) });
  }
});

// Collection endpoints
app.get('/api/collection', async (req, res) => {
  try {
    res.json(await readCollection());
  } catch(err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/collection', async (req, res) => {
  const card = req.body.card;
  const quantity = validQuantity(req.body.quantity || 1);
  if (!card?.id) return res.status(400).json({ error: 'card with an id is required in body' });
  if (!quantity) return res.status(400).json({ error: 'quantity must be a positive integer' });
  try {
    const db = await database;
    await db.run(`
      INSERT INTO collection (id, card_json, quantity, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        card_json = excluded.card_json,
        quantity = collection.quantity + excluded.quantity,
        updated_at = CURRENT_TIMESTAMP
    `, card.id, JSON.stringify(card), quantity);
    res.status(201).json(await readCard(card.id));
  } catch(err) {
    res.status(500).json({ error: String(err) });
  }
});

app.put('/api/collection/:id', async (req, res) => {
  const id = req.params.id;
  const quantity = validQuantity(req.body.quantity);
  if (!quantity) return res.status(400).json({ error: 'quantity must be a positive integer' });
  try {
    const card = await updateCardRecord('collection', id, quantity, req.body.card);
    if (!card) return res.status(404).json({ error: 'not found' });
    res.json(card);
  } catch(err) {
    res.status(500).json({ error: String(err) });
  }
});

app.delete('/api/collection/:id', async (req, res) => {
  try {
    const db = await database;
    const result = await db.run('DELETE FROM collection WHERE id = ?', req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'not found' });
    res.json({ deleted: req.params.id });
  } catch(err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/wishlist', async (req, res) => {
  try {
    res.json(await readWishlist());
  } catch(err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/wishlist', async (req, res) => {
  const card = req.body.card;
  const quantity = validQuantity(req.body.quantity || 1);
  if (!card?.id) return res.status(400).json({ error: 'card with an id is required in body' });
  if (!quantity) return res.status(400).json({ error: 'quantity must be a positive integer' });
  try {
    const db = await database;
    await db.run(`
      INSERT INTO wishlist (id, card_json, quantity, added_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET card_json = excluded.card_json, quantity = wishlist.quantity + excluded.quantity
    `, card.id, JSON.stringify(card), quantity);
    res.status(201).json({ ...card, quantity });
  } catch(err) {
    res.status(500).json({ error: String(err) });
  }
});

app.put('/api/wishlist/:id', async (req, res) => {
  const quantity = validQuantity(req.body.quantity);
  if (!quantity) return res.status(400).json({ error: 'quantity must be a positive integer' });
  try {
    const card = await updateCardRecord('wishlist', req.params.id, quantity, req.body.card);
    if (!card) return res.status(404).json({ error: 'not found' });
    res.json(card);
  } catch(err) {
    res.status(500).json({ error: String(err) });
  }
});

app.delete('/api/wishlist/:id', async (req, res) => {
  try {
    const db = await database;
    const result = await db.run('DELETE FROM wishlist WHERE id = ?', req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'not found' });
    res.json({ deleted: req.params.id });
  } catch(err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/decks', async (req, res) => {
  try {
    const db = await database;
    const rows = await db.all('SELECT deck_json FROM decks ORDER BY updated_at DESC');
    res.json(rows.map(row => JSON.parse(row.deck_json)));
  } catch(err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/decks', async (req, res) => {
  const deck = req.body.deck;
  if (!deck?.id || !deck.name) return res.status(400).json({ error: 'deck with an id and name is required' });
  try {
    const db = await database;
    await db.run('INSERT INTO decks (id, deck_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)', deck.id, JSON.stringify(deck));
    res.status(201).json(deck);
  } catch(err) {
    res.status(500).json({ error: String(err) });
  }
});

app.put('/api/decks/:id', async (req, res) => {
  const deck = { ...req.body.deck, id: req.params.id };
  if (!deck.name) return res.status(400).json({ error: 'deck name is required' });
  try {
    const db = await database;
    const result = await db.run('UPDATE decks SET deck_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', JSON.stringify(deck), req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'not found' });
    res.json(deck);
  } catch(err) {
    res.status(500).json({ error: String(err) });
  }
});

app.delete('/api/decks/:id', async (req, res) => {
  try {
    const db = await database;
    const result = await db.run('DELETE FROM decks WHERE id = ?', req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'not found' });
    res.json({ deleted: req.params.id });
  } catch(err) {
    res.status(500).json({ error: String(err) });
  }
});

initializeDatabase()
  .then(() => app.listen(PORT, () => console.log(`MTG backend listening on ${PORT}`)))
  .catch(err => {
    console.error('Could not initialize SQLite:', err);
    process.exit(1);
  });
