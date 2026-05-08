"use strict";
const axios = require("axios");

const PROXY_SOURCES = [
  "https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=5000&country=all",
  "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
];

const TEST_URL = "https://www.youtube.com/robots.txt";
const TEST_TIMEOUT_MS = 5_000;
const REFRESH_INTERVAL_MS = 30 * 60 * 1_000;
const TEST_CONCURRENCY = 10;
const MAX_NEW_PER_REFRESH = 200; // cap to avoid long test cycles

class ProxyManager {
  constructor() {
    this.proxies = new Map(); // url -> { url, score, lastUsed, cooldownUntil, retired }
    this.refreshTimer = null;
  }

  _parseList(text) {
    return text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^\d{1,3}(\.\d{1,3}){3}:\d{2,5}$/.test(l))
      .map((l) => `http://${l}`);
  }

  async _fetchRaw() {
    const all = new Set();
    for (const src of PROXY_SOURCES) {
      try {
        const res = await axios.get(src, { timeout: 15_000, responseType: "text" });
        for (const p of this._parseList(String(res.data))) all.add(p);
      } catch (e) {
        console.warn(`[ProxyManager] Fetch failed ${src}: ${e.message}`);
      }
    }
    return [...all];
  }

  async _testOne(proxyUrl) {
    const m = proxyUrl.match(/^https?:\/\/([^:]+):(\d+)/);
    if (!m) return false;
    const [, host, portStr] = m;
    try {
      const res = await axios.get(TEST_URL, {
        proxy: { protocol: "http", host, port: parseInt(portStr, 10) },
        timeout: TEST_TIMEOUT_MS,
        validateStatus: null,
        maxRedirects: 0,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" },
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  async _testBatch(urls) {
    const results = [];
    for (let i = 0; i < urls.length; i += TEST_CONCURRENCY) {
      const chunk = urls.slice(i, i + TEST_CONCURRENCY);
      const out = await Promise.all(
        chunk.map((url) => this._testOne(url).then((ok) => ({ url, ok })))
      );
      results.push(...out);
    }
    return results;
  }

  async refresh() {
    console.log("[ProxyManager] Refreshing proxy pool...");
    const raw = await this._fetchRaw();

    const newUrls = raw
      .filter((url) => !this.proxies.has(url))
      .slice(0, MAX_NEW_PER_REFRESH);

    if (newUrls.length > 0) {
      console.log(`[ProxyManager] Testing ${newUrls.length} new proxies...`);
      const tested = await this._testBatch(newUrls);
      let added = 0;
      for (const { url, ok } of tested) {
        if (ok) {
          this.proxies.set(url, {
            url,
            score: 60,
            lastUsed: 0,
            cooldownUntil: 0,
            retired: false,
          });
          added++;
        }
      }
      console.log(`[ProxyManager] +${added} verified. Pool: ${this.proxies.size}`);
    } else {
      console.log(`[ProxyManager] No new proxies. Pool: ${this.proxies.size}`);
    }

    // Prune retired entries to keep the map lean
    for (const [url, p] of this.proxies) {
      if (p.retired) this.proxies.delete(url);
    }
  }

  startRefreshing() {
    this.refresh().catch((e) =>
      console.error("[ProxyManager] Initial refresh error:", e.message)
    );
    this.refreshTimer = setInterval(
      () =>
        this.refresh().catch((e) =>
          console.error("[ProxyManager] Refresh error:", e.message)
        ),
      REFRESH_INTERVAL_MS
    );
    console.log("✅ ProxyManager: refresh every 30 min");
  }

  // Returns the least-recently-used healthy proxy URL, or null for direct connection.
  getBestProxy() {
    const now = Date.now();
    let best = null;
    for (const proxy of this.proxies.values()) {
      if (proxy.retired || proxy.score < 20) continue;
      if (proxy.cooldownUntil > now) continue;
      if (!best || proxy.lastUsed < best.lastUsed) best = proxy;
    }
    if (best) {
      best.lastUsed = Date.now();
      return best.url;
    }
    return null;
  }

  // Call after every download attempt to update proxy health.
  recordResult(proxyUrl, success, errorCode = null) {
    if (!proxyUrl) return;
    const proxy = this.proxies.get(proxyUrl);
    if (!proxy) return;

    if (success) {
      proxy.score = Math.min(100, proxy.score + 5);
      return;
    }

    const code = String(errorCode || "");
    const now = Date.now();
    if (code === "500") {
      // Connection/tunnel failure — retire immediately, no point retrying
      proxy.score = 0;
    } else if (code.includes("429")) {
      proxy.score -= 30;
      proxy.cooldownUntil = now + 15 * 60 * 1_000;
    } else if (code.includes("403")) {
      proxy.score -= 60;
      proxy.cooldownUntil = now + 2 * 60 * 60 * 1_000;
    } else {
      proxy.score -= 15;
    }

    if (proxy.score < 20) {
      proxy.retired = true;
      this.proxies.delete(proxyUrl);
      console.log(`[ProxyManager] Retired ${proxyUrl}`);
    }
  }

  getStats() {
    const now = Date.now();
    const all = [...this.proxies.values()];
    return {
      total: all.length,
      healthy: all.filter((p) => !p.retired && p.score >= 20 && p.cooldownUntil <= now).length,
      cooldown: all.filter((p) => !p.retired && p.cooldownUntil > now).length,
    };
  }
}

module.exports = new ProxyManager();
