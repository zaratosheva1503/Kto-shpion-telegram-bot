
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
    try {
    const safePath = req.url.replace(/^\/\/+/, "/");
    const url = new URL(safePath, PUBLIC_URL);
    // [STABILITY] Per-IP rate limit for API endpoints.
    if (url.pathname.startsWith("/api/")) {
      const ip =
        (String(req.headers["x-forwarded-for"] || "").split(",")[0] || "").trim() ||
        req.socket.remoteAddress ||
        "unknown";
      if (!checkRateLimit(ip)) {
        sendJson(res, { error: "Слишком много запросов, подожди немного" }, 429);
        return;
      }
    }
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
      const actor = verifyActor(req, requesterId);
      if (!actor.ok) {
        sendJson(res, { error: actor.error || "Не подтверждена личность" }, 403);
        return;
      }
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
      const actor = verifyActor(req, requesterId);
      if (!actor.ok) {
        sendJson(res, { error: actor.error || "Не подтверждена личность" }, 403);
        return;
      }
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
      const actor = verifyActor(req, requesterId);
      if (!actor.ok) {
        sendJson(res, { error: actor.error || "Не подтверждена личность" }, 403);
        return;
      }
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
      const actor = verifyActor(req, requesterId);
      if (!actor.ok) {
        sendJson(res, { error: actor.error || "Не подтверждена личность" }, 403);
        return;
      }
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
      // [ANTI-CHEAT] In strict mode you may only fetch your OWN role, so nobody
      // can peek at who the spy is by passing another player's id.
      const roleActor = verifyActor(req, playerId);
      if (!roleActor.ok) {
        sendJson(res, { error: roleActor.error || "Не подтверждена личность" }, 403);
        return;
      }
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
      const actor = verifyActor(req, body.requesterId);
      if (!actor.ok) {
        sendJson(res, { error: actor.error || "Не подтверждена личность" }, 403);
        return;
      }
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
    } catch (err) {
      if (err && err.statusCode === 413) {
        sendJson(res, { error: "Слишком большой запрос" }, 413);
      } else {
        console.error("Request handler error:", err && err.message);
        if (!res.headersSent)
          sendJson(res, { error: "Внутренняя ошибка сервера" }, 500);
      }
    }
  });
}

const MAX_BODY_BYTES = 100 * 1024; // [STABILITY] 100 KB cap on request bodies

function readRaw(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const err = new Error("Payload too large");
        err.statusCode = 413;
        req.destroy();
        reject(err);
        return;
      }
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function readBody(req) {
  const raw = await readRaw(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
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

// [STABILITY] Crash guards so one bad request/promise can't kill the process.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err && err.message);
});

// [STABILITY] Periodic cleanup of empty rooms and stale rate-limit buckets.
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (!room.players || room.players.length === 0) {
      rooms.delete(code);
      chats.delete(code);
      if (currentMatchRoomCode === code) currentMatchRoomCode = null;
    }
  }
  for (const [ip, bucket] of rateBuckets) {
    if (now > bucket.reset) rateBuckets.delete(ip);
  }
}, 5 * 60 * 1000);
cleanupTimer.unref();

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
