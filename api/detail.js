import { yahooSummary } from "../lib/yahoo.js";

function raw(obj) {
  if (obj == null) return null;
  // Empty objects {} mean "no data" from Yahoo
  if (typeof obj === "object") {
    if ("raw" in obj) return obj.raw;
    if (Object.keys(obj).length === 0) return null;
    return null;
  }
  return obj;
}

// Try multiple sources for a value, return first non-null
function first(...vals) {
  for (const v of vals) {
    const r = raw(v);
    if (r != null && !isNaN(r)) return r;
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const ticker = req.query?.ticker;
  if (!ticker) {
    return res.status(400).json({ error: "Missing ticker param" });
  }

  try {
    const data = await yahooSummary(ticker);
    if (!data) {
      return res.status(404).json({ error: "Ticker not found" });
    }

    const p = data.price || {};
    const sd = data.summaryDetail || {};
    const ks = data.defaultKeyStatistics || {};
    const fd = data.financialData || {};
    const ap = data.assetProfile || {};

    // Compute ROE/ROA from financial statements if not in financialData
    let computedROE = null;
    let computedROA = null;
    try {
      const bs = data.balanceSheetHistory?.balanceSheetStatements?.[0];
      const is = data.incomeStatementHistory?.incomeStatementHistory?.[0];
      if (bs && is) {
        const netIncome = raw(is.netIncome);
        const totalEquity = raw(bs.totalStockholderEquity);
        const totalAssets = raw(bs.totalAssets);
        if (netIncome != null && totalEquity && totalEquity !== 0) {
          computedROE = netIncome / totalEquity;
        }
        if (netIncome != null && totalAssets && totalAssets !== 0) {
          computedROA = netIncome / totalAssets;
        }
      }
    } catch(e) { /* ignore computation errors */ }

    const result = {
      // Price
      price: first(p.regularMarketPrice, fd.currentPrice),
      change: first(p.regularMarketChange),
      changePct: first(p.regularMarketChangePercent),
      mcap: first(p.marketCap, sd.marketCap),
      volume: first(p.regularMarketVolume, sd.volume),
      name: p.shortName || p.longName || ticker,

      // Valuation
      pe: first(sd.trailingPE, ks.trailingPE, p.trailingPE),
      forwardPe: first(sd.forwardPE, ks.forwardPE, p.forwardPE),
      pb: first(sd.priceToBook, ks.priceToBook),
      evToEbitda: first(ks.enterpriseToEbitda),
      pegRatio: first(ks.pegRatio),
      divYield: first(sd.dividendYield, sd.trailingAnnualDividendYield),
      eps: first(ks.trailingEps),

      // Quality — try multiple sources, fall back to computed from statements
      roe: first(fd.returnOnEquity, ks.returnOnEquity) ?? computedROE,
      roa: first(fd.returnOnAssets, ks.returnOnAssets) ?? computedROA,
      profitMargin: first(fd.profitMargins, ks.profitMargins),
      operatingMargin: first(fd.operatingMargins, ks.operatingMargins),
      grossMargin: first(fd.grossMargins),

      // Health
      debtToEquity: first(fd.debtToEquity),
      currentRatio: first(fd.currentRatio),
      quickRatio: first(fd.quickRatio),

      // Growth
      revenueGrowth: first(fd.revenueGrowth),
      earningsGrowth: first(fd.earningsGrowth),
      revenue: first(fd.totalRevenue),
      ebitda: first(fd.ebitda),
      freeCashflow: first(fd.freeCashflow),

      // Risk
      beta: first(ks.beta, sd.beta),

      // 52-week
      high52w: first(sd.fiftyTwoWeekHigh),
      low52w: first(sd.fiftyTwoWeekLow),
      avg50: first(sd.fiftyDayAverage),
      avg200: first(sd.twoHundredDayAverage),

      // Analyst
      targetHigh: first(fd.targetHighPrice),
      targetLow: first(fd.targetLowPrice),
      targetMean: first(fd.targetMeanPrice),
      recommendation: fd.recommendationKey || null,
      numAnalysts: first(fd.numberOfAnalystOpinions),

      // Company
      sector: ap.sector || null,
      industry: ap.industry || null,
      website: ap.website || null,
      employees: first(ap.fullTimeEmployees),
      longBusinessSummary: ap.longBusinessSummary || null,

      // Analyst Trends (for tracking accuracy over time)
      recommendationTrend: (data.recommendationTrend?.trend || []).map(t => ({
        period: t.period,
        strongBuy: t.strongBuy || 0,
        buy: t.buy || 0,
        hold: t.hold || 0,
        sell: t.sell || 0,
        strongSell: t.strongSell || 0,
      })),

      // Earnings estimates
      earningsTrend: (data.earningsTrend?.trend || []).map(t => ({
        period: t.period,
        growth: raw(t.growth),
        earningsEst: t.earningsEstimate ? {
          avg: raw(t.earningsEstimate.avg),
          low: raw(t.earningsEstimate.low),
          high: raw(t.earningsEstimate.high),
          yearAgoEps: raw(t.earningsEstimate.yearAgoEps),
          numAnalysts: raw(t.earningsEstimate.numberOfAnalysts),
        } : null,
      })),
    };

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json(result);
  } catch (err) {
    console.error("detail error:", err);
    return res.status(500).json({ error: err.message });
  }
}
