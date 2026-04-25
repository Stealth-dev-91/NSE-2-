# NSE Screener

Live Nifty 50 stock screener with Yahoo Finance data, composite scoring, Google News integration, and Supabase watchlist persistence.

## Quick Start

```bash
cd nse-screener
npx vercel dev
```

Open http://localhost:3000

## Deploy to Vercel

```bash
git init && git add . && git commit -m "NSE Screener v1"
# Create GitHub repo and push, then:
npx vercel --prod
```

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/stocks` | All Nifty 50 quotes with scoring data |
| `GET /api/stocks?tickers=ZOMATO.NS` | Include custom tickers |
| `GET /api/detail?ticker=RELIANCE.NS` | Deep fundamentals for a single stock |
| `GET /api/news?q=NSE+market&limit=6` | Google News articles |

## Supabase Setup (Optional)

The app works without Supabase (falls back to localStorage). To enable cloud watchlists:

1. Create a Supabase project
2. Run this SQL in the SQL Editor:

```sql
create table watchlists (
  id uuid default gen_random_uuid() primary key,
  username text not null,
  ticker text not null,
  added_at timestamptz default now(),
  unique(username, ticker)
);
alter table watchlists enable row level security;
create policy "public_read" on watchlists for select using (true);
create policy "public_insert" on watchlists for insert with check (true);
create policy "public_delete" on watchlists for delete using (true);
create index idx_wl_user on watchlists(username);
```

3. Update `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `public/index.html`

## Architecture

- **Zero dependencies** — native fetch everywhere, no build step
- **React 18 via CDN** with Babel standalone
- **Yahoo Finance** cookie+crumb auth for live market data
- **Google News RSS** parsed with regex
- **Vercel Serverless Functions** for API layer

## Features

- Live Nifty 50 data with composite scoring
- 6 screener presets (Value, Momentum, Dividends, Oversold, Mega Cap, Growth)
- Custom filters (P/E, P/B, Dividend Yield, Market Cap)
- Deep fundamentals modal with valuation, quality, growth metrics
- 52-week range visualization with DMA markers
- Analyst price targets
- Market news feed (Google News)
- Per-stock news in detail view
- Add custom NSE tickers
- Watchlist with Supabase persistence (localStorage fallback)
- Dark theme, responsive design
