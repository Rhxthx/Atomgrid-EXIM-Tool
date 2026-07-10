# EXIM Trade Intelligence — Frontend (Phase 3)

Enterprise dashboard for the EXIM merged dataset.  Built with React 18 +
Vite + TypeScript + Tailwind + ShadCN-style primitives + Recharts +
TanStack Table.  Talks to the Phase 2 FastAPI backend.

> **Scope.** UI + visualisation only. No auth, no AI/chatbot, no deploy
> infra — those are later phases. Phase 2 backend must be running.

## What's inside

| Module | Page | Highlights |
|---|---|---|
| Dashboard         | `/`            | KPIs, monthly value, top importers/suppliers, country heatmap |
| Global Search     | `/search`      | Free-text + filters, "Did you mean" via /similar, Save search |
| Shipment Explorer | `/shipments`   | Full filter surface, expandable rows, server-side sort + pagination, CSV |
| Importers / Exporters / Suppliers | `/importers`, `/exporters`, `/suppliers` | Top entity ranking + drill-down, HHI for importers |
| HSN Analysis      | `/hsn`         | Top HSNs + keyword cloud |
| Country Analysis  | `/countries`   | Country bar + heatmap tiles + drill-down |
| Trends            | `/trends`      | Monthly value/count + group-by split |
| Saved             | `/saved`       | Saved searches + bookmarked counterparties (localStorage) |

Reusable building blocks:

- `DataTable` — TanStack Table wrapper: sticky header, column resize, sort,
  pagination, CSV export, row JSON copy, expandable details
- `FilterPanel` — every backend filter, collapsible, with active-chip strip
- `KpiCard`, `ChartCard` with skeletons + empty states
- 4 Recharts wrappers: `LineTrendChart`, `AreaTrendChart`, `BarRankChart`,
  `DonutSplitChart`
- Global search popover with debounced `/suggest`, theme toggle (dark
  default), persisted theme + saved searches via Zustand

## Quick start

```powershell
# Make sure Phase 2 backend is running:
#   cd ../backend && python main.py
#
# Then in another shell:
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

Vite proxies `/api/*` to `http://127.0.0.1:8000` in dev — no CORS hassle.

For a production build:

```powershell
# Set the prod API origin first (or use a reverse proxy)
echo VITE_API_BASE_URL=https://your-api.example.com > .env.local
npm run build
npm run preview        # serve dist/ locally
```

## Config

| Env | Purpose | Default |
|---|---|---|
| `VITE_API_BASE_URL` | Where the SPA calls the FastAPI backend | `/api` (proxied in dev) |

## Project layout

```
frontend/
├── src/
│   ├── App.tsx                  # routes
│   ├── main.tsx                 # React Query + Router providers
│   ├── layouts/AppLayout.tsx    # sidebar + topbar + outlet
│   ├── components/
│   │   ├── ui/                  # ShadCN-style primitives (button, card, …)
│   │   ├── layout/Sidebar.tsx · TopBar.tsx
│   │   ├── filters/FilterPanel.tsx
│   │   ├── table/DataTable.tsx · Pagination.tsx · shipmentColumns.tsx
│   │   ├── charts/{Line,Area,BarRank,DonutSplit}Chart.tsx · ChartCard.tsx
│   │   ├── KpiCard.tsx · PageHeader.tsx
│   ├── pages/
│   │   ├── Dashboard.tsx · GlobalSearch.tsx · Shipments.tsx
│   │   ├── EntityIntelligence.tsx + Importers.tsx · Exporters.tsx · Suppliers.tsx
│   │   ├── Hsn.tsx · Countries.tsx · Trends.tsx · Saved.tsx
│   ├── services/                # axios + endpoint wrappers
│   ├── hooks/                   # useDebounce, useUrlFilters, queries (React Query)
│   ├── store/                   # Zustand: theme, saved searches
│   ├── types/api.ts             # mirrors FastAPI response shapes
│   ├── utils/                   # cn, format (₹/L/Cr), csv
│   └── styles/globals.css       # Tailwind + HSL theme tokens
├── vite.config.ts               # /api proxy + manual chunks
├── tailwind.config.js · postcss.config.js
├── tsconfig.{,app,node}.json
├── package.json
└── README.md
```

## API integration

The frontend talks to the Phase 2 backend exclusively through
[`src/services/endpoints.ts`](src/services/endpoints.ts) — one thin
function per endpoint.  React Query hooks live in
[`src/hooks/queries.ts`](src/hooks/queries.ts).  All response shapes are
mirrored as TypeScript types in [`src/types/api.ts`](src/types/api.ts);
when the backend evolves, run `curl /openapi.json` and update.

Key conventions:

- **Filter shape is shared.**  Every backend endpoint accepts the same
  `FilterParams` object, so the same `FilterPanel` works on every page.
- **URL state.**  `useUrlFilters` keeps filter state in
  `?key=value&…` — page refresh and shareable links work for free.
- **Debounce.**  Search input + autosuggest use `useDebounce` (200–350 ms).
- **CSV export.**  Implemented client-side from the visible table page;
  switch to a server-side stream when row counts exceed ~10k.
- **Server-side sort + pagination.**  DataTable's `serverSort` /
  `serverPagination` props delegate ordering and pagination to the
  backend so it scales to the full DuckDB.

## Performance notes

- **Code splitting.** `vite.config.ts` puts `recharts` and `@tanstack/*`
  into their own chunks.  React Router lazy-loading can be added later if
  cold-start matters more.
- **React Query cache.**  60 s staleTime by default; analytics endpoints
  bump that to 2–5 min (they're aggregate queries that don't change
  often).
- **Server-side everything.**  Sort, filter, paginate and aggregate run
  on the DuckDB.  The frontend never holds more than one page of rows.
- **Virtualised tables.**  Not enabled by default — DuckDB returns at
  most `page_size` rows so the DOM has at most ~500 rows.  When you want
  to render thousands of rows client-side, swap the `<tbody>` for
  `@tanstack/react-virtual`.

## Adding a new page

1. Build / fetch data in a React Query hook (`src/hooks/queries.ts`).
2. Drop a new `<page>.tsx` under `src/pages/` reusing `PageHeader`,
   `FilterPanel`, `DataTable`, `ChartCard`.
3. Register the route in `src/App.tsx` and `src/components/layout/Sidebar.tsx`.

That's it — the reusable components carry the heavy lifting.

## Future integration

- **AI querying / chatbot.**  Add an `/ask` endpoint that returns
  `{filters, summary}` from an LLM; route the user to a pre-filtered
  shipment view with the summary in the side panel.
- **Real-time updates.**  React Query already supports refetchInterval;
  flip it on for `/stats` and `/trends/monthly` once the backend supports
  incremental refresh.
- **Auth.**  Wrap `<AppLayout>` in an auth guard; pass tokens through the
  axios `Authorization` header (one-line change in `src/services/api.ts`).
- **Theming.**  Light theme is built; toggle is in the top bar.  All
  colours are HSL CSS vars so re-skinning is straightforward.
