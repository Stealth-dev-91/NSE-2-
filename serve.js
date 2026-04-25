import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Dynamically import API handlers
const stocksHandler = (await import("./api/stocks.js")).default;
const detailHandler = (await import("./api/detail.js")).default;
const newsHandler = (await import("./api/news.js")).default;
const nseListHandler = (await import("./api/nse-list.js")).default;
const chartHandler = (await import("./api/chart.js")).default;
const analystSnapshotHandler = (await import("./api/analyst-snapshot.js")).default;

const indexPath = join(__dirname, "public", "index.html");

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const query = Object.fromEntries(url.searchParams);

  // Minimal req/res shim for Vercel-style handlers
  const fakeReq = { method: req.method, url: req.url, query, headers: req.headers };
  const fakeRes = {
    _status: 200,
    _headers: {},
    setHeader(k, v) { this._headers[k] = v; },
    status(code) { this._status = code; return this; },
    json(data) {
      res.writeHead(this._status, { ...this._headers, "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    },
    end() { res.writeHead(this._status, this._headers); res.end(); },
  };

  try {
    if (url.pathname === "/api/stocks") {
      await stocksHandler(fakeReq, fakeRes);
    } else if (url.pathname === "/api/detail") {
      await detailHandler(fakeReq, fakeRes);
    } else if (url.pathname === "/api/news") {
      await newsHandler(fakeReq, fakeRes);
    } else if (url.pathname === "/api/chart") {
      await chartHandler(fakeReq, fakeRes);
    } else if (url.pathname === "/api/nse-list") {
      await nseListHandler(fakeReq, fakeRes);
    } else if (url.pathname === "/api/analyst-snapshot") {
      fakeReq.method = req.method;
      await analystSnapshotHandler(fakeReq, fakeRes);
    } else {
      res.writeHead(200, { "Content-Type": "text/html", "Access-Control-Allow-Origin": "*" });
      res.end(readFileSync(indexPath, "utf8"));
    }
  } catch (err) {
    console.error(err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`NSE Screener dev server: http://localhost:${PORT}`));
