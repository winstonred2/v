export const config = { runtime: "edge" };

const TARGET_BASE = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");

const STRIP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
]);

function buildTargetUrl(req) {
  const url = new URL(req.url);
  return TARGET_BASE + url.pathname + url.search;
}

export default async function handler(req) {
  if (!TARGET_BASE) {
    return new Response("Misconfigured: TARGET_DOMAIN is not set", { status: 500 });
  }

  try {
    const targetUrl = buildTargetUrl(req);

    // بهتر: clone مستقیم headers (کمتر break)
    const headers = new Headers(req.headers);

    // پاکسازی minimal (نه aggressive)
    for (const h of STRIP_HEADERS) {
      headers.delete(h);
    }

    // مهم برای سازگاری TLS / routing
    headers.set("x-forwarded-proto", "https");

    // host واقعی upstream (کمک به سازگاری xhttp)
    headers.set("host", new URL(TARGET_BASE).host);

    const method = req.method;
    const hasBody = method !== "GET" && method !== "HEAD";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);

    const res = await fetch(targetUrl, {
      method,
      headers,
      body: hasBody ? req.body : undefined,
      redirect: "manual",
      signal: controller.signal,
    });

    clearTimeout(timeout);

    // پاس-through کامل (برای XHTTP مهمه)
    const newRes = new Response(res.body, res);

    return newRes;

  } catch (err) {
    console.error("relay error:", err);
    return new Response("Bad Gateway", { status: 502 });
  }
}
