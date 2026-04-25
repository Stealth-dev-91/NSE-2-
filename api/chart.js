// Yahoo Finance chart data endpoint
// Supports: 1h, 24h, 7d, all-time ranges

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Import auth helper
import { yahooQuote } from "../lib/yahoo.js";

// We need cookie/crumb — reuse from yahoo.js internals
let cachedCrumb = null;
let cachedCookie = null;
let cacheTime = 0;
const CACHE_TTL = 10 * 60 * 1000;

async function getAuth() {
  if (cachedCrumb && cachedCookie && Date.now() - cacheTime < CACHE_TTL) {
    return { crumb: cachedCrumb, cookie: cachedCookie };
  }

  const cookieRes = await fetch("https://fc.yahoo.com/", {
    headers: { "User-Agent": UA },
    redirect: "manual",
  });

  const setCookies = cookieRes.headers.getSetCookie?.() || [];
  const cookieStr = setCookies.map((c) => c.split(";")[0]).join("; ");
  if (!cookieStr) throw new Error("Failed to get Yahoo cookies");

  const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, Cookie: cookieStr },
  });

  if (!crumbRes.ok) throw new Error(`Failed to get crumb: ${crumbRes.status}`);
  const crumb = await crumbRes.text();
  if (!crumb || crumb.includes("<")) throw new Error("Invalid crumb response");

  cachedCrumb = crumb;
  cachedCookie = cookieStr;
  cacheTime = Date.now();
  return { crumb, cookie: cookieStr };
}

// Range presets: { yahoo range, yahoo interval }
const RANGE_CONFIG = {
  "1h":  { range: "1d",   interval: "2m"  },  // 1 day of 2-min candles, we'll trim to last hour
  "24h": { range: "1d",   interval: "5m"  },
  "7d":  { range: "5d",   interval: "15m" },
  "1m":  { range: "1mo",  interval: "1h"  },
  "3m":  { range: "3mo",  interval: "1d"  },
  "1y":  { range: "1y",   interval: "1d"  },
  "all": { range: "max",  interval: "1wk" },
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const ticker = req.query?.ticker;
  const period = req.query?.period || "24h";

  if (!ticker) {
    return res.status(400).json({ error: "Missing ticker param" });
  }

  const config = RANGE_CONFIG[period];
  if (!config) {
    return res.status(400).json({ error: "Invalid period. Use: 1h, 24h, 7d, 1m, 3m, 1y, all" });
  }

  try {
    const { crumb, cookie } = await getAuth();
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${config.range}&interval=${config.interval}&crumb=${encodeURIComponent(crumb)}`;

    const response = await fetch(url, {
      headers: { "User-Agent": UA, Cookie: cookie },
    });

    if (!response.ok) {
      throw new Error(`Yahoo chart API error: ${response.status}`);
    }

    const data = await response.json();
    const result = data.chart?.result?.[0];

    if (!result) {
      return res.status(404).json({ error: "No chart data found" });
    }

    const timestamps = result.timestamp || [];
    const quotes = result.indicators?.quote?.[0] || {};
    const closes = quotes.close || [];
    const meta = result.meta || {};

    // Build data points
    let points = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] != null) {
        points.push({
          t: timestamps[i] * 1000, // ms
          p: Math.round(closes[i] * 100) / 100,
        });
      }
    }

    // For "1h" period, trim to last 60 minutes of data
    if (period === "1h" && points.length > 0) {
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      points = points.filter(pt => pt.t >= oneHourAgo);
    }

    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");
    return res.status(200).json({
      ticker,
      period,
      currency: meta.currency || "INR",
      previousClose: meta.chartPreviousClose || meta.previousClose || null,
      points,
    });
  } catch (err) {
    console.error("chart error:", err);
    return res.status(500).json({ error: err.message });
  }
}
