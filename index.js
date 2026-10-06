const express = require("express");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
const OCARD_WEBHOOK_URL =
  "https://api.ocard.co/bot_line/webhook?app_id=boyfriend";
const PORT = process.env.PORT || 3000;

app.use(
  "/webhook",
  express.raw({ type: "application/json", limit: "2mb" })
);

function isValidLineSignature(body, signature, secret) {
  if (!signature || !secret || !Buffer.isBuffer(body)) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest();

  let actual;
  try {
    actual = Buffer.from(signature, "base64");
  } catch {
    return false;
  }

  return (
    actual.length === expected.length &&
    crypto.timingSafeEqual(actual, expected)
  );
}

function isSafeTestWindowInTaipei(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const clockMinutes = hour * 60 + minute;

  // 目前試測時段：台灣時間 21:00 至 21:45，不含 21:45。
  return clockMinutes >= 21 * 60 && clockMinutes < 21 * 60 + 45;
}

function configuredTesters() {
  return new Set(
    String(process.env.AI_TEST_USER_IDS || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  );
}

function shouldSendToAi(events) {
  if (
    process.env.AI_NIGHT_TEST_ENABLED !== "true" ||
    !isSafeTestWindowInTaipei()
  ) {
    return false;
  }

  const testers = configuredTesters();
  if (testers.size === 0 || !process.env.AI_WORKER_WEBHOOK_URL) {
    return false;
  }

  return events.some(
    (event) =>
      event.type === "message" &&
      event.message?.type === "text" &&
      !String(event.message.text).includes("請綁定您的會員") &&
      event.source?.type === "user" &&
      testers.has(event.source?.userId)
  );
}

app.get("/", (_req, res) => res.status(200).send("OK"));

app.post("/webhook", async (req, res) => {
  const rawBody = req.body;
  const signature = req.get("x-line-signature") || "";

  if (
    !isValidLineSignature(
      rawBody,
      signature,
      process.env.LINE_CHANNEL_SECRET
    )
  ) {
    return res.status(401).send("Invalid LINE signature");
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).send("Invalid JSON");
  }

  const events = Array.isArray(payload.events) ? payload.events : [];

  // LINE Webhook 驗證使用空事件，直接正常回應。
  if (events.length === 0) {
    return res.status(200).send("OK");
  }

  // 保留原本的會員綁定文字攔截條件。
  const firstText = events[0]?.message?.text || "";
  const ocardIntercepted = firstText.includes("請綁定您的會員");

  if (!ocardIntercepted) {
    try {
      await axios.post(OCARD_WEBHOOK_URL, payload, {
        headers: { "Content-Type": "application/json" },
        timeout: 10000,
      });
    } catch (error) {
      console.error(
        "Ocard forwarding failed:",
        error.response?.status || error.message
      );
      return res.status(502).send("Ocard forwarding failed");
    }
  }

  if (shouldSendToAi(events)) {
    try {
      await axios.post(process.env.AI_WORKER_WEBHOOK_URL, rawBody, {
        headers: {
          "Content-Type": "application/json",
          "x-line-signature": signature,
        },
        timeout: 8000,
      });
    } catch (error) {
      console.error(
        "AI Worker forwarding failed:",
        error.response?.status || error.message
      );
      // AI 轉發失敗只記錄，不額外傳送忙碌訊息給客人。
    }
  }

  return res.status(200).send("OK");
});

app.listen(PORT, () => {
  console.log(`Webhook listening on ${PORT}`);
});
