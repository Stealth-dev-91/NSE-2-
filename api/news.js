function timeAgo(dateStr) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = block.match(/<title><!\[CDATA\[(.*?)\]\]>|<title>(.*?)<\/title>/);
    const link = block.match(/<link>(.*?)<\/link>/);
    const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/);
    const source = block.match(/<source[^>]*>(.*?)<\/source>/);

    items.push({
      title: title ? (title[1] || title[2] || "").trim() : "",
      link: link ? link[1].trim() : "",
      pubDate: pubDate ? pubDate[1].trim() : "",
      source: source ? source[1].trim() : "Google News",
      timeAgo: pubDate ? timeAgo(pubDate[1].trim()) : "",
    });
  }

  return items;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const query = req.query?.q || "NSE India stock market";
  const limit = parseInt(req.query?.limit || "6", 10);

  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
    const rssRes = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!rssRes.ok) {
      throw new Error(`Google News RSS error: ${rssRes.status}`);
    }

    const xml = await rssRes.text();
    const items = parseRSS(xml).slice(0, limit);

    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=1200");
    return res.status(200).json({ articles: items });
  } catch (err) {
    console.error("news error:", err);
    return res.status(500).json({ error: err.message, articles: [] });
  }
}
