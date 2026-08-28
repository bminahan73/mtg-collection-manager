import express from 'express';
import fs from 'fs/promises';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

const dataDir = path.resolve('./backend/data');
const dataFile = path.join(dataDir, 'collection.json');

async function readCollection(){
  try{
    const txt = await fs.readFile(dataFile, 'utf8');
    return JSON.parse(txt || '[]');
  }catch(e){
    return [];
  }
}

async function writeCollection(arr){
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify(arr, null, 2));
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

// Collection endpoints
app.get('/api/collection', async (req, res) => {
  const coll = await readCollection();
  res.json(coll);
});

app.post('/api/collection', async (req, res) => {
  const card = req.body.card;
  if (!card) return res.status(400).json({ error: 'card object required in body' });
  const coll = await readCollection();
  coll.push(card);
  await writeCollection(coll);
  res.status(201).json(card);
});

app.delete('/api/collection/:id', async (req, res) => {
  const id = req.params.id;
  let coll = await readCollection();
  const before = coll.length;
  coll = coll.filter(c => String(c.id) !== String(id));
  if (coll.length === before) return res.status(404).json({ error: 'not found' });
  await writeCollection(coll);
  res.json({ deleted: id });
});

app.listen(PORT, () => console.log(`MTG backend listening on ${PORT}`));
