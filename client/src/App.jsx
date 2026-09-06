import React, { useEffect, useMemo, useState } from 'react'

const colorNames = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' }
const colorClasses = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' }
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000'

function cardImage(card){
  return card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || ''
}

function normalizeCollection(cards){
  return cards.reduce((items, card) => {
    const existing = items.find(item => item.id === card.id)
    if(existing) existing.quantity += Number(card.quantity) || 1
    else items.push({ ...card, quantity: Number(card.quantity) || 1 })
    return items
  }, [])
}

function App(){
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [totalResults, setTotalResults] = useState(0)
  const [collection, setCollection] = useState([])
  const [collectionState, setCollectionState] = useState('loading')
  const [collectionError, setCollectionError] = useState('')
  const [searchState, setSearchState] = useState('idle')
  const [searchError, setSearchError] = useState('')
  const [sortBy, setSortBy] = useState('name')
  const [filters, setFilters] = useState({ colors: [], types: [], rarity: '', manaMax: '' })

  function buildSearchQuery(){
    let searchQuery = query.trim()
    const parts = []
    if(filters.colors.length > 0) parts.push(`c:${filters.colors.join('')}`)
    if(filters.types.length > 0) parts.push(filters.types.map(type => `t:${type}`).join(' '))
    if(filters.rarity) parts.push(`r:${filters.rarity}`)
    if(filters.manaMax) parts.push(`cmc<=${filters.manaMax}`)
    if(parts.length > 0) searchQuery = (searchQuery ? `${searchQuery} ` : '') + parts.join(' ')
    return searchQuery
  }

  async function search(event){
    event?.preventDefault()
    const finalQuery = buildSearchQuery()
    if(!finalQuery) return
    setSearchState('loading')
    setSearchError('')
    try {
      const res = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(finalQuery)}`)
      const json = await res.json()
      if(!res.ok) throw new Error(json.details || 'Scryfall could not complete that search.')
      setResults(json.data || [])
      setTotalResults(json.total_cards || json.data?.length || 0)
      setSearchState('success')
    } catch(error) {
      setResults([])
      setTotalResults(0)
      setSearchError(error.message || 'Search failed. Please try again.')
      setSearchState('error')
    }
  }

  function toggleColor(color){
    setFilters(prev => ({ ...prev, colors: prev.colors.includes(color) ? prev.colors.filter(item => item !== color) : [...prev.colors, color] }))
  }

  function toggleType(type){
    setFilters(prev => ({ ...prev, types: prev.types.includes(type) ? prev.types.filter(item => item !== type) : [...prev.types, type] }))
  }

  function updateCollection(nextCollection){
    setCollection(nextCollection)
    localStorage.setItem('mtg-collection', JSON.stringify(nextCollection))
  }

  async function add(card){
    const existing = collection.find(item => item.id === card.id)
    const nextCollection = existing
      ? collection.map(item => item.id === card.id ? { ...item, quantity: item.quantity + 1 } : item)
      : [...collection, { ...card, quantity: 1 }]
    updateCollection(nextCollection)
    try {
      const response = await fetch(`${API_BASE}/api/collection${existing ? `/${card.id}` : ''}`, {
        method: existing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(existing ? { quantity: existing.quantity + 1 } : { card })
      })
      if(!response.ok) throw new Error('The collection server rejected this card.')
      setCollectionError('')
      setCollectionState('ready')
    } catch(error) {
      setCollectionError(`${error.message} Your local copy is still available.`)
    }
  }

  async function changeQuantity(id, amount){
    const card = collection.find(item => item.id === id)
    if(!card) return
    const nextQuantity = card.quantity + amount
    const nextCollection = collection.map(item => item.id === id ? { ...item, quantity: nextQuantity } : item).filter(item => item.quantity > 0)
    updateCollection(nextCollection)
    try {
      const response = nextQuantity > 0
        ? await fetch(`${API_BASE}/api/collection/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quantity: nextQuantity }) })
        : await fetch(`${API_BASE}/api/collection/${id}`, { method: 'DELETE' })
      if(!response.ok) throw new Error('The collection server could not update that quantity.')
      setCollectionError('')
      setCollectionState('ready')
    } catch(error) {
      setCollectionError(`${error.message} Your local copy is still available.`)
    }
  }

  useEffect(() => {
    const raw = localStorage.getItem('mtg-collection')
    const localCollection = (() => {
      try { return normalizeCollection(raw ? JSON.parse(raw) : []) } catch { return [] }
    })()
    fetch(`${API_BASE}/api/collection`)
      .then(response => {
        if(!response.ok) throw new Error('The collection server is unavailable.')
        return response.json()
      })
      .then(cards => {
        const savedCollection = normalizeCollection(cards)
        if(savedCollection.length === 0 && localCollection.length > 0){
          return Promise.all(localCollection.map(card => fetch(`${API_BASE}/api/collection`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ card })
          }))).then(() => {
            setCollection(localCollection)
            localStorage.setItem('mtg-collection', JSON.stringify(localCollection))
            setCollectionState('ready')
          })
        }
        setCollection(savedCollection)
        localStorage.setItem('mtg-collection', JSON.stringify(savedCollection))
        setCollectionState('ready')
      })
      .catch(error => {
        setCollection(localCollection)
        setCollectionState('offline')
        setCollectionError(`${error.message} Using your local copy for now.`)
      })
  }, [])

  const totalCards = collection.reduce((total, card) => total + card.quantity, 0)
  const colorsInCollection = [...new Set(collection.flatMap(card => card.colors || []))]
  const sortedCollection = useMemo(() => [...collection].sort((a, b) => {
    if(sortBy === 'quantity') return b.quantity - a.quantity || a.name.localeCompare(b.name)
    if(sortBy === 'rarity') return a.rarity.localeCompare(b.rarity) || a.name.localeCompare(b.name)
    return a.name.localeCompare(b.name)
  }), [collection, sortBy])

  return <div className="app">
    <header className="hero"><div><p className="eyebrow">CARD LIBRARY / 01</p><h1>Keep your cardboard <em>close.</em></h1><p className="hero-copy">Search the multiverse, save what you own, and see your collection take shape.</p></div><div className="hero-mark" aria-hidden="true">✦</div></header>
    <section className="stats" aria-label="Collection summary"><div><strong>{totalCards}</strong><span>cards owned</span></div><div><strong>{collection.length}</strong><span>unique cards</span></div><div><strong>{colorsInCollection.length || '—'}</strong><span>colors represented</span></div></section>
    <main>
      <section className="search-panel"><div className="section-heading"><div><p className="eyebrow">DISCOVER</p><h2>Find your next card</h2></div><span className="api-note">Powered by Scryfall</span></div><form className="search" onSubmit={search}><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Try “lightning bolt” or “legendary elf”" aria-label="Search cards" /><button type="submit" disabled={searchState === 'loading'}>{searchState === 'loading' ? 'Searching…' : 'Search cards'}</button></form><div className="filters"><div className="filter-group"><label>Colors</label><div className="color-buttons">{['W', 'U', 'B', 'R', 'G'].map(color => <button type="button" key={color} className={`color-btn ${colorClasses[color]} ${filters.colors.includes(color) ? 'active' : ''}`} onClick={() => toggleColor(color)} title={colorNames[color]} aria-pressed={filters.colors.includes(color)}>{color}</button>)}</div></div><div className="filter-group type-filter"><label>Card type</label><div className="type-buttons">{['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land'].map(type => <button type="button" key={type} className={`type-btn ${filters.types.includes(type) ? 'active' : ''}`} onClick={() => toggleType(type)} aria-pressed={filters.types.includes(type)}>{type}</button>)}</div></div><div className="compact-filters"><label>Rarity<select value={filters.rarity} onChange={e => setFilters(prev => ({...prev, rarity: e.target.value}))}><option value="">Any rarity</option><option value="common">Common</option><option value="uncommon">Uncommon</option><option value="rare">Rare</option><option value="mythic">Mythic</option></select></label><label>Max mana<input type="number" min="0" max="20" value={filters.manaMax} onChange={e => setFilters(prev => ({...prev, manaMax: e.target.value}))} placeholder="Any" /></label></div></div></section>
      <section className="results"><div className="section-heading"><div><p className="eyebrow">SEARCH RESULTS</p><h2>{searchState === 'success' ? `${totalResults.toLocaleString()} cards found` : 'A whole multiverse'}</h2></div></div>{searchState === 'idle' && <div className="empty-state"><span>✦</span><p>Search for a card to begin exploring.</p></div>}{searchState === 'error' && <div className="message error-message">{searchError}</div>}{searchState === 'success' && results.length === 0 && <div className="empty-state"><span>⌁</span><p>No cards matched those filters. Try a broader search.</p></div>}<div className="card-grid">{results.map(card => <CardTile key={card.id} card={card} actionLabel="Add to collection" onAction={() => add(card)} />)}</div></section>
      <section className="collection"><div className="section-heading collection-heading"><div><p className="eyebrow">YOUR BINDER</p><h2>My collection <span>{totalCards}</span></h2></div><label className="sort-control">Sort by<select value={sortBy} onChange={e => setSortBy(e.target.value)}><option value="name">Name</option><option value="quantity">Quantity</option><option value="rarity">Rarity</option></select></label></div>{collectionState === 'loading' && <div className="message">Loading your saved collection…</div>}{collectionError && <div className="message error-message">{collectionError}</div>}{collection.length === 0 && collectionState !== 'loading' && <div className="empty-state collection-empty"><span>＋</span><p>Your collection is waiting for its first card.</p></div>}<div className="collection-list">{sortedCollection.map(card => <article key={card.id} className="collection-card"><img src={cardImage(card)} alt="" /><div className="collection-card-info"><strong>{card.name}</strong><span>{card.set_name || card.set?.toUpperCase()} · {card.rarity}</span></div><div className="quantity" aria-label={`${card.quantity} copies of ${card.name}`}><button onClick={() => changeQuantity(card.id, -1)} aria-label={`Remove one ${card.name}`}>−</button><strong>{card.quantity}</strong><button onClick={() => changeQuantity(card.id, 1)} aria-label={`Add one ${card.name}`}>＋</button></div></article>)}</div></section>
    </main><footer>Built for the cards you actually play with.</footer>
  </div>
}

function CardTile({ card, actionLabel, onAction }){
  return <article className="card-tile"><div className="card-image-wrap"><img src={cardImage(card)} alt={`${card.name} card art`} /><span className={`rarity-dot ${card.rarity}`}></span></div><div className="card-tile-body"><div><h3>{card.name}</h3><p>{card.type_line}</p></div><button onClick={onAction}>{actionLabel}</button></div></article>
}

export default App
