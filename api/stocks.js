import { yahooQuote } from "../lib/yahoo.js";
import { fetchNSEList } from "../lib/nse.js";

// ─── SERVER-SIDE CACHE ───
// Cache full results for 5 minutes to avoid re-fetching 2000+ stocks on every request
let cachedResponse = null;
let cachedResponseTime = 0;
const RESPONSE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Map NSE industry names to broader sectors
const INDUSTRY_TO_SECTOR = {
  "Financial Services": "Financial Services",
  "Banks": "Financial Services",
  "IT - Software": "Information Technology",
  "IT - Services": "Information Technology",
  "IT - Hardware": "Information Technology",
  "Pharmaceuticals & Biotechnology": "Healthcare",
  "Healthcare": "Healthcare",
  "Healthcare Equipment & Supplies": "Healthcare",
  "Oil Gas & Consumable Fuels": "Energy",
  "Power": "Energy",
  "Automobile": "Automobile",
  "Auto Components": "Automobile",
  "Fast Moving Consumer Goods": "FMCG",
  "Consumer Durables": "Consumer",
  "Consumer Services": "Consumer",
  "Textiles": "Consumer",
  "Metals & Mining": "Metals & Mining",
  "Construction Materials": "Materials",
  "Chemicals": "Materials",
  "Cement & Cement Products": "Materials",
  "Construction": "Infrastructure",
  "Capital Goods": "Industrials",
  "Industrial Manufacturing": "Industrials",
  "Services": "Services",
  "Telecommunication": "Telecom",
  "Media Entertainment & Publication": "Media",
  "Realty": "Real Estate",
  "Diversified": "Conglomerate",
  "Forest Materials": "Materials",
  "Tobacco": "FMCG",
  "Fertilizers & Agrochemicals": "Agriculture",
  "Agricultural Food & other Products": "Agriculture",
  "Diamond Gems and Jewellery": "Consumer",
  "Leisure Services": "Consumer",
  "Retailing": "Consumer",
  "Transport Services": "Services",
  "Transport Infrastructure": "Infrastructure",
};

function getSector(industry) {
  if (!industry) return null;
  if (INDUSTRY_TO_SECTOR[industry]) return INDUSTRY_TO_SECTOR[industry];
  // Fuzzy match
  for (const [key, sector] of Object.entries(INDUSTRY_TO_SECTOR)) {
    if (industry.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(industry.toLowerCase())) {
      return sector;
    }
  }
  return "Other";
}

function mapQuote(q) {
  const ticker = q.symbol;
  const high52 = q.fiftyTwoWeekHigh || 0;
  const low52 = q.fiftyTwoWeekLow || 0;
  const price = q.regularMarketPrice || 0;
  const range52 = high52 - low52;
  const pos52 = range52 > 0 ? ((price - low52) / range52) * 100 : 50;

  return {
    ticker,
    name: q.shortName || q.longName || ticker,
    sector: q.sector || null,
    industry: q.industry || null,
    price,
    changePct: q.regularMarketChangePercent || 0,
    mcap: q.marketCap || 0,
    pe: q.trailingPE || null,
    forwardPe: q.forwardPE || null,
    pb: q.priceToBook || null,
    divYield: q.trailingAnnualDividendYield ? q.trailingAnnualDividendYield * 100 : null,
    eps: q.epsTrailingTwelveMonths || null,
    high52w: high52,
    low52w: low52,
    avg50: q.fiftyDayAverage || null,
    avg200: q.twoHundredDayAverage || null,
    abv50: price > (q.fiftyDayAverage || Infinity),
    abv200: price > (q.twoHundredDayAverage || Infinity),
    pos52: Math.round(pos52 * 10) / 10,
    volume: q.regularMarketVolume || 0,
    avgVolume: q.averageDailyVolume3Month || 0,
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // Determine which tickers to fetch
    const mode = req.query?.mode || "all"; // "all" | "nifty50" | "custom"
    const noExtraTickers = !req.query?.tickers;

    // Return cached response for full NSE mode if fresh (avoids re-fetching 2000+ stocks)
    if (mode === "all" && noExtraTickers && cachedResponse && Date.now() - cachedResponseTime < RESPONSE_CACHE_TTL) {
      console.log("Returning cached full NSE response");
      res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
      return res.status(200).json(cachedResponse);
    }

    let tickers = [];

    if (mode === "nifty50") {
      tickers = NIFTY_50;
    } else if (mode === "custom") {
      const custom = req.query?.tickers;
      if (custom) {
        tickers = custom.split(",").map(t => t.trim()).filter(Boolean);
      }
    } else {
      const nseList = await fetchNSEList();
      tickers = nseList.map(s => s.yahooTicker);

      const extra = req.query?.tickers;
      if (extra) {
        const extraList = extra.split(",").map(t => t.trim()).filter(Boolean);
        for (const t of extraList) {
          if (!tickers.includes(t)) tickers.push(t);
        }
      }
    }

    console.log(`Fetching ${tickers.length} tickers (mode: ${mode})...`);

    // Build industry lookup from NSE data
    const nseList = await fetchNSEList();
    const industryLookup = {};
    for (const s of nseList) {
      if (s.industry) {
        industryLookup[s.yahooTicker] = s.industry;
        // Also map the decoded version (M%26M.NS → M&M.NS)
        industryLookup[s.yahooTicker.replace("%26", "&")] = s.industry;
      }
    }

    const quotes = await yahooQuote(tickers);
    const mapped = quotes
      .map(q => {
        const stock = mapQuote(q);
        // Attach industry from NSE data
        if (!stock.industry) {
          stock.industry = industryLookup[stock.ticker] || industryLookup[stock.ticker.replace("%26", "&")] || null;
        }
        // Derive sector from industry
        if (!stock.sector && stock.industry) {
          stock.sector = getSector(stock.industry);
        }
        return stock;
      })
      .filter(s => s.price > 0); // Filter out dead/suspended tickers

    // Collect unique sectors and industries for frontend filters
    const sectors = [...new Set(mapped.map(s => s.sector).filter(Boolean))].sort();
    const industries = [...new Set(mapped.map(s => s.industry).filter(Boolean))].sort();

    const responseBody = {
      stocks: mapped,
      sectors,
      industries,
      totalTickers: tickers.length,
      returnedCount: mapped.length,
      updatedAt: new Date().toISOString(),
    };

    // Cache full NSE response for warm instance reuse
    if (mode === "all" && noExtraTickers) {
      cachedResponse = responseBody;
      cachedResponseTime = Date.now();
    }

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json(responseBody);
  } catch (err) {
    console.error("stocks error:", err);
    return res.status(500).json({ error: err.message });
  }
}

// Kept for backward compatibility with mode=nifty50
const NIFTY_50 = [
  "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS",
  "HINDUNILVR.NS", "ITC.NS", "SBIN.NS", "BHARTIARTL.NS", "BAJFINANCE.NS",
  "KOTAKBANK.NS", "LT.NS", "HCLTECH.NS", "ASIANPAINT.NS", "MARUTI.NS",
  "AXISBANK.NS", "SUNPHARMA.NS", "TATAMOTORS.NS", "TITAN.NS", "WIPRO.NS",
  "ULTRACEMCO.NS", "NESTLEIND.NS", "POWERGRID.NS", "NTPC.NS", "M%26M.NS",
  "ONGC.NS", "ADANIENT.NS", "COALINDIA.NS", "DRREDDY.NS", "TATASTEEL.NS",
  "BAJAJFINSV.NS", "JSWSTEEL.NS", "TECHM.NS", "INDUSINDBK.NS", "HINDALCO.NS",
  "APOLLOHOSP.NS", "CIPLA.NS", "EICHERMOT.NS", "DIVISLAB.NS", "BPCL.NS",
  "TATACONSUM.NS", "HEROMOTOCO.NS", "GRASIM.NS", "SBILIFE.NS", "BRITANNIA.NS",
  "HDFCLIFE.NS", "BAJAJ-AUTO.NS", "SHRIRAMFIN.NS", "TRENT.NS", "ADANIPORTS.NS",
];
