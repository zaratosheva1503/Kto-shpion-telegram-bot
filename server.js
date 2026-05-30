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
const packById = new Map(PACKS.map((pack) => [pack.id, pack]));
const botState = { username: process.env.BOT_USERNAME || "" };
const rooms = new Map();
const users = new Map();
const chats = new Map();

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

  // /donate quick command
  bot.command("donate", async (ctx) => {
    const args = ctx.message.text.split(/\s+/).slice(1);
    const stars = Math.max(
      1,
      Math.min(100000, Math.floor(Number(args[0]) || 100)),
    );
    try {
      const link = await createStarsInvoice({
        title: `На покушать ${stars} ⭐`,
        description: "Поддержать разработчика. Премиум + случайная косметика.",
        payload: JSON.stringify({
          kind: "donation",
          playerId: ctx.from.id,
          stars,
        }),
        stars,
      });
      await ctx.reply(`💛 Ссылка на оплату ${stars} ⭐: ${link}`);
    } catch (e) {
      await ctx.reply(`Ошибка: ${e.message}`);
    }
  });

  bot.command("admin", async (ctx) => {
    getUser(ctx.from);
    if (!isAdminId(ctx.from.id)) {
      await ctx.reply(
        `🚫 Нет доступа к админке. Твой Telegram ID: ${ctx.from.id}\n\nДобавь его в ADMIN_USER_IDS и перезапусти сервер.`,
      );
      return;
    }
    const summary = buildAdminSummary();
    await ctx.reply(
      formatAdminSummary(summary),
      adminPanelKeyboard(botState.username),
    );
  });

  bot.action("admin_refresh", async (ctx) => {
    if (!isAdminId(ctx.from.id)) {
      await safeAnswer(ctx, "Нет доступа");
      return;
    }
    await safeAnswer(ctx, "Обновлено");
    const summary = buildAdminSummary();
    await ctx.reply(
      formatAdminSummary(summary),
      adminPanelKeyboard(botState.username),
    );
  });

  bot.on("text", (ctx) => handleTextMessage(bot, ctx));

  bot.telegram
    .getMe()
    .then((me) => {
      botState.username = me.username || botState.username;
    })
    .catch(() => {});

  bot.catch((error, ctx) => {
    console.error(error);
    if (ctx) {
      ctx.reply(error.message || "Ошибка. Попробуй ещё раз.").catch(() => {});
    }
  });

  return bot;
}

function getApiRoom(code) {
  const room = rooms.get(String(code).toUpperCase());
  if (!room) return null;
  const data = {
    code: room.code,
    mode: room.mode,
    rounds: room.rounds,
    packIds: room.packIds,
    packs: room.packIds
      .map((id) => packById.get(id))
      .filter(Boolean)
      .map((pack) => ({
        id: pack.id,
        title: pack.title,
        titleEn: pack.titleEn || pack.title,
        emoji: pack.emoji,
        cover: toPublicAsset(pack.cover),
        count: pack.cards.length,
      })),
    players: room.players.map((id) => {
      const u = storage.getUser(id);
      return {
        id,
        name: getPlayerName(id),
        owner: id === room.ownerId,
        avatar: u && u.avatar ? u.avatar : null,
        level: u ? u.level || 1 : 1,
        equipped:
          u && u.inventory && u.inventory.equipped
            ? u.inventory.equipped
            : null,
        online: isPlayerOnline(id),
      };
    }),
    status: room.status,
  };
  if (room.status === "playing" || room.status === "voting") {
    data.currentRound = room.currentRound;
    data.totalRounds = room.rounds;
    data.currentPlayerId = room.order
      ? room.order[room.currentPlayerIndex]
      : null;
    data.currentPlayerName = data.currentPlayerId
      ? getPlayerName(data.currentPlayerId)
      : null;
    data.votesCount = room.votes ? room.votes.size : 0;
  }
  if (room.status === "finished" || room.status === "round_end") {
    data.result = room.lastResult || null;
  }
  return data;
}

function getPlayerRole(room, playerId) {
  if (!room || room.status === "lobby") return null;
  const isSpy = playerId === room.spyId;
  return {
    isSpy,
    card: isSpy
      ? null
      : room.card
        ? {
            name: room.card.name,
            nameEn: room.card.nameEn || room.card.name,
            image: room.card.image ? toPublicAsset(room.card.image) : null,
          }
        : null,
    spyHint: isSpy && room.spyHints && room.card ? getSpyHintCards(room) : null,
  };
}

function getSpyHintCards(room) {
  const cards = getSelectedCards(room);
  const hints = [
    { name: room.card.name, nameEn: room.card.nameEn || room.card.name },
  ];
  const others = cards.filter((c) => c.name !== room.card.name);
  shuffle(others);
  for (let i = 0; i < 3 && i < others.length; i++) {
    hints.push({
      name: others[i].name,
      nameEn: others[i].nameEn || others[i].name,
    });
  }
  shuffle(hints);
  return hints;
}

function beginRoundWeb(room) {
  const cards = getSelectedCards(room);
  if (cards.length === 0) throw new Error("Выбери хотя бы один пак.");
  room.status = "playing";
  room.currentRound += 1;
  room.currentPlayerIndex = 0;
  room.order = shuffle(room.players.slice());
  room.votes = new Map();
  room.card = pickRandom(cards);
  room.spyId = pickRandom(room.players);
  room.lastResult = null;
}

function finishVotingWeb(room) {
  const { leader, tie } = countVotes(room);
  const guessedSpy = !tie && Number(leader) === Number(room.spyId);
  const spyName = getPlayerName(room.spyId);
  const cardName = room.card.name;
  let result;
  if (tie) {
    result = {
      text: `Ничья. Шпион выжил!`,
      card: cardName,
      spy: spyName,
      spyWon: true,
    };
  } else if (guessedSpy) {
    result = {
      text: `Мирные нашли шпиона: ${spyName}!`,
      card: cardName,
      spy: spyName,
      spyWon: false,
    };
  } else {
    result = {
      text: `Шпион победил! Вы выбрали ${getPlayerName(Number(leader))}, а шпион был ${spyName}.`,
      card: cardName,
      spy: spyName,
      spyWon: true,
    };
  }
  room.lastResult = result;
  if (room.currentRound >= room.rounds) {
    room.status = "finished";
  } else {
    room.status = "round_end";
  }
  return result;
}

// ============== profile / shop / donations helpers ==============
function serializeFullUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    username: u.username || null,
    avatar: u.avatar || null,
    level: u.level || 1,
    xp: u.xp || 0,
    premium: Boolean(u.premium),
    premiumUntil: u.premiumUntil || 0,
    totalStarsDonated: u.totalStarsDonated || 0,
    stats: u.stats || storage.defaultStats(),
    inventory: u.inventory || storage.defaultInventory(),
    nextLevelXp: storage.xpForLevel((u.level || 1) + 1),
    currentLevelXp: storage.xpForLevel(u.level || 1),
  };
}

function notifyProfileUpdate(playerId, extra = {}) {
  const u = storage.getUser(playerId);
  if (!u) return false;
  return notifyUser(playerId, {
    type: "me:update",
    user: storage.publicProfile(u),
    full: serializeFullUser(u),
    ...extra,
  });
}

function adminUserView(u, { includePayments = false } = {}) {
  if (!u) return null;
  const full = serializeFullUser(u);
  const payments = includePayments
    ? storage
        .listPaymentsForUser(u.id)
        .sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0))
        .slice(0, 20)
    : [];
  return {
    ...full,
    public: storage.publicProfile(u),
    online: isPlayerOnline(u.id),
    currentRoom: findCurrentRoomCode(u.id),
    isAdmin: isAdminId(u.id),
    payments,
    paymentsTotalStars: payments.reduce(
      (sum, p) => sum + Number(p.stars || 0),
      0,
    ),
  };
}

function searchAdminUsers(query, limit = 30) {
  const q = String(query || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
  const usersList = storage
    .listUsers()
    .slice()
    .sort((a, b) => Number(b.lastSeen || 0) - Number(a.lastSeen || 0));
  const filtered = q
    ? usersList.filter(
        (u) =>
          String(u.id).includes(q) ||
          String(u.name || "")
            .toLowerCase()
            .includes(q) ||
          String(u.username || "")
            .toLowerCase()
            .includes(q),
      )
    : usersList;
  return filtered
    .slice(0, Math.max(1, Math.min(100, Number(limit) || 30)))
    .map((u) => adminUserView(u));
}

function validateCosmeticInput(kind, itemId) {
  if (!ADMIN_COSMETIC_KINDS.includes(kind))
    throw new Error("Некорректный тип косметики");
  const item = cosmetics.findItem(kind, itemId);
  if (!item) throw new Error("Предмет не найден в каталоге");
  return item;
}

function auditAdmin(adminId, action, props = {}) {
  storage.trackEvent("admin_action", { adminId, action, ...props });
}

function findCurrentRoomCode(playerId) {
  for (const room of rooms.values()) {
    if (room.players.includes(Number(playerId))) return room.code;
  }
  return null;
}

// Get the API-shaped room and broadcast it to all WS clients in that room.
function pushRoom(code) {
  const apiRoom = getApiRoom(code);
  if (apiRoom) broadcastRoom(code, apiRoom);
  return apiRoom;
}

async function createStarsInvoice({ title, description, payload, stars }) {
  if (!bot) {
    throw new Error(
      "Бот не настроен. Задай BOT_TOKEN в .env и перезапусти сервер.",
    );
  }
  // Telegraf supports Stars: currency must be 'XTR' and prices are integer.
  // See https://core.telegram.org/bots/payments#telegram-stars
  const link = await bot.telegram.createInvoiceLink({
    title: String(title).slice(0, 32),
    description: String(description).slice(0, 255),
    payload: String(payload).slice(0, 128),
    provider_token: "", // empty for Stars
    currency: "XTR",
    prices: [
      {
        label: title.slice(0, 30) || "Покупка",
        amount: Math.max(1, Math.floor(stars)),
      },
    ],
  });
  return link;
}

function grantDonationRewards(playerId, stars, paymentId) {
  // Stars are credited toward premium; donations of 100+ also unlock a
  // random rare cosmetic per 100 stars donated.
  const ms = cosmetics.starsToPremiumMs(stars);
  storage.setPremium(playerId, ms, stars);
  // Award a cosmetic for every 100 stars
  const grants = Math.max(1, Math.floor(stars / 100));
  const kinds = [
    "frames",
    "themes",
    "nameEffects",
    "statusEmojis",
    "animatedAvatars",
  ];
  for (let i = 0; i < grants; i += 1) {
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const pool = cosmetics.ALL[kind];
    if (!pool || !pool.length) continue;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    try {
      storage.grantItem(playerId, kind, pick.id);
    } catch (_) {}
  }
  storage.recordPayment({
    userId: playerId,
    stars,
    type: "donation",
    paymentId,
    status: "success",
  });
  storage.trackEvent("donation_success", { playerId, stars, paymentId });
  notifyUser(playerId, {
    type: "donation:success",
    stars,
    user: storage.publicProfile(storage.getUser(playerId)),
    full: serializeFullUser(storage.getUser(playerId)),
  });
}

function grantCosmeticPurchase(playerId, kind, itemId, stars, paymentId) {
  try {
    storage.grantItem(playerId, kind, itemId);
    storage.recordPayment({
      userId: playerId,
      stars,
      type: "cosmetic",
      kind,
      itemId,
      paymentId,
      status: "success",
    });
    storage.trackEvent("purchase_success", { playerId, stars, kind, itemId });
    notifyUser(playerId, {
      type: "purchase:success",
      kind,
      itemId,
      stars,
      user: storage.publicProfile(storage.getUser(playerId)),
      full: serializeFullUser(storage.getUser(playerId)),
    });
  } catch (e) {
    console.error("grantCosmeticPurchase failed", e);
  }
}

function createServer(bot) {
  const publicDir = __dirname;
  return http.createServer(async (req, res) => {
    applyCorsHeaders(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    const safePath = req.url.replace(/^\/\/+/, "/");
    const url = new URL(safePath, PUBLIC_URL);
    if (url.pathname === "/api/packs") {
      sendJson(res, {
        packs: PACKS.map((pack) => ({
          id: pack.id,
          title: pack.title,
          titleEn: pack.titleEn || pack.title,
          emoji: pack.emoji,
          cover: toPublicAsset(pack.cover),
          count: pack.cards.length,
          free: Boolean(pack.free),
        })),
      });
      return;
    }
    if (url.pathname === "/api/matchmaking/join" && req.method === "POST") {
      const body = await readBody(req);
      const name = String(body.name || "Гость").slice(0, 30);
      const playerId = Number(
        body.telegramId ||
          body.playerId ||
          `9${crypto.randomInt(100000, 999999)}`,
      );
      rememberUser(playerId, name, body.username);
      removeFromMatchQueue(playerId);
      if (matchAssignments.has(playerId)) {
        const prev = matchAssignments.get(playerId);
        const prevRoom = rooms.get(prev.code);
        if (
          !prevRoom ||
          prevRoom.status !== "lobby" ||
          !prevRoom.players.includes(playerId)
        ) {
          matchAssignments.delete(playerId);
        }
      }
      // Drop into an already-forming match room if window is still open and seats available
      const openRoom = getOpenMatchRoom();
      if (openRoom && !openRoom.players.includes(playerId)) {
        addPlayerToOpenMatch(openRoom, { playerId, name });
        sendJson(res, {
          matched: true,
          code: openRoom.code,
          playerId,
          queueSize: openRoom.players.length,
          target: MATCHMAKING_MAX,
        });
        return;
      }
      if (openRoom && openRoom.players.includes(playerId)) {
        sendJson(res, {
          matched: true,
          code: openRoom.code,
          playerId,
          queueSize: openRoom.players.length,
          target: MATCHMAKING_MAX,
        });
        return;
      }
      matchQueue.push({ playerId, name, joinedAt: Date.now() });
      const room = tryFormMatch();
      if (room) {
        sendJson(res, {
          matched: true,
          code: room.code,
          playerId,
          queueSize: room.players.length,
          target: MATCHMAKING_MAX,
        });
        return;
      }
      sendJson(res, {
        matched: false,
        inQueue: true,
        playerId,
        queueSize: matchQueue.length,
        target: MATCHMAKING_MIN,
        position: matchQueuePosition(playerId) + 1,
      });
      return;
    }
    if (url.pathname === "/api/matchmaking/status" && req.method === "GET") {
      const playerId = Number(url.searchParams.get("playerId"));
      if (matchAssignments.has(playerId)) {
        const { code } = matchAssignments.get(playerId);
        const assignedRoom = rooms.get(code);
        if (assignedRoom && assignedRoom.players.includes(playerId)) {
          sendJson(res, {
            matched: true,
            code,
            queueSize: assignedRoom.players.length,
            target: MATCHMAKING_MAX,
          });
          return;
        }
        matchAssignments.delete(playerId);
      }
      const idx = matchQueuePosition(playerId);
      if (idx === -1) {
        sendJson(res, {
          matched: false,
          inQueue: false,
          queueSize: queuePreviewCount(),
          target: queuePreviewTarget(),
        });
        return;
      }
      sendJson(res, {
        matched: false,
        inQueue: true,
        queueSize: matchQueue.length,
        target: MATCHMAKING_MIN,
        position: idx + 1,
      });
      return;
    }
    if (url.pathname === "/api/matchmaking/leave" && req.method === "POST") {
      const body = await readBody(req);
      const playerId = Number(body.playerId);
      removeFromMatchQueue(playerId);
      matchAssignments.delete(playerId);
      sendJson(res, { left: true });
      return;
    }
    if (url.pathname === "/api/rooms" && req.method === "POST") {
      const body = await readBody(req);
      const name = body.name || "Гость";
      const id = Number(
        body.telegramId ||
          body.playerId ||
          `9${crypto.randomInt(100000, 999999)}`,
      );
      rememberUser(id, name, body.username);
      const room = buildRoom(id);
      sendJson(res, {
        room: pushRoom(room.code),
        playerId: id,
        link: getRoomLink(room.code, botState.username, false),
      });
      return;
    }
    if (
      url.pathname.match(/^\/api\/rooms\/[^/]+\/join$/) &&
      req.method === "POST"
    ) {
      const code = url.pathname.split("/")[3].toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        sendJson(res, { error: "Комната не найдена" }, 404);
        return;
      }
      const body = await readBody(req);
      const id = Number(
        body.telegramId ||
          body.playerId ||
          `9${crypto.randomInt(100000, 999999)}`,
      );
      rememberUser(id, body.name || "Гость", body.username);
      if (room.status !== "lobby") {
        sendJson(res, { error: "Игра уже началась" }, 409);
        return;
      }
      if (!room.players.includes(id) && room.players.length < 8)
        room.players.push(id);
      sendJson(res, { room: pushRoom(room.code), playerId: id });
      return;
    }
    if (
      url.pathname.match(/^\/api\/rooms\/[^/]+\/kick$/) &&
      req.method === "POST"
    ) {
      const code = url.pathname.split("/")[3].toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        sendJson(res, { error: "Комната не найдена" }, 404);
        return;
      }
      const body = await readBody(req);
      const requesterId = Number(body.requesterId);
      const targetId = Number(body.targetId);
      if (room.ownerId !== requesterId) {
        sendJson(res, { error: "Только хост может кикать" }, 403);
        return;
      }
      if (requesterId === targetId) {
        sendJson(res, { error: "Нельзя кикнуть себя" }, 400);
        return;
      }
      room.players = room.players.filter((id) => id !== targetId);
      matchAssignments.delete(targetId);
      // Notify the kicked player so their UI can return to the main menu.
      try {
        notifyUser(targetId, {
          type: "room:kicked",
          code,
          reason: "host",
          by: requesterId,
        });
      } catch (_) {}
      try {
        storage.trackEvent("room_kick", { code, targetId, by: requesterId });
      } catch (_) {}
      sendJson(res, { room: pushRoom(code) });
      return;
    }
    if (
      url.pathname.match(/^\/api\/rooms\/[^/]+\/transfer$/) &&
      req.method === "POST"
    ) {
      const code = url.pathname.split("/")[3].toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        sendJson(res, { error: "Комната не найдена" }, 404);
        return;
      }
      const body = await readBody(req);
      const requesterId = Number(body.requesterId);
      const targetId = Number(body.targetId);
      if (room.ownerId !== requesterId) {
        sendJson(res, { error: "Только хост может передать права" }, 403);
        return;
      }
      if (!room.players.includes(targetId)) {
        sendJson(res, { error: "Игрок не в комнате" }, 400);
        return;
      }
      room.ownerId = targetId;
      sendJson(res, { room: pushRoom(code) });
      return;
    }
    if (
      url.pathname.match(/^\/api\/rooms\/[^/]+\/leave$/) &&
      req.method === "POST"
    ) {
      const code = url.pathname.split("/")[3].toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        sendJson(res, { error: "Комната не найдена" }, 404);
        return;
      }
      const body = await readBody(req);
      const playerId = Number(body.playerId);
      room.players = room.players.filter((id) => id !== playerId);
      matchAssignments.delete(playerId);
      if (room.ownerId === playerId && room.players.length > 0) {
        room.ownerId = room.players[0];
      }
      if (room.players.length === 0) {
        if (currentMatchRoomCode === code) currentMatchRoomCode = null;
        rooms.delete(code);
        chats.delete(code);
        sendJson(res, { left: true });
        return;
      }
      sendJson(res, { room: pushRoom(code) });
      return;
    }
    if (
      url.pathname.match(/^\/api\/rooms\/[^/]+\/start$/) &&
      req.method === "POST"
    ) {
      const code = url.pathname.split("/")[3].toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        sendJson(res, { error: "Комната не найдена" }, 404);
        return;
      }
      const body = await readBody(req);
      const requesterId = Number(body.requesterId);
      if (room.ownerId !== requesterId) {
        sendJson(res, { error: "Только хост может начать игру" }, 403);
        return;
      }
      if (room.players.length < 3) {
        sendJson(res, { error: "Минимум 3 игрока" }, 400);
        return;
      }
      try {
        beginRoundWeb(room);
        sendJson(res, { room: pushRoom(code), started: true });
      } catch (e) {
        console.error("Start game error:", e);
        room.status = "lobby";
        sendJson(res, { error: e.message || "Ошибка запуска игры" }, 500);
      }
      return;
    }
    if (
      url.pathname.match(/^\/api\/rooms\/[^/]+\/packs$/) &&
      req.method === "POST"
    ) {
      const code = url.pathname.split("/")[3].toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        sendJson(res, { error: "Комната не найдена" }, 404);
        return;
      }
      const body = await readBody(req);
      const requesterId = Number(body.requesterId);
      if (room.ownerId !== requesterId) {
        sendJson(res, { error: "Только хост может менять паки" }, 403);
        return;
      }
      const packId = body.packId;
      if (packById.has(packId)) {
        if (room.packIds.includes(packId)) {
          if (room.packIds.length > 1) {
            room.packIds = room.packIds.filter((id) => id !== packId);
          }
        } else {
          room.packIds.push(packId);
        }
      }
      sendJson(res, { room: pushRoom(code) });
      return;
    }
    if (
      url.pathname.match(/^\/api\/rooms\/[^/]+\/chat$/) &&
      req.method === "GET"
    ) {
      const code = url.pathname.split("/")[3].toUpperCase();
      if (!rooms.has(code)) {
        sendJson(res, { error: "Комната не найдена" }, 404);
        return;
      }
      const since = Number(url.searchParams.get("since") || 0);
      const messages = (chats.get(code) || []).filter((m) => m.ts > since);
      sendJson(res, { messages });
      return;
    }
    if (
      url.pathname.match(/^\/api\/rooms\/[^/]+\/chat$/) &&
      req.method === "POST"
    ) {
      const code = url.pathname.split("/")[3].toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        sendJson(res, { error: "Комната не найдена" }, 404);
        return;
      }
      const body = await readBody(req);
      const text = String(body.text || "")
        .trim()
        .slice(0, 500);
      const name = String(body.name || "Гость").slice(0, 30);
      const playerId = Number(body.playerId || 0) || null;
      if (!text) {
        sendJson(res, { error: "Пустое сообщение" }, 400);
        return;
      }
      // Chat command handling (server-side)
      const cmd = parseChatCommand(text);
      if (cmd) {
        const result = handleChatCommand(room, cmd, { playerId, name });
        if (result) {
          const sysMsg = {
            id: nextChatId(code),
            name: "Система",
            text: result.text,
            ts: Date.now(),
            system: true,
            playerId: null,
          };
          pushChat(code, sysMsg);
          broadcastChat(code, sysMsg);
          sendJson(res, { message: sysMsg, command: true });
          return;
        }
      }
      const msg = {
        id: nextChatId(code),
        name,
        text,
        ts: Date.now(),
        playerId,
        reactions: {},
      };
      pushChat(code, msg);
      broadcastChat(code, msg);
      sendJson(res, { message: msg });
      return;
    }
    if (
      url.pathname.match(/^\/api\/rooms\/[^/]+\/chat\/react$/) &&
      req.method === "POST"
    ) {
      const code = url.pathname.split("/")[3].toUpperCase();
      if (!rooms.has(code)) {
        sendJson(res, { error: "Комната не найдена" }, 404);
        return;
      }
      const body = await readBody(req);
      const messageId = String(body.messageId || "");
      const emoji = String(body.emoji || "").slice(0, 8);
      const playerId = Number(body.playerId);
      if (!messageId || !emoji || !playerId) {
        sendJson(res, { error: "Некорректный запрос" }, 400);
        return;
      }
      const list = chats.get(code) || [];
      const msg = list.find((m) => String(m.id) === messageId);
      if (!msg) {
        sendJson(res, { error: "Сообщение не найдено" }, 404);
        return;
      }
      if (!msg.reactions) msg.reactions = {};
      if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
      const idx = msg.reactions[emoji].indexOf(playerId);
      if (idx >= 0) msg.reactions[emoji].splice(idx, 1);
      else msg.reactions[emoji].push(playerId);
      if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
      broadcastReaction(code, { messageId, reactions: msg.reactions });
      storage.trackEvent("chat_reaction", { code, messageId, emoji, playerId });
      sendJson(res, { ok: true, reactions: msg.reactions });
      return;
    }
    if (
      url.pathname.match(/^\/api\/rooms\/[^/]+\/vote-kick$/) &&
      req.method === "POST"
    ) {
      const code = url.pathname.split("/")[3].toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        sendJson(res, { error: "Комната не найдена" }, 404);
        return;
      }
      const body = await readBody(req);
      const voterId = Number(body.voterId);
      const targetId = Number(body.targetId);
      const vote = body.vote === false ? false : true;
      if (!room.players.includes(voterId) || !room.players.includes(targetId)) {
        sendJson(res, { error: "Игрок не в комнате" }, 400);
        return;
      }
      if (voterId === targetId) {
        sendJson(res, { error: "Нельзя голосовать против себя" }, 400);
        return;
      }
      if (!room.kickVotes) room.kickVotes = new Map();
      const voteData = room.kickVotes.get(targetId) || {
        yes: new Set(),
        startedAt: Date.now(),
        startedBy: voterId,
      };
      if (vote) voteData.yes.add(voterId);
      else voteData.yes.delete(voterId);
      room.kickVotes.set(targetId, voteData);
      // Need majority (more than half) of other players
      const others = room.players.filter((id) => id !== targetId).length;
      const need = Math.ceil(others / 2) + (others % 2 === 0 ? 0 : 0);
      const required = Math.max(2, Math.ceil(others / 2));
      const yesCount = voteData.yes.size;
      const sysText = `Голосование за кик ${getPlayerName(targetId)}: ${yesCount}/${required}`;
      const sysMsg = {
        id: nextChatId(code),
        name: "Система",
        text: sysText,
        ts: Date.now(),
        system: true,
      };
      pushChat(code, sysMsg);
      broadcastChat(code, sysMsg);
      if (yesCount >= required) {
        room.players = room.players.filter((id) => id !== targetId);
        matchAssignments.delete(targetId);
        room.kickVotes.delete(targetId);
        // Hand over host rights if the kicked player was the host
        if (room.ownerId === targetId && room.players.length > 0) {
          room.ownerId = room.players[0];
        }
        const kickedName = getPlayerName(targetId);
        const kickMsg = {
          id: nextChatId(code),
          name: "Система",
          text: `🚪 ${kickedName} был кикнут голосованием`,
          ts: Date.now(),
          system: true,
        };
        pushChat(code, kickMsg);
        broadcastChat(code, kickMsg);
        broadcastRoom(code, getApiRoom(code));
        try {
          notifyUser(targetId, {
            type: "room:kicked",
            code,
            reason: "vote",
            voters: Array.from(voteData.yes),
          });
        } catch (_) {}
        storage.trackEvent("vote_kick_success", {
          code,
          targetId,
          voters: Array.from(voteData.yes),
        });
        sendJson(res, { kicked: true, room: getApiRoom(code) });
        return;
      }
      sendJson(res, { kicked: false, yes: yesCount, required });
      return;
    }
    if (
      url.pathname.match(/^\/api\/rooms\/[^/]+\/role$/) &&
      req.method === "GET"
    ) {
      const code = url.pathname.split("/")[3].toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        sendJson(res, { error: "Комната не найдена" }, 404);
        return;
      }
      const playerId = Number(url.searchParams.get("playerId"));
      const role = getPlayerRole(room, playerId);
      sendJson(res, { role, room: getApiRoom(code) });
      return;
    }
    if (
      url.pathname.match(/^\/api\/rooms\/[^/]+\/next-turn$/) &&
      req.method === "POST"
    ) {
      const code = url.pathname.split("/")[3].toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        sendJson(res, { error: "Комната не найдена" }, 404);
        return;
      }
      if (room.status !== "playing") {
        sendJson(res, { error: "Сейчас не ход" }, 400);
        return;
      }
      room.currentPlayerIndex += 1;
      if (room.currentPlayerIndex >= room.order.length) {
        room.status = "voting";
        room.votes = new Map();
      }
      sendJson(res, { room: pushRoom(code) });
      return;
    }
    if (
      url.pathname.match(/^\/api\/rooms\/[^/]+\/vote$/) &&
      req.method === "POST"
    ) {
      const code = url.pathname.split("/")[3].toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        sendJson(res, { error: "Комната не найдена" }, 404);
        return;
      }
      if (room.status !== "voting") {
        sendJson(res, { error: "Голосование не идёт" }, 400);
        return;
      }
      const body = await readBody(req);
      const voterId = Number(body.voterId);
      const targetId = Number(body.targetId);
      room.votes.set(voterId, targetId);
      if (room.votes.size >= room.players.length) {
        const result = finishVotingWeb(room);
        sendJson(res, { room: pushRoom(code), result });
        return;
      }
      sendJson(res, { room: pushRoom(code) });
      return;
    }
    if (
      url.pathname.match(/^\/api\/rooms\/[^/]+\/guess$/) &&
      req.method === "POST"
    ) {
      const code = url.pathname.split("/")[3].toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        sendJson(res, { error: "Комната не найдена" }, 404);
        return;
      }
      const body = await readBody(req);
      const playerId = Number(body.playerId);
      const guess = String(body.guess || "").trim();
      if (playerId !== room.spyId) {
        sendJson(res, { error: "Только шпион может угадывать" }, 403);
        return;
      }
      const correct =
        room.card &&
        (fuzzyMatch(guess, room.card.name) ||
          (room.card.nameEn && fuzzyMatch(guess, room.card.nameEn)));
      const result = {
        text: correct
          ? `Шпион угадал карту "${room.card.name}"! Шпион победил!`
          : `Шпион ошибся! Карта была: ${room.card.name}`,
        card: room.card.name,
        spy: getPlayerName(room.spyId),
        spyWon: correct,
      };
      room.lastResult = result;
      room.status = "finished";
      sendJson(res, { room: pushRoom(code), result });
      return;
    }
    if (
      url.pathname.match(/^\/api\/rooms\/[^/]+\/next-round$/) &&
      req.method === "POST"
    ) {
      const code = url.pathname.split("/")[3].toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        sendJson(res, { error: "Комната не найдена" }, 404);
        return;
      }
      const body = await readBody(req);
      if (room.ownerId !== Number(body.requesterId)) {
        sendJson(res, { error: "Только хост" }, 403);
        return;
      }
      try {
        beginRoundWeb(room);
        sendJson(res, { room: pushRoom(code) });
      } catch (e) {
        room.status = "lobby";
        sendJson(res, { error: e.message }, 500);
      }
      return;
    }
    if (
      url.pathname.match(/^\/api\/rooms\/[^/]+\/back-to-lobby$/) &&
      req.method === "POST"
    ) {
      const code = url.pathname.split("/")[3].toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        sendJson(res, { error: "Комната не найдена" }, 404);
        return;
      }
      room.status = "lobby";
      room.currentRound = 0;
      room.lastResult = null;
      sendJson(res, { room: pushRoom(code) });
      return;
    }
    // ==================== USER PROFILE / STATS BACKUP ====================
    if (url.pathname === "/api/me" && req.method === "GET") {
      const playerId = Number(url.searchParams.get("playerId"));
      if (!playerId) {
        sendJson(res, { error: "playerId required" }, 400);
        return;
      }
      const u = storage.getOrCreateUser(playerId);
      sendJson(res, {
        user: storage.publicProfile(u),
        full: serializeFullUser(u),
      });
      return;
    }
    if (url.pathname === "/api/me/identify" && req.method === "POST") {
      const body = await readBody(req);
      const playerId = Number(body.playerId);
      if (!playerId) {
        sendJson(res, { error: "playerId required" }, 400);
        return;
      }
      const u = storage.upsertUser(playerId, {
        name: String(body.name || "").slice(0, 30) || undefined,
        avatar: body.avatar || undefined,
        username: body.username || undefined,
      });
      sendJson(res, {
        user: storage.publicProfile(u),
        full: serializeFullUser(u),
      });
      return;
    }
    if (url.pathname === "/api/me/sync-stats" && req.method === "POST") {
      // Merge stats from a returning client (localStorage values) with what
      // we have on the server, keeping the higher number for each counter.
      // This makes stats portable across devices.
      const body = await readBody(req);
      const playerId = Number(body.playerId);
      const incoming = body.stats || {};
      if (!playerId) {
        sendJson(res, { error: "playerId required" }, 400);
        return;
      }
      const u = storage.updateUser(playerId, (user) => {
        const s = user.stats || storage.defaultStats();
        for (const key of Object.keys(s)) {
          const a = Number(s[key] || 0);
          const b = Number(incoming[key] || 0);
          s[key] = Math.max(a, b);
        }
        user.stats = s;
      });
      sendJson(res, {
        user: storage.publicProfile(u),
        full: serializeFullUser(u),
      });
      return;
    }
    if (url.pathname === "/api/me/game-result" && req.method === "POST") {
      const body = await readBody(req);
      const playerId = Number(body.playerId);
      if (!playerId) {
        sendJson(res, { error: "playerId required" }, 400);
        return;
      }
      const out = storage.applyGameResult(playerId, {
        wasSpy: Boolean(body.wasSpy),
        won: Boolean(body.won),
      });
      // Notify via WS (so level-up popup can render in real time even
      // for late updates).
      notifyUser(playerId, {
        type: "me:update",
        user: storage.publicProfile(out.user),
        full: serializeFullUser(out.user),
        leveledUp: out.leveledUp,
        fromLevel: out.fromLevel,
        toLevel: out.toLevel,
      });
      sendJson(res, {
        user: storage.publicProfile(out.user),
        full: serializeFullUser(out.user),
        leveledUp: out.leveledUp,
        fromLevel: out.fromLevel,
        toLevel: out.toLevel,
      });
      return;
    }
    if (url.pathname.match(/^\/api\/users\/(\d+)$/) && req.method === "GET") {
      const id = Number(url.pathname.split("/")[3]);
      const u = storage.getUser(id);
      if (!u) {
        sendJson(res, { error: "Пользователь не найден" }, 404);
        return;
      }
      sendJson(res, {
        user: storage.publicProfile(u),
        online: isPlayerOnline(id),
      });
      return;
    }
    if (url.pathname === "/api/users/search" && req.method === "POST") {
      const body = await readBody(req);
      const list = storage
        .searchUsers(body.query || "", 30)
        .map((p) => ({ ...p, online: isPlayerOnline(p.id) }));
      sendJson(res, { users: list });
      return;
    }

    // ==================== FRIENDS ====================
    if (url.pathname === "/api/friends" && req.method === "GET") {
      const playerId = Number(url.searchParams.get("playerId"));
      if (!playerId) {
        sendJson(res, { error: "playerId required" }, 400);
        return;
      }
      const u = storage.getOrCreateUser(playerId);
      const friends = (u.friends || [])
        .map((fid) => {
          const f = storage.getUser(fid);
          return f
            ? {
                ...storage.publicProfile(f),
                online: isPlayerOnline(fid),
                currentRoom: findCurrentRoomCode(fid),
              }
            : null;
        })
        .filter(Boolean);
      const incoming = (u.friendRequestsIn || [])
        .map((fid) => {
          const f = storage.getUser(fid);
          return f
            ? { ...storage.publicProfile(f), online: isPlayerOnline(fid) }
            : null;
        })
        .filter(Boolean);
      const outgoing = (u.friendRequestsOut || [])
        .map((fid) => {
          const f = storage.getUser(fid);
          return f
            ? { ...storage.publicProfile(f), online: isPlayerOnline(fid) }
            : null;
        })
        .filter(Boolean);
      sendJson(res, { friends, incoming, outgoing });
      return;
    }
    if (url.pathname === "/api/friends/request" && req.method === "POST") {
      const body = await readBody(req);
      const fromId = Number(body.playerId);
      const toId = Number(body.targetId);
      if (!fromId || !toId) {
        sendJson(res, { error: "playerId/targetId required" }, 400);
        return;
      }
      try {
        storage.sendFriendRequest(fromId, toId);
        const from = storage.getUser(fromId);
        notifyUser(toId, {
          type: "friend:request",
          from: storage.publicProfile(from),
        });
        sendJson(res, { ok: true });
      } catch (e) {
        sendJson(res, { error: e.message }, 400);
      }
      return;
    }
    if (url.pathname === "/api/friends/accept" && req.method === "POST") {
      const body = await readBody(req);
      const playerId = Number(body.playerId);
      const fromId = Number(body.fromId);
      try {
        storage.acceptFriendRequest(playerId, fromId);
        const u = storage.getUser(playerId);
        const f = storage.getUser(fromId);
        notifyUser(fromId, {
          type: "friend:accepted",
          friend: storage.publicProfile(u),
        });
        notifyUser(playerId, {
          type: "friend:accepted",
          friend: storage.publicProfile(f),
        });
        sendJson(res, { ok: true });
      } catch (e) {
        sendJson(res, { error: e.message }, 400);
      }
      return;
    }
    if (url.pathname === "/api/friends/decline" && req.method === "POST") {
      const body = await readBody(req);
      try {
        storage.declineFriendRequest(
          Number(body.playerId),
          Number(body.fromId),
        );
        sendJson(res, { ok: true });
      } catch (e) {
        sendJson(res, { error: e.message }, 400);
      }
      return;
    }
    if (url.pathname === "/api/friends/remove" && req.method === "POST") {
      const body = await readBody(req);
      try {
        storage.removeFriend(Number(body.playerId), Number(body.targetId));
        sendJson(res, { ok: true });
      } catch (e) {
        sendJson(res, { error: e.message }, 400);
      }
      return;
    }
    if (url.pathname === "/api/friends/invite" && req.method === "POST") {
      const body = await readBody(req);
      const fromId = Number(body.playerId);
      const toId = Number(body.targetId);
      const code = String(body.code || "").toUpperCase();
      if (!fromId || !toId || !code) {
        sendJson(res, { error: "playerId/targetId/code required" }, 400);
        return;
      }
      const from = storage.getUser(fromId);
      if (!from) {
        sendJson(res, { error: "Не найден пользователь" }, 404);
        return;
      }
      const ok = notifyUser(toId, {
        type: "room:invite",
        from: storage.publicProfile(from),
        code,
        link: `${PUBLIC_URL}/?join=${encodeURIComponent(code)}`,
      });
      storage.trackEvent("room_invite_sent", {
        fromId,
        toId,
        code,
        delivered: ok,
      });
      sendJson(res, { delivered: ok });
      return;
    }

    // ==================== COSMETICS SHOP ====================
    if (url.pathname === "/api/shop/catalog" && req.method === "GET") {
      sendJson(res, { catalog: cosmetics.ALL });
      return;
    }
    if (url.pathname === "/api/shop/equip" && req.method === "POST") {
      const body = await readBody(req);
      const playerId = Number(body.playerId);
      const kind = String(body.kind || "");
      const itemId = body.itemId;
      try {
        const u = storage.equipItem(playerId, kind, itemId);
        notifyUser(playerId, {
          type: "me:update",
          user: storage.publicProfile(u),
          full: serializeFullUser(u),
        });
        sendJson(res, {
          user: storage.publicProfile(u),
          full: serializeFullUser(u),
        });
      } catch (e) {
        sendJson(res, { error: e.message }, 400);
      }
      return;
    }
    if (url.pathname === "/api/shop/purchase-link" && req.method === "POST") {
      // Create a Telegram Stars invoice for a specific cosmetic item.
      const body = await readBody(req);
      const playerId = Number(body.playerId);
      const kind = String(body.kind || "");
      const itemId = body.itemId;
      const item = cosmetics.findItem(kind, itemId);
      if (!item || !item.starsPrice) {
        sendJson(res, { error: "Предмет недоступен для покупки" }, 400);
        return;
      }
      try {
        const link = await createStarsInvoice({
          title: `${item.title} (${kind})`,
          description: `Покупка предмета "${item.title}"`,
          payload: JSON.stringify({
            kind: "cosmetic",
            cosmeticKind: kind,
            itemId,
            playerId,
            stars: item.starsPrice,
          }),
          stars: item.starsPrice,
        });
        sendJson(res, { link, stars: item.starsPrice, item });
      } catch (e) {
        sendJson(res, { error: e.message }, 500);
      }
      return;
    }

    // ==================== "НА ПОКУШАТЬ" (DONATIONS) ====================
    if (url.pathname === "/api/donate/create-link" && req.method === "POST") {
      const body = await readBody(req);
      const playerId = Number(body.playerId);
      const stars = Math.max(
        1,
        Math.min(100000, Math.floor(Number(body.stars))),
      );
      if (!playerId || !stars) {
        sendJson(res, { error: "playerId / stars required" }, 400);
        return;
      }
      const title = body.title || `На покушать (${stars} ⭐)`;
      const description =
        body.description ||
        "Поддержать разработчика — даёт премиум и косметику.";
      try {
        const link = await createStarsInvoice({
          title,
          description,
          payload: JSON.stringify({ kind: "donation", playerId, stars }),
          stars,
        });
        storage.trackEvent("donate_link_created", { playerId, stars });
        sendJson(res, { link, stars });
      } catch (e) {
        sendJson(res, { error: e.message || "Не удалось создать инвойс" }, 500);
      }
      return;
    }
    if (url.pathname === "/api/donate/test-grant" && req.method === "POST") {
      // Local-dev fallback: if bot token is not configured, lets the client
      // simulate a successful donation. Behind a feature flag.
      if (process.env.NODE_ENV === "production") {
        sendJson(res, { error: "Недоступно в проде" }, 403);
        return;
      }
      const body = await readBody(req);
      const playerId = Number(body.playerId);
      const stars = Math.max(1, Math.floor(Number(body.stars || 0)));
      if (!playerId || !stars) {
        sendJson(res, { error: "playerId / stars required" }, 400);
        return;
      }
      grantDonationRewards(playerId, stars, "manual-test");
      const u = storage.getUser(playerId);
      sendJson(res, {
        user: storage.publicProfile(u),
        full: serializeFullUser(u),
      });
      return;
    }

    // ==================== ADMIN MINI APP ====================
    if (url.pathname === "/api/admin/me" && req.method === "GET") {
      const admin = requireAdminRequest(req, res, url);
      if (!admin) return;
      sendJson(res, {
        isAdmin: true,
        adminId: admin.id,
        via: admin.via,
        summary: buildAdminSummary(),
      });
      return;
    }
    if (url.pathname === "/api/admin/summary" && req.method === "GET") {
      const admin = requireAdminRequest(req, res, url);
      if (!admin) return;
      sendJson(res, buildAdminSummary());
      return;
    }
    if (url.pathname === "/api/admin/catalog" && req.method === "GET") {
      const admin = requireAdminRequest(req, res, url);
      if (!admin) return;
      sendJson(res, { kinds: ADMIN_COSMETIC_KINDS, catalog: cosmetics.ALL });
      return;
    }
    if (url.pathname === "/api/admin/users" && req.method === "GET") {
      const admin = requireAdminRequest(req, res, url);
      if (!admin) return;
      const query = url.searchParams.get("query") || "";
      const limit = Number(url.searchParams.get("limit") || 30);
      sendJson(res, { users: searchAdminUsers(query, limit) });
      return;
    }
    if (
      url.pathname.match(/^\/api\/admin\/users\/(\d+)$/) &&
      req.method === "GET"
    ) {
      const admin = requireAdminRequest(req, res, url);
      if (!admin) return;
      const id = Number(url.pathname.split("/")[4]);
      const u = storage.getUser(id);
      if (!u) {
        sendJson(res, { error: "Пользователь не найден" }, 404);
        return;
      }
      sendJson(res, { user: adminUserView(u, { includePayments: true }) });
      return;
    }
    if (
      url.pathname.match(/^\/api\/admin\/users\/(\d+)\/xp$/) &&
      req.method === "POST"
    ) {
      const body = await readBody(req);
      const admin = requireAdminRequest(req, res, url, body);
      if (!admin) return;
      const id = Number(url.pathname.split("/")[4]);
      const value = Number(body.value);
      if (!Number.isFinite(value)) {
        sendJson(res, { error: "value required" }, 400);
        return;
      }
      const mode = body.mode === "set" ? "set" : "add";
      const out =
        mode === "set"
          ? storage.setXp(id, value, `admin:${admin.id}`)
          : storage.addXp(id, value, `admin:${admin.id}`);
      if (!out || !out.user) {
        sendJson(res, { error: "Не удалось изменить XP" }, 400);
        return;
      }
      notifyProfileUpdate(id, {
        leveledUp: out.leveledUp,
        fromLevel: out.fromLevel,
        toLevel: out.toLevel,
      });
      auditAdmin(admin.id, mode === "set" ? "xp_set" : "xp_add", {
        targetId: id,
        value,
      });
      sendJson(res, {
        user: adminUserView(out.user, { includePayments: true }),
        result: out,
      });
      return;
    }
    if (
      url.pathname.match(/^\/api\/admin\/users\/(\d+)\/level$/) &&
      req.method === "POST"
    ) {
      const body = await readBody(req);
      const admin = requireAdminRequest(req, res, url, body);
      if (!admin) return;
      const id = Number(url.pathname.split("/")[4]);
      const level = Math.max(
        1,
        Math.min(999, Math.floor(Number(body.level) || 1)),
      );
      const out = storage.setLevel(id, level, `admin:${admin.id}`);
      notifyProfileUpdate(id, {
        leveledUp: out.leveledUp,
        fromLevel: out.fromLevel,
        toLevel: out.toLevel,
      });
      auditAdmin(admin.id, "level_set", { targetId: id, level });
      sendJson(res, {
        user: adminUserView(out.user, { includePayments: true }),
        result: out,
      });
      return;
    }
    if (
      url.pathname.match(/^\/api\/admin\/users\/(\d+)\/cosmetics\/grant$/) &&
      req.method === "POST"
    ) {
      const body = await readBody(req);
      const admin = requireAdminRequest(req, res, url, body);
      if (!admin) return;
      const id = Number(url.pathname.split("/")[4]);
      const kind = String(body.kind || "");
      const itemId = body.itemId;
      try {
        validateCosmeticInput(kind, itemId);
        let u = storage.grantItem(id, kind, itemId);
        if (body.equip) u = storage.equipItem(id, kind, itemId);
        notifyProfileUpdate(id);
        auditAdmin(admin.id, "cosmetic_grant", {
          targetId: id,
          kind,
          itemId,
          equip: Boolean(body.equip),
        });
        sendJson(res, { user: adminUserView(u, { includePayments: true }) });
      } catch (e) {
        sendJson(res, { error: e.message }, 400);
      }
      return;
    }
    if (
      url.pathname.match(/^\/api\/admin\/users\/(\d+)\/cosmetics\/revoke$/) &&
      req.method === "POST"
    ) {
      const body = await readBody(req);
      const admin = requireAdminRequest(req, res, url, body);
      if (!admin) return;
      const id = Number(url.pathname.split("/")[4]);
      const kind = String(body.kind || "");
      const itemId = body.itemId;
      try {
        validateCosmeticInput(kind, itemId);
        const u = storage.revokeItem(id, kind, itemId);
        notifyProfileUpdate(id);
        auditAdmin(admin.id, "cosmetic_revoke", { targetId: id, kind, itemId });
        sendJson(res, { user: adminUserView(u, { includePayments: true }) });
      } catch (e) {
        sendJson(res, { error: e.message }, 400);
      }
      return;
    }
    if (
      url.pathname.match(/^\/api\/admin\/users\/(\d+)\/premium$/) &&
      req.method === "POST"
    ) {
      const body = await readBody(req);
      const admin = requireAdminRequest(req, res, url, body);
      if (!admin) return;
      const id = Number(url.pathname.split("/")[4]);
      const u = storage.updateUser(id, (user) => {
        if (body.mode === "clear" || body.active === false) {
          user.premium = false;
          user.premiumUntil = 0;
          return;
        }
        const days = Math.max(
          1,
          Math.min(3650, Math.floor(Number(body.days) || 30)),
        );
        user.premium = true;
        user.premiumUntil =
          Math.max(Number(user.premiumUntil || 0), Date.now()) +
          days * 24 * 60 * 60 * 1000;
      });
      notifyProfileUpdate(id);
      auditAdmin(
        admin.id,
        body.mode === "clear" || body.active === false
          ? "premium_clear"
          : "premium_grant",
        { targetId: id, days: body.days || null },
      );
      sendJson(res, { user: adminUserView(u, { includePayments: true }) });
      return;
    }
    if (
      url.pathname.match(/^\/api\/admin\/users\/(\d+)\/stats$/) &&
      req.method === "POST"
    ) {
      const body = await readBody(req);
      const admin = requireAdminRequest(req, res, url, body);
      if (!admin) return;
      const id = Number(url.pathname.split("/")[4]);
      const u = storage.updateUser(id, (user) => {
        if (body.mode === "reset") {
          user.stats = storage.defaultStats();
          return;
        }
        const patch = body.stats || {};
        const stats = { ...(user.stats || storage.defaultStats()) };
        for (const key of Object.keys(storage.defaultStats())) {
          if (key in patch)
            stats[key] = Math.max(0, Math.floor(Number(patch[key]) || 0));
        }
        user.stats = stats;
      });
      notifyProfileUpdate(id);
      auditAdmin(
        admin.id,
        body.mode === "reset" ? "stats_reset" : "stats_patch",
        { targetId: id },
      );
      sendJson(res, { user: adminUserView(u, { includePayments: true }) });
      return;
    }
    if (
      url.pathname.match(/^\/api\/admin\/users\/(\d+)\/profile$/) &&
      req.method === "POST"
    ) {
      const body = await readBody(req);
      const admin = requireAdminRequest(req, res, url, body);
      if (!admin) return;
      const id = Number(url.pathname.split("/")[4]);
      const u = storage.updateUser(id, (user) => {
        if (body.name != null)
          user.name = String(body.name).trim().slice(0, 30) || user.name;
        if (body.username !== undefined)
          user.username = body.username
            ? String(body.username).replace(/^@/, "").slice(0, 32)
            : null;
        if (body.avatar !== undefined)
          user.avatar = body.avatar ? String(body.avatar).slice(0, 500) : null;
      });
      notifyProfileUpdate(id);
      auditAdmin(admin.id, "profile_patch", { targetId: id });
      sendJson(res, { user: adminUserView(u, { includePayments: true }) });
      return;
    }
    if (url.pathname === "/api/admin/notify" && req.method === "POST") {
      const body = await readBody(req);
      const admin = requireAdminRequest(req, res, url, body);
      if (!admin) return;
      const targetId = Number(body.targetId);
      const message = String(body.message || "")
        .trim()
        .slice(0, 1000);
      if (!targetId || !message) {
        sendJson(res, { error: "targetId/message required" }, 400);
        return;
      }
      const deliveredWs = notifyUser(targetId, {
        type: "admin:message",
        message,
        from: admin.id,
        ts: Date.now(),
      });
      if (bot && body.telegram !== false) {
        bot.telegram
          .sendMessage(targetId, `🛡 Сообщение от админа:\n\n${message}`)
          .catch(() => {});
      }
      auditAdmin(admin.id, "notify", { targetId, deliveredWs });
      sendJson(res, { ok: true, deliveredWs });
      return;
    }
    if (url.pathname === "/api/admin/rooms" && req.method === "GET") {
      const admin = requireAdminRequest(req, res, url);
      if (!admin) return;
      sendJson(res, {
        rooms: Array.from(rooms.values()).map(getRoomAdminView),
      });
      return;
    }
    if (
      url.pathname.match(/^\/api\/admin\/rooms\/[^/]+\/action$/) &&
      req.method === "POST"
    ) {
      const body = await readBody(req);
      const admin = requireAdminRequest(req, res, url, body);
      if (!admin) return;
      const code = url.pathname.split("/")[4].toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        sendJson(res, { error: "Комната не найдена" }, 404);
        return;
      }
      if (body.action === "close") {
        for (const id of room.players) {
          matchAssignments.delete(id);
          notifyUser(id, {
            type: "room:kicked",
            code,
            reason: "admin",
            by: admin.id,
          });
        }
        rooms.delete(code);
        chats.delete(code);
        if (currentMatchRoomCode === code) currentMatchRoomCode = null;
        auditAdmin(admin.id, "room_close", { code });
        sendJson(res, { ok: true, closed: true });
        return;
      }
      if (body.action === "backToLobby") {
        room.status = "lobby";
        room.currentRound = 0;
        room.lastResult = null;
        auditAdmin(admin.id, "room_lobby", { code });
        sendJson(res, { room: pushRoom(code) });
        return;
      }
      if (body.action === "kick") {
        const targetId = Number(body.targetId);
        if (!room.players.includes(targetId)) {
          sendJson(res, { error: "Игрок не в комнате" }, 400);
          return;
        }
        room.players = room.players.filter((id) => id !== targetId);
        matchAssignments.delete(targetId);
        if (room.ownerId === targetId && room.players.length > 0)
          room.ownerId = room.players[0];
        notifyUser(targetId, {
          type: "room:kicked",
          code,
          reason: "admin",
          by: admin.id,
        });
        auditAdmin(admin.id, "room_kick", { code, targetId });
        if (room.players.length === 0) {
          rooms.delete(code);
          chats.delete(code);
          sendJson(res, { ok: true, closed: true });
          return;
        }
        sendJson(res, { room: pushRoom(code) });
        return;
      }
      sendJson(res, { error: "Неизвестное действие" }, 400);
      return;
    }

    // ==================== ANALYTICS ====================
    if (url.pathname === "/api/analytics/track" && req.method === "POST") {
      const body = await readBody(req);
      const event = String(body.event || "").slice(0, 64);
      if (!event) {
        sendJson(res, { error: "event required" }, 400);
        return;
      }
      storage.trackEvent(event, {
        playerId: body.playerId || null,
        ...body.props,
      });
      sendJson(res, { ok: true });
      return;
    }
    if (url.pathname === "/api/analytics/summary" && req.method === "GET") {
      const admin = getAdminFromRequest(req, url);
      const legacyPlayerId = Number(url.searchParams.get("playerId"));
      if (!admin.ok && !ADMIN_USER_IDS.includes(legacyPlayerId)) {
        sendJson(res, { error: "Только админы" }, 403);
        return;
      }
      sendJson(res, storage.summarizeEvents());
      return;
    }

    if (url.pathname.match(/^\/api\/rooms\/[^/]+$/)) {
      const code = url.pathname.split("/")[3].toUpperCase();
      const room = getApiRoom(code);
      if (!room) {
        sendJson(res, { error: "Комната не найдена" }, 404);
        return;
      }
      sendJson(res, { room });
      return;
    }
    if (url.pathname === "/telegram" && req.method === "POST" && bot) {
      const body = await readRaw(req);
      await bot.handleUpdate(JSON.parse(body));
      res.writeHead(200).end("ok");
      return;
    }
    serveStatic(publicDir, url.pathname, res);
  });
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function readBody(req) {
  const raw = await readRaw(req);
  if (!raw) return {};
  return JSON.parse(raw);
}

function sendJson(res, payload, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function applyCorsHeaders(req, res) {
  const configured = String(process.env.CORS_ALLOW_ORIGIN || "*");
  const origin = req.headers.origin;
  if (configured === "*") {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin) {
    const allowed = configured
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (allowed.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
  }
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Telegram-Init-Data, X-Admin-User-Id",
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function serveStatic(publicDir, pathname, res) {
  const safePath =
    pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const filePath = path.normalize(path.join(publicDir, safePath));
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404).end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    const types = {
      ".html": "text/html",
      ".css": "text/css",
      ".js": "application/javascript",
      ".svg": "image/svg+xml",
      ".png": "image/png",
    };
    res.writeHead(200, {
      "Content-Type": `${types[ext] || "application/octet-stream"}; charset=utf-8`,
    });
    res.end(content);
  });
}

const bot = setupBot();
const server = createServer(bot);
setupWebSocket(server);
server.listen(PORT, async () => {
  console.log(`Кто шпион app is running on ${PUBLIC_URL} (port ${PORT})`);
  console.log(`WebSocket endpoint: ${PUBLIC_URL.replace(/^http/, "ws")}/ws`);
  if (bot) {
    if (process.env.WEBHOOK_URL) {
      await bot.telegram.setWebhook(
        `${normalizePublicUrl(process.env.WEBHOOK_URL)}/telegram`,
      );
      console.log("Telegram webhook is configured.");
    } else {
      bot.launch();
      console.log("Telegram bot polling started.");
    }
  } else {
    console.log("BOT_TOKEN is not set, web preview only.");
  }
});

process.once("SIGINT", () => {
  if (bot) bot.stop("SIGINT");
  try {
    storage.flush("users");
    storage.flush("payments");
  } catch (_) {}
  server.close();
});
process.once("SIGTERM", () => {
  if (bot) bot.stop("SIGTERM");
  try {
    storage.flush("users");
    storage.flush("payments");
  } catch (_) {}
  server.close();
});
