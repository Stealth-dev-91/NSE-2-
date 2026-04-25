/**
 * Analyst Snapshot API
 *
 * GET /api/analyst-snapshot?ticker=TCS.NS
 *   → Returns stored snapshots for a ticker (from Supabase)
 *
 * POST /api/analyst-snapshot?mode=snapshot
 *   → Takes a snapshot of top stocks' analyst data and stores in Supabase
 *   → Designed to be called by a cron job (weekly)
 *
 * POST /api/analyst-snapshot?mode=evaluate
 *   → Evaluates past snapshots: did targets hit? Were recommendations correct?
 *   → Computes accuracy scores per stock
 *
 * Supabase table schema:
 * CREATE TABLE analyst_snapshots (
 *   id BIGSERIAL PRIMARY KEY,
 *   ticker TEXT NOT NULL,
 *   snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
 *   price NUMERIC,
 *   recommendation TEXT,
 *   target_mean NUMERIC,
 *   target_low NUMERIC,
 *   target_high NUMERIC,
 *   num_analysts INTEGER,
 *   rec_trend JSONB,         -- recommendationTrend array
 *   earnings_trend JSONB,    -- earningsTrend array
 *   raw_data JSONB,          -- compressed full Yahoo response for future use
 *   created_at TIMESTAMPTZ DEFAULT NOW(),
 *   UNIQUE(ticker, snapshot_date)
 * );
 *
 * CREATE TABLE analyst_accuracy (
 *   id BIGSERIAL PRIMARY KEY,
 *   ticker TEXT NOT NULL,
 *   snapshot_date DATE NOT NULL,
 *   eval_date DATE NOT NULL DEFAULT CURRENT_DATE,
 *   original_price NUMERIC,
 *   original_target NUMERIC,
 *   original_recommendation TEXT,
 *   actual_price NUMERIC,
 *   target_hit BOOLEAN,         -- did price reach target?
 *   direction_correct BOOLEAN,  -- was buy/sell direction right?
 *   accuracy_pct NUMERIC,       -- how close to target (%)
 *   days_elapsed INTEGER,
 *   created_at TIMESTAMPTZ DEFAULT NOW(),
 *   UNIQUE(ticker, snapshot_date, eval_date)
 * );
 *
 * CREATE INDEX idx_snapshots_ticker ON analyst_snapshots(ticker);
 * CREATE INDEX idx_snapshots_date ON analyst_snapshots(snapshot_date);
 * CREATE INDEX idx_accuracy_ticker ON analyst_accuracy(ticker);
 */

import { yahooSummary } from "../lib/yahoo.js";
import { fetchNSEList } from "../lib/nse.js";

// Helper to compress raw data — strip unnecessary nested objects to save space
function compressRawData(data) {
  if (!data) return null;
  return {
    price: data.price ? {
      regularMarketPrice: data.price.regularMarketPrice,
      regularMarketChange: data.price.regularMarketChange,
      regularMarketChangePercent: data.price.regularMarketChangePercent,
      marketCap: data.price.marketCap,
    } : null,
    financialData: data.financialData ? {
      targetHighPrice: data.financialData.targetHighPrice,
      targetLowPrice: data.financialData.targetLowPrice,
      targetMeanPrice: data.financialData.targetMeanPrice,
      recommendationKey: data.financialData.recommendationKey,
      numberOfAnalystOpinions: data.financialData.numberOfAnalystOpinions,
    } : null,
    recommendationTrend: data.recommendationTrend || null,
    earningsTrend: data.earningsTrend || null,
    defaultKeyStatistics: data.defaultKeyStatistics ? {
      trailingPE: data.defaultKeyStatistics.trailingPE,
      forwardPE: data.defaultKeyStatistics.forwardPE,
      pegRatio: data.defaultKeyStatistics.pegRatio,
      priceToBook: data.defaultKeyStatistics.priceToBook,
    } : null,
  };
}

function raw(obj) {
  if (obj == null) return null;
  if (typeof obj === "object") {
    if ("raw" in obj) return obj.raw;
    if (Object.keys(obj).length === 0) return null;
    return null;
  }
  return obj;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  // Check for Supabase config via env
  const sbUrl = process.env.SUPABASE_URL || "https://jvdtliqrstgvioigfcjc.supabase.co";
  const sbKey = process.env.SUPABASE_SERVICE_KEY; // must be set in Vercel env vars

  if (!sbKey) {
    return res.status(200).json({
      error: null,
      message: "SUPABASE_SERVICE_KEY not set. Add it to Vercel environment variables.",
      schema: getSchema(),
    });
  }

  const mode = req.query?.mode || "get";

  try {
    if (req.method === "GET" || mode === "get") {
      // Return stored snapshots for a ticker
      const ticker = req.query?.ticker;
      if (!ticker) return res.status(400).json({ error: "Missing ticker param" });

      const snapshots = await supabaseFetch(sbUrl, sbKey, "analyst_snapshots", {
        select: "*",
        ticker: `eq.${ticker}`,
        order: "snapshot_date.desc",
        limit: 52, // last year of weekly snapshots
      });

      const accuracy = await supabaseFetch(sbUrl, sbKey, "analyst_accuracy", {
        select: "*",
        ticker: `eq.${ticker}`,
        order: "eval_date.desc",
        limit: 52,
      });

      return res.status(200).json({ snapshots, accuracy });

    } else if (mode === "snapshot") {
      // Take snapshots for top stocks (by market cap)
      // This should be called by a cron job weekly
      const nseList = await fetchNSEList();
      // Snapshot top 200 stocks to stay within limits
      const tickers = nseList.slice(0, 200).map(s => s.yahooTicker);

      const results = { saved: 0, errors: 0, skipped: 0 };
      const today = new Date().toISOString().slice(0, 10);

      // Process in batches of 5
      for (let i = 0; i < tickers.length; i += 5) {
        const batch = tickers.slice(i, i + 5);
        const promises = batch.map(async (ticker) => {
          try {
            const data = await yahooSummary(ticker);
            if (!data) { results.skipped++; return; }

            const fd = data.financialData || {};
            const p = data.price || {};

            const row = {
              ticker,
              snapshot_date: today,
              price: raw(p.regularMarketPrice) || raw(fd.currentPrice),
              recommendation: fd.recommendationKey || null,
              target_mean: raw(fd.targetMeanPrice),
              target_low: raw(fd.targetLowPrice),
              target_high: raw(fd.targetHighPrice),
              num_analysts: raw(fd.numberOfAnalystOpinions),
              rec_trend: data.recommendationTrend?.trend || [],
              earnings_trend: data.earningsTrend?.trend || [],
              raw_data: compressRawData(data),
            };

            await supabaseUpsert(sbUrl, sbKey, "analyst_snapshots", row, "ticker,snapshot_date");
            results.saved++;
          } catch (e) {
            console.error(`Snapshot error for ${ticker}:`, e.message);
            results.errors++;
          }
        });
        await Promise.all(promises);
      }

      return res.status(200).json({ mode: "snapshot", ...results });

    } else if (mode === "evaluate") {
      // Evaluate past predictions
      // Compare snapshots from N days ago with current prices
      const daysBack = parseInt(req.query?.days || "30");
      const cutoffDate = new Date(Date.now() - daysBack * 86400000).toISOString().slice(0, 10);

      const snapshots = await supabaseFetch(sbUrl, sbKey, "analyst_snapshots", {
        select: "ticker,snapshot_date,price,target_mean,recommendation",
        "snapshot_date": `lte.${cutoffDate}`,
        order: "snapshot_date.desc",
        limit: 500,
      });

      if (!snapshots || snapshots.length === 0) {
        return res.status(200).json({ message: "No snapshots old enough to evaluate", daysBack });
      }

      // Get current prices for these tickers
      const uniqueTickers = [...new Set(snapshots.map(s => s.ticker))];
      const { yahooQuote } = await import("../lib/yahoo.js");
      const quotes = await yahooQuote(uniqueTickers);
      const priceMap = {};
      for (const q of quotes) {
        priceMap[q.symbol] = q.regularMarketPrice;
      }

      const results = { evaluated: 0, errors: 0 };
      const today = new Date().toISOString().slice(0, 10);

      for (const snap of snapshots) {
        const currentPrice = priceMap[snap.ticker];
        if (!currentPrice || !snap.target_mean || !snap.price) continue;

        const targetHit = snap.recommendation?.includes("buy")
          ? currentPrice >= snap.target_mean
          : snap.recommendation?.includes("sell")
            ? currentPrice <= snap.target_mean
            : Math.abs(currentPrice - snap.target_mean) / snap.target_mean < 0.05;

        const isBuyRec = snap.recommendation?.includes("buy");
        const isSellRec = snap.recommendation?.includes("sell");
        const priceWentUp = currentPrice > snap.price;
        const directionCorrect = (isBuyRec && priceWentUp) || (isSellRec && !priceWentUp) || (!isBuyRec && !isSellRec);

        const accuracyPct = snap.target_mean > 0
          ? (1 - Math.abs(currentPrice - snap.target_mean) / snap.target_mean) * 100
          : null;

        const daysElapsed = Math.round((new Date(today) - new Date(snap.snapshot_date)) / 86400000);

        try {
          await supabaseUpsert(sbUrl, sbKey, "analyst_accuracy", {
            ticker: snap.ticker,
            snapshot_date: snap.snapshot_date,
            eval_date: today,
            original_price: snap.price,
            original_target: snap.target_mean,
            original_recommendation: snap.recommendation,
            actual_price: currentPrice,
            target_hit: targetHit,
            direction_correct: directionCorrect,
            accuracy_pct: accuracyPct ? parseFloat(accuracyPct.toFixed(2)) : null,
            days_elapsed: daysElapsed,
          }, "ticker,snapshot_date,eval_date");
          results.evaluated++;
        } catch (e) {
          results.errors++;
        }
      }

      return res.status(200).json({ mode: "evaluate", daysBack, ...results });
    }

    return res.status(400).json({ error: "Invalid mode. Use: get, snapshot, or evaluate" });
  } catch (err) {
    console.error("analyst-snapshot error:", err);
    return res.status(500).json({ error: err.message });
  }
}

// Simple Supabase REST helpers (no SDK needed on server)
async function supabaseFetch(url, key, table, params = {}) {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  const res = await fetch(`${url}/rest/v1/${table}?${qs}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Supabase fetch error: ${res.status}`);
  return res.json();
}

async function supabaseUpsert(url, key, table, data, onConflict) {
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: `resolution=merge-duplicates`,
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase upsert error: ${res.status} ${text}`);
  }
}

function getSchema() {
  return {
    tables: [
      {
        name: "analyst_snapshots",
        sql: `CREATE TABLE analyst_snapshots (
  id BIGSERIAL PRIMARY KEY,
  ticker TEXT NOT NULL,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  price NUMERIC,
  recommendation TEXT,
  target_mean NUMERIC,
  target_low NUMERIC,
  target_high NUMERIC,
  num_analysts INTEGER,
  rec_trend JSONB,
  earnings_trend JSONB,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(ticker, snapshot_date)
);
CREATE INDEX idx_snapshots_ticker ON analyst_snapshots(ticker);
CREATE INDEX idx_snapshots_date ON analyst_snapshots(snapshot_date);`,
      },
      {
        name: "analyst_accuracy",
        sql: `CREATE TABLE analyst_accuracy (
  id BIGSERIAL PRIMARY KEY,
  ticker TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  eval_date DATE NOT NULL DEFAULT CURRENT_DATE,
  original_price NUMERIC,
  original_target NUMERIC,
  original_recommendation TEXT,
  actual_price NUMERIC,
  target_hit BOOLEAN,
  direction_correct BOOLEAN,
  accuracy_pct NUMERIC,
  days_elapsed INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(ticker, snapshot_date, eval_date)
);
CREATE INDEX idx_accuracy_ticker ON analyst_accuracy(ticker);`,
      },
    ],
  };
}
