export const config = { runtime: "edge" };

const TARGET_BASE = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");
const CACHE = caches.default;

const ALLOWED_HEADERS = new Set([
  "accept",
  "accept-language",
  "content-type",
  "user-agent",
  "authorization",
  "range",
]);

const ipMap = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const data = ipMap.get(ip);

  if (!data || now - data.time > 1000) {
    ipMap.set(ip, { count: 1, time: now });
    return true;
  }

  if (data.count > 12) return false;

  data.count++;
  return true;
}

function buildTargetUrl(req) {
  const url = new URL(req.url);
  return TARGET_BASE + url.pathname + url.search;
}

export default async function handler(req) {
  if (!TARGET_BASE) {
    return new Response("Missing TARGET_DOMAIN", { status: 500 });
  }

  const method = req.method;
  const targetUrl = buildTargetUrl(req);

  const cacheKey = new Request(targetUrl, { method: "GET" });

  try {
    const ip =
      req.headers.get("x-forwarded-for") ||
      req.headers.get("x-real-ip") ||
      "unknown";

    if (!rateLimit(ip)) {
      return new Response("Too Many Requests", { status: 429 });
    }

    if (method === "GET") {
      const cached = await CACHE.match(cacheKey);
      if (cached) return cached;
    }

    const headers = new Headers();

    for (const [k, v] of req.headers) {
      const key = k.toLowerCase();
      if (ALLOWED_HEADERS.has(key)) {
        headers.set(key, v);
      }
    }

    headers.set("x-forwarded-proto", "https");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const hasBody = method !== "GET" && method !== "HEAD";

    const res = await fetch(targetUrl, {
      method,
      headers,
      body: hasBody ? req.body : undefined,
      redirect: "manual",
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const newRes = new Response(res.body, res);

    if (method === "GET" && res.ok) {
      newRes.headers.set(
        "Cache-Control",
        "public, s-maxage=60, stale-while-revalidate=300"
      );

      await CACHE.put(cacheKey, newRes.clone());
    }

    return newRes;

  } catch (err) {
    console.error("proxy error:", err);
    return new Response("Bad Gateway", { status: 502 });
  }
}
