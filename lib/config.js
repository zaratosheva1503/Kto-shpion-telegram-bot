"use strict";

// Centralised configuration and URL helpers extracted from server.js.

function normalizePublicUrl(value) {
  return String(value).replace(/\/$/, "");
}

const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_URL = normalizePublicUrl(
  process.env.PUBLIC_URL ||
    process.env.WEBAPP_URL ||
    `http://localhost:${PORT}`,
);
const SPY_IMAGE = process.env.SPY_IMAGE || `${PUBLIC_URL}/assets/cards/spy.svg`;
const ADMIN_USER_IDS = String(process.env.ADMIN_USER_IDS || "")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter(Boolean);
const ADMIN_AUTH_MAX_AGE_SECONDS = Number(
  process.env.ADMIN_AUTH_MAX_AGE_SECONDS || 24 * 60 * 60,
);
const ADMIN_COSMETIC_KINDS = [
  "frames",
  "themes",
  "nameEffects",
  "statusEmojis",
  "animatedAvatars",
];

// === Matchmaking ===
const MATCHMAKING_MIN = 3;
const MATCHMAKING_MAX = 8;
const MATCHMAKING_JOIN_WINDOW_MS = 15000;

// === Stability ===
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 1024 * 100);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 10000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 120);
const ROOM_TTL_MS = Number(process.env.ROOM_TTL_MS || 6 * 60 * 60 * 1000);

function getTelegramSafeUrl(value) {
  const url = new URL(value);
  url.username = "";
  url.password = "";
  return url.toString();
}

function getBrowserUrl(value) {
  return value;
}

function getRoomLink(code, botUsername, safeForTelegram = false) {
  const publicUrl = safeForTelegram
    ? getTelegramSafeUrl(PUBLIC_URL)
    : getBrowserUrl(PUBLIC_URL);
  const base = `${publicUrl}/?join=${encodeURIComponent(code)}`;
  return botUsername ? `${base}&bot=${encodeURIComponent(botUsername)}` : base;
}

function toPublicAsset(value) {
  if (!value) return value;
  if (/^https?:\/\//.test(value)) return getTelegramSafeUrl(value);
  return getTelegramSafeUrl(
    `${PUBLIC_URL}/${String(value).replace(/^\//, "")}`,
  );
}

function isAdminId(id) {
  return ADMIN_USER_IDS.includes(Number(id));
}

function getAdminPanelUrl(botUsername) {
  const safeUrl = getTelegramSafeUrl(PUBLIC_URL);
  const url = `${safeUrl}/?admin=1`;
  return botUsername ? `${url}&bot=${encodeURIComponent(botUsername)}` : url;
}

module.exports = {
  normalizePublicUrl,
  BOT_TOKEN,
  PORT,
  PUBLIC_URL,
  SPY_IMAGE,
  ADMIN_USER_IDS,
  ADMIN_AUTH_MAX_AGE_SECONDS,
  ADMIN_COSMETIC_KINDS,
  MATCHMAKING_MIN,
  MATCHMAKING_MAX,
  MATCHMAKING_JOIN_WINDOW_MS,
  MAX_BODY_BYTES,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX,
  ROOM_TTL_MS,
  getTelegramSafeUrl,
  getBrowserUrl,
  getRoomLink,
  toPublicAsset,
  isAdminId,
  getAdminPanelUrl,
};
