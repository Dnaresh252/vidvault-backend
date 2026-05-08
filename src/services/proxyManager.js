"use strict";

const PROXY_IPS = [
  "31.59.20.176:6754",
  "92.113.242.158:6742",
  "198.23.239.134:6540",
  "45.38.107.97:6014",
  "107.172.163.27:6543",
  "216.10.27.159:6837",
  "142.111.67.146:5611",
  "191.96.254.138:6185",
  "31.58.9.4:6077",
  "23.229.19.94:8689",
];

class ProxyManager {
  constructor() {
    this.proxies = new Map(); // url -> { url, score, lastUsed, cooldownUntil, retired }
  }

  startRefreshing() {
    const user = process.env.WEBSHARE_PROXY_USER;
    const pass = process.env.WEBSHARE_PROXY_PASS;

    if (!user || !pass) {
      console.warn("[ProxyManager] WEBSHARE_PROXY_USER/PASS not set — proxy rotation disabled");
      return;
    }

    for (const ipPort of PROXY_IPS) {
      const url = `http://${user}:${pass}@${ipPort}`;
      this.proxies.set(url, {
        url,
        score: 100,
        lastUsed: 0,
        cooldownUntil: 0,
        retired: false,
      });
    }

    console.log(`✅ ProxyManager: ${this.proxies.size} Webshare proxies loaded`);
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
