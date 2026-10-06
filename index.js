const express = require("express");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
const OCARD_WEBHOOK_URL = "https://api.ocard.co/bot_line/webhook?app_id=boyfriend";
const PORT = process.env.PORT || 3000;

// 使用 LINE 傳來的原始內容驗證簽章。
app.use("/webhook", express.raw({ type: "application/json", limit: "2mb" }));

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

  return actual.length === expected.length &&
    crypto.timingSafeEqual(actual, expected);
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

  // 僅在台灣時間 21:00 至 21:45 前進行正式帳號測試。
  return clockMinutes >= 21 * 60 &&
    clockMinutes < 21 * 60 + 45;
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
      event.type ===
