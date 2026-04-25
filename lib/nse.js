// Fetch full NSE equity list + industry data from NSE archives (public CSVs, no auth)

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

let cachedList = null;
let cacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Returns array of { symbol, name, yahooTicker, industry }
 * Merges EQUITY_L.csv (all stocks) with Nifty Total Market + Nifty 500 (for industry).
 */
export async function fetchNSEList() {
  if (cachedList && Date.now() - cacheTime < CACHE_TTL) {
    return cachedList;
  }

  // Fetch all 3 CSVs in parallel
  const [equityRes, totalMktRes, nifty500Res] = await Promise.all([
    fetch("https://archives.nseindia.com/content/equities/EQUITY_L.csv", { headers: { "User-Agent": UA } }),
    fetch("https://archives.nseindia.com/content/indices/ind_niftytotalmarket_list.csv", { headers: { "User-Agent": UA } }).catch(() => null),
    fetch("https://archives.nseindia.com/content/indices/ind_nifty500list.csv", { headers: { "User-Agent": UA } }).catch(() => null),
  ]);

  if (!equityRes.ok) {
    throw new Error(`NSE equity CSV fetch failed: ${equityRes.status}`);
  }

  // Build industry map from Total Market + Nifty 500
  const industryMap = {};

  for (const res of [totalMktRes, nifty500Res]) {
    if (!res || !res.ok) continue;
    const csv = await res.text();
    const lines = csv.trim().split("\n");
    // Header: Company Name,Industry,Symbol,Series,ISIN Code
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map(c => c.trim());
      if (cols.length < 3) continue;
      const symbol = cols[2];
      const industry = cols[1];
      if (symbol && industry) {
        industryMap[symbol] = industry;
      }
    }
  }

  // Parse main equity list
  const equityCsv = await equityRes.text();
  const lines = equityCsv.trim().split("\n");

  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map(c => c.trim());
    if (cols.length < 3) continue;

    const symbol = cols[0];
    const name = cols[1];
    const series = cols[2];

    // Only include regular equity (EQ series)
    if (series !== "EQ") continue;
    if (!symbol) continue;

    const yahooTicker = symbol.replace("&", "%26") + ".NS";

    results.push({
      symbol,
      name,
      yahooTicker,
      industry: industryMap[symbol] || null,
    });
  }

  cachedList = results;
  cacheTime = Date.now();

  console.log(`NSE list: ${results.length} stocks, ${Object.keys(industryMap).length} with industry data`);

  return results;
}
