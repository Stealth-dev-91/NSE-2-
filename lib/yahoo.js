// Yahoo Finance auth helper — cookie + crumb flow
// Cache crumb in-memory for warm instance reuse (10 min TTL)

let cachedCrumb = null;
let cachedCookie = null;
let cacheTime = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function getAuth() {
  if (cachedCrumb && cachedCookie && Date.now() - cacheTime < CACHE_TTL) {
    return { crumb: cachedCrumb, cookie: cachedCookie };
  }

  // Step 1: Get cookies from Yahoo
  const cookieRes = await fetch("https://fc.yahoo.com/", {
    headers: { "User-Agent": UA },
    redirect: "manual",
  });

  const setCookies = cookieRes.headers.getSetCookie?.() || [];
  const cookieStr = setCookies
    .map((c) => c.split(";")[0])
    .join("; ");

  if (!cookieStr) {
    throw new Error("Failed to get Yahoo cookies");
  }

  // Step 2: Get crumb using cookies
  const crumbRes = await fetch(
    "https://query2.finance.yahoo.com/v1/test/getcrumb",
    {
      headers: {
        "User-Agent": UA,
        Cookie: cookieStr,
      },
    }
  );

  if (!crumbRes.ok) {
    throw new Error(`Failed to get crumb: ${crumbRes.status}`);
  }

  const crumb = await crumbRes.text();

  if (!crumb || crumb.includes("<")) {
    throw new Error("Invalid crumb response");
  }

  cachedCrumb = crumb;
  cachedCookie = cookieStr;
  cacheTime = Date.now();

  return { crumb, cookie: cookieStr };
}

/**
 * Fetch quotes for an array of symbols. Batches into chunks of 50,
 * runs up to 5 batches concurrently for speed.
 */
export async function yahooQuote(symbols) {
  const { crumb, cookie } = await getAuth();
  const BATCH_SIZE = 50;
  const CONCURRENCY = 5;
  const results = [];

  // Split into batches
  const batches = [];
  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    batches.push(symbols.slice(i, i + BATCH_SIZE));
  }

  // Process batches with concurrency limit
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const concurrentBatches = batches.slice(i, i + CONCURRENCY);
    const promises = concurrentBatches.map(async (batch, idx) => {
      const symbolStr = batch.join(",");
      const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${symbolStr}&crumb=${encodeURIComponent(crumb)}`;

      try {
        const res = await fetch(url, {
          headers: { "User-Agent": UA, Cookie: cookie },
        });

        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            cachedCrumb = null;
            cachedCookie = null;
          }
          console.error(`Yahoo batch error: ${res.status} (batch ${i + idx + 1}/${batches.length})`);
          return [];
        }

        const data = await res.json();
        return data.quoteResponse?.result || [];
      } catch (err) {
        console.error(`Yahoo batch fetch error (batch ${i + idx + 1}):`, err.message);
        return [];
      }
    });

    const batchResults = await Promise.all(promises);
    for (const quotes of batchResults) {
      results.push(...quotes);
    }
  }

  return results;
}

export async function yahooSummary(symbol) {
  const { crumb, cookie } = await getAuth();
  const modules = "price,summaryDetail,defaultKeyStatistics,financialData,assetProfile,balanceSheetHistory,incomeStatementHistory,recommendationTrend,earningsTrend";
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=${modules}&crumb=${encodeURIComponent(crumb)}`;

  const res = await fetch(url, {
    headers: { "User-Agent": UA, Cookie: cookie },
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      cachedCrumb = null;
      cachedCookie = null;
    }
    throw new Error(`Yahoo summary API error: ${res.status}`);
  }

  const data = await res.json();
  return data.quoteSummary?.result?.[0] || null;
}
