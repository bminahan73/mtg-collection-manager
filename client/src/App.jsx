import React, { useState } from 'react'

function App(){
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [collection, setCollection] = useState([])
  const [filters, setFilters] = useState({
    colors: [],
    types: [],
    rarity: '',
    manaMax: ''
  })

  function buildSearchQuery(){
    let q = query;
    const parts = [];
    
    if(filters.colors.length > 0){
      parts.push(`c:${filters.colors.join('')}`)
    }
    if(filters.types.length > 0){
      parts.push(filters.types.map(t => `t:${t}`).join(' '))
    }
    if(filters.rarity){
      parts.push(`r:${filters.rarity}`)
    }
    if(filters.manaMax){
      parts.push(`cmc<=${filters.manaMax}`)
    }
    
    if(parts.length > 0){
      q = (q ? `${q} ` : '') + parts.join(' ')
    }
    return q;
  }

  async function search(){
    const finalQuery = buildSearchQuery();
    if(!finalQuery) return;
    const res = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(finalQuery)}`)
    const json = await res.json()
    setResults(json.data || [])
  }

  function toggleColor(color){
    setFilters(prev => ({
      ...prev,
      colors: prev.colors.includes(color)
        ? prev.colors.filter(c => c !== color)
        : [...prev.colors, color]
    }))
  }

  function toggleType(type){
    setFilters(prev => ({
      ...prev,
      types: prev.types.includes(type)
        ? prev.types.filter(t => t !== type)
        : [...prev.types, type]
    }))
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

      <div className="filters">
        <h3>Filters</h3>
        
        <div className="filter-group">
          <label>Colors:</label>
          <div className="color-buttons">
            {['W', 'U', 'B', 'R', 'G'].map(color => (
              <button
                key={color}
                className={`color-btn ${filters.colors.includes(color) ? 'active' : ''}`}
                onClick={() => toggleColor(color)}
                title={{W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green'}[color]}
              >
                {color}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-group">
          <label>Card Types:</label>
          <div className="type-buttons">
            {['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land'].map(type => (
              <button
                key={type}
                className={`type-btn ${filters.types.includes(type) ? 'active' : ''}`}
                onClick={() => toggleType(type)}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-group">
          <label>Rarity:</label>
          <select value={filters.rarity} onChange={e => setFilters(prev => ({...prev, rarity: e.target.value}))}>
            <option value="">All</option>
            <option value="common">Common</option>
            <option value="uncommon">Uncommon</option>
            <option value="rare">Rare</option>
            <option value="mythic">Mythic</option>
          </select>
        </div>

        <div className="filter-group">
          <label>Max Mana Cost:</label>
          <input 
            type="number" 
            min="0" 
            max="20" 
            value={filters.manaMax} 
            onChange={e => setFilters(prev => ({...prev, manaMax: e.target.value}))}
            placeholder="e.g., 5"
          />
        </div>
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
