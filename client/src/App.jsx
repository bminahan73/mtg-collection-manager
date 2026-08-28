import React, { useState } from 'react'

function App(){
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [collection, setCollection] = useState([])

  async function search(){
    if(!query) return;
    // Call Scryfall directly from the browser (CORS allowed)
    const res = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}`)
    const json = await res.json()
    setResults(json.data || [])
  }

  function saveCollection(coll){
    localStorage.setItem('mtg-collection', JSON.stringify(coll))
  }

  function add(card){
    const coll = [...collection, card]
    setCollection(coll)
    saveCollection(coll)
  }

  function removeCard(id){
    const coll = collection.filter(c => String(c.id) !== String(id))
    setCollection(coll)
    saveCollection(coll)
  }

  function loadCollection(){
    const raw = localStorage.getItem('mtg-collection')
    setCollection(raw ? JSON.parse(raw) : [])
  }

  React.useEffect(()=>{ loadCollection() }, [])

  return (
    <div className="app">
      <h1>MTG Collection (Demo)</h1>
      <div className="search">
        <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search cards (e.g., lightning bolt)" />
        <button onClick={search}>Search</button>
      </div>
      <div className="results">
        <h2>Results</h2>
        {results.length === 0 && <div>No results</div>}
        {results.map(c=> (
          <div key={c.id} className="card">
            <img src={c.image_uris?.small || c.card_faces?.[0]?.image_uris?.small || ''} alt="" />
            <div>
              <div className="name">{c.name}</div>
              <div className="type">{c.type_line}</div>
              <button onClick={()=>add(c)}>Add</button>
            </div>
          </div>
        ))}
      </div>

      <div className="collection">
        <h2>My Collection ({collection.length})</h2>
        {collection.length === 0 && <div>(empty)</div>}
        {collection.map(c=> (
          <div key={c.id} className="card small">
            <img src={c.image_uris?.small || c.card_faces?.[0]?.image_uris?.small || ''} alt="" />
            <div style={{flex:1}}>
              <div>{c.name}</div>
            </div>
            <div>
              <button onClick={()=>removeCard(c.id)}>Remove</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default App
