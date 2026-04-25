import { fetchNSEList } from "../lib/nse.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const list = await fetchNSEList();

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=7200");
    return res.status(200).json({
      count: list.length,
      stocks: list.map(s => ({
        symbol: s.symbol,
        name: s.name,
        yahooTicker: s.yahooTicker,
      })),
    });
  } catch (err) {
    console.error("nse-list error:", err);
    return res.status(500).json({ error: err.message });
  }
}
