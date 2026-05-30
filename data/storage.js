// Server-side persistent JSON storage.
// Stores users/friends/inventory/payments/analytics on disk so data is not
// lost between restarts and follows users across devices.

const fs = require("fs");
const path = require("path");
const cosmetics = require("./cosmetics");

const ROOT = path.join(__dirname, "storage");
const FILES = {
  users: path.join(ROOT, "users.json"),
  payments: path.join(ROOT, "payments.json"),
  events: path.join(ROOT, "events.jsonl"),
};

function ensureRoot() {
  if (!fs.existsSync(ROOT)) fs.mkdirSync(ROOT, { recursive: true });
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.error(`storage: failed to read ${file}:`, err.message);
    return fallback;
  }
}

const cache = {
  users: null,
  payments: null,
  dirty: { users: false, payments: false },
};
const SAVE_DEBOUNCE_MS = 400;
const saveTimers = { users: null, payments: null };

function loadAll() {
  ensureRoot();
  cache.users = readJson(FILES.users, {});
  cache.payments = readJson(FILES.payments, {});
}

function scheduleSave(kind) {
  cache.dirty[kind] = true;
  if (saveTimers[kind]) return;
  saveTimers[kind] = setTimeout(() => {
    saveTimers[kind] = null;
    flush(kind);
  }, SAVE_DEBOUNCE_MS);
}

function flush(kind) {
  if (!kind) {
    flush("users");
    flush("payments");
    return;
  }
  if (!cache.dirty[kind]) return;
  cache.dirty[kind] = false;
  try {
    ensureRoot();
    const tmp = `${FILES[kind]}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache[kind], null, 2));
    fs.renameSync(tmp, FILES[kind]);
  } catch (err) {
    console.error(`storage: failed to write ${kind}:`, err.message);
  }
}

function defaultStats() {
  return {
    games: 0,
    wins: 0,
    losses: 0,
    spyCount: 0,
    peacefulCount: 0,
    spyWins: 0,
    peacefulWins: 0,
    streak: 0,
    bestStreak: 0,
  };
}

function defaultInventory() {
  return {
    frames: ["default"],
    themes: ["dark", "light"],
    nameEffects: ["none"],
    statusEmojis: ["none"],
    animatedAvatars: [],
    equipped: {
      frame: "default",
      theme: "dark",
      nameEffect: "none",
      statusEmoji: "none",
      animatedAvatar: null,
    },
  };
}

const INVENTORY_KINDS = [
  "frames",
  "themes",
  "nameEffects",
  "statusEmojis",
  "animatedAvatars",
];

function unique(values) {
  return Array.from(
    new Set((values || []).filter((v) => v !== undefined && v !== null)),
  );
}

function equippedKeyForKind(kind) {
  return kind === "animatedAvatars"
    ? "animatedAvatar"
    : String(kind || "").replace(/s$/, "");
}

function ensureInventory(user) {
  const base = defaultInventory();
  if (!user.inventory || typeof user.inventory !== "object")
    user.inventory = defaultInventory();
  for (const kind of INVENTORY_KINDS) {
    user.inventory[kind] = unique([
      ...(base[kind] || []),
      ...((user.inventory && user.inventory[kind]) || []),
    ]);
  }
  user.inventory.equipped = {
    ...base.equipped,
    ...((user.inventory && user.inventory.equipped) || {}),
  };
  for (const kind of INVENTORY_KINDS) {
    const key = equippedKeyForKind(kind);
    const equipped = user.inventory.equipped[key];
    if (equipped && !user.inventory[kind].includes(equipped)) {
      user.inventory.equipped[key] = base.equipped[key] ?? null;
    }
  }
  return user.inventory;
}

function canUnlockItemByLevel(user, item) {
  if (!item) return false;
  const required = Number(item.levelRequired || 0);
  if (!required)
    return Boolean(item.free || Number(item.starsPrice || 0) === 0);
  return (
    (user.level || 1) >= required &&
    (item.freeAt === "level" || Number(item.starsPrice || 0) === 0)
  );
}

function syncLevelRewards(user) {
  ensureInventory(user);
  const unlocked = [];
  for (const kind of INVENTORY_KINDS) {
    for (const item of cosmetics.ALL[kind] || []) {
      if (!item || !item.levelRequired) continue;
      if (!canUnlockItemByLevel(user, item)) continue;
      if (!user.inventory[kind].includes(item.id)) {
        user.inventory[kind].push(item.id);
        unlocked.push({ kind, itemId: item.id });
      }
    }
  }
  return unlocked;
}

function defaultUser(id, overrides = {}) {
  return {
    id: Number(id),
    name: overrides.name || `Игрок ${id}`,
    avatar: overrides.avatar || null,
    username: overrides.username || null,
    level: 1,
    xp: 0,
    premium: false,
    premiumUntil: 0,
    totalStarsDonated: 0,
    stats: defaultStats(),
    inventory: defaultInventory(),
    friends: [],
    friendRequestsIn: [],
    friendRequestsOut: [],
    createdAt: Date.now(),
    lastSeen: Date.now(),
  };
}

function getUser(id) {
  if (!cache.users) loadAll();
  return cache.users[String(id)] || null;
}

function upsertUser(id, patch = {}) {
  if (!cache.users) loadAll();
  const key = String(id);
  const existing = cache.users[key];
  if (!existing) {
    const u = defaultUser(id, patch);
    Object.assign(u, patch, { id: Number(id) });
    if (!u.stats) u.stats = defaultStats();
    ensureInventory(u);
    syncLevelRewards(u);
    if (!u.friends) u.friends = [];
    if (!u.friendRequestsIn) u.friendRequestsIn = [];
    if (!u.friendRequestsOut) u.friendRequestsOut = [];
    cache.users[key] = u;
    scheduleSave("users");
    return u;
  }
  // Merge patch shallowly, but never overwrite nested objects we manage
  Object.keys(patch).forEach((k) => {
    if (
      k === "stats" ||
      k === "inventory" ||
      k === "friends" ||
      k === "friendRequestsIn" ||
      k === "friendRequestsOut"
    )
      return;
    existing[k] = patch[k];
  });
  if (!existing.stats) existing.stats = defaultStats();
  ensureInventory(existing);
  syncLevelRewards(existing);
  if (!existing.friends) existing.friends = [];
  if (!existing.friendRequestsIn) existing.friendRequestsIn = [];
  if (!existing.friendRequestsOut) existing.friendRequestsOut = [];
  existing.lastSeen = Date.now();
  scheduleSave("users");
  return existing;
}

function getOrCreateUser(id, patch = {}) {
  return getUser(id) || upsertUser(id, patch);
}

function updateUser(id, mutator) {
  const u = getOrCreateUser(id);
  ensureInventory(u);
  mutator(u);
  ensureInventory(u);
  scheduleSave("users");
  return u;
}

function listUsers() {
  if (!cache.users) loadAll();
  return Object.values(cache.users);
}

// XP / level helpers — quadratic curve, ~100 xp per level baseline.
function xpForLevel(level) {
  // total xp needed to reach `level` from 0
  return Math.round(100 * Math.pow(Math.max(1, level - 1), 1.6));
}

function levelForXp(xp) {
  let level = 1;
  while (xpForLevel(level + 1) <= xp && level < 999) level += 1;
  return level;
}

function addXp(userId, delta, reason) {
  if (!delta) return null;
  const u = getOrCreateUser(userId);
  const before = u.level;
  u.xp = Math.max(0, Math.floor((u.xp || 0) + Number(delta)));
  u.level = levelForXp(u.xp);
  const unlocked = syncLevelRewards(u);
  scheduleSave("users");
  trackEvent("xp_added", {
    userId,
    delta,
    reason: reason || "unknown",
    xp: u.xp,
    level: u.level,
  });
  if (u.level > before) {
    trackEvent("level_up", { userId, level: u.level, xp: u.xp, unlocked });
  }
  return {
    user: u,
    leveledUp: u.level > before,
    fromLevel: before,
    toLevel: u.level,
    unlocked,
  };
}

function setXp(userId, xp, reason) {
  const u = getOrCreateUser(userId);
  const before = u.level || 1;
  u.xp = Math.max(0, Math.floor(Number(xp) || 0));
  u.level = levelForXp(u.xp);
  const unlocked = syncLevelRewards(u);
  scheduleSave("users");
  trackEvent("xp_set", {
    userId,
    xp: u.xp,
    level: u.level,
    reason: reason || "admin",
  });
  if (u.level > before)
    trackEvent("level_up", { userId, level: u.level, xp: u.xp, unlocked });
  return {
    user: u,
    leveledUp: u.level > before,
    fromLevel: before,
    toLevel: u.level,
    unlocked,
  };
}

function setLevel(userId, level, reason) {
  const safeLevel = Math.max(1, Math.min(999, Math.floor(Number(level) || 1)));
  return setXp(userId, xpForLevel(safeLevel), reason || "level_set");
}

function applyGameResult(userId, { wasSpy, won }) {
  const u = getOrCreateUser(userId);
  u.stats.games += 1;
  if (wasSpy) u.stats.spyCount += 1;
  else u.stats.peacefulCount += 1;
  if (won) {
    u.stats.wins += 1;
    if (wasSpy) u.stats.spyWins += 1;
    else u.stats.peacefulWins += 1;
    u.stats.streak += 1;
    if (u.stats.streak > u.stats.bestStreak)
      u.stats.bestStreak = u.stats.streak;
  } else {
    u.stats.losses += 1;
    u.stats.streak = 0;
  }
  scheduleSave("users");
  // Award XP: base 10, win bonus 25, spy-win extra 15
  let delta = 10;
  if (won) delta += 25;
  if (won && wasSpy) delta += 15;
  return { user: u, ...addXp(userId, delta, won ? "game_win" : "game_loss") };
}

// Friends ----------------------------------------------------------
function sendFriendRequest(fromId, toId) {
  if (Number(fromId) === Number(toId)) throw new Error("Нельзя добавить себя");
  const from = getOrCreateUser(fromId);
  const to = getOrCreateUser(toId);
  if (from.friends.includes(to.id)) return { ok: true, already: true };
  if (to.friendRequestsIn.includes(from.id)) return { ok: true, already: true };
  if (!from.friendRequestsOut.includes(to.id))
    from.friendRequestsOut.push(to.id);
  if (!to.friendRequestsIn.includes(from.id)) to.friendRequestsIn.push(from.id);
  scheduleSave("users");
  trackEvent("friend_request", { from: from.id, to: to.id });
  return { ok: true };
}

function acceptFriendRequest(userId, fromId) {
  const u = getOrCreateUser(userId);
  const other = getOrCreateUser(fromId);
  u.friendRequestsIn = u.friendRequestsIn.filter((id) => id !== other.id);
  other.friendRequestsOut = other.friendRequestsOut.filter((id) => id !== u.id);
  if (!u.friends.includes(other.id)) u.friends.push(other.id);
  if (!other.friends.includes(u.id)) other.friends.push(u.id);
  scheduleSave("users");
  trackEvent("friend_accept", { a: u.id, b: other.id });
  return { ok: true };
}

function declineFriendRequest(userId, fromId) {
  const u = getOrCreateUser(userId);
  const other = getOrCreateUser(fromId);
  u.friendRequestsIn = u.friendRequestsIn.filter((id) => id !== other.id);
  other.friendRequestsOut = other.friendRequestsOut.filter((id) => id !== u.id);
  scheduleSave("users");
  return { ok: true };
}

function removeFriend(userId, otherId) {
  const u = getOrCreateUser(userId);
  const other = getOrCreateUser(otherId);
  u.friends = u.friends.filter((id) => id !== other.id);
  other.friends = other.friends.filter((id) => id !== u.id);
  scheduleSave("users");
  trackEvent("friend_remove", { a: u.id, b: other.id });
  return { ok: true };
}

function searchUsers(query, limit = 20) {
  if (!cache.users) loadAll();
  const q = String(query || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
  if (!q) return [];
  const results = [];
  for (const u of Object.values(cache.users)) {
    if (!u || !u.id) continue;
    const idMatch = String(u.id).includes(q);
    const nameMatch = u.name && u.name.toLowerCase().includes(q);
    const userMatch = u.username && u.username.toLowerCase().includes(q);
    if (idMatch || nameMatch || userMatch) {
      results.push(publicProfile(u));
      if (results.length >= limit) break;
    }
  }
  return results;
}

function publicProfile(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    avatar: u.avatar,
    username: u.username || null,
    level: u.level || 1,
    xp: u.xp || 0,
    premium: Boolean(u.premium),
    stats: u.stats || defaultStats(),
    equipped:
      (u.inventory && u.inventory.equipped) || defaultInventory().equipped,
    lastSeen: u.lastSeen || 0,
  };
}

// Cosmetics / inventory --------------------------------------------
function grantItem(userId, kind, itemId) {
  const u = getOrCreateUser(userId);
  ensureInventory(u);
  const list = u.inventory[kind];
  if (!list) throw new Error(`Unknown cosmetic kind: ${kind}`);
  if (!list.includes(itemId)) list.push(itemId);
  scheduleSave("users");
  return u;
}

function revokeItem(userId, kind, itemId) {
  const u = getOrCreateUser(userId);
  ensureInventory(u);
  const list = u.inventory[kind];
  if (!list) throw new Error(`Unknown cosmetic kind: ${kind}`);
  const base = defaultInventory();
  if ((base[kind] || []).includes(itemId))
    throw new Error("Базовый предмет нельзя забрать");
  u.inventory[kind] = list.filter((id) => id !== itemId);
  const key = equippedKeyForKind(kind);
  if (u.inventory.equipped && u.inventory.equipped[key] === itemId) {
    u.inventory.equipped[key] = base.equipped[key] ?? null;
  }
  scheduleSave("users");
  trackEvent("cosmetic_revoked", { userId, kind, itemId });
  return u;
}

function equipItem(userId, kind, itemId) {
  const u = getOrCreateUser(userId);
  ensureInventory(u);
  const list = u.inventory[kind] || [];
  const item = cosmetics.findItem(kind, itemId);
  if (!list.includes(itemId) && canUnlockItemByLevel(u, item)) {
    list.push(itemId);
  }
  if (kind === "animatedAvatars") {
    if (itemId && !list.includes(itemId))
      throw new Error("Этот предмет не куплен");
    u.inventory.equipped.animatedAvatar = itemId || null;
  } else {
    const equippedKind = equippedKeyForKind(kind);
    if (!list.includes(itemId)) throw new Error("Этот предмет не куплен");
    u.inventory.equipped[equippedKind] = itemId;
  }
  scheduleSave("users");
  trackEvent("cosmetic_equipped", { userId, kind, itemId });
  return u;
}

function setPremium(userId, durationMs, stars) {
  const u = getOrCreateUser(userId);
  const now = Date.now();
  u.premium = true;
  u.premiumUntil =
    Math.max(u.premiumUntil || 0, now) +
    (durationMs || 30 * 24 * 60 * 60 * 1000);
  u.totalStarsDonated = (u.totalStarsDonated || 0) + (stars || 0);
  scheduleSave("users");
  return u;
}

// Payments ---------------------------------------------------------
function recordPayment(payment) {
  if (!cache.payments) loadAll();
  const id =
    payment.id || `pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  cache.payments[id] = { ...payment, id, ts: payment.ts || Date.now() };
  scheduleSave("payments");
  trackEvent("payment", {
    id,
    userId: payment.userId,
    stars: payment.stars,
    type: payment.type,
  });
  return cache.payments[id];
}

function listPaymentsForUser(userId) {
  if (!cache.payments) loadAll();
  return Object.values(cache.payments).filter(
    (p) => Number(p.userId) === Number(userId),
  );
}

// Analytics --------------------------------------------------------
function trackEvent(event, props = {}) {
  ensureRoot();
  try {
    const line = JSON.stringify({ event, props, ts: Date.now() }) + "\n";
    fs.appendFile(FILES.events, line, () => {});
  } catch (err) {
    // swallow
  }
}

function summarizeEvents(limit = 1000) {
  ensureRoot();
  try {
    if (!fs.existsSync(FILES.events)) return { totals: {}, recent: [] };
    const raw = fs.readFileSync(FILES.events, "utf8");
    const lines = raw.split(/\n/).filter(Boolean);
    const totals = {};
    const recent = [];
    const tail = lines.slice(-limit);
    for (const line of tail) {
      try {
        const e = JSON.parse(line);
        totals[e.event] = (totals[e.event] || 0) + 1;
        recent.push(e);
      } catch (_) {}
    }
    return {
      totals,
      recent: recent.slice(-100).reverse(),
      totalLines: lines.length,
    };
  } catch (err) {
    return { totals: {}, recent: [], error: err.message };
  }
}

// Initial load
loadAll();

// Persist on shutdown
function shutdown() {
  flush();
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
process.once("exit", shutdown);

module.exports = {
  // users
  getUser,
  getOrCreateUser,
  upsertUser,
  updateUser,
  listUsers,
  publicProfile,
  // xp
  addXp,
  setXp,
  setLevel,
  xpForLevel,
  levelForXp,
  applyGameResult,
  // friends
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  removeFriend,
  searchUsers,
  // cosmetics
  grantItem,
  revokeItem,
  equipItem,
  setPremium,
  // payments
  recordPayment,
  listPaymentsForUser,
  // analytics
  trackEvent,
  summarizeEvents,
  // util
  flush,
  defaultInventory,
  defaultStats,
};
