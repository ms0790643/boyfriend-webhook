const express = require("express");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
const VERSION = "pilot-gateway-2026-10-07";
const OCARD_URL = "https://api.ocard.co/bot_line/webhook?app_id=boyfriend";
app.use("/webhook", express.raw({ type: "application/json", limit: "2mb" }));

function validSignature(body, signature) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || !signature || !Buffer.isBuffer(body)) return false;
  const expected = crypto.createHmac("sha256", secret).update(body).digest();
  const actual = Buffer.from(signature, "base64");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function aiDecision(events, now = new Date()) {
  if (process.env.AI_NIGHT_TEST_ENABLED !== "true") return "disabled";
  let url;
  try { url = new URL(process.env.AI_WORKER_WEBHOOK_URL); }
  catch { return "missing_or_invalid_worker_url"; }
  if (url.protocol !== "https:") return "worker_url_requires_https";
  const testers = new Set(String(process.env.AI_TEST_USER_IDS || "")
    .split(",").map(id => id.trim()).filter(Boolean));
  if (!testers.size) return "missing_test_user_ids";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const clock = Number(parts.find(p => p.type === "hour").value) * 60 +
    Number(parts.find(p => p.type === "minute").value);
  if (clock < 1260 || clock >= 1305) return "outside_test_window";
  return events.some(e => e.type === "message" && e.message?.type === "text" &&
    e.source?.type === "user" && testers.has(e.source.userId))
    ? "eligible" : "no_eligible_event";
}

async function forward(name, url, body, signature, requestId, timeout) {
  const started = Date.now();
  try {
    const result = await axios.post(url, body, {
      headers: { "Content-Type": "application/json", "x-line-signature": signature },
      transformRequest: [data => data], timeout,
    });
    console.info(JSON.stringify({ requestId, target: name, status: result.status,
      result: "accepted", elapsedMs: Date.now() - started }));
  } catch (error) {
    console.error(JSON.stringify({ requestId, target: name, result: "failed",
      status: error.response?.status || null, code: error.code || null,
      elapsedMs: Date.now() - started }));
  }
}

app.get("/", (_req, res) => res.status(200).json({ status: "ok", version: VERSION }));
app.post("/webhook", (req, res) => {
  const requestId = crypto.randomUUID();
  const signature = req.get("x-line-signature") || "";
  if (!process.env.LINE_CHANNEL_SECRET) {
    console.error(JSON.stringify({ requestId, error: "missing_line_channel_secret" }));
    return res.status(503).send("Missing configuration");
  }
  if (!validSignature(req.body, signature)) return res.status(401).send("Invalid signature");
  let payload;
  try { payload = JSON.parse(req.body.toString("utf8")); }
  catch { return res.status(400).send("Invalid JSON"); }
  if (!payload || !Array.isArray(payload.events) ||
      payload.events.some(e => !e || typeof e !== "object" || Array.isArray(e))) {
    return res.status(400).send("Invalid events");
  }
  if (!payload.events.length) return res.status(200).send("OK");
  const decision = aiDecision(payload.events);
  console.info(JSON.stringify({ requestId, events: payload.events.length, ai: decision }));
  // 試測入口：先回應 LINE，再獨立轉送；尚無持久佇列或自動補送。
  res.status(200).send("OK");
  setImmediate(() => {
    const tasks = [forward("Ocard", OCARD_URL, req.body, signature, requestId, 10000)];
    if (decision === "eligible") tasks.push(forward("AI Worker",
      process.env.AI_WORKER_WEBHOOK_URL, req.body, signature, requestId, 8000));
    Promise.allSettled(tasks).catch(() => {});
  });
});

app.listen(process.env.PORT || 3000, () => console.info("Webhook listening: " + VERSION));
