import React, { useEffect, useMemo, useState } from "react";

const colorNames = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
const colorClasses = {
  W: "white",
  U: "blue",
  B: "black",
  R: "red",
  G: "green",
};
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";

function cardImage(card) {
  return (
    card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || ""
  );
}

function normalizeCollection(cards) {
  return cards.reduce((items, card) => {
    const existing = items.find((item) => item.id === card.id);
    if (existing) existing.quantity += Number(card.quantity) || 1;
    else items.push({ ...card, quantity: Number(card.quantity) || 1 });
    return items;
  }, []);
}

function normalizeWishlist(cards) {
  return cards.reduce(
    (items, card) =>
      items.some((item) => item.id === card.id)
        ? items
        : [...items, { ...card, quantity: Number(card.quantity) || 1 }],
    [],
  );
}

function cardPrice(card) {
  const price = card.foil ? card.prices?.usd_foil : card.prices?.usd;
  return price ? Number(price) : null;
}

function parseCsv(text) {
  const sanitized = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [],
    value = "",
    quoted = false;
  for (let index = 0; index < sanitized.length; index += 1) {
    const character = sanitized[index];
    if (character === '"' && sanitized[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && sanitized[index + 1] === "\n") index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else value += character;
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) =>
    header.toLowerCase().replace(/[^a-z0-9]+/g, ""),
  );
  return rows
    .slice(1)
    .map((values) =>
      headers.reduce(
        (record, header, index) => ({
          ...record,
          [header]: values[index] ?? "",
        }),
        {},
      ),
    );
}

function normalizeImportValue(value) {
  return String(value ?? "")
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/\s+/g, " ");
}

function normalizeCardName(value) {
  return normalizeImportValue(value).toLowerCase().replace(/['’]/g, "");
}

function printingLabel(card) {
  const set = card.set_name || card.set?.toUpperCase() || "Unknown set";
  return `${set} (${String(card.set || "").toUpperCase()})${card.released_at ? ` · ${card.released_at}` : ""}`;
}

function groupCollectionByName(cards) {
  return cards.reduce((groups, card) => {
    const key = normalizeCardName(card.name);
    const group = groups.find((item) => item.groupKey === key);
    if (group) group.quantity += card.quantity;
    else groups.push({ ...card, groupKey: key, printingIds: [card.id] });
    if (group) group.printingIds.push(card.id);
    return groups;
  }, []);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithBackoff(url, options = {}, maxRetries = 10) {
  let attempt = 0;
  while (true) {
    const response = await fetch(url, options);
    if (
      (response.status === 429 ||
        (response.status >= 500 && response.status < 600)) &&
      attempt < maxRetries
    ) {
      const retryAfterHeader = Number(
        response.headers.get("retry-after") || "0",
      );
      const baseDelay =
        retryAfterHeader > 0 ? retryAfterHeader * 1000 : 750 * 2 ** attempt;
      const jitter = Math.random() * 500;
      const delay = baseDelay + jitter;
      await sleep(delay);
      attempt += 1;
      continue;
    }
    return response;
  }
}

function App() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [totalResults, setTotalResults] = useState(0);
  const [nextPage, setNextPage] = useState("");
  const [collection, setCollection] = useState([]);
  const [wishlist, setWishlist] = useState([]);
  const [collectionQuery, setCollectionQuery] = useState("");
  const [wishlistQuery, setWishlistQuery] = useState("");
  const [dragTarget, setDragTarget] = useState("");
  const [editing, setEditing] = useState(null);
  const [printingPicker, setPrintingPicker] = useState(null);
  const [decks, setDecks] = useState([]);
  const [activeDeckId, setActiveDeckId] = useState("");
  const [deckName, setDeckName] = useState("");
  const [deckFormat, setDeckFormat] = useState("commander");
  const [importState, setImportState] = useState("");
  const [assistantResults, setAssistantResults] = useState([]);
  const [assistantSource, setAssistantSource] = useState("");
  const [collectionState, setCollectionState] = useState("loading");
  const [collectionError, setCollectionError] = useState("");
  const [searchState, setSearchState] = useState("idle");
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [groupPrintings, setGroupPrintings] = useState(false);
  const [activeView, setActiveView] = useState("collection");
  const [deckMode, setDeckMode] = useState("all");
  const [deckQuery, setDeckQuery] = useState("");
  const [deckResults, setDeckResults] = useState([]);
  const [deckSearchState, setDeckSearchState] = useState("idle");
  const [deckSearchError, setDeckSearchError] = useState("");
  const [deckNextPage, setDeckNextPage] = useState("");
  const [isLoadingMoreDeck, setIsLoadingMoreDeck] = useState(false);
  const [filters, setFilters] = useState({
    colors: [],
    types: [],
    rarity: "",
    manaMin: "",
    manaMax: "",
    oracle: "",
    set: "",
    format: "",
  });

  const initialFilters = {
    colors: [],
    types: [],
    rarity: "",
    manaMin: "",
    manaMax: "",
    oracle: "",
    set: "",
    format: "",
  };
  const [deckFilters, setDeckFilters] = useState(initialFilters);

  function buildSearchQuery(searchText = query, searchFilters = filters) {
    let searchQuery = searchText.trim();
    const parts = [];
    if (searchFilters.colors.length > 0) parts.push(`c:${searchFilters.colors.join("")}`);
    if (searchFilters.types.length > 0)
      parts.push(searchFilters.types.map((type) => `t:${type}`).join(" "));
    if (searchFilters.rarity) parts.push(`r:${searchFilters.rarity}`);
    if (searchFilters.manaMin) parts.push(`mv>=${searchFilters.manaMin}`);
    if (searchFilters.manaMax) parts.push(`mv<=${searchFilters.manaMax}`);
    if (searchFilters.oracle.trim()) parts.push(`o:"${searchFilters.oracle.trim()}"`);
    if (searchFilters.set.trim()) parts.push(`set:${searchFilters.set.trim()}`);
    if (searchFilters.format) parts.push(`f:${searchFilters.format}`);
    if (parts.length > 0)
      searchQuery = (searchQuery ? `${searchQuery} ` : "") + parts.join(" ");
    return searchQuery;
  }

  useEffect(() => {
    const finalQuery = buildSearchQuery();
    if (!finalQuery) {
      setResults([]);
      setTotalResults(0);
      setNextPage("");
      setSearchError("");
      setSearchState("idle");
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setSearchState("loading");
      setSearchError("");
      try {
        const res = await fetch(
          `https://api.scryfall.com/cards/search?q=${encodeURIComponent(finalQuery)}`,
          { signal: controller.signal },
        );
        const json = await res.json();
        if (!res.ok)
          throw new Error(
            json.details || "Scryfall could not complete that search.",
          );
        setResults(json.data || []);
        setTotalResults(json.total_cards || json.data?.length || 0);
        setNextPage(json.next_page || "");
        setSearchState("success");
      } catch (error) {
        if (error.name === "AbortError") return;
        setResults([]);
        setTotalResults(0);
        setSearchError(error.message || "Search failed. Please try again.");
        setSearchState("error");
      }
    }, 400);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query, filters]);

  async function search(event) {
    event?.preventDefault();
    const finalQuery = buildSearchQuery();
    if (!finalQuery) return;
    setSearchState("loading");
    setSearchError("");
    try {
      const res = await fetch(
        `https://api.scryfall.com/cards/search?q=${encodeURIComponent(finalQuery)}`,
      );
      const json = await res.json();
      if (!res.ok)
        throw new Error(
          json.details || "Scryfall could not complete that search.",
        );
      setResults(json.data || []);
      setTotalResults(json.total_cards || json.data?.length || 0);
      setNextPage(json.next_page || "");
      setSearchState("success");
    } catch (error) {
      setResults([]);
      setTotalResults(0);
      setSearchError(error.message || "Search failed. Please try again.");
      setSearchState("error");
    }
  }

  async function loadMore() {
    if (!nextPage || isLoadingMore) return;
    setIsLoadingMore(true);
    setSearchError("");
    try {
      const res = await fetch(nextPage);
      const json = await res.json();
      if (!res.ok)
        throw new Error(json.details || "Scryfall could not load more cards.");
      setResults((previous) => [...previous, ...(json.data || [])]);
      setNextPage(json.next_page || "");
    } catch (error) {
      setSearchError(error.message || "Could not load more cards.");
    } finally {
      setIsLoadingMore(false);
    }
  }

  function toggleColor(color) {
    setFilters((prev) => ({
      ...prev,
      colors: prev.colors.includes(color)
        ? prev.colors.filter((item) => item !== color)
        : [...prev.colors, color],
    }));
  }

  function toggleType(type) {
    setFilters((prev) => ({
      ...prev,
      types: prev.types.includes(type)
        ? prev.types.filter((item) => item !== type)
        : [...prev.types, type],
    }));
  }

  function updateCollection(nextCollection) {
    setCollection(nextCollection);
    localStorage.setItem("mtg-collection", JSON.stringify(nextCollection));
  }

  function updateWishlist(nextWishlist) {
    setWishlist(nextWishlist);
    localStorage.setItem("mtg-wishlist", JSON.stringify(nextWishlist));
  }

  async function toggleWishlist(card) {
    const alreadySaved = wishlist.some((item) => item.id === card.id);
    const wishlistCard = { ...card, quantity: Number(card.quantity) || 1 };
    const nextWishlist = alreadySaved
      ? wishlist.filter((item) => item.id !== card.id)
      : [...wishlist, wishlistCard];
    updateWishlist(nextWishlist);
    try {
      const response = await fetch(
        `${API_BASE}/api/wishlist${alreadySaved ? `/${card.id}` : ""}`,
        {
          method: alreadySaved ? "DELETE" : "POST",
          headers: alreadySaved
            ? undefined
            : { "Content-Type": "application/json" },
          body: alreadySaved ? undefined : JSON.stringify({ card }),
        },
      );
      if (!response.ok)
        throw new Error("The wishlist server rejected that change.");
      setCollectionError("");
    } catch (error) {
      setCollectionError(
        `${error.message} Your local wishlist is still available.`,
      );
    }
  }

  async function saveCard(card, quantity = 1) {
    const existing = collection.find((item) => item.id === card.id);
    const nextCollection = existing
      ? collection.map((item) =>
          item.id === card.id
            ? { ...item, quantity: item.quantity + quantity }
            : item,
        )
      : [...collection, { ...card, quantity }];
    updateCollection(nextCollection);
    if (wishlist.some((item) => item.id === card.id))
      await toggleWishlist(card);
    try {
      const response = await fetch(
        `${API_BASE}/api/collection${existing ? `/${card.id}` : ""}`,
        {
          method: existing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            existing
              ? { quantity: existing.quantity + quantity }
              : { card, quantity },
          ),
        },
      );
      if (!response.ok)
        throw new Error("The collection server rejected this card.");
      setCollectionError("");
      setCollectionState("ready");
    } catch (error) {
      setCollectionError(
        `${error.message} Your local copy is still available.`,
      );
    }
  }

  async function fetchPrintings(card) {
    const query = card.oracle_id
      ? `oracle_id:${card.oracle_id}`
      : `!"${String(card.name || "").replace(/"/g, '\\"')}"`;
    const params = new URLSearchParams({
      q: query,
      unique: "prints",
      order: "released",
      dir: "desc",
    });
    const response = await fetch(
      `https://api.scryfall.com/cards/search?${params}`,
    );
    const json = await response.json();
    if (!response.ok)
      throw new Error(json.details || "Could not load card printings.");
    return json.data || [];
  }

  async function openAddPrinting(card) {
    setPrintingPicker({
      card,
      printings: [],
      selectedId: card.id,
      loading: true,
      error: "",
    });
    try {
      const printings = await fetchPrintings(card);
      setPrintingPicker((previous) =>
        previous
          ? {
              ...previous,
              card: printings[0] || card,
              printings,
              selectedId: (printings[0] || card).id,
              loading: false,
            }
          : null,
      );
    } catch (error) {
      setPrintingPicker((previous) =>
        previous ? { ...previous, loading: false, error: error.message } : null,
      );
    }
  }

  function add(card) {
    openAddPrinting(card);
  }

  async function saveDeck(nextDeck) {
    setDecks((previous) =>
      previous.some((deck) => deck.id === nextDeck.id)
        ? previous.map((deck) => (deck.id === nextDeck.id ? nextDeck : deck))
        : [...previous, nextDeck],
    );
    localStorage.setItem(
      "mtg-decks",
      JSON.stringify(
        decks.some((deck) => deck.id === nextDeck.id)
          ? decks.map((deck) => (deck.id === nextDeck.id ? nextDeck : deck))
          : [...decks, nextDeck],
      ),
    );
    const exists = decks.some((deck) => deck.id === nextDeck.id);
    await fetch(`${API_BASE}/api/decks${exists ? `/${nextDeck.id}` : ""}`, {
      method: exists ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deck: nextDeck }),
    });
  }

  async function createDeck(event) {
    event.preventDefault();
    const name = deckName.trim() || "Untitled deck";
    const deck = {
      id: crypto.randomUUID(),
      name,
      format: deckFormat,
      commander: null,
      cards: [],
    };
    await saveDeck(deck);
    setActiveDeckId(deck.id);
    setDeckName("");
  }

  async function deleteDeck(deckId) {
    if (!window.confirm("Delete this deck? This cannot be undone.")) return;
    try {
      const response = await fetch(`${API_BASE}/api/decks/${deckId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("The deck could not be deleted.");
      const nextDecks = decks.filter((deck) => deck.id !== deckId);
      setDecks(nextDecks);
      localStorage.setItem("mtg-decks", JSON.stringify(nextDecks));
      if (activeDeckId === deckId) setActiveDeckId(nextDecks[0]?.id || "");
    } catch (error) {
      setCollectionError(error.message || "The deck could not be deleted.");
    }
  }

  async function addToDeck(card) {
    if (!activeDeckId) return;
    const deck = decks.find((item) => item.id === activeDeckId);
    if (!deck) return;
    const cards = deck.cards.some((item) => item.card.id === card.id)
      ? deck.cards.map((item) =>
          item.card.id === card.id
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        )
      : [...deck.cards, { card, quantity: 1 }];
    await saveDeck({ ...deck, cards });
  }

  async function changeDeckQuantity(cardId, amount) {
    if (!activeDeck) return;
    const cards = activeDeck.cards
      .map((item) => item.card.id === cardId ? { ...item, quantity: item.quantity + amount } : item)
      .filter((item) => item.quantity > 0);
    await saveDeck({ ...activeDeck, cards });
  }

  async function searchDeckCards(event) {
    event?.preventDefault();
    const searchQuery = buildSearchQuery(deckQuery, deckFilters);
    if (!searchQuery) return;
    setDeckSearchState("loading");
    setDeckSearchError("");
    if (deckMode === "collection") {
      setDeckResults(collection.filter((card) => matchesDeckFilters(card, deckQuery, deckFilters)));
      setDeckNextPage("");
      setDeckSearchState("success");
      return;
    }
    try {
      const response = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(searchQuery)}`);
      const json = await response.json();
      if (!response.ok) throw new Error(json.details || "Scryfall could not complete that search.");
      setDeckResults(json.data || []);
      setDeckNextPage(json.next_page || "");
      setDeckSearchState("success");
    } catch (error) {
      setDeckResults([]);
      setDeckSearchError(error.message || "Deck search failed.");
      setDeckSearchState("error");
    }
  }

  async function loadMoreDeckCards() {
    if (!deckNextPage || isLoadingMoreDeck) return;
    setIsLoadingMoreDeck(true);
    try {
      const response = await fetch(deckNextPage);
      const json = await response.json();
      if (!response.ok) throw new Error(json.details || "Could not load more deck cards.");
      setDeckResults((previous) => [...previous, ...(json.data || [])]);
      setDeckNextPage(json.next_page || "");
    } catch (error) {
      setDeckSearchError(error.message || "Could not load more deck cards.");
    } finally {
      setIsLoadingMoreDeck(false);
    }
  }

  useEffect(() => {
    if (activeView !== "deck-builder") return;
    const searchQuery = buildSearchQuery(deckQuery, deckFilters);
    if (!searchQuery) {
      setDeckResults([]);
      setDeckNextPage("");
      setDeckSearchError("");
      setDeckSearchState("idle");
      return;
    }
    const timeout = setTimeout(() => searchDeckCards(), 400);
    return () => clearTimeout(timeout);
  }, [activeView, deckQuery, deckFilters, deckMode]);

  async function importManaBox(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportState("Reading ManaBox export…");
    const rows = parseCsv(await file.text());
    const validRows = rows.filter((row) =>
      normalizeImportValue(row.name || row.cardname),
    );
    let imported = 0,
      skipped = rows.length - validRows.length;
    const resolvedCards = [];
    const batchSize = 75;

    for (let start = 0; start < validRows.length;) {
      const batch = validRows.slice(start, start + batchSize);
      const identifiers = batch.map((row) => {
        const rowName = normalizeImportValue(row.name || row.cardname);
        const setCode = normalizeImportValue(row.setcode || row.set);
        const collectorNumber = normalizeImportValue(
          row.collectornumber || row.collector_number,
        );
        return setCode && collectorNumber
          ? { set: setCode, collector_number: collectorNumber }
          : { name: rowName };
      });

      let batchSucceeded = false;
      let retryCount = 0;
      let retryDelay = 1500;

      while (!batchSucceeded && retryCount <= 10) {
        try {
          const response = await fetchWithBackoff(
            "https://api.scryfall.com/cards/collection",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ identifiers }),
            },
            10,
          );

          if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(
              payload.details || `Scryfall import failed (${response.status}).`,
            );
          }

          const json = await response.json();
          const found = json.data || [];
          batch.forEach((row, index) => {
            const identifier = identifiers[index];
            const card = identifier.set
              ? found.find(
                  (item) =>
                    normalizeCardName(item.name) ===
                      normalizeCardName(row.name || row.cardname) &&
                    String(item.set || "").toLowerCase() ===
                      String(identifier.set).toLowerCase() &&
                    String(item.collector_number || "").replace(/^0+/, "") ===
                      String(identifier.collector_number).replace(/^0+/, ""),
                )
              : found.find(
                  (item) =>
                    normalizeCardName(item.name) ===
                    normalizeCardName(
                      identifier.name || row.name || row.cardname,
                    ),
                );
            if (card) resolvedCards.push({ card, row });
            else skipped += 1;
          });

          batchSucceeded = true;
        } catch (error) {
          retryCount += 1;
          if (retryCount > 10) {
            console.error("ManaBox import batch failed after retries:", error);
            skipped += batch.length;
            batchSucceeded = true;
            break;
          }
          const retryAfterHeader =
            error?.response?.headers?.get?.("retry-after");
          const retryAfterMs = retryAfterHeader
            ? Number(retryAfterHeader) * 1000
            : retryDelay;
          const jitter = Math.random() * 500;
          setImportState(
            `Scryfall rate limit hit; retrying batch in ${Math.round((retryAfterMs + jitter) / 1000)}s (${retryCount}/6)…`,
          );
          await sleep(retryAfterMs + jitter);
          retryDelay *= 2;
        }
      }

      const currentCount = Math.min(start + batch.length, validRows.length);
      setImportState(`Resolved ${currentCount} of ${validRows.length} rows…`);
      start += batch.length;
      if (start < validRows.length) await sleep(150);
    }

    const importedCards = resolvedCards.map(({ card, row }) => ({
      ...card,
      condition:
        normalizeImportValue(row.condition || row.conditionname || row.cond) ||
        undefined,
      language: normalizeImportValue(row.language || row.lang) || undefined,
      foil:
        /^(true|yes|1|foil)$/i.test(normalizeImportValue(row.foil || row.f)) ||
        normalizeImportValue(row.foil || row.f).toLowerCase() === "foil",
      quantity: Math.max(1, Number(row.quantity) || 1),
    }));
    const nextCollection = normalizeCollection([
      ...collection,
      ...importedCards,
    ]);
    updateCollection(nextCollection);
    for (const item of importedCards) {
      await fetch(`${API_BASE}/api/collection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card: item, quantity: item.quantity }),
      });
      imported += item.quantity;
    }
    setImportState(
      `Import complete: ${imported} cards added, ${skipped} rows skipped.`,
    );
    event.target.value = "";
  }

  async function loadAssistant() {
    const deck = decks.find((item) => item.id === activeDeckId);
    const commander =
      deck?.commander ||
      deck?.cards?.find((item) =>
        item.card.type_line?.includes("Legendary Creature"),
      )?.card;
    if (!commander) {
      setAssistantResults([]);
      return;
    }
    try {
      const slug = commander.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const edhrecResponse = await fetch(
        `https://json.edhrec.com/pages/commanders/${slug}.json`,
      );
      if (edhrecResponse.ok) {
        const edhrec = await edhrecResponse.json();
        const views = (edhrec.container?.json_dict?.cardlists || [])
          .flatMap((list) => list.cardviews || [])
          .slice(0, 8);
        const cards = await Promise.all(
          views.map(async (view) => {
            const response = await fetch(
              `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(view.name)}`,
            );
            return response.ok ? response.json() : null;
          }),
        );
        const recommendations = cards.filter(Boolean);
        if (recommendations.length > 0) {
          setAssistantResults(recommendations);
          setAssistantSource("EDHREC recommendations");
          return;
        }
      }
      const response = await fetch(
        `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`related:${commander.id}`)}`,
      );
      const json = await response.json();
      setAssistantResults((json.data || []).slice(0, 8));
      setAssistantSource("Scryfall related cards");
    } catch {
      setAssistantResults([]);
      setAssistantSource("");
    }
  }

  async function changeQuantity(id, amount) {
    const card = collection.find((item) => item.id === id);
    if (!card) return;
    const nextQuantity = card.quantity + amount;
    const nextCollection = collection
      .map((item) =>
        item.id === id ? { ...item, quantity: nextQuantity } : item,
      )
      .filter((item) => item.quantity > 0);
    updateCollection(nextCollection);
    try {
      const response =
        nextQuantity > 0
          ? await fetch(`${API_BASE}/api/collection/${id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ quantity: nextQuantity }),
            })
          : await fetch(`${API_BASE}/api/collection/${id}`, {
              method: "DELETE",
            });
      if (!response.ok)
        throw new Error(
          "The collection server could not update that quantity.",
        );
      setCollectionError("");
      setCollectionState("ready");
    } catch (error) {
      setCollectionError(
        `${error.message} Your local copy is still available.`,
      );
    }
  }

  function openEditor(card, source) {
    const originalId = card.id;
    const editableCard = {
      ...card,
      quantity: Number(card.quantity) || 1,
      set_name: card.set_name || card.set?.toUpperCase() || "",
      rarity: card.rarity || "",
      condition: card.condition || "Near Mint",
      language: card.language || "English",
      foil: Boolean(card.foil),
      notes: card.notes || "",
    };
      setEditing((prev) => ({
        ...prev,
        source,
        originalId,
        card: editableCard,
        selectedId: card.id,
        printings: [],
        printingsLoading: true,
        printingsError: "",
      }));
    fetchPrintings(card)
      .then((printings) =>
        setEditing((previous) =>
          previous ? { ...previous, printings, printingsLoading: false } : null,
        ),
      )
      .catch((error) =>
        setEditing((previous) =>
          previous
            ? {
                ...previous,
                printingsLoading: false,
                printingsError: error.message,
              }
            : null,
        ),
      );
  }

  async function saveEdit(event) {
    event.preventDefault();
    if (!editing) return;
    const quantity = Math.max(1, Number(editing.card.quantity) || 1);
    const card = { ...editing.card, quantity };
    if (editing.source === "collection")
      updateCollection(
        collection.map((item) =>
          item.id === editing.originalId ? card : item,
        ),
      );
    else
      updateWishlist(
        wishlist.map((item) => (item.id === editing.originalId ? card : item)),
      );
    try {
      const response = await fetch(
        `${API_BASE}/api/${editing.source}/${editing.originalId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quantity, card }),
        },
      );
      if (!response.ok) throw new Error("The card details could not be saved.");
      const savedCard = await response.json();
      if (editing.source === "collection") {
        const nextCollection = collection
          .filter((item) => item.id !== editing.originalId && item.id !== savedCard.id)
          .concat(savedCard);
        updateCollection(nextCollection);
      } else {
        updateWishlist(
          wishlist
            .filter((item) => item.id !== editing.originalId && item.id !== savedCard.id)
            .concat(savedCard),
        );
      }
      setEditing(null);
      setCollectionError("");
    } catch (error) {
      setCollectionError(
        `${error.message} Your local changes are still visible.`,
      );
    }
  }

  function selectPrinting(stateKey, id) {
    const state = stateKey === "editing" ? editing : printingPicker;
    const selected = state?.printings.find((printing) => printing.id === id);
    if (!selected) return;
    if (stateKey === "editing")
      setEditing((previous) => ({
        ...previous,
        card: {
          ...previous.card,
          ...selected,
          quantity: previous.card.quantity,
          condition: previous.card.condition,
          language: previous.card.language,
          notes: previous.card.notes,
        },
        selectedId: id,
      }));
    else
      setPrintingPicker((previous) => ({
        ...previous,
        card: { ...selected, quantity: 1 },
        selectedId: id,
      }));
  }

  function matchesLocalQuery(card, localQuery) {
    const terms = localQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return true;
    const searchableText = [
      card.name,
      card.type_line,
      card.oracle_text,
      card.set_name,
      card.rarity,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return terms.every((term) => searchableText.includes(term));
  }

  function matchesDeckFilters(card, localQuery, searchFilters) {
    if (!matchesLocalQuery(card, localQuery)) return false;
    if (searchFilters.colors.length > 0 && !searchFilters.colors.every((color) => (card.colors || []).includes(color))) return false;
    if (searchFilters.types.length > 0 && !searchFilters.types.every((type) => card.type_line?.toLowerCase().includes(type.toLowerCase()))) return false;
    if (searchFilters.rarity && card.rarity !== searchFilters.rarity) return false;
    const manaValue = Number(card.mana_value ?? card.cmc);
    if (searchFilters.manaMin && (Number.isNaN(manaValue) || manaValue < Number(searchFilters.manaMin))) return false;
    if (searchFilters.manaMax && (Number.isNaN(manaValue) || manaValue > Number(searchFilters.manaMax))) return false;
    if (searchFilters.oracle.trim() && !card.oracle_text?.toLowerCase().includes(searchFilters.oracle.trim().toLowerCase())) return false;
    if (searchFilters.set.trim()) {
      const setQuery = searchFilters.set.trim().toLowerCase();
      if (!card.set?.toLowerCase().includes(setQuery) && !card.set_name?.toLowerCase().includes(setQuery)) return false;
    }
    if (searchFilters.format && card.legalities?.[searchFilters.format] !== "legal") return false;
    return true;
  }

  function startDrag(event, card, source) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(
      "application/json",
      JSON.stringify({ card, source }),
    );
  }

  function endDrag() {
    setDragTarget("");
  }

  async function dropCard(event, target) {
    event.preventDefault();
    setDragTarget("");
    try {
      const payload = JSON.parse(
        event.dataTransfer.getData("application/json"),
      );
      if (!payload.card || payload.source === target) return;
      if (target === "search") {
        setQuery(payload.card.name);
        return;
      }
      if (target === "collection") await add(payload.card);
      if (target === "wishlist" && payload.source === "collection") {
        await toggleWishlist({ ...payload.card, quantity: 1 });
        await changeQuantity(payload.card.id, -1);
      } else if (target === "wishlist") {
        await toggleWishlist(payload.card);
      }
    } catch (error) {
      setCollectionError("That card could not be moved. Please try again.");
    }
  }

  function allowDrop(event, target) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragTarget(target);
  }

  useEffect(() => {
    const raw = localStorage.getItem("mtg-collection");
    const localCollection = (() => {
      try {
        return normalizeCollection(raw ? JSON.parse(raw) : []);
      } catch {
        return [];
      }
    })();
    const rawWishlist = localStorage.getItem("mtg-wishlist");
    const localWishlist = (() => {
      try {
        return normalizeWishlist(rawWishlist ? JSON.parse(rawWishlist) : []);
      } catch {
        return [];
      }
    })();
    Promise.all([
      fetch(`${API_BASE}/api/collection`),
      fetch(`${API_BASE}/api/wishlist`),
    ])
      .then(async ([collectionResponse, wishlistResponse]) => {
        if (!collectionResponse.ok || !wishlistResponse.ok)
          throw new Error("The collection server is unavailable.");
        const [cards, savedWishlist] = await Promise.all([
          collectionResponse.json(),
          wishlistResponse.json(),
        ]);
        const normalizedWishlist = normalizeWishlist(savedWishlist);
        setWishlist(normalizedWishlist);
        localStorage.setItem(
          "mtg-wishlist",
          JSON.stringify(normalizedWishlist),
        );
        return cards;
      })
      .then((cards) => {
        const savedCollection = normalizeCollection(cards);
        if (savedCollection.length === 0 && localCollection.length > 0) {
          return Promise.all(
            localCollection.map((card) =>
              fetch(`${API_BASE}/api/collection`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ card }),
              }),
            ),
          ).then(() => {
            setCollection(localCollection);
            localStorage.setItem(
              "mtg-collection",
              JSON.stringify(localCollection),
            );
            setCollectionState("ready");
          });
        }
        setCollection(savedCollection);
        localStorage.setItem("mtg-collection", JSON.stringify(savedCollection));
        setCollectionState("ready");
      })
      .catch((error) => {
        setWishlist(localWishlist);
        setCollection(localCollection);
        setCollectionState("offline");
        setCollectionError(`${error.message} Using your local copy for now.`);
      });
  }, []);

  useEffect(() => {
    const localDecks = (() => {
      try {
        return JSON.parse(localStorage.getItem("mtg-decks") || "[]");
      } catch {
        return [];
      }
    })();
    fetch(`${API_BASE}/api/decks`)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((savedDecks) => {
        setDecks(savedDecks);
        localStorage.setItem("mtg-decks", JSON.stringify(savedDecks));
        if (savedDecks[0]) setActiveDeckId(savedDecks[0].id);
      })
      .catch(() => {
        setDecks(localDecks);
        if (localDecks[0]) setActiveDeckId(localDecks[0].id);
      });
  }, []);

  const totalCards = collection.reduce(
    (total, card) => total + card.quantity,
    0,
  );
  const collectionRows = useMemo(() => {
    const rows = groupPrintings
      ? groupCollectionByName(collection)
      : [...collection];
    return rows.sort((a, b) => {
      if (sortBy === "quantity")
        return b.quantity - a.quantity || a.name.localeCompare(b.name);
      if (sortBy === "rarity")
        return a.rarity.localeCompare(b.rarity) || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });
  }, [collection, groupPrintings, sortBy]);
  const visibleCollection = collectionRows.filter((card) =>
    matchesLocalQuery(card, collectionQuery),
  );
  const visibleWishlist = wishlist.filter((card) =>
    matchesLocalQuery(card, wishlistQuery),
  );
  const activeDeck = decks.find((deck) => deck.id === activeDeckId);
  const deckPrice =
    activeDeck?.cards?.reduce(
      (total, item) => total + (cardPrice(item.card) || 0) * item.quantity,
      0,
    ) || 0;

  return (
    <div className="app">
      <nav className="app-nav" aria-label="Primary navigation">
        <button className={activeView === "collection" ? "active" : ""} type="button" onClick={() => setActiveView("collection")}>Collection</button>
        <button className={activeView === "deck-builder" ? "active" : ""} type="button" onClick={() => setActiveView("deck-builder")}>Deck builder</button>
      </nav>
      {activeView === "deck-builder" && <DeckBuilderView
        decks={decks}
        activeDeck={activeDeck}
        activeDeckId={activeDeckId}
        setActiveDeckId={setActiveDeckId}
        deckName={deckName}
        setDeckName={setDeckName}
        deckFormat={deckFormat}
        setDeckFormat={setDeckFormat}
        createDeck={createDeck}
        deleteDeck={deleteDeck}
        deckMode={deckMode}
        setDeckMode={setDeckMode}
        deckQuery={deckQuery}
        setDeckQuery={setDeckQuery}
        deckFilters={deckFilters}
        setDeckFilters={setDeckFilters}
        deckResults={deckResults}
        deckSearchState={deckSearchState}
        deckSearchError={deckSearchError}
        deckNextPage={deckNextPage}
        isLoadingMoreDeck={isLoadingMoreDeck}
        searchDeckCards={searchDeckCards}
        loadMoreDeckCards={loadMoreDeckCards}
        addToDeck={addToDeck}
        changeDeckQuantity={changeDeckQuantity}
        cardPrice={cardPrice}
      />}
      {activeView === "collection" && <main>
        {false && activeDeck && (
          <section className="deck-suggestions">
            <div className="section-heading">
              <div>
                <p className="eyebrow">DECK INPUT</p>
                <h2>Add search results to {activeDeck.name}</h2>
              </div>
              <span className="api-note">
                {results.length
                  ? "Choose a card below"
                  : "Search for cards above"}
              </span>
            </div>
            <div className="suggestion-list">
              {results.slice(0, 8).map((card) => (
                <button
                  type="button"
                  key={card.id}
                  onClick={() => addToDeck(card)}
                >
                  <span>{card.name}</span>
                  <small>{card.type_line}</small>
                </button>
              ))}
            </div>
          </section>
        )}
        {false && <section className="decks">
          <div className="section-heading">
            <div>
              <p className="eyebrow">DECK LAB</p>
              <h2>Build a deck</h2>
            </div>
            <span className="api-note">
              {activeDeck
                ? `${activeDeck.cards.length} cards · $${deckPrice.toFixed(2)} estimate`
                : "Create a deck to start"}
            </span>
          </div>
          <form className="deck-create" onSubmit={createDeck}>
            <input
              value={deckName}
              onChange={(event) => setDeckName(event.target.value)}
              placeholder="Deck name"
              aria-label="Deck name"
            />
            <select
              value={deckFormat}
              onChange={(event) => setDeckFormat(event.target.value)}
              aria-label="Deck format"
            >
              <option value="commander">Commander</option>
              <option value="modern">Modern</option>
              <option value="standard">Standard</option>
              <option value="casual">Casual</option>
            </select>
            <button type="submit">New deck</button>
          </form>
          {decks.length > 0 && (
            <div className="deck-workspace">
              <label className="deck-picker">
                Active deck
                <select
                  value={activeDeckId}
                  onChange={(event) => setActiveDeckId(event.target.value)}
                >
                  {decks.map((deck) => (
                    <option key={deck.id} value={deck.id}>
                      {deck.name} · {deck.format}
                    </option>
                  ))}
                </select>
              </label>
              {activeDeck && (
                <>
                  <div className="deck-list">
                    {activeDeck.cards.length === 0 ? (
                      <span className="deck-empty">
                        Add cards from search results with “Add to deck”.
                      </span>
                    ) : (
                      activeDeck.cards.map((item) => (
                        <div className="deck-card" key={item.card.id}>
                          <span>
                            {item.quantity}× {item.card.name}
                          </span>
                          <span>
                            {cardPrice(item.card)
                              ? `$${(cardPrice(item.card) * item.quantity).toFixed(2)}`
                              : "No price"}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="assistant">
                    <div className="assistant-heading">
                      <div>
                        <p className="eyebrow">CARD ASSISTANT</p>
                        <h3>Related cards</h3>
                      </div>
                      <button type="button" onClick={loadAssistant}>
                        Find suggestions
                      </button>
                      <a
                        href={
                          activeDeck.cards.find((item) =>
                            item.card.type_line?.includes("Legendary Creature"),
                          )
                            ? `https://edhrec.com/commanders/${activeDeck.cards
                                .find((item) =>
                                  item.card.type_line?.includes(
                                    "Legendary Creature",
                                  ),
                                )
                                .card.name.toLowerCase()
                                .replace(/[^a-z0-9]+/g, "-")}`
                            : "https://edhrec.com"
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open EDHREC
                      </a>
                    </div>
                    {assistantResults.length > 0 && (
                      <div className="assistant-list">
                        {assistantResults.map((card) => (
                          <button
                            type="button"
                            key={card.id}
                            onClick={() => addToDeck(card)}
                          >
                            {card.name}
                            <span>{card.type_line}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </section>}
        <section className="search-panel">
          <div className="section-heading">
            <div>
              <h2>Search cards</h2>
            </div>
            <span className="api-note">
              Powered by Scryfall · updates as you type
            </span>
          </div>
          <form className="search" onSubmit={search}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Try “lightning bolt” or “legendary elf”"
              aria-label="Search cards"
            />
            <button type="submit" disabled={searchState === "loading"}>
              {searchState === "loading" ? "Searching…" : "Search now"}
            </button>
          </form>
          <div className="filters">
            <div className="filter-group">
              <label>Colors</label>
              <div className="color-buttons">
                {["W", "U", "B", "R", "G"].map((color) => (
                  <button
                    type="button"
                    key={color}
                    className={`color-btn ${colorClasses[color]} ${filters.colors.includes(color) ? "active" : ""}`}
                    onClick={() => toggleColor(color)}
                    title={colorNames[color]}
                    aria-pressed={filters.colors.includes(color)}
                  >
                    {color}
                  </button>
                ))}
              </div>
            </div>
            <div className="filter-group type-filter">
              <label>Card type</label>
              <div className="type-buttons">
                {[
                  "Creature",
                  "Instant",
                  "Sorcery",
                  "Artifact",
                  "Enchantment",
                  "Land",
                ].map((type) => (
                  <button
                    type="button"
                    key={type}
                    className={`type-btn ${filters.types.includes(type) ? "active" : ""}`}
                    onClick={() => toggleType(type)}
                    aria-pressed={filters.types.includes(type)}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
            <div className="compact-filters">
              <label>
                Rarity
                <select
                  value={filters.rarity}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, rarity: e.target.value }))
                  }
                >
                  <option value="">Any rarity</option>
                  <option value="common">Common</option>
                  <option value="uncommon">Uncommon</option>
                  <option value="rare">Rare</option>
                  <option value="mythic">Mythic</option>
                </select>
              </label>
              <label>
                Min mana
                <input
                  type="number"
                  min="0"
                  max="20"
                  value={filters.manaMin}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, manaMin: e.target.value }))
                  }
                  placeholder="Any"
                />
              </label>
              <label>
                Max mana
                <input
                  type="number"
                  min="0"
                  max="20"
                  value={filters.manaMax}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, manaMax: e.target.value }))
                  }
                  placeholder="Any"
                />
              </label>
            </div>
            <div className="advanced-filters">
              <label>
                Oracle text
                <input
                  value={filters.oracle}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, oracle: e.target.value }))
                  }
                  placeholder="draw a card"
                />
              </label>
              <label>
                Set code
                <input
                  value={filters.set}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, set: e.target.value }))
                  }
                  placeholder="set code"
                  maxLength="5"
                />
              </label>
              <label>
                Format
                <select
                  value={filters.format}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, format: e.target.value }))
                  }
                >
                  <option value="">Any format</option>
                  <option value="commander">Commander</option>
                  <option value="standard">Standard</option>
                  <option value="modern">Modern</option>
                  <option value="pioneer">Pioneer</option>
                  <option value="pauper">Pauper</option>
                  <option value="legacy">Legacy</option>
                </select>
              </label>
            </div>
          </div>
        </section>
        <section
          className={`results drop-zone ${dragTarget === "search" ? "drag-target" : ""}`}
          onDragOver={(event) => allowDrop(event, "search")}
          onDragLeave={() => setDragTarget("")}
          onDrop={(event) => dropCard(event, "search")}
        >
          <div className="section-heading">
            <div>
              <h2>
                {searchState === "success"
                  ? `${totalResults.toLocaleString()} cards found`
                  : "Search results"}
              </h2>
            </div>
          </div>
          {searchState === "idle" && (
            <div className="empty-state">
              <span>✦</span>
              <p>Search for a card to begin exploring.</p>
            </div>
          )}
          {searchState === "error" && (
            <div className="message error-message">{searchError}</div>
          )}
          {searchState === "success" && results.length === 0 && (
            <div className="empty-state">
              <span>⌁</span>
              <p>No cards matched those filters. Try a broader search.</p>
            </div>
          )}
          <div className="card-grid">
            {results.map((card) => (
              <CardTile
                key={card.id}
                card={card}
                actionLabel="Add to collection"
                onAction={() => add(card)}
                wishlistActive={wishlist.some((item) => item.id === card.id)}
                onWishlist={() => toggleWishlist(card)}
                onDragStart={(event) => startDrag(event, card, "search")}
                onDragEnd={endDrag}
              />
            ))}
          </div>
          {searchError && searchState === "success" && (
            <div className="message error-message">{searchError}</div>
          )}
          {nextPage && (
            <button
              className="load-more"
              type="button"
              onClick={loadMore}
              disabled={isLoadingMore}
            >
              {isLoadingMore
                ? "Loading more cards…"
                : `Load more cards (${results.length} of ${totalResults.toLocaleString()})`}
            </button>
          )}
        </section>
        <section
          className={`collection drop-zone ${dragTarget === "collection" ? "drag-target" : ""}`}
          onDragOver={(event) => allowDrop(event, "collection")}
          onDragLeave={() => setDragTarget("")}
          onDrop={(event) => dropCard(event, "collection")}
        >
          <div className="section-heading collection-heading">
            <div>
              <h2>My collection <span>{totalCards}</span></h2>
            </div>
            <div className="collection-tools">
              <label className="sort-control">
                Sort by
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                >
                  <option value="name">Name</option>
                  <option value="quantity">Quantity</option>
                  <option value="rarity">Rarity</option>
                </select>
              </label>
              <label className="group-control">
                <input
                  type="checkbox"
                  checked={groupPrintings}
                  onChange={(event) => setGroupPrintings(event.target.checked)}
                />{" "}
                Group printings
              </label>
            </div>
          </div>
          <input
            className="local-search"
            value={collectionQuery}
            onChange={(event) => setCollectionQuery(event.target.value)}
            placeholder="Search your collection"
            aria-label="Search your collection"
          />
          {collectionState === "loading" && (
            <div className="message">Loading your saved collection…</div>
          )}
          {collectionError && (
            <div className="message error-message">{collectionError}</div>
          )}
          {collection.length === 0 && collectionState !== "loading" && (
            <div className="empty-state collection-empty">
              <span>＋</span>
              <p>Your collection is waiting for its first card.</p>
            </div>
          )}
          {collection.length > 0 && visibleCollection.length === 0 && (
            <div className="empty-state">
              <p>No owned cards match that search.</p>
            </div>
          )}
          <div className="collection-list">
            {visibleCollection.map((card) => (
              <article
                key={card.groupKey || card.id}
                className="collection-card"
                draggable
                onDragStart={(event) => startDrag(event, card, "collection")}
                onDragEnd={endDrag}
              >
                <img src={cardImage(card)} alt="" />
                <div className="collection-card-info">
                  <strong>{card.name}</strong>
                  <span>
                    {groupPrintings
                      ? `${card.printingIds.length} printings · ${card.quantity} total`
                      : `${card.set_name || card.set?.toUpperCase()} · ${card.rarity} · ${card.condition || "Near Mint"}${card.foil ? " · Foil" : ""}`}
                  </span>
                </div>
                <div
                  className="quantity"
                  aria-label={`${card.quantity} copies of ${card.name}`}
                >
                  <button
                    onClick={() => changeQuantity(card.id, -1)}
                    aria-label={`Remove one ${card.name}`}
                  >
                    −
                  </button>
                  <strong>{card.quantity}</strong>
                  <button
                    onClick={() => changeQuantity(card.id, 1)}
                    aria-label={`Add one ${card.name}`}
                  >
                    ＋
                  </button>
                </div>
                {!groupPrintings && (
                  <button
                    className="edit-button"
                    type="button"
                    onClick={() => openEditor(card, "collection")}
                  >
                    Edit
                  </button>
                )}
              </article>
            ))}
          </div>
        </section>
        <section
          className={`wishlist drop-zone ${dragTarget === "wishlist" ? "drag-target" : ""}`}
          onDragOver={(event) => allowDrop(event, "wishlist")}
          onDragLeave={() => setDragTarget("")}
          onDrop={(event) => dropCard(event, "wishlist")}
        >
          <div className="section-heading">
            <div>
              <h2>Wishlist <span>{wishlist.length}</span></h2>
            </div>
            <p className="wishlist-note">
              Save cards to remember what to trade for next.
            </p>
          </div>
          <input
            className="local-search"
            value={wishlistQuery}
            onChange={(event) => setWishlistQuery(event.target.value)}
            placeholder="Search your wishlist"
            aria-label="Search your wishlist"
          />
          {wishlist.length === 0 ? (
            <div className="empty-state">
              <span>☆</span>
              <p>Nothing here yet. Tap the star on a search result.</p>
            </div>
          ) : visibleWishlist.length === 0 ? (
            <div className="empty-state">
              <p>No wanted cards match that search.</p>
            </div>
          ) : (
            <div className="wishlist-list">
              {visibleWishlist.map((card) => (
                <article
                  key={card.id}
                  className="wishlist-card"
                  draggable
                  onDragStart={(event) => startDrag(event, card, "wishlist")}
                  onDragEnd={endDrag}
                >
                  <img src={cardImage(card)} alt="" />
                  <div>
                    <strong>{card.name}</strong>
                    <span>
                      {card.set_name || card.set?.toUpperCase()} · {card.rarity}{" "}
                      · {card.condition || "Near Mint"}
                      {card.foil ? " · Foil" : ""}
                    </span>
                  </div>
                  <div className="quantity">
                    <strong>{card.quantity}</strong>
                  </div>
                  <button
                    className="edit-button"
                    type="button"
                    onClick={() => openEditor(card, "wishlist")}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleWishlist(card)}
                    aria-label={`Remove ${card.name} from wishlist`}
                  >
                    Remove
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
        <details className="collection-import">
          <summary>Collection tools</summary>
          <div className="section-heading">
            <div>
              <h2>Import collection</h2>
            </div>
            <span className="api-note">ManaBox CSV</span>
          </div>
          <label className="import-button">
            Import ManaBox CSV
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={importManaBox}
            />
          </label>
          {importState && <div className="message">{importState}</div>}
        </details>
      </main>}
      {editing && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setEditing(null)
          }
        >
          <form className="edit-modal" onSubmit={saveEdit}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">CARD DETAILS</p>
                <h2>Edit {editing.card.name}</h2>
              </div>
              <button
                className="modal-close"
                type="button"
                onClick={() => setEditing(null)}
                aria-label="Close edit window"
              >
                ×
              </button>
            </div>
            <div className="edit-fields">
              <label>
                Quantity
                <input
                  type="number"
                  min="1"
                  value={editing.card.quantity}
                  onChange={(event) =>
                    setEditing((prev) => ({
                      ...prev,
                      card: { ...prev.card, quantity: event.target.value },
                    }))
                  }
                />
              </label>
              <label className="printing-select">
                Set
                {editing.printingsLoading ? (
                  <span className="field-note">Loading available printings…</span>
                ) : (
                  <select
                    value={editing.selectedId}
                    onChange={(event) => selectPrinting("editing", event.target.value)}
                  >
                    {editing.printings.map((printing) => (
                      <option key={printing.id} value={printing.id}>
                        {printingLabel(printing)}
                      </option>
                    ))}
                  </select>
                )}
              </label>
              <div className="printing-preview">
                <img src={cardImage(editing.card)} alt={`${editing.card.name} preview`} />
              </div>
              {editing.printingsError && (
                <div className="message error-message">{editing.printingsError}</div>
              )}
              <label>
                Rarity
                <select
                  value={editing.card.rarity}
                  onChange={(event) =>
                    setEditing((prev) => ({
                      ...prev,
                      card: { ...prev.card, rarity: event.target.value },
                    }))
                  }
                >
                  <option value="common">Common</option>
                  <option value="uncommon">Uncommon</option>
                  <option value="rare">Rare</option>
                  <option value="mythic">Mythic</option>
                </select>
              </label>
              <label>
                Condition
                <select
                  value={editing.card.condition}
                  onChange={(event) =>
                    setEditing((prev) => ({
                      ...prev,
                      card: { ...prev.card, condition: event.target.value },
                    }))
                  }
                >
                  <option>Near Mint</option>
                  <option>Lightly Played</option>
                  <option>Moderately Played</option>
                  <option>Heavily Played</option>
                  <option>Damaged</option>
                </select>
              </label>
              <label>
                Language
                <input
                  value={editing.card.language}
                  onChange={(event) =>
                    setEditing((prev) => ({
                      ...prev,
                      card: { ...prev.card, language: event.target.value },
                    }))
                  }
                />
              </label>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={editing.card.foil}
                  onChange={(event) =>
                    setEditing((prev) => ({
                      ...prev,
                      card: { ...prev.card, foil: event.target.checked },
                    }))
                  }
                />{" "}
                Foil printing
              </label>
              <label className="notes-field">
                Notes
                <textarea
                  rows="4"
                  value={editing.card.notes}
                  onChange={(event) =>
                    setEditing((prev) => ({
                      ...prev,
                      card: { ...prev.card, notes: event.target.value },
                    }))
                  }
                  placeholder="Where is it stored? What deck needs it?"
                />
              </label>
            </div>
            <div className="modal-actions">
              <button
                className="cancel-button"
                type="button"
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
              <button className="save-button" type="submit">
                Save details
              </button>
            </div>
          </form>
        </div>
      )}
      {printingPicker && (
        <PrintingModal
          card={printingPicker.card}
          printings={printingPicker.printings}
          selectedId={printingPicker.selectedId}
          loading={printingPicker.loading}
          error={printingPicker.error}
          onSelect={(id) => selectPrinting("picker", id)}
          onClose={() => setPrintingPicker(null)}
          onConfirm={async () => {
            await saveCard(printingPicker.card);
            setPrintingPicker(null);
          }}
        />
      )}
      <footer>Built for the cards you actually play with.</footer>
    </div>
  );
}

function SearchFilters({ filters, setFilters }) {
  const toggleColor = (color) => setFilters((previous) => ({ ...previous, colors: previous.colors.includes(color) ? previous.colors.filter((item) => item !== color) : [...previous.colors, color] }));
  const toggleType = (type) => setFilters((previous) => ({ ...previous, types: previous.types.includes(type) ? previous.types.filter((item) => item !== type) : [...previous.types, type] }));
  return <div className="filters deck-filters">
    <div className="filter-group"><label>Colors</label><div className="color-buttons">{["W", "U", "B", "R", "G"].map((color) => <button type="button" key={color} className={`color-btn ${colorClasses[color]} ${filters.colors.includes(color) ? "active" : ""}`} onClick={() => toggleColor(color)} title={colorNames[color]} aria-pressed={filters.colors.includes(color)}>{color}</button>)}</div></div>
    <div className="filter-group type-filter"><label>Card type</label><div className="type-buttons">{["Creature", "Instant", "Sorcery", "Artifact", "Enchantment", "Land"].map((type) => <button type="button" key={type} className={`type-btn ${filters.types.includes(type) ? "active" : ""}`} onClick={() => toggleType(type)} aria-pressed={filters.types.includes(type)}>{type}</button>)}</div></div>
    <div className="compact-filters"><label>Rarity<select value={filters.rarity} onChange={(event) => setFilters((previous) => ({ ...previous, rarity: event.target.value }))}><option value="">Any rarity</option><option value="common">Common</option><option value="uncommon">Uncommon</option><option value="rare">Rare</option><option value="mythic">Mythic</option></select></label><label>Min mana<input type="number" min="0" max="20" value={filters.manaMin} onChange={(event) => setFilters((previous) => ({ ...previous, manaMin: event.target.value }))} placeholder="Any" /></label><label>Max mana<input type="number" min="0" max="20" value={filters.manaMax} onChange={(event) => setFilters((previous) => ({ ...previous, manaMax: event.target.value }))} placeholder="Any" /></label></div>
    <div className="advanced-filters"><label>Oracle text<input value={filters.oracle} onChange={(event) => setFilters((previous) => ({ ...previous, oracle: event.target.value }))} placeholder="draw a card" /></label><label>Set code<input value={filters.set} onChange={(event) => setFilters((previous) => ({ ...previous, set: event.target.value }))} placeholder="set code" maxLength="5" /></label><label>Format<select value={filters.format} onChange={(event) => setFilters((previous) => ({ ...previous, format: event.target.value }))}><option value="">Any format</option><option value="commander">Commander</option><option value="standard">Standard</option><option value="modern">Modern</option><option value="pioneer">Pioneer</option><option value="pauper">Pauper</option><option value="legacy">Legacy</option></select></label></div>
  </div>;
}

function DeckBuilderView({
  decks,
  activeDeck,
  activeDeckId,
  setActiveDeckId,
  deckName,
  setDeckName,
  deckFormat,
  setDeckFormat,
  createDeck,
  deleteDeck,
  deckMode,
  setDeckMode,
  deckQuery,
  setDeckQuery,
  deckFilters,
  setDeckFilters,
  deckResults,
  deckSearchState,
  deckSearchError,
  deckNextPage,
  isLoadingMoreDeck,
  searchDeckCards,
  loadMoreDeckCards,
  addToDeck,
  changeDeckQuantity,
  cardPrice,
}) {
  return (
    <section className="deck-builder-view">
      <div className="deck-builder-heading">
        <div>
          <h2>Deck builder</h2>
        </div>
      </div>
      <div className="deck-builder-toolbar">
        <form className="deck-create" onSubmit={createDeck}>
          <input value={deckName} onChange={(event) => setDeckName(event.target.value)} placeholder="Deck name" aria-label="Deck name" />
          <select value={deckFormat} onChange={(event) => setDeckFormat(event.target.value)} aria-label="Deck format">
            <option value="commander">Commander</option>
            <option value="modern">Modern</option>
            <option value="standard">Standard</option>
            <option value="casual">Casual</option>
          </select>
          <button type="submit">New deck</button>
        </form>
        {decks.length > 0 && <div className="deck-builder-deck-actions"><label className="deck-picker">Active deck<select value={activeDeckId} onChange={(event) => setActiveDeckId(event.target.value)}>{decks.map((deck) => <option key={deck.id} value={deck.id}>{deck.name} · {deck.format}</option>)}</select></label>{activeDeck && <button className="delete-deck-button" type="button" onClick={() => deleteDeck(activeDeck.id)}>Delete deck</button>}</div>}
      </div>
      {!activeDeck ? <div className="empty-state"><span>＋</span><p>Create a deck to begin building.</p></div> : <div className="deck-builder-layout">
        <section className="deck-card-browser">
          <div className="section-heading"><div><p className="eyebrow">CARD SOURCE</p><h3>Add cards to {activeDeck.name}</h3></div><span className="api-note">{deckResults.length ? `${deckResults.length} cards` : "Search to begin"}</span></div>
          <div className="deck-mode-switch" role="tablist" aria-label="Deck card source">
            <button className={deckMode === "all" ? "active" : ""} type="button" role="tab" aria-selected={deckMode === "all"} onClick={() => setDeckMode("all")}>All Magic</button>
            <button className={deckMode === "collection" ? "active" : ""} type="button" role="tab" aria-selected={deckMode === "collection"} onClick={() => setDeckMode("collection")}>My collection</button>
          </div>
          <form className="deck-search" onSubmit={searchDeckCards}><input value={deckQuery} onChange={(event) => setDeckQuery(event.target.value)} placeholder={deckMode === "all" ? "Search every Magic card" : "Search cards you own"} aria-label={deckMode === "all" ? "Search all Magic cards" : "Search your collection for deck cards"} /><button type="submit" disabled={deckSearchState === "loading"}>{deckSearchState === "loading" ? "Searching…" : "Search"}</button></form>
          <SearchFilters filters={deckFilters} setFilters={setDeckFilters} />
          {deckSearchError && <div className="message error-message">{deckSearchError}</div>}
          {deckSearchState === "success" && deckResults.length === 0 && <div className="empty-state"><p>No cards matched that search.</p></div>}
          <div className="deck-result-list">{deckResults.map((card) => <article className="deck-result" key={card.id}><img src={cardImage(card)} alt="" /><div><strong>{card.name}</strong><span>{card.set_name || card.set?.toUpperCase()} · {card.type_line}</span></div><button type="button" onClick={() => addToDeck(card)}>Add</button></article>)}</div>
          {deckNextPage && <button className="load-more" type="button" onClick={loadMoreDeckCards} disabled={isLoadingMoreDeck}>{isLoadingMoreDeck ? "Loading more cards…" : "Load more cards"}</button>}
        </section>
        <aside className="deck-list-panel"><div className="section-heading"><div><p className="eyebrow">DECK LIST</p><h3>{activeDeck.name}</h3></div><span className="api-note">{activeDeck.cards.reduce((total, item) => total + item.quantity, 0)} cards · ${activeDeck.cards.reduce((total, item) => total + (cardPrice(item.card) || 0) * item.quantity, 0).toFixed(2)}</span></div>{activeDeck.cards.length === 0 ? <div className="empty-state"><p>Your deck list is empty.</p></div> : <div className="deck-builder-list">{activeDeck.cards.map((item) => <div className="deck-builder-row" key={item.card.id}><div><strong>{item.card.name}</strong><span>{item.card.type_line}</span></div><div className="deck-quantity"><button type="button" onClick={() => changeDeckQuantity(item.card.id, -1)} aria-label={`Remove one ${item.card.name}`}>−</button><strong>{item.quantity}</strong><button type="button" onClick={() => changeDeckQuantity(item.card.id, 1)} aria-label={`Add one ${item.card.name}`}>＋</button></div></div>)}</div>}</aside>
      </div>}
    </section>
  );
}

function PrintingModal({
  card,
  printings,
  selectedId,
  loading,
  error,
  onSelect,
  onClose,
  onConfirm,
}) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="edit-modal printing-modal">
        <div className="modal-heading">
          <div>
            <p className="eyebrow">CHOOSE PRINTING</p>
            <h2>Add {card.name}</h2>
          </div>
          <button
            className="modal-close"
            type="button"
            onClick={onClose}
            aria-label="Close printing picker"
          >
            ×
          </button>
        </div>
        {loading ? (
          <div className="message">Loading available printings…</div>
        ) : (
          <>
            <div className="printing-preview">
              <img src={cardImage(card)} alt={`${card.name} preview`} />
            </div>
            {error && (
              <div className="message error-message">
                {error} You can still add the selected search result.
              </div>
            )}
            <label className="printing-select">
              Set
              <select
                value={selectedId}
                onChange={(event) => onSelect(event.target.value)}
              >
                {printings.map((printing) => (
                  <option key={printing.id} value={printing.id}>
                    {printingLabel(printing)}
                  </option>
                ))}
              </select>
            </label>
            <div className="modal-actions">
              <button className="cancel-button" type="button" onClick={onClose}>
                Cancel
              </button>
              <button className="save-button" type="button" onClick={onConfirm}>
                Add to collection
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CardTile({
  card,
  actionLabel,
  onAction,
  wishlistActive,
  onWishlist,
  onDragStart,
  onDragEnd,
}) {
  return (
    <article
      className="card-tile"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="card-image-wrap">
        <img src={cardImage(card)} alt={`${card.name} card art`} />
        <span className={`rarity-dot ${card.rarity}`}></span>
        <button
          className={`wishlist-button ${wishlistActive ? "active" : ""}`}
          type="button"
          onClick={onWishlist}
          aria-label={`${wishlistActive ? "Remove" : "Add"} ${card.name} ${wishlistActive ? "from" : "to"} wishlist`}
          aria-pressed={wishlistActive}
        >
          ☆
        </button>
      </div>
      <div className="card-tile-body">
        <div>
          <h3>{card.name}</h3>
          <p>{card.type_line}</p>
        </div>
        <div className="card-actions">
          <button onClick={() => onAction(card)}>{actionLabel}</button>
          <button
            className="wishlist-action"
            type="button"
            onClick={onWishlist}
          >
            {wishlistActive ? "Wishlisted" : "Add to wishlist"}
          </button>
        </div>
      </div>
    </article>
  );
}

export default App;
