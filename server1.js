const crypto = require("crypto");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { Telegraf, Markup } = require("telegraf");
const { PACKS } = require("./data/packs");
const storage = require("./data/storage");
const cosmetics = require("./data/cosmetics");
const {
  setupWebSocket,
  broadcastRoom,
  broadcastChat,
  broadcastReaction,
  isPlayerOnline,
  getOnlineUserIds,
  notifyUser,
} = require("./ws-server");

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
// [ANTI-CHEAT] Optional strict identity check. When enabled, actions that claim
// a player id must prove it via Telegram WebApp initData. Default OFF so the
// current browser clients keep working exactly as before.
const STRICT_AUTH = ["1", "true", "yes", "on"].includes(
  String(process.env.STRICT_AUTH || "").toLowerCase(),
);
const packById = new Map(PACKS.map((pack) => [pack.id, pack]));
const botState = { username: process.env.BOT_USERNAME || "" };
const rooms = new Map();
const users = new Map();
const chats = new Map();

// [STABILITY] Lightweight per-IP rate limiting for /api/* endpoints.
const RATE_LIMIT_WINDOW_MS = 10000;
const RATE_LIMIT_MAX = 120;
const rateBuckets = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.reset) {
    rateBuckets.set(ip, { count: 1, reset: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT_MAX;
}

// === Matchmaking ===
const MATCHMAKING_MIN = 3;
const MATCHMAKING_MAX = 8;
const MATCHMAKING_JOIN_WINDOW_MS = 15000; // time window after match opens for new players to drop in
const matchQueue = []; // [{ playerId, name, joinedAt }]
const matchAssignments = new Map(); // playerId -> { code, ts }
let currentMatchRoomCode = null; // currently open match room accepting drop-ins

function matchQueuePosition(playerId) {
  return matchQueue.findIndex((p) => p.playerId === Number(playerId));
}

function removeFromMatchQueue(playerId) {
  const idx = matchQueuePosition(playerId);
  if (idx >= 0) matchQueue.splice(idx, 1);
}

function getOpenMatchRoom() {
  if (!currentMatchRoomCode) return null;
  const room = rooms.get(currentMatchRoomCode);
  if (!room) {
    currentMatchRoomCode = null;
    return null;
  }
  if (room.status !== "lobby") {
    currentMatchRoomCode = null;
    return null;
  }
  if (!room.matchOpenUntil || Date.now() > room.matchOpenUntil) {
    currentMatchRoomCode = null;
    return null;
  }
  if (room.players.length >= MATCHMAKING_MAX) {
    currentMatchRoomCode = null;
    return null;
  }
  return room;
}

function addPlayerToOpenMatch(room, player) {
  if (!room.players.includes(player.playerId))
    room.players.push(player.playerId);
  rememberUser(player.playerId, player.name);
  matchAssignments.set(player.playerId, { code: room.code, ts: Date.now() });
  if (room.players.length >= MATCHMAKING_MAX) {
    currentMatchRoomCode = null;
    room.matchOpenUntil = Date.now();
  }
}

function tryFormMatch() {
  if (matchQueue.length < MATCHMAKING_MIN) return null;
  const picked = matchQueue.splice(
    0,
    Math.min(matchQueue.length, MATCHMAKING_MAX),
  );
  picked.forEach((p) => {
    rememberUser(p.playerId, p.name);
  });
  const hostIndex = Math.floor(Math.random() * picked.length);
  const host = picked[hostIndex];
  const room = buildRoom(host.playerId);
  room.players = picked.map((p) => p.playerId);
  room.ownerId = host.playerId;
  room.matchmaking = true;
  room.matchOpenUntil = Date.now() + MATCHMAKING_JOIN_WINDOW_MS;
  const ts = Date.now();
  picked.forEach((p) => {
    matchAssignments.set(p.playerId, { code: room.code, ts });
  });
  currentMatchRoomCode =
    room.players.length >= MATCHMAKING_MAX ? null : room.code;
  return room;
}

function queuePreviewCount() {
  const open = getOpenMatchRoom();
  if (open) return open.players.length;
  return Math.max(matchQueue.length, 0);
}

function queuePreviewTarget() {
  const open = getOpenMatchRoom();
  if (open)
    return Math.min(
      MATCHMAKING_MAX,
      Math.max(open.players.length, MATCHMAKING_MIN),
    );
  return MATCHMAKING_MIN;
}

function normalizePublicUrl(value) {
  return String(value).replace(/\/$/, "");
}

function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let index = 0; index < 6; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return rooms.has(code) ? makeCode() : code;
}

function getUser(from) {
  if (!users.has(from.id)) {
    const name = from.first_name || from.username || `Игрок ${from.id}`;
    users.set(from.id, { id: from.id, name });
    storage.upsertUser(from.id, { name, username: from.username || null });
  }
  return users.get(from.id);
}

function rememberUser(id, name, username) {
  const safeName = String(name || `Игрок ${id}`).slice(0, 30);
  users.set(Number(id), { id: Number(id), name: safeName });
  storage.upsertUser(id, { name: safeName, username: username || null });
}

function buildRoom(ownerId) {
  const code = makeCode();
  const room = {
    code,
    ownerId,
    players: [ownerId],
    mode: "online",
    rounds: 2,
    packIds: ["base"],
    timer: 0,
    spyHints: false,
    spyCantGuess: false,
    phoneVibration: false,
    status: "lobby",
    currentRound: 0,
    currentPlayerIndex: 0,
    spyId: null,
    card: null,
    order: [],
    votes: new Map(),
  };
  rooms.set(code, room);
  return room;
}

function getPlayerName(playerId) {
  return users.get(playerId)?.name || `Игрок ${playerId}`;
}

function getRoomForPlayer(playerId) {
  for (const room of rooms.values()) {
    if (room.players.includes(playerId)) {
      return room;
    }
  }
  return null;
}

function getSelectedCards(room) {
  return room.packIds.flatMap((packId) => packById.get(packId)?.cards || []);
}

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
  }
  return result;
}

// Chat helpers ------------------------------------------------------
const chatIdCounters = new Map();
function nextChatId(code) {
  const next = (chatIdCounters.get(code) || 0) + 1;
  chatIdCounters.set(code, next);
  return `${code}-${next}`;
}

function pushChat(code, msg) {
  if (!chats.has(code)) chats.set(code, []);
  chats.get(code).push(msg);
  if (chats.get(code).length > 200) chats.get(code).shift();
}

function parseChatCommand(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed.startsWith("/")) return null;
  const parts = trimmed.slice(1).split(/\s+/);
  const cmd = parts[0].toLowerCase();
  if (!cmd) return null;
  return { cmd, args: parts.slice(1) };
}

function handleChatCommand(room, command, sender) {
  const { cmd, args } = command;
  switch (cmd) {
    case "rules":
      return {
        text: "Правила: мирные говорят ассоциации, не выдавая карту шпиону. Шпион пытается понять локацию по чужим ассоциациям. /skip - пропустить ход (только хост), /hint - подсказка шпиону, /kick @id - голосование за кик.",
      };
    case "skip":
      if (!sender.playerId || room.ownerId !== Number(sender.playerId)) {
        return { text: "🚫 Команда /skip доступна только хосту." };
      }
      if (room.status !== "playing")
        return { text: "Сейчас не ход ассоциаций." };
      room.currentPlayerIndex += 1;
      if (room.currentPlayerIndex >= room.order.length) {
        room.status = "voting";
        room.votes = new Map();
      }
      broadcastRoom(room.code, getApiRoom(room.code));
      return { text: `⏭ ${sender.name} пропустил ход.` };
    case "hint":
      if (room.status !== "playing" || !room.spyId)
        return { text: "Подсказка доступна только во время раунда." };
      if (Number(sender.playerId) !== room.spyId)
        return { text: "🚫 Подсказка доступна только шпиону." };
      if (!room.card) return { text: "Карта ещё не выбрана." };
      const hints = getSpyHintCards(room)
        .map((h) => h.name)
        .join(" / ");
      return { text: `💡 Подсказка шпиону: ${hints}` };
    case "kick": {
      const targetArg = (args[0] || "").replace(/^@/, "");
      let targetId = null;
      if (/^\d+$/.test(targetArg)) targetId = Number(targetArg);
      else {
        // Search by name
        for (const id of room.players) {
          if (getPlayerName(id).toLowerCase() === targetArg.toLowerCase()) {
            targetId = id;
            break;
          }
        }
      }
      if (!targetId || !room.players.includes(targetId)) {
        return { text: "Игрок не найден. Используй /kick @ID или /kick Имя." };
      }
      if (targetId === Number(sender.playerId))
        return { text: "Нельзя кикнуть себя." };
      if (!room.kickVotes) room.kickVotes = new Map();
      const voteData = room.kickVotes.get(targetId) || {
        yes: new Set(),
        startedAt: Date.now(),
        startedBy: sender.playerId,
      };
      voteData.yes.add(Number(sender.playerId));
      room.kickVotes.set(targetId, voteData);
      const others = room.players.filter((id) => id !== targetId).length;
      const required = Math.max(2, Math.ceil(others / 2));
      return {
        text: `🗳 Голосование за кик ${getPlayerName(targetId)}: ${voteData.yes.size}/${required}. Голосуйте через кнопку или /kick ещё раз.`,
      };
    }
    case "help":
      return { text: "Команды: /rules /skip /hint /kick @id_или_имя /help" };
    default:
      return null;
  }
}

const RU_TO_EN = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "yo",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};
const EN_TO_RU = {
  a: "а",
  b: "б",
  c: "к",
  d: "д",
  e: "е",
  f: "ф",
  g: "г",
  h: "х",
  i: "и",
  j: "дж",
  k: "к",
  l: "л",
  m: "м",
  n: "н",
  o: "о",
  p: "п",
  q: "к",
  r: "р",
  s: "с",
  t: "т",
  u: "у",
  v: "в",
  w: "в",
  x: "кс",
  y: "й",
  z: "з",
};

function normalize(str) {
  return str
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-яей0-9]/gi, "");
}

function toEn(str) {
  return str
    .toLowerCase()
    .split("")
    .map((c) => RU_TO_EN[c] || c)
    .join("");
}

function toRu(str) {
  return str
    .toLowerCase()
    .split("")
    .map((c) => EN_TO_RU[c] || c)
    .join("");
}

function levenshtein(a, b) {
  const m = a.length,
    n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array(n + 1);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function fuzzyMatch(guess, cardName) {
  const g = normalize(guess);
  const c = normalize(cardName);
  if (!g || !c) return false;
  if (g === c) return true;
  if (c.includes(g) || g.includes(c)) return true;
  const variants = new Set([g]);
  variants.add(normalize(toEn(guess)));
  variants.add(normalize(toRu(guess)));
  const targets = new Set([c]);
  targets.add(normalize(toEn(cardName)));
  targets.add(normalize(toRu(cardName)));
  for (const v of variants) {
    for (const t of targets) {
      if (v === t) return true;
      if (t.includes(v) || v.includes(t)) return true;
      const maxLen = Math.max(v.length, t.length);
      if (
        maxLen > 2 &&
        levenshtein(v, t) <= Math.max(1, Math.floor(maxLen * 0.25))
      )
        return true;
    }
  }
  return false;
}

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

function compareHex(a, b) {
  try {
    const left = Buffer.from(String(a || ""), "hex");
    const right = Buffer.from(String(b || ""), "hex");
    if (left.length !== right.length || left.length === 0) return false;
    return crypto.timingSafeEqual(left, right);
  } catch (_) {
    return false;
  }
}

function validateTelegramInitData(initData) {
  if (!initData) return { ok: false, error: "Нет подписи Telegram WebApp" };
  if (!BOT_TOKEN) return { ok: false, error: "BOT_TOKEN не настроен" };
  const params = new URLSearchParams(String(initData));
  const hash = params.get("hash");
  if (!hash) return { ok: false, error: "Нет hash в initData" };
  params.delete("hash");
  const pairs = [];
  for (const [key, value] of params.entries()) pairs.push(`${key}=${value}`);
  pairs.sort();
  const dataCheckString = pairs.join("\n");
  const secret = crypto
    .createHmac("sha256", "WebAppData")
    .update(BOT_TOKEN)
    .digest();
  const calculated = crypto
    .createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");
  if (!compareHex(calculated, hash))
    return { ok: false, error: "Неверная подпись Telegram" };
  const authDate = Number(params.get("auth_date") || 0);
  if (
    ADMIN_AUTH_MAX_AGE_SECONDS > 0 &&
    authDate &&
    Math.floor(Date.now() / 1000) - authDate > ADMIN_AUTH_MAX_AGE_SECONDS
  ) {
    return {
      ok: false,
      error: "Сессия Telegram устарела, открой mini app заново",
    };
  }
  let user = null;
  try {
    user = JSON.parse(params.get("user") || "null");
  } catch (_) {}
  if (!user || !user.id)
    return { ok: false, error: "В initData нет пользователя" };
  return { ok: true, user };
}

function getAdminFromRequest(req, url, body = {}) {
  const rawInitData = Array.isArray(req.headers["x-telegram-init-data"])
    ? req.headers["x-telegram-init-data"][0]
    : req.headers["x-telegram-init-data"];
  const verified = validateTelegramInitData(rawInitData);
  if (verified.ok) {
    if (isAdminId(verified.user.id)) {
      return {
        ok: true,
        id: Number(verified.user.id),
        user: verified.user,
        via: "telegram",
      };
    }
    return {
      ok: false,
      status: 403,
      error: `Нет доступа. Твой Telegram ID: ${verified.user.id}`,
    };
  }

  // Local development fallback: when there is no BOT_TOKEN, allow the local
  // web preview to pass an admin id header. This is intentionally disabled in
  // production and when Telegram signature validation is available.
  const fallbackId = Number(
    req.headers["x-admin-user-id"] ||
      body.adminId ||
      url.searchParams.get("adminId"),
  );
  if (
    !BOT_TOKEN &&
    process.env.NODE_ENV !== "production" &&
    isAdminId(fallbackId)
  ) {
    return { ok: true, id: fallbackId, user: { id: fallbackId }, via: "dev" };
  }
  return { ok: false, status: 403, error: verified.error || "Только админы" };
}

function requireAdminRequest(req, res, url, body = {}) {
  const admin = getAdminFromRequest(req, url, body);
  if (!admin.ok) {
    sendJson(
      res,
      { error: admin.error || "Только админы" },
      admin.status || 403,
    );
    return null;
  }
  return admin;
}

// [ANTI-CHEAT] Verify the actor's claimed id. Legacy behavior when STRICT_AUTH
// is off (the claimed id is trusted). When on, Telegram initData must match.
function verifyActor(req, claimedId) {
  const id = Number(claimedId);
  if (!STRICT_AUTH) return { ok: Boolean(id), id };
  const rawInitData = Array.isArray(req.headers["x-telegram-init-data"])
    ? req.headers["x-telegram-init-data"][0]
    : req.headers["x-telegram-init-data"];
  const verified = validateTelegramInitData(rawInitData);
  if (!verified.ok) return { ok: false, error: verified.error };
  if (Number(verified.user.id) !== id)
    return { ok: false, error: "Действие от чужого имени запрещено" };
  return { ok: true, id };
}

function adminPanelKeyboard(botUsername) {
  return Markup.inlineKeyboard([
    [
      Markup.button.webApp(
        "🛡 Открыть admin mini app",
        getAdminPanelUrl(botUsername),
      ),
    ],
    [Markup.button.callback("📊 Обновить сводку", "admin_refresh")],
  ]);
}

function mainMenuKeyboard(botUsername) {
  const safeUrl = getTelegramSafeUrl(PUBLIC_URL);
  const webAppUrl = botUsername
    ? `${safeUrl}/?bot=${encodeURIComponent(botUsername)}`
    : safeUrl;
  return Markup.inlineKeyboard([
    [Markup.button.callback("🕵️ Создать комнату", "create_room")],
    [Markup.button.webApp("🎮 Открыть игру", webAppUrl)],
  ]);
}

function roomKeyboard(room, botUsername) {
  const lobbyUrl = getRoomLink(room.code, botUsername, true);
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("📋 Скопировать код", `copy:${room.code}`),
      Markup.button.callback("👥 Пригласить", `invite:${room.code}`),
    ],
    [
      Markup.button.callback("🎒 Выбрать паки", `packs:${room.code}`),
      Markup.button.callback("⚙️ Настройки", `settings:${room.code}`),
    ],
    [Markup.button.callback("▶️ Начать игру", `start:${room.code}`)],
    [Markup.button.webApp("🌐 Открыть лобби", lobbyUrl)],
    [Markup.button.callback("🚪 Покинуть комнату", `leave:${room.code}`)],
  ]);
}

function settingsKeyboard(room) {
  const online = room.mode === "online" ? "✅ Онлайн" : "Онлайн";
  const offline = room.mode === "offline" ? "✅ Офлайн" : "Офлайн";
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(online, `mode:${room.code}:online`),
      Markup.button.callback(offline, `mode:${room.code}:offline`),
    ],
    [1, 2, 3, 4].map((round) =>
      Markup.button.callback(
        `${room.rounds === round ? "✅ " : ""}${round}`,
        `rounds:${room.code}:${round}`,
      ),
    ),
    [0, 15, 30, 45, 60].map((seconds) =>
      Markup.button.callback(
        `${room.timer === seconds ? "✅ " : ""}${seconds ? `${seconds}с` : "Выкл"}`,
        `timer:${room.code}:${seconds}`,
      ),
    ),
    [
      Markup.button.callback(
        `${room.spyHints ? "✅" : "⬜"} Подсказка для шпиона`,
        `toggle:${room.code}:spyHints`,
      ),
    ],
    [
      Markup.button.callback(
        `${room.spyCantGuess ? "✅" : "⬜"} Запретить «я угадал»`,
        `toggle:${room.code}:spyCantGuess`,
      ),
    ],
    [
      Markup.button.callback(
        `${room.phoneVibration ? "✅" : "⬜"} Вибрация телефона`,
        `toggle:${room.code}:phoneVibration`,
      ),
    ],
    [Markup.button.callback("⬅️ В лобби", `lobby:${room.code}`)],
  ]);
}

function packsKeyboard(room, page = 0) {
  const perPage = 8;
  const pages = Math.ceil(PACKS.length / perPage);
  const visible = PACKS.slice(page * perPage, page * perPage + perPage);
  const rows = visible.map((pack) => {
    const selected = room.packIds.includes(pack.id) ? "✅" : "⬜";
    return [
      Markup.button.callback(
        `${selected} ${pack.emoji} ${pack.title}`,
        `pack:${room.code}:${pack.id}:${page}`,
      ),
    ];
  });
  rows.push([
    Markup.button.callback(
      "◀️",
      `packs_page:${room.code}:${Math.max(0, page - 1)}`,
    ),
    Markup.button.callback(`${page + 1}/${pages}`, `packs:${room.code}`),
    Markup.button.callback(
      "▶️",
      `packs_page:${room.code}:${Math.min(pages - 1, page + 1)}`,
    ),
  ]);
  rows.push([Markup.button.callback("⬅️ В лобби", `lobby:${room.code}`)]);
  return Markup.inlineKeyboard(rows);
}

function formatRoom(room, botUsername) {
  const players = room.players
    .map(
      (id, index) =>
        `${index + 1}. ${getPlayerName(id)}${id === room.ownerId ? " 👑" : ""}`,
    )
    .join("\n");
  const packs = room.packIds
    .map((id) => packById.get(id)?.title)
    .filter(Boolean)
    .join(", ");
  return `Код комнаты\n${room.code}\n\n🎒 Паки: ${packs}\n🎮 ${room.mode === "online" ? "Онлайн" : "Офлайн"} · 🔁 ${room.rounds} круга\n👥 Игроки (${room.players.length}/8)\n${players}\n\nМинимум 3 игрока для старта. По ссылке можно зайти в лобби: ${getRoomLink(room.code, botUsername, true)}`;
}

function formatSettings(room) {
  return `⚙️ Настройки игры\n${room.mode} · ${room.rounds} круга\n\n⏱ Давление времени: ${room.timer ? `${room.timer}с` : "выкл"}\n💡 Подсказка для шпиона: ${room.spyHints ? "вкл" : "выкл"}\n🚫 Запретить «я угадал»: ${room.spyCantGuess ? "вкл" : "выкл"}\n📳 Вибрация телефона: ${room.phoneVibration ? "вкл" : "выкл"}`;
}

function getRoomAdminView(room) {
  return {
    code: room.code,
    status: room.status,
    ownerId: room.ownerId,
    ownerName: getPlayerName(room.ownerId),
    playersCount: room.players.length,
    players: room.players.map((id) => ({
      id,
      name: getPlayerName(id),
      owner: id === room.ownerId,
      online: isPlayerOnline(id),
    })),
    packs: room.packIds,
    rounds: room.rounds,
    currentRound: room.currentRound || 0,
    createdByMatchmaking: Boolean(room.matchOpenUntil),
  };
}

function buildAdminSummary() {
  const allUsers = storage.listUsers();
  const onlineIds = getOnlineUserIds();
  const roomsList = Array.from(rooms.values());
  const roomsByStatus = roomsList.reduce((acc, room) => {
    acc[room.status] = (acc[room.status] || 0) + 1;
    return acc;
  }, {});
  const totalStars = allUsers.reduce(
    (sum, u) => sum + Number(u.totalStarsDonated || 0),
    0,
  );
  const premiumActive = allUsers.filter(
    (u) => u.premium && Number(u.premiumUntil || 0) > Date.now(),
  ).length;
  return {
    generatedAt: Date.now(),
    adminsConfigured: ADMIN_USER_IDS.length,
    usersTotal: allUsers.length,
    onlineTotal: onlineIds.length,
    premiumActive,
    totalStars,
    roomsTotal: roomsList.length,
    roomsByStatus,
    queueSize: matchQueue.length,
    openMatchRoom: currentMatchRoomCode,
    recentUsers: allUsers
      .slice()
      .sort((a, b) => Number(b.lastSeen || 0) - Number(a.lastSeen || 0))
      .slice(0, 8)
      .map((u) => ({
        id: u.id,
        name: u.name,
        username: u.username || null,
        level: u.level || 1,
        online: isPlayerOnline(u.id),
        lastSeen: u.lastSeen || 0,
      })),
    rooms: roomsList.map(getRoomAdminView),
    events: storage.summarizeEvents(500),
  };
}

function formatAdminSummary(summary) {
  return [
    "🛡 Админ-панель",
    "",
    `👥 Пользователей: ${summary.usersTotal} · онлайн ${summary.onlineTotal}`,
    `🎮 Комнат: ${summary.roomsTotal} · очередь ${summary.queueSize}`,
    `💛 Премиум активен: ${summary.premiumActive}`,
    `⭐ Всего звёзд: ${summary.totalStars}`,
    "",
    "Открой mini app ниже, чтобы выдавать/забирать XP, уровни, премиум и косметику.",
  ].join("\n");
}

async function showRoom(ctx, room, botUsername) {
  await ctx.reply(
    formatRoom(room, botUsername),
    roomKeyboard(room, botUsername),
  );
}

async function showMain(ctx, botUsername) {
  await ctx.reply(
    "🕵️ Кто шпион\n\nСоздай комнату, выбери паки и пригласи друзей по ссылке или коду.",
    mainMenuKeyboard(botUsername),
  );
}

async function safeAnswer(ctx, message) {
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery(message).catch(() => {});
  }
}

function requireRoom(code) {
  const room = rooms.get(code);
  if (!room) {
    throw new Error("Комната не найдена.");
  }
  return room;
}

function requireOwner(room, userId) {
  if (room.ownerId !== userId) {
    throw new Error("Менять настройки может только создатель комнаты.");
  }
}

async function sendRole(bot, room, playerId) {
  const isSpy = playerId === room.spyId;
  const cardLine =
    room.card.nameEn && room.card.nameEn !== room.card.name
      ? `🃏 Карта: ${room.card.name}\n      ${room.card.nameEn}`
      : `🃏 Карта: ${room.card.name}`;
  const title = isSpy ? "🕵️ Ты — шпион" : cardLine;
  let body = isSpy
    ? "Слушай ассоциации игроков и попробуй понять карту. Не выдай себя!"
    : `Твоя задача — говорить ассоциации так, чтобы мирные поняли друг друга, а шпион не догадался.`;
  if (isSpy && room.spyHints && room.card) {
    const hints = getSpyHintCards(room)
      .map((h) =>
        h.nameEn && h.nameEn !== h.name
          ? `• ${h.name} (${h.nameEn})`
          : `• ${h.name}`,
      )
      .join("\n");
    body += `\n\n💡 Возможные карты:\n${hints}`;
  }
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("Я понял", `ok:${room.code}`)],
    [Markup.button.callback("🎯 Я угадал карту", `guess:${room.code}`)],
  ]);

  try {
    if (!isSpy && room.card.image) {
      await bot.telegram
        .sendPhoto(playerId, room.card.image, {
          caption: `${title}\n${body}`,
          ...keyboard,
        })
        .catch(async () => {
          await bot.telegram.sendMessage(
            playerId,
            `${title}\n${body}`,
            keyboard,
          );
        });
      return;
    }

    if (isSpy && SPY_IMAGE) {
      await bot.telegram
        .sendPhoto(playerId, toPublicAsset(SPY_IMAGE), {
          caption: `${title}\n${body}`,
          ...keyboard,
        })
        .catch(async () => {
          await bot.telegram.sendMessage(
            playerId,
            `${title}\n${body}`,
            keyboard,
          );
        });
      return;
    }

    await bot.telegram.sendMessage(playerId, `${title}\n${body}`, keyboard);
  } catch (err) {
    console.error(`sendRole failed for player ${playerId}:`, err.message);
  }
}

async function beginRound(bot, room) {
  const cards = getSelectedCards(room);
  if (cards.length === 0) {
    throw new Error("Выбери хотя бы один пак.");
  }
  room.status = "playing";
  room.currentRound += 1;
  room.currentPlayerIndex = 0;
  room.order = shuffle(room.players);
  room.votes = new Map();
  room.card = pickRandom(cards);
  room.spyId = pickRandom(room.players);

  await Promise.all(
    room.players.map((playerId) => sendRole(bot, room, playerId)),
  );
  await notifyTurn(bot, room);
}

async function notifyTurn(bot, room) {
  const playerId = room.order[room.currentPlayerIndex];
  const message = `Раунд ${room.currentRound}/${room.rounds}\nСейчас говорит: ${getPlayerName(playerId)}\n\nГовори одну ассоциацию к карте.`;
  await Promise.all(
    room.players.map((id) =>
      bot.telegram
        .sendMessage(
          id,
          message,
          Markup.inlineKeyboard([
            [
              Markup.button.callback(
                "✅ Я сказал, передай ход",
                `next:${room.code}`,
              ),
            ],
            [
              Markup.button.callback(
                "🗳 Открыть голосование",
                `vote_menu:${room.code}`,
              ),
            ],
          ]),
        )
        .catch(() => {}),
    ),
  );
}

async function nextTurn(bot, room) {
  room.currentPlayerIndex += 1;
  if (room.currentPlayerIndex >= room.order.length) {
    await openVoting(bot, room);
    return;
  }
  await notifyTurn(bot, room);
}

async function openVoting(bot, room) {
  room.status = "voting";
  const buttons = room.players.map((id) => [
    Markup.button.callback(getPlayerName(id), `vote:${room.code}:${id}`),
  ]);
  await Promise.all(
    room.players.map((id) =>
      bot.telegram
        .sendMessage(
          id,
          "🗳 Голосование: кто шпион?",
          Markup.inlineKeyboard(buttons),
        )
        .catch(() => {}),
    ),
  );
}

function countVotes(room) {
  const totals = new Map();
  for (const votedId of room.votes.values()) {
    totals.set(votedId, (totals.get(votedId) || 0) + 1);
  }
  let leader = null;
  let score = 0;
  let tie = false;
  for (const [playerId, total] of totals.entries()) {
    if (total > score) {
      leader = playerId;
      score = total;
      tie = false;
    } else if (total === score) {
      tie = true;
    }
  }
  return { leader, score, tie };
}

async function finishVoting(bot, room) {
  const { leader, tie } = countVotes(room);
  const guessedSpy = !tie && Number(leader) === Number(room.spyId);
  const result = tie
    ? `Ничья. Шпион выжил! Карта была: ${room.card.name}`
    : guessedSpy
      ? `Мирные нашли шпиона: ${getPlayerName(room.spyId)}. Карта была: ${room.card.name}`
      : `Шпион победил! Вы выбрали ${getPlayerName(Number(leader))}, а шпион был ${getPlayerName(room.spyId)}. Карта была: ${room.card.name}`;

  if (room.currentRound >= room.rounds) {
    room.status = "finished";
    await Promise.all(
      room.players.map((id) =>
        bot.telegram
          .sendMessage(
            id,
            `${result}\n\nИгра окончена.`,
            roomKeyboard(room, botState.username),
          )
          .catch(() => {}),
      ),
    );
    room.status = "lobby";
    room.currentRound = 0;
    return;
  }

  await Promise.all(
    room.players.map((id) =>
      bot.telegram
        .sendMessage(id, `${result}\n\nГотовим следующий раунд...`)
        .catch(() => {}),
    ),
  );
  await beginRound(bot, room);
}

async function handleTextMessage(bot, ctx) {
  const room = getRoomForPlayer(ctx.from.id);
  if (
    !room ||
    room.status !== "playing" ||
    ctx.from.id !== room.spyId ||
    room.spyCantGuess ||
    !room.card
  ) {
    return;
  }
  const guess = ctx.message.text.trim();
  if (!guess) return;
  if (
    fuzzyMatch(guess, room.card.name) ||
    (room.card.nameEn && fuzzyMatch(guess, room.card.nameEn))
  ) {
    room.status = "finished";
    await Promise.all(
      room.players.map((id) =>
        bot.telegram
          .sendMessage(
            id,
            `🕵️ Шпион ${getPlayerName(room.spyId)} угадал карту: ${room.card.name}. Шпион победил!`,
            roomKeyboard(room, botState.username),
          )
          .catch(() => {}),
      ),
    );
    room.status = "lobby";
    room.currentRound = 0;
  } else {
    await ctx.reply("Не угадал. Продолжай слушать ассоциации.");
  }
}

function normalizeGuess(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, "");
}

function setupBot() {
  if (!BOT_TOKEN) {
    return null;
  }

  const bot = new Telegraf(BOT_TOKEN);

  bot.start(async (ctx) => {
    const user = getUser(ctx.from);
    const payload = String(ctx.startPayload || "").toUpperCase();
    if (payload && rooms.has(payload)) {
      const room = rooms.get(payload);
      if (
        room.status === "lobby" &&
        !room.players.includes(user.id) &&
        room.players.length < 8
      ) {
        room.players.push(user.id);
      }
      await showRoom(ctx, room, botState.username);
      return;
    }
    await showMain(ctx, botState.username);
  });

  bot.command("join", async (ctx) => {
    const user = getUser(ctx.from);
    const code = ctx.message.text.split(/\s+/)[1]?.toUpperCase();
    if (!code || !rooms.has(code)) {
      await ctx.reply(
        "Комната не найдена. Отправь /join КОД или зайди по ссылке.",
      );
      return;
    }
    const room = rooms.get(code);
    if (
      room.status === "lobby" &&
      !room.players.includes(user.id) &&
      room.players.length < 8
    ) {
      room.players.push(user.id);
    }
    await showRoom(ctx, room, botState.username);
  });

  bot.action("create_room", async (ctx) => {
    const user = getUser(ctx.from);
    const existing = getRoomForPlayer(user.id);
    const room = existing || buildRoom(user.id);
    await safeAnswer(ctx);
    await showRoom(ctx, room, botState.username);
  });

  bot.action(/^copy:(.+)$/, async (ctx) => {
    await safeAnswer(ctx, ctx.match[1]);
  });

  bot.action(/^invite:(.+)$/, async (ctx) => {
    const room = requireRoom(ctx.match[1]);
    await safeAnswer(ctx);
    const telegramLink = botState.username
      ? `https://t.me/${botState.username}?start=${room.code}`
      : "";
    await ctx.reply(
      `Приглашение в игру:\n${getRoomLink(room.code, botState.username, true)}${telegramLink ? `\n${telegramLink}` : ""}\n\nИли код: ${room.code}`,
    );
  });

  bot.action(/^lobby:(.+)$/, async (ctx) => {
    await safeAnswer(ctx);
    await showRoom(ctx, requireRoom(ctx.match[1]), botState.username);
  });

  bot.action(/^settings:(.+)$/, async (ctx) => {
    const room = requireRoom(ctx.match[1]);
    await safeAnswer(ctx);
    await ctx.reply(formatSettings(room), settingsKeyboard(room));
  });

  bot.action(/^mode:(.+):(online|offline)$/, async (ctx) => {
    const room = requireRoom(ctx.match[1]);
    requireOwner(room, ctx.from.id);
    room.mode = ctx.match[2];
    await safeAnswer(ctx);
    await ctx
      .editMessageText(formatSettings(room), settingsKeyboard(room))
      .catch(() => ctx.reply(formatSettings(room), settingsKeyboard(room)));
  });

  bot.action(/^rounds:(.+):(\d+)$/, async (ctx) => {
    const room = requireRoom(ctx.match[1]);
    requireOwner(room, ctx.from.id);
    room.rounds = Number(ctx.match[2]);
    await safeAnswer(ctx);
    await ctx
      .editMessageText(formatSettings(room), settingsKeyboard(room))
      .catch(() => ctx.reply(formatSettings(room), settingsKeyboard(room)));
  });

  bot.action(/^timer:(.+):(\d+)$/, async (ctx) => {
    const room = requireRoom(ctx.match[1]);
    requireOwner(room, ctx.from.id);
    room.timer = Number(ctx.match[2]);
    await safeAnswer(ctx);
    await ctx
      .editMessageText(formatSettings(room), settingsKeyboard(room))
      .catch(() => ctx.reply(formatSettings(room), settingsKeyboard(room)));
  });

  bot.action(
    /^toggle:(.+):(spyHints|spyCantGuess|phoneVibration)$/,
    async (ctx) => {
      const room = requireRoom(ctx.match[1]);
      requireOwner(room, ctx.from.id);
      room[ctx.match[2]] = !room[ctx.match[2]];
      await safeAnswer(ctx);
      await ctx
        .editMessageText(formatSettings(room), settingsKeyboard(room))
        .catch(() => ctx.reply(formatSettings(room), settingsKeyboard(room)));
    },
  );

  bot.action(/^packs:(.+)$/, async (ctx) => {
    await safeAnswer(ctx);
    await ctx.reply(
      "🎒 Выбери паки для игры:",
      packsKeyboard(requireRoom(ctx.match[1])),
    );
  });

  bot.action(/^packs_page:(.+):(\d+)$/, async (ctx) => {
    await safeAnswer(ctx);
    const room = requireRoom(ctx.match[1]);
    await ctx
      .editMessageReplyMarkup(
        packsKeyboard(room, Number(ctx.match[2])).reply_markup,
      )
      .catch(() => {});
  });

  bot.action(/^pack:(.+):([^:]+):(\d+)$/, async (ctx) => {
    const room = requireRoom(ctx.match[1]);
    requireOwner(room, ctx.from.id);
    const packId = ctx.match[2];
    if (room.packIds.includes(packId)) {
      if (room.packIds.length > 1) {
        room.packIds = room.packIds.filter((id) => id !== packId);
      }
    } else {
      room.packIds.push(packId);
    }
    await safeAnswer(ctx);
    await ctx
      .editMessageReplyMarkup(
        packsKeyboard(room, Number(ctx.match[3])).reply_markup,
      )
      .catch(() => {});
  });

  bot.action(/^start:(.+)$/, async (ctx) => {
    const room = requireRoom(ctx.match[1]);
    requireOwner(room, ctx.from.id);
    if (room.players.length < 3) {
      await safeAnswer(ctx, "Минимум 3 игрока");
      return;
    }
    await safeAnswer(ctx);
    await beginRound(bot, room);
  });

  bot.action(/^ok:(.+)$/, async (ctx) => safeAnswer(ctx, "Удачной игры!"));

  bot.action(/^next:(.+)$/, async (ctx) => {
    const room = requireRoom(ctx.match[1]);
    if (room.status !== "playing") {
      await safeAnswer(ctx, "Сейчас не ход ассоциаций");
      return;
    }
    await safeAnswer(ctx);
    await nextTurn(bot, room);
  });

  bot.action(/^vote_menu:(.+)$/, async (ctx) => {
    await safeAnswer(ctx);
    await openVoting(bot, requireRoom(ctx.match[1]));
  });

  bot.action(/^vote:(.+):(\d+)$/, async (ctx) => {
    const room = requireRoom(ctx.match[1]);
    room.votes.set(ctx.from.id, Number(ctx.match[2]));
    await safeAnswer(ctx, "Голос принят");
    if (room.votes.size >= room.players.length) {
      await finishVoting(bot, room);
    }
  });

  bot.action(/^guess:(.+)$/, async (ctx) => {
    const room = requireRoom(ctx.match[1]);
    if (room.spyCantGuess || ctx.from.id !== room.spyId) {
      await safeAnswer(ctx, "Недоступно");
      return;
    }
    await safeAnswer(ctx);
    await ctx.reply(
      "Напиши название карты в чат. Если совпадёт — шпион победит.",
    );
  });

  bot.action(/^leave:(.+)$/, async (ctx) => {
    const room = requireRoom(ctx.match[1]);
    room.players = room.players.filter((id) => id !== ctx.from.id);
    if (room.ownerId === ctx.from.id && room.players.length > 0) {
      room.ownerId = room.players[0];
    }
    if (room.players.length === 0) {
      rooms.delete(room.code);
    }
    await safeAnswer(ctx);
    await showMain(ctx, botState.username);
  });

  // === Telegram Stars payments ===
  // Stars invoices are created via createInvoiceLink (see createStarsInvoice).
  // We MUST answer the pre_checkout_query within 10 seconds, then handle
  // `successful_payment` to actually grant the perk.
  bot.on("pre_checkout_query", async (ctx) => {
    try {
      await ctx.answerPreCheckoutQuery(true);
    } catch (e) {
      console.error("pre_checkout_query failed", e.message);
    }
  });

  bot.on("successful_payment", async (ctx) => {
    try {
      const sp = ctx.message.successful_payment;
      const payloadRaw = sp.invoice_payload || "";
      const stars = Number(sp.total_amount) || 0;
      const paymentId = sp.telegram_payment_charge_id || `tg_${Date.now()}`;
      let payload;
      try {
        payload = JSON.parse(payloadRaw);
      } catch (_) {
        payload = {};
      }
      const playerId = Number(payload.playerId || ctx.from.id);
      rememberUser(
        playerId,
        ctx.from.first_name || ctx.from.username,
        ctx.from.username,
      );
      if (
        payload.kind === "cosmetic" &&
        payload.cosmeticKind &&
        payload.itemId
      ) {
        grantCosmeticPurchase(
          playerId,
          payload.cosmeticKind,
          payload.itemId,
          stars,
          paymentId,
        );
        await ctx.reply(
          `✅ Покупка завершена: ${payload.itemId}. ${stars} ⭐ списано.`,
        );
      } else {
        // Treat as donation by default
        grantDonationRewards(playerId, stars, paymentId);
        await ctx.reply(
          `🥹 Спасибо за поддержку! +${stars} ⭐ → премиум активирован и тебе добавлено несколько предметов.`,
        );
      }
    } catch (e) {
      console.error("successful_payment failed", e.message);
    }
  });