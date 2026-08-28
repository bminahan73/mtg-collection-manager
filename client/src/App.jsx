import React, { useState } from 'react'

function App(){
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [collection, setCollection] = useState([])

  async function search(){
    if(!query) return;
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`)
    const json = await res.json()
    setResults(json.data || [])
  }

  async function add(card){
    await fetch('/api/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card })
    })
    setCollection(prev => [...prev, card])
  }

  async function loadCollection(){
    const res = await fetch('/api/collection')
    const json = await res.json()
    setCollection(json || [])
  }

  React.useEffect(()=>{ loadCollection() }, [])

  return (
    <div className="app">
      <h1>MTG Collection</h1>
      <div className="search">
        <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search cards (e.g., lightning bolt)" />
        <button onClick={search}>Search</button>
      </div>
      <div className="results">
        <h2>Results</h2>
        {results.map(c=> (
          <div key={c.id} className="card">
            <img src={c.image_uris?.small || c.card_faces?.[0]?.image_uris?.small} alt="" />
            <div>
              <div className="name">{c.name}</div>
              <button onClick={()=>add(c)}>Add</button>
            </div>
          </div>
        ))}
      </div>

      <div className="collection">
        <h2>My Collection ({collection.length})</h2>
        {collection.map(c=> (
          <div key={c.id} className="card small">
            <img src={c.image_uris?.small || c.card_faces?.[0]?.image_uris?.small} alt="" />
            <div>{c.name}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default App
