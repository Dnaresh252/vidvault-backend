"use strict";
const axios = require("axios");

const WEBSHARE_API =
  "https://proxy.webshare.io/api/v2/proxy/list/?mode=direct&page=1&page_size=100";
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1_000; // 24 hours

class ProxyManager {
  constructor() {
    this.proxies = new Map(); // url -> { url, score, lastUsed, cooldownUntil, retired }
    this.refreshTimer = null;
  }

  async _fetchFromAPI() {
    const apiKey = process.env.WEBSHARE_API_KEY;
    if (!apiKey) {
      console.warn("[ProxyManager] WEBSHARE_API_KEY not set — skipping fetch");
      return [];
    }

    const res = await axios.get(WEBSHARE_API, {
      headers: { Authorization: `Token ${apiKey}` },
      timeout: 15_000,
    });

    return res.data.results.map(
      ({ proxy_address, port, username, password }) =>
        `http://${username}:${password}@${proxy_address}:${port}`
    );
  }

  async _loadProxies() {
    let urls;
    try {
      urls = await this._fetchFromAPI();
    } catch (e) {
      console.error(`[ProxyManager] API fetch failed — keeping existing pool (${this.proxies.size} proxies): ${e.message}`);
      return;
    }

    if (urls.length === 0) {
      console.warn("[ProxyManager] API returned 0 proxies — keeping existing pool");
      return;
    }

    // Add new proxies at full health; preserve scores for ones already in pool
    const urlSet = new Set(urls);
    let added = 0;
    for (const url of urls) {
      if (!this.proxies.has(url)) {
        this.proxies.set(url, {
          url,
          score: 100,
          lastUsed: 0,
          cooldownUntil: 0,
          retired: false,
        });
        added++;
      }
    }

    // Remove proxies no longer returned by the API
    for (const url of this.proxies.keys()) {
      if (!urlSet.has(url)) this.proxies.delete(url);
    }

    console.log(`✅ ProxyManager: ${this.proxies.size} proxies loaded (+${added} new from API)`);
  }

  startRefreshing() {
    this._loadProxies().catch((e) =>
      console.error("[ProxyManager] Initial load error:", e.message)
    );
    this.refreshTimer = setInterval(
      () =>
        this._loadProxies().catch((e) =>
          console.error("[ProxyManager] Refresh error:", e.message)
        ),
      REFRESH_INTERVAL_MS
    );
    console.log("✅ ProxyManager: Webshare API refresh every 24 h");
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
      // Connection/tunnel failure — retire immediately
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
