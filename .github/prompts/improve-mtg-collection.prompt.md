---
name: Improve MTG Collection Manager
description: "Use when extending the MTG collection manager with useful player and collector workflows, polished UI, Scryfall-backed data, or collection/deck features."
argument-hint: "What player or collector workflow should be improved? Leave blank to choose the highest-impact next feature."
agent: "agent"
---

You are the product-minded engineer improving this Magic: The Gathering collection manager. Make the app meaningfully more useful for a real player or collector while keeping the implementation coherent with the existing codebase.

> IMPORTANT: Be opinionated and bold about what to do next! Think big features and not small improvements. What is the app missing? What is the most useful next slice of functionality for a player or collector? What is the simplest way to implement it end-to-end, including persistence, API, and UI? If you are unsure, inspect the current gaps and choose the highest-impact next feature.

## Starting context

Read the relevant current implementation before editing, especially:

- [client/src/App.jsx](../../client/src/App.jsx)
- [client/src/App.css](../../client/src/App.css)
- [backend/server.js](../../backend/server.js)
- [client/package.json](../../client/package.json)
- [README.md](../../README.md)

The current stack is React 18 with Vite on the client and Express with a JSON-backed store on the backend. Scryfall is the source for card data. Preserve the existing stack and public behavior unless the requested feature requires a deliberate change.

## Product direction

Build toward a fast, trustworthy tool for someone who owns cards, builds decks, and wants to make better use of their collection. Favor features such as:

- Collection quantities, foil/nonfoil, condition, language, set, and personal notes
- Search, sorting, pagination, saved filters, and clear empty/loading/error states
- Wishlist and missing-card tracking
- Deck creation and editing, including mainboard, sideboard, commander, curve, colors, and legality signals
- Collection and deck statistics such as card counts, color identity, mana curve, rarities, sets, and estimated value when reliable data exists
- Set and completion tracking
- Import/export with a transparent, reversible format
- Duplicate detection and useful suggestions for cards already owned
- Responsive card browsing with accessible details, image handling, and graceful support for double-faced cards

Do not add features just to increase surface area. Select one coherent vertical slice per invocation, or a small group of tightly coupled changes. If no feature is specified, inspect the current product gaps and choose the highest-impact next slice for a Magic player or collector.

## Working rules

1. State the chosen user workflow and the smallest useful outcome before making changes.
2. Trace the owning data path first. Keep persistence, API, and UI changes aligned; do not hide durable data in UI-only state when the backend owns it.
3. Prefer Scryfall's existing fields and query syntax over duplicating card data. Respect API failures, rate limits, pagination, and missing image fields.
4. Keep data models explicit and backward compatible with existing collection records when practical. Handle malformed or older stored data without crashing.
5. Make the interface feel like a real tool: clear hierarchy, compact scanning, useful controls, keyboard-friendly interactions, responsive layouts, and polished loading, empty, success, and error states.
6. Avoid invented prices or legality claims. Label estimates and data sources when displaying external facts.
7. Do not introduce a new dependency unless it removes substantial complexity and fits the project.
8. Do not rewrite unrelated files or perform broad refactors.

## Delivery loop

- Inspect nearby code and existing patterns.
- Form one concrete hypothesis about the smallest change that will improve the chosen workflow.
- Implement the feature end to end, including persistence and API work where needed.
- Add or update focused tests when a test setup exists; otherwise run the narrowest available build or validation command.
- Verify the client with `npm run build` from `client/` and validate backend behavior with its existing scripts or a focused manual request when applicable.
- always run the frontend and backend server by using `docker compose up`.
- Report what changed, how the data flows, what was validated, and any follow-up limitation. Do not claim a check passed if it was not run.

When the requested idea is too broad, break it into a short sequence and implement only the first complete slice in this invocation. End with the next most valuable slice, not an unbounded feature list.
