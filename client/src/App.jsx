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

function normalizeWishlist(cards){
  return cards.reduce((items, card) => items.some(item => item.id === card.id) ? items : [...items, card], [])
}

function App(){
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [totalResults, setTotalResults] = useState(0)
  const [nextPage, setNextPage] = useState('')
  const [collection, setCollection] = useState([])
  const [wishlist, setWishlist] = useState([])
  const [collectionQuery, setCollectionQuery] = useState('')
  const [wishlistQuery, setWishlistQuery] = useState('')
  const [dragTarget, setDragTarget] = useState('')
  const [collectionState, setCollectionState] = useState('loading')
  const [collectionError, setCollectionError] = useState('')
  const [searchState, setSearchState] = useState('idle')
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [sortBy, setSortBy] = useState('name')
  const [filters, setFilters] = useState({ colors: [], types: [], rarity: '', manaMin: '', manaMax: '', oracle: '', set: '', format: '' })

  function buildSearchQuery(){
    let searchQuery = query.trim()
    const parts = []
    if(filters.colors.length > 0) parts.push(`c:${filters.colors.join('')}`)
    if(filters.types.length > 0) parts.push(filters.types.map(type => `t:${type}`).join(' '))
    if(filters.rarity) parts.push(`r:${filters.rarity}`)
    if(filters.manaMin) parts.push(`mv>=${filters.manaMin}`)
    if(filters.manaMax) parts.push(`mv<=${filters.manaMax}`)
    if(filters.oracle.trim()) parts.push(`o:"${filters.oracle.trim()}"`)
    if(filters.set.trim()) parts.push(`set:${filters.set.trim()}`)
    if(filters.format) parts.push(`f:${filters.format}`)
    if(parts.length > 0) searchQuery = (searchQuery ? `${searchQuery} ` : '') + parts.join(' ')
    return searchQuery
  }

  useEffect(() => {
    const finalQuery = buildSearchQuery()
    if(!finalQuery) {
      setResults([])
      setTotalResults(0)
      setNextPage('')
      setSearchError('')
      setSearchState('idle')
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(async () => {
      setSearchState('loading')
      setSearchError('')
      try {
        const res = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(finalQuery)}`, { signal: controller.signal })
        const json = await res.json()
        if(!res.ok) throw new Error(json.details || 'Scryfall could not complete that search.')
        setResults(json.data || [])
        setTotalResults(json.total_cards || json.data?.length || 0)
        setNextPage(json.next_page || '')
        setSearchState('success')
      } catch(error) {
        if(error.name === 'AbortError') return
        setResults([])
        setTotalResults(0)
        setSearchError(error.message || 'Search failed. Please try again.')
        setSearchState('error')
      }
    }, 400)

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [query, filters])

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
      setNextPage(json.next_page || '')
      setSearchState('success')
    } catch(error) {
      setResults([])
      setTotalResults(0)
      setSearchError(error.message || 'Search failed. Please try again.')
      setSearchState('error')
    }
  }

  async function loadMore(){
    if(!nextPage || isLoadingMore) return
    setIsLoadingMore(true)
    setSearchError('')
    try {
      const res = await fetch(nextPage)
      const json = await res.json()
      if(!res.ok) throw new Error(json.details || 'Scryfall could not load more cards.')
      setResults(previous => [...previous, ...(json.data || [])])
      setNextPage(json.next_page || '')
    } catch(error) {
      setSearchError(error.message || 'Could not load more cards.')
    } finally {
      setIsLoadingMore(false)
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

  function updateWishlist(nextWishlist){
    setWishlist(nextWishlist)
    localStorage.setItem('mtg-wishlist', JSON.stringify(nextWishlist))
  }

  async function toggleWishlist(card){
    const alreadySaved = wishlist.some(item => item.id === card.id)
    const nextWishlist = alreadySaved ? wishlist.filter(item => item.id !== card.id) : [...wishlist, card]
    updateWishlist(nextWishlist)
    try {
      const response = await fetch(`${API_BASE}/api/wishlist${alreadySaved ? `/${card.id}` : ''}`, {
        method: alreadySaved ? 'DELETE' : 'POST',
        headers: alreadySaved ? undefined : { 'Content-Type': 'application/json' },
        body: alreadySaved ? undefined : JSON.stringify({ card })
      })
      if(!response.ok) throw new Error('The wishlist server rejected that change.')
      setCollectionError('')
    } catch(error) {
      setCollectionError(`${error.message} Your local wishlist is still available.`)
    }
  }

  async function add(card){
    const existing = collection.find(item => item.id === card.id)
    const nextCollection = existing
      ? collection.map(item => item.id === card.id ? { ...item, quantity: item.quantity + 1 } : item)
      : [...collection, { ...card, quantity: 1 }]
    updateCollection(nextCollection)
    if(wishlist.some(item => item.id === card.id)) await toggleWishlist(card)
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

  function matchesLocalQuery(card, localQuery){
    const terms = localQuery.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if(terms.length === 0) return true
    const searchableText = [card.name, card.type_line, card.oracle_text, card.set_name, card.rarity].filter(Boolean).join(' ').toLowerCase()
    return terms.every(term => searchableText.includes(term))
  }

  function startDrag(event, card, source){
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/json', JSON.stringify({ card, source }))
  }

  function endDrag(){
    setDragTarget('')
  }

  async function dropCard(event, target){
    event.preventDefault()
    setDragTarget('')
    try {
      const payload = JSON.parse(event.dataTransfer.getData('application/json'))
      if(!payload.card || payload.source === target) return
      if(target === 'search') {
        setQuery(payload.card.name)
        return
      }
      if(target === 'collection') await add(payload.card)
      if(target === 'wishlist' && payload.source === 'collection') {
        await toggleWishlist(payload.card)
        await changeQuantity(payload.card.id, -1)
      } else if(target === 'wishlist') {
        await toggleWishlist(payload.card)
      }
    } catch(error) {
      setCollectionError('That card could not be moved. Please try again.')
    }
  }

  function allowDrop(event, target){
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDragTarget(target)
  }

  useEffect(() => {
    const raw = localStorage.getItem('mtg-collection')
    const localCollection = (() => {
      try { return normalizeCollection(raw ? JSON.parse(raw) : []) } catch { return [] }
    })()
    const rawWishlist = localStorage.getItem('mtg-wishlist')
    const localWishlist = (() => {
      try { return normalizeWishlist(rawWishlist ? JSON.parse(rawWishlist) : []) } catch { return [] }
    })()
    Promise.all([fetch(`${API_BASE}/api/collection`), fetch(`${API_BASE}/api/wishlist`)]).then(async ([collectionResponse, wishlistResponse]) => {
        if(!collectionResponse.ok || !wishlistResponse.ok) throw new Error('The collection server is unavailable.')
        const [cards, savedWishlist] = await Promise.all([collectionResponse.json(), wishlistResponse.json()])
        const normalizedWishlist = normalizeWishlist(savedWishlist)
        setWishlist(normalizedWishlist)
        localStorage.setItem('mtg-wishlist', JSON.stringify(normalizedWishlist))
        return cards
      }).then(cards => {
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
        setWishlist(localWishlist)
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
  const visibleCollection = sortedCollection.filter(card => matchesLocalQuery(card, collectionQuery))
  const visibleWishlist = wishlist.filter(card => matchesLocalQuery(card, wishlistQuery))

  return <div className="app">
    <header className="hero"><div><p className="eyebrow">CARD LIBRARY / 01</p><h1>Keep your cardboard <em>close.</em></h1><p className="hero-copy">Search the multiverse, save what you own, and see your collection take shape.</p></div><div className="hero-mark" aria-hidden="true">✦</div></header>
    <section className="stats" aria-label="Collection summary"><div><strong>{totalCards}</strong><span>cards owned</span></div><div><strong>{collection.length}</strong><span>unique cards</span></div><div><strong>{wishlist.length}</strong><span>wishlist cards</span></div><div><strong>{colorsInCollection.length || '—'}</strong><span>colors represented</span></div></section>
    <main>
      <section className="search-panel"><div className="section-heading"><div><p className="eyebrow">DISCOVER</p><h2>Find your next card</h2></div><span className="api-note">Powered by Scryfall · updates as you type</span></div><form className="search" onSubmit={search}><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Try “lightning bolt” or “legendary elf”" aria-label="Search cards" /><button type="submit" disabled={searchState === 'loading'}>{searchState === 'loading' ? 'Searching…' : 'Search now'}</button></form><div className="filters"><div className="filter-group"><label>Colors</label><div className="color-buttons">{['W', 'U', 'B', 'R', 'G'].map(color => <button type="button" key={color} className={`color-btn ${colorClasses[color]} ${filters.colors.includes(color) ? 'active' : ''}`} onClick={() => toggleColor(color)} title={colorNames[color]} aria-pressed={filters.colors.includes(color)}>{color}</button>)}</div></div><div className="filter-group type-filter"><label>Card type</label><div className="type-buttons">{['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land'].map(type => <button type="button" key={type} className={`type-btn ${filters.types.includes(type) ? 'active' : ''}`} onClick={() => toggleType(type)} aria-pressed={filters.types.includes(type)}>{type}</button>)}</div></div><div className="compact-filters"><label>Rarity<select value={filters.rarity} onChange={e => setFilters(prev => ({...prev, rarity: e.target.value}))}><option value="">Any rarity</option><option value="common">Common</option><option value="uncommon">Uncommon</option><option value="rare">Rare</option><option value="mythic">Mythic</option></select></label><label>Min mana<input type="number" min="0" max="20" value={filters.manaMin} onChange={e => setFilters(prev => ({...prev, manaMin: e.target.value}))} placeholder="Any" /></label><label>Max mana<input type="number" min="0" max="20" value={filters.manaMax} onChange={e => setFilters(prev => ({...prev, manaMax: e.target.value}))} placeholder="Any" /></label></div><div className="advanced-filters"><label>Oracle text<input value={filters.oracle} onChange={e => setFilters(prev => ({...prev, oracle: e.target.value}))} placeholder="draw a card" /></label><label>Set code<input value={filters.set} onChange={e => setFilters(prev => ({...prev, set: e.target.value}))} placeholder="set code" maxLength="5" /></label><label>Format<select value={filters.format} onChange={e => setFilters(prev => ({...prev, format: e.target.value}))}><option value="">Any format</option><option value="commander">Commander</option><option value="standard">Standard</option><option value="modern">Modern</option><option value="pioneer">Pioneer</option><option value="pauper">Pauper</option><option value="legacy">Legacy</option></select></label></div></div></section>
      <section className={`results drop-zone ${dragTarget === 'search' ? 'drag-target' : ''}`} onDragOver={event => allowDrop(event, 'search')} onDragLeave={() => setDragTarget('')} onDrop={event => dropCard(event, 'search')}><div className="section-heading"><div><p className="eyebrow">SEARCH RESULTS</p><h2>{searchState === 'success' ? `${totalResults.toLocaleString()} cards found` : 'A whole multiverse'}</h2></div><span className="drag-hint">Drag cards to your binder or wishlist</span></div>{searchState === 'idle' && <div className="empty-state"><span>✦</span><p>Search for a card to begin exploring.</p></div>}{searchState === 'error' && <div className="message error-message">{searchError}</div>}{searchState === 'success' && results.length === 0 && <div className="empty-state"><span>⌁</span><p>No cards matched those filters. Try a broader search.</p></div>}<div className="card-grid">{results.map(card => <CardTile key={card.id} card={card} actionLabel="Add to collection" onAction={() => add(card)} wishlistActive={wishlist.some(item => item.id === card.id)} onWishlist={() => toggleWishlist(card)} onDragStart={event => startDrag(event, card, 'search')} onDragEnd={endDrag} />)}</div>{searchError && searchState === 'success' && <div className="message error-message">{searchError}</div>}{nextPage && <button className="load-more" type="button" onClick={loadMore} disabled={isLoadingMore}>{isLoadingMore ? 'Loading more cards…' : `Load more cards (${results.length} of ${totalResults.toLocaleString()})`}</button>}</section>
      <section className={`collection drop-zone ${dragTarget === 'collection' ? 'drag-target' : ''}`} onDragOver={event => allowDrop(event, 'collection')} onDragLeave={() => setDragTarget('')} onDrop={event => dropCard(event, 'collection')}><div className="section-heading collection-heading"><div><p className="eyebrow">YOUR BINDER</p><h2>My collection <span>{totalCards}</span></h2></div><label className="sort-control">Sort by<select value={sortBy} onChange={e => setSortBy(e.target.value)}><option value="name">Name</option><option value="quantity">Quantity</option><option value="rarity">Rarity</option></select></label></div><input className="local-search" value={collectionQuery} onChange={event => setCollectionQuery(event.target.value)} placeholder="Search your collection" aria-label="Search your collection" />{collectionState === 'loading' && <div className="message">Loading your saved collection…</div>}{collectionError && <div className="message error-message">{collectionError}</div>}{collection.length === 0 && collectionState !== 'loading' && <div className="empty-state collection-empty"><span>＋</span><p>Your collection is waiting for its first card.</p></div>}{collection.length > 0 && visibleCollection.length === 0 && <div className="empty-state"><p>No owned cards match that search.</p></div>}<div className="collection-list">{visibleCollection.map(card => <article key={card.id} className="collection-card" draggable onDragStart={event => startDrag(event, card, 'collection')} onDragEnd={endDrag}><img src={cardImage(card)} alt="" /><div className="collection-card-info"><strong>{card.name}</strong><span>{card.set_name || card.set?.toUpperCase()} · {card.rarity}</span></div><div className="quantity" aria-label={`${card.quantity} copies of ${card.name}`}><button onClick={() => changeQuantity(card.id, -1)} aria-label={`Remove one ${card.name}`}>−</button><strong>{card.quantity}</strong><button onClick={() => changeQuantity(card.id, 1)} aria-label={`Add one ${card.name}`}>＋</button></div></article>)}</div></section>
      <section className={`wishlist drop-zone ${dragTarget === 'wishlist' ? 'drag-target' : ''}`} onDragOver={event => allowDrop(event, 'wishlist')} onDragLeave={() => setDragTarget('')} onDrop={event => dropCard(event, 'wishlist')}><div className="section-heading"><div><p className="eyebrow">WANTED LIST</p><h2>Wishlist <span>{wishlist.length}</span></h2></div><p className="wishlist-note">Save cards to remember what to trade for next.</p></div><input className="local-search" value={wishlistQuery} onChange={event => setWishlistQuery(event.target.value)} placeholder="Search your wishlist" aria-label="Search your wishlist" />{wishlist.length === 0 ? <div className="empty-state"><span>☆</span><p>Nothing here yet. Tap the star on a search result.</p></div> : visibleWishlist.length === 0 ? <div className="empty-state"><p>No wanted cards match that search.</p></div> : <div className="wishlist-list">{visibleWishlist.map(card => <article key={card.id} className="wishlist-card" draggable onDragStart={event => startDrag(event, card, 'wishlist')} onDragEnd={endDrag}><img src={cardImage(card)} alt="" /><div><strong>{card.name}</strong><span>{card.set_name || card.set?.toUpperCase()} · {card.rarity}</span></div><button type="button" onClick={() => toggleWishlist(card)} aria-label={`Remove ${card.name} from wishlist`}>Remove</button></article>)}</div>}</section>
    </main><footer>Built for the cards you actually play with.</footer>
  </div>
}

function CardTile({ card, actionLabel, onAction, wishlistActive, onWishlist, onDragStart, onDragEnd }){
  return <article className="card-tile" draggable onDragStart={onDragStart} onDragEnd={onDragEnd}><div className="card-image-wrap"><img src={cardImage(card)} alt={`${card.name} card art`} /><span className={`rarity-dot ${card.rarity}`}></span><button className={`wishlist-button ${wishlistActive ? 'active' : ''}`} type="button" onClick={onWishlist} aria-label={`${wishlistActive ? 'Remove' : 'Add'} ${card.name} ${wishlistActive ? 'from' : 'to'} wishlist`} aria-pressed={wishlistActive}>☆</button></div><div className="card-tile-body"><div><h3>{card.name}</h3><p>{card.type_line}</p></div><div className="card-actions"><button onClick={onAction}>{actionLabel}</button><button className="wishlist-action" type="button" onClick={onWishlist}>{wishlistActive ? 'Wishlisted' : 'Add to wishlist'}</button></div></div></article>
}

export default App
