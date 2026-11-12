"use strict";

const http = require("node:http");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 10000);
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || "";
const ELEVARE_ADMIN_TOKEN = process.env.ELEVARE_ADMIN_TOKEN || "";
const TARGET_USER_ID = "bca2d16f-67c1-437a-97f4-d9059f6882f2";
const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 5;
const attempts = new Map();

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function safeEqual(a, b) {
  const left = Buffer.from(a || "");
  const right = Buffer.from(b || "");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function rateLimited(key) {
  const now = Date.now();
  const current = attempts.get(key) || { count: 0, resetAt: now + WINDOW_MS };
  if (now > current.resetAt) {
    current.count = 0;
    current.resetAt = now + WINDOW_MS;
  }
  current.count += 1;
  attempts.set(key, current);
  return current.count > MAX_REQUESTS;
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 4096) throw new Error("PAYLOAD_TOO_LARGE");
  }
  return JSON.parse(raw || "{}");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, { ok: true, service: "elevare-one-admin-api" });
  }

  if (url.pathname !== "/admin/reset-password" || req.method !== "POST") {
    return send(res, 404, { error: "Not found" });
  }

  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !ELEVARE_ADMIN_TOKEN) {
    return send(res, 503, { error: "Service not configured" });
  }

  const origin = req.headers.origin;
  if (origin && origin !== "https://elevare-one.onrender.com") {
    return send(res, 403, { error: "Origin not allowed" });
  }

  const auth = req.headers.authorization || "";
  const suppliedToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!safeEqual(suppliedToken, ELEVARE_ADMIN_TOKEN)) {
    return send(res, 401, { error: "Unauthorized" });
  }

  const clientIp = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").toString().split(",")[0].trim();
  if (rateLimited(clientIp)) {
    return send(res, 429, { error: "Too many attempts. Try again in 15 minutes." });
  }

  let payload;
  try {
    payload = await readJson(req);
  } catch {
    return send(res, 400, { error: "Invalid request body" });
  }

  const password = typeof payload.password === "string" ? payload.password : "";
  if (password.length < 12 || password.length > 128) {
    return send(res, 400, { error: "Password must contain between 12 and 128 characters." });
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${TARGET_USER_ID}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_SECRET_KEY,
        "Authorization": `Bearer ${SUPABASE_SECRET_KEY}`
      },
      body: JSON.stringify({ password })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error("Supabase admin update failed:", response.status, error.code || error.msg || error.message || "unknown");
      return send(res, 502, { error: "Supabase rejected the password update.", status: response.status });
    }

    return send(res, 200, { ok: true, message: "Password updated." });
  } catch (error) {
    console.error("Password update request failed:", error.message);
    return send(res, 502, { error: "Could not reach Supabase." });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`ELEVARE ONE admin API listening on port ${PORT}`);
});
