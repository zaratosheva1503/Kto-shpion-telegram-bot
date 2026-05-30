const tg = window.Telegram && window.Telegram.WebApp;
if (tg) {
  try {
    tg.ready();
    tg.expand();
  } catch (_) {}
}
const tgUser = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;

// Pretty avatar icons via Dicebear (deterministic SVG, no auth, CDN-cached)
function dicebearAvatar(style, seed) {
  return `https://api.dicebear.com/7.x/${style}/svg?seed=${encodeURIComponent(seed)}&radius=50&backgroundType=gradientLinear&backgroundRotation=0,360`;
}

const AVATAR_OPTIONS = (() => {
  const seeds = [
    "Felix",
    "Maverick",
    "Sasha",
    "Loki",
    "Tigger",
    "Boots",
    "Aria",
    "Nova",
    "Mochi",
    "Pepper",
    "Coco",
    "Buddy",
    "Zara",
    "Dexter",
    "Misty",
    "Bella",
    "Charlie",
    "Lola",
    "Ginger",
    "Oreo",
    "Shadow",
    "Pumpkin",
    "Storm",
    "Whiskers",
  ];
  const styles = [
    "fun-emoji",
    "bottts",
    "adventurer",
    "avataaars",
    "lorelei",
    "micah",
    "notionists",
    "open-peeps",
    "pixel-art",
    "thumbs",
    "big-smile",
    "personas",
  ];
  const opts = [];
  seeds.forEach((seed, i) => {
    const style = styles[i % styles.length];
    opts.push({ id: `${style}:${seed}`, url: dicebearAvatar(style, seed) });
  });
  return opts;
})();

// Legacy emoji fallbacks for backward-compat with old saved values
const LEGACY_EMOJI = [
  "😎",
  "🦊",
  "🐱",
  "🐯",
  "🐼",
  "🐸",
  "🐵",
  "🐶",
  "🐺",
  "🦄",
  "🦁",
  "🐲",
  "👻",
  "👽",
  "🤖",
  "🧙",
  "🦸",
  "🥷",
  "🧛",
  "🧞",
  "🐻",
];

function isAvatarUrl(value) {
  return typeof value === "string" && /^(https?:|data:|\/)/.test(value);
}

function renderAvatarInto(el, value, altText) {
  if (!el) return;
  if (isAvatarUrl(value)) {
    el.innerHTML = "";
    const img = document.createElement("img");
    img.src = value;
    img.alt = altText || "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.onerror = () => {
      el.innerHTML = "";
      el.textContent = "🙂";
    };
    el.appendChild(img);
  } else {
    el.innerHTML = "";
    el.textContent = value || "🙂";
  }
}

const STATS_KEY = "spyStats";
const NAME_KEY = "spyPlayerName";
const ID_KEY = "spyPlayerId";
const THEME_KEY = "spyTheme";
const AVATAR_KEY = "spyAvatar";
const SETTINGS_KEY = "spyUserSettings";

function pickStableAvatar(seedId) {
  const seed = seedId ? Number(seedId) : Math.floor(Math.random() * 1e6);
  return AVATAR_OPTIONS[Math.abs(seed) % AVATAR_OPTIONS.length].url;
}

const initialPlayerId = tgUser
  ? tgUser.id
  : Number(localStorage.getItem(ID_KEY)) || null;

const state = {
  mode: "online",
  rounds: 2,
  timer: 0,
  spyHints: false,
  spyCantGuess: false,
  phoneVibration: false,
  packs: [],
  room: null,
  role: null,
  playerId: initialPlayerId,
  name: tgUser
    ? tgUser.first_name + (tgUser.last_name ? " " + tgUser.last_name : "")
    : localStorage.getItem(NAME_KEY) ||
      `Игрок ${Math.floor(Math.random() * 900 + 100)}`,
  avatar: localStorage.getItem(AVATAR_KEY) || pickStableAvatar(initialPlayerId),
  pollTimer: null,
  chatTimer: null,
  matchTimer: null,
  lastChatTs: 0,
  inMatchmaking: false,
  statsRecordedFor: null,
};

if (!state.playerId) {
  state.playerId = Number(`9${Math.floor(Math.random() * 900000 + 100000)}`);
}
localStorage.setItem(ID_KEY, String(state.playerId));
localStorage.setItem(NAME_KEY, state.name);
localStorage.setItem(AVATAR_KEY, state.avatar);

// === DOM refs ===
const $ = (id) => document.getElementById(id);
const roomCard = $("room-card");
const actionsSection = $("actions-section");
const roomCode = $("room-code");
const roomPlayers = $("room-players");
const roomStatus = $("room-status");
const roomInfoBar = $("room-info-bar");
const joinCode = $("join-code");
const chatSection = $("chat-section");
const chatBody = $("chat-body");
const chatMessages = $("chat-messages");
const chatInput = $("chat-input");
const packsBrowser = $("packs-browser");
const packsGrid = $("packs-grid");
const gameScreen = $("game-screen");
const gameContent = $("game-content");
const matchmakingCard = $("matchmaking-card");
const mmProgressBar = $("mm-progress-bar");
const mmMeta = $("mm-meta");
const mmStatus = $("mm-status");
const mmTitle = $("mm-title");
const bottomNav = $("bottom-nav");
const navPill = $("nav-pill");
const themeSwitch = $("theme-switch");
const themeIcon = $("theme-icon");
const themeCurrent = $("theme-current");
const profileName = $("profile-name");
const profileAvatar = $("profile-avatar");
const profileId = $("profile-id");
const profileRank = $("profile-rank");
const userChipName = $("user-chip-name");
const userChipEmoji = $("user-chip-emoji");
const pageSubtitle = $("page-subtitle");
const rulesEl = $("rules");
const rulesToggle = $("rules-toggle");

// === API ===
function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (tg && tg.initData) headers["X-Telegram-Init-Data"] = tg.initData;
  if (state && state.playerId)
    headers["X-Admin-User-Id"] = String(state.playerId);
  return fetch(path, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Ошибка запроса");
    return data;
  });
}

function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// === Toasts ===
let toastStack;
function toast(message, variant = "", duration = 2400) {
  if (!toastStack) {
    toastStack = document.createElement("div");
    toastStack.className = "toast-stack";
    document.body.appendChild(toastStack);
  }
  const el = document.createElement("div");
  el.className = `toast ${variant}`.trim();
  el.textContent = message;
  toastStack.appendChild(el);
  setTimeout(() => {
    el.classList.add("fade-out");
    setTimeout(() => el.remove(), 240);
  }, duration);
  try {
    if (
      window.Telegram &&
      window.Telegram.WebApp &&
      window.Telegram.WebApp.HapticFeedback
    ) {
      window.Telegram.WebApp.HapticFeedback.notificationOccurred(
        variant === "error" ? "error" : "success",
      );
    }
  } catch (_) {}
}

// === Theme ===
function applyTheme(theme) {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
  if (themeIcon) themeIcon.textContent = theme === "light" ? "☀️" : "🌙";
  if (themeCurrent)
    themeCurrent.textContent = theme === "light" ? "Светлая" : "Тёмная";
  if (themeSwitch)
    themeSwitch.setAttribute(
      "aria-checked",
      theme === "light" ? "true" : "false",
    );
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta)
    meta.setAttribute("content", theme === "light" ? "#f3eefd" : "#0b0b14");
  try {
    if (window.Telegram && window.Telegram.WebApp) {
      window.Telegram.WebApp.setHeaderColor &&
        window.Telegram.WebApp.setHeaderColor(
          theme === "light" ? "#f3eefd" : "#0b0b14",
        );
      window.Telegram.WebApp.setBackgroundColor &&
        window.Telegram.WebApp.setBackgroundColor(
          theme === "light" ? "#f3eefd" : "#0a0a14",
        );
    }
  } catch (_) {}
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  applyTheme(current === "dark" ? "light" : "dark");
}

// === Page navigation ===
const PAGE_SUBTITLES = {
  home: "Найди шпиона среди своих",
  friends: "Друзья, заявки и быстрые инвайты",
  shop: "Косметика, темы и премиум",
  settings: "Подкрути под себя",
  profile: "Твоя статистика и стиль",
  admin: "Управление игроками и комнатами",
};

function switchPage(name) {
  document.querySelectorAll(".page").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.page === name);
  });
  const items = Array.from(bottomNav.querySelectorAll(".nav-item")).filter(
    (btn) => !btn.classList.contains("hidden"),
  );
  bottomNav.style.setProperty("--nav-count", String(items.length || 1));
  let activeIndex = 0;
  items.forEach((btn, idx) => {
    const isActive = btn.dataset.tab === name;
    btn.classList.toggle("is-active", isActive);
    if (isActive) activeIndex = idx;
  });
  if (navPill) {
    navPill.style.transform = `translateX(${activeIndex * 100}%)`;
  }
  if (pageSubtitle && PAGE_SUBTITLES[name]) {
    pageSubtitle.textContent = PAGE_SUBTITLES[name];
  }
  if (name === "profile") {
    renderProfile();
  }
  try {
    if (
      window.Telegram &&
      window.Telegram.WebApp &&
      window.Telegram.WebApp.HapticFeedback
    ) {
      window.Telegram.WebApp.HapticFeedback.selectionChanged();
    }
  } catch (_) {}
}

// === User chip ===
function refreshUserChip() {
  if (userChipName) userChipName.textContent = state.name;
  if (userChipEmoji) renderAvatarInto(userChipEmoji, state.avatar, state.name);
  if (profileAvatar) renderAvatarInto(profileAvatar, state.avatar, state.name);
  if (profileName && document.activeElement !== profileName)
    profileName.value = state.name;
  if (profileId) profileId.textContent = `ID ${state.playerId}`;
}

// === Stats ===
function loadStats() {
  try {
    const raw = JSON.parse(localStorage.getItem(STATS_KEY) || "null");
    if (raw && typeof raw === "object")
      return Object.assign(defaultStats(), raw);
  } catch (_) {}
  return defaultStats();
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

function saveStats(stats) {
  localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}

function recordGameResult({ wasSpy, won }) {
  const s = loadStats();
  s.games += 1;
  if (wasSpy) s.spyCount += 1;
  else s.peacefulCount += 1;
  if (won) {
    s.wins += 1;
    if (wasSpy) s.spyWins += 1;
    else s.peacefulWins += 1;
    s.streak += 1;
    if (s.streak > s.bestStreak) s.bestStreak = s.streak;
  } else {
    s.losses += 1;
    s.streak = 0;
  }
  saveStats(s);
  renderProfile();
}

function rankForStats(s) {
  if (s.wins >= 100) return { icon: "👑", text: "Легенда" };
  if (s.wins >= 50) return { icon: "💎", text: "Профи" };
  if (s.wins >= 25) return { icon: "🥇", text: "Эксперт" };
  if (s.wins >= 10) return { icon: "🥈", text: "Опытный" };
  if (s.wins >= 3) return { icon: "🥉", text: "Любитель" };
  return { icon: "🥚", text: "Новичок" };
}

function animateNumber(el, target, suffix = "") {
  const start = Number(String(el.textContent).replace(/[^0-9.\-]/g, "")) || 0;
  const dur = 600;
  const t0 = performance.now();
  function step(now) {
    const t = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    const value = Math.round(start + (target - start) * eased);
    el.textContent = `${value}${suffix}`;
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function renderProfile() {
  const s = loadStats();
  refreshUserChip();
  const winRate = s.games > 0 ? Math.round((s.wins / s.games) * 100) : 0;
  const spyRate =
    s.spyCount > 0 ? Math.round((s.spyWins / s.spyCount) * 100) : 0;
  const peacefulRate =
    s.peacefulCount > 0
      ? Math.round((s.peacefulWins / s.peacefulCount) * 100)
      : 0;

  const map = {
    games: s.games,
    wins: s.wins,
    losses: s.losses,
    winRate: `${winRate}%`,
    spyWins: s.spyWins,
    spyCount: s.spyCount,
    spyRate: `${spyRate}%`,
    peacefulWins: s.peacefulWins,
    peacefulCount: s.peacefulCount,
    peacefulRate: `${peacefulRate}%`,
    streak: s.streak,
    bestStreak: s.bestStreak,
  };
  document.querySelectorAll("[data-stat]").forEach((el) => {
    const key = el.dataset.stat;
    if (!(key in map)) return;
    const val = map[key];
    if (typeof val === "number") {
      animateNumber(el, val);
    } else {
      el.textContent = val;
    }
  });

  document.querySelectorAll("[data-stat-bar]").forEach((bar) => {
    const key = bar.dataset.statBar;
    const pct = key === "spy" ? spyRate : peacefulRate;
    bar.style.width = `${pct}%`;
  });

  const rank = rankForStats(s);
  if (profileRank) {
    profileRank.innerHTML = `<span class="rank-icon">${rank.icon}</span><span class="rank-text">${rank.text}</span>`;
  }
}

function resetStats() {
  if (!confirm("Точно сбросить всю статистику?")) return;
  localStorage.removeItem(STATS_KEY);
  state.statsRecordedFor = null;
  renderProfile();
  toast("Статистика сброшена", "success");
}

// === Settings persistence ===
function loadUserSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
    if (raw && typeof raw === "object") {
      [
        "mode",
        "rounds",
        "timer",
        "spyHints",
        "spyCantGuess",
        "phoneVibration",
      ].forEach((k) => {
        if (k in raw) state[k] = raw[k];
      });
    }
  } catch (_) {}
}

function saveUserSettings() {
  const data = {
    mode: state.mode,
    rounds: state.rounds,
    timer: state.timer,
    spyHints: state.spyHints,
    spyCantGuess: state.spyCantGuess,
    phoneVibration: state.phoneVibration,
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
}

function applySettingsToUI() {
  document.querySelectorAll(".segmented").forEach((container) => {
    const key = container.dataset.setting;
    if (!key) return;
    setSegmentValue(container, state[key]);
  });
  document
    .querySelectorAll('input[type="checkbox"][data-setting]')
    .forEach((cb) => {
      cb.checked = Boolean(state[cb.dataset.setting]);
    });
}

function setSegmentValue(container, value) {
  container.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.value === String(value));
  });
}

// === Packs ===
function renderPacksBrowser() {
  if (!state.room || !state.packs.length) return;
  const selected = state.room.packIds || [];
  const isHost = state.room.players.some(
    (p) => p.owner && p.id === Number(state.playerId),
  );
  const counter = $("packs-counter");
  if (counter) {
    const totalCards = state.packs
      .filter((p) => selected.includes(p.id))
      .reduce((s, p) => s + p.count, 0);
    counter.textContent = `выбрано ${selected.length}/${state.packs.length} · ${totalCards} карт`;
  }
  packsGrid.innerHTML = state.packs
    .map((pack) => {
      const isSelected = selected.includes(pack.id);
      const clickable = isHost ? `data-pack-id="${pack.id}"` : "";
      const showEn =
        pack.titleEn && pack.titleEn.toLowerCase() !== pack.title.toLowerCase();
      return `
        <div class="pack-select-item ${isSelected ? "selected" : ""} ${isHost ? "" : "readonly"}" ${clickable}>
            <div class="pack-select-cover" style="background-image:url('${pack.cover}')">
                <span class="pack-check">${isSelected ? "✓" : ""}</span>
                <span class="pack-count-badge">${pack.count}</span>
            </div>
            <span class="pack-title-ru">${pack.emoji} ${escapeHtml(pack.title)}</span>
            ${showEn ? `<small class="pack-title-en">${escapeHtml(pack.titleEn)}</small>` : ""}
        </div>`;
    })
    .join("");
}

// === Room rendering ===
function hideRoomSections() {
  roomCard.classList.add("hidden");
  chatSection.classList.add("hidden");
  gameScreen.classList.add("hidden");
  packsBrowser.classList.add("hidden");
}

function showMainUI() {
  hideRoomSections();
  actionsSection.classList.remove("hidden");
  matchmakingCard.classList.add("hidden");
  rulesToggle.classList.remove("hidden");
}

function showLobbyUI() {
  actionsSection.classList.add("hidden");
  matchmakingCard.classList.add("hidden");
  gameScreen.classList.add("hidden");
  roomCard.classList.remove("hidden");
  chatSection.classList.remove("hidden");
  rulesToggle.classList.add("hidden");
}

function showGameUI() {
  actionsSection.classList.add("hidden");
  matchmakingCard.classList.add("hidden");
  roomCard.classList.add("hidden");
  packsBrowser.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  chatSection.classList.remove("hidden");
  rulesToggle.classList.add("hidden");
}

function handleRoomUpdate(room) {
  // If we are not in the players list anymore, we were kicked — bounce to main menu.
  if (room && Array.isArray(room.players)) {
    const stillIn = room.players.some(
      (p) => Number(p.id) === Number(state.playerId),
    );
    if (!stillIn && state.room && state.room.code === room.code) {
      handleKickedFromRoom("host");
      return;
    }
  }
  state.room = room;
  if (room.status === "lobby") {
    renderLobby(room);
  } else if (room.status === "playing") {
    fetchRoleAndRenderGame(room);
  } else if (room.status === "voting") {
    fetchRoleAndRenderGame(room);
  } else if (room.status === "finished" || room.status === "round_end") {
    renderResult(room);
    maybeRecordStats(room);
  }
}

function handleKickedFromRoom(reason) {
  stopPolling();
  state.room = null;
  state.role = null;
  state._voted = false;
  state.statsRecordedFor = null;
  try {
    history.replaceState(null, "", location.pathname);
  } catch (_) {}
  showMainUI();
  switchPage("home");
  const text =
    reason === "vote"
      ? "Тебя кикнули голосованием 🗳"
      : "Хост кикнул тебя из комнаты 🚪";
  toast(text, "error", 3600);
}
window.handleKickedFromRoom = handleKickedFromRoom;

function maybeRecordStats(room) {
  if (!room.result) return;
  const key = `${room.code}:${room.currentRound || 0}:${room.status}`;
  if (state.statsRecordedFor === key) return;
  if (state.role == null) return;
  state.statsRecordedFor = key;
  const wasSpy = Boolean(state.role && state.role.isSpy);
  const spyWon = Boolean(room.result.spyWon);
  const won = wasSpy ? spyWon : !spyWon;
  recordGameResult({ wasSpy, won });
}

function renderLobby(room) {
  showLobbyUI();
  roomCode.textContent = room.code;

  const packNames =
    (room.packs || []).map((p) => `${p.emoji} ${p.title}`).join(" · ") ||
    "Не выбраны";
  const modeLabel = room.mode === "online" ? "🕹 Онлайн" : "🤝 Офлайн";
  roomInfoBar.innerHTML = `<span class="info-mode">${modeLabel}</span><span class="info-packs">🎒 ${packNames}</span><span class="info-rounds">🔁 ${room.rounds} кр.</span>`;

  const isHost = room.players.some(
    (p) => p.owner && p.id === Number(state.playerId),
  );
  roomPlayers.innerHTML =
    `<h3>Игроки (${room.players.length}/8)</h3>` +
    room.players
      .map((player) => {
        const isMe = Number(player.id) === Number(state.playerId);
        let actions = "";
        // Show vote-kick button for everyone (including host) on every other player.
        const canVoteKick = !isMe && !player.owner;
        if (isHost && !player.owner) {
          // Host: transfer-rights + vote-kick + hard kick in one row
          actions = `<span class="player-actions">
                <button class="btn-transfer" data-player-id="${player.id}" title="Передать права">👑</button>
                ${canVoteKick ? `<button class="btn-vote-kick" data-player-id="${player.id}" title="Голосовать за кик">🗳</button>` : ""}
                <button class="btn-kick" data-player-id="${player.id}" title="Кикнуть">✕</button>
            </span>`;
        } else if (canVoteKick) {
          // Non-host: just vote-kick
          actions = `<span class="player-actions">
                <button class="btn-vote-kick" data-player-id="${player.id}" title="Голосовать за кик">🗳</button>
            </span>`;
        }
        const equipped = player.equipped || {};
        const fxClass = `name-fx-${equipped.nameEffect || "none"}`;
        const statusEmoji =
          equipped.statusEmoji && equipped.statusEmoji !== "none"
            ? ` ${escapeHtml(equipped.statusEmoji)}`
            : "";
        const frame = equipped.frame || "default";
        const onlineDot = player.online
          ? '<span class="player-online-dot"></span>'
          : "";
        const level = player.level || 1;
        return `<div class="player" data-player-tap="${player.id}" data-frame="${frame}">
            <span class="player-name-line">${player.owner ? "👑" : "🙂"}${onlineDot} <span class="${fxClass}">${escapeHtml(player.name)}</span><small class="player-level"> · ур.${level}</small>${statusEmoji}</span>
            ${player.owner ? "<b>хост</b>" : actions}
        </div>`;
      })
      .join("");

  const startBtn =
    isHost && room.players.length >= 3
      ? '<button class="primary start-game-btn" id="start-game" type="button"><span class="btn-emoji">▶️</span><span class="btn-label">Начать игру</span><span class="btn-sub">Все готовы — погнали!</span></button>'
      : "";
  roomStatus.innerHTML =
    (room.players.length >= 3
      ? "Можно начинать игру"
      : "Минимум 3 игрока для старта") + startBtn;

  const browseBtn = $("browse-packs");
  if (browseBtn) browseBtn.textContent = isHost ? "🎒 Выбрать паки" : "🎒 Паки";

  renderPacksBrowser();
}

async function fetchRoleAndRenderGame(room) {
  try {
    const { role } = await api(
      `/api/rooms/${room.code}/role?playerId=${state.playerId}`,
    );
    state.role = role;
  } catch (_) {}

  if (room.status === "playing") {
    renderPlayingScreen(room);
  } else if (room.status === "voting") {
    renderVotingScreen(room);
  }
}

function renderPlayingScreen(room) {
  showGameUI();

  const existingGuessForm = $("guess-form");
  if (existingGuessForm && !existingGuessForm.classList.contains("hidden"))
    return;

  const role = state.role;
  const isMyTurn = room.currentPlayerId === Number(state.playerId);
  const isSpy = role && role.isSpy;

  let roleHtml;
  if (isSpy) {
    roleHtml = `<div class="role-card spy-role">
            <div class="role-emoji">🕵️</div>
            <h2>Ты — шпион</h2>
            <p>Слушай ассоциации и попробуй понять карту</p>
            ${
              role.spyHint
                ? `<div class="spy-hints"><small>Варианты:</small> ${role.spyHint
                    .map((h) => {
                      const hintName = typeof h === "string" ? h : h.name;
                      const hintEn =
                        typeof h === "object" && h.nameEn && h.nameEn !== h.name
                          ? h.nameEn
                          : null;
                      return `<span class="hint-tag">${escapeHtml(hintName)}${hintEn ? `<small>${escapeHtml(hintEn)}</small>` : ""}</span>`;
                    })
                    .join(" ")}</div>`
                : ""
            }
            <button class="btn-guess" id="btn-guess" type="button">🎯 Угадать карту</button>
            <div class="guess-form hidden" id="guess-form">
                <input class="guess-input" id="guess-input" placeholder="Название карты..." maxlength="100">
                <div class="guess-buttons">
                    <button class="primary" id="btn-send-guess" type="button">Отправить</button>
                    <button class="secondary" id="btn-cancel-guess" type="button">Отмена</button>
                </div>
            </div>
        </div>`;
  } else if (role && role.card) {
    roleHtml = `<div class="role-card civilian-role">
            ${role.card.image ? `<img class="role-image" src="${role.card.image}" alt="${escapeHtml(role.card.name)}">` : '<div class="role-emoji">🃏</div>'}
            <h2>🃏 ${escapeHtml(role.card.name)}</h2>
            ${role.card.nameEn && role.card.nameEn !== role.card.name ? `<p class="card-name-en">${escapeHtml(role.card.nameEn)}</p>` : ""}
            <p>Говори ассоциации, не выдавая карту шпиону</p>
        </div>`;
  } else {
    roleHtml = `<div class="role-card"><div class="role-emoji">⏳</div><h2>Загрузка...</h2></div>`;
  }

  const turnHtml = `<div class="turn-info">
        <p>Раунд ${room.currentRound}/${room.totalRounds}</p>
        <h3>${isMyTurn ? "🎙 Твой ход — скажи ассоциацию" : `🎙 Говорит: ${escapeHtml(room.currentPlayerName || "...")}`}</h3>
        ${isMyTurn ? '<button class="primary" id="btn-next-turn" type="button">✅ Я сказал, передай ход</button>' : ""}
    </div>`;

  const playersHtml = `<div class="game-players">${room.players
    .map(
      (p) =>
        `<span class="gp ${p.id === room.currentPlayerId ? "active" : ""}">${escapeHtml(p.name)}</span>`,
    )
    .join("")}</div>`;

  const next = roleHtml + turnHtml + playersHtml;
  // Skip the DOM rewrite if nothing changed — avoids "jumping" on every poll.
  if (gameContent.dataset.lastRender === next) return;
  gameContent.dataset.lastRender = next;
  gameContent.innerHTML = next;
}

function renderVotingScreen(room) {
  showGameUI();
  const alreadyVoted = state._voted;

  let votingHtml;
  if (alreadyVoted) {
    votingHtml = `<div class="vote-screen">
            <div class="role-emoji">🗳</div>
            <h2>Голосование</h2>
            <p>Ты уже проголосовал. Ждём остальных... (${room.votesCount}/${room.players.length})</p>
        </div>`;
  } else {
    votingHtml = `<div class="vote-screen">
            <div class="role-emoji">🗳</div>
            <h2>Кто шпион?</h2>
            <p>Голосуй за того, кого считаешь шпионом</p>
            <div class="vote-buttons">${room.players
              .map(
                (p) =>
                  `<button class="vote-btn" data-vote-id="${p.id}">${escapeHtml(p.name)}</button>`,
              )
              .join("")}</div>
        </div>`;
  }

  if (gameContent.dataset.lastRender === votingHtml) return;
  gameContent.dataset.lastRender = votingHtml;
  gameContent.innerHTML = votingHtml;
}

function renderResult(room) {
  showGameUI();
  const result = room.result;
  const isHost = room.players.some(
    (p) => p.owner && p.id === Number(state.playerId),
  );
  const wasSpy = Boolean(state.role && state.role.isSpy);
  const won = wasSpy
    ? Boolean(result && result.spyWon)
    : Boolean(result && !result.spyWon);

  let html = `<div class="result-screen">
        <div class="role-emoji">${won ? "🎉" : "💀"}</div>
        <h2>${won ? "Победа!" : "Поражение"}</h2>
        ${result ? `<p>${escapeHtml(result.text)}</p><p>Карта: <b>${escapeHtml(result.card)}</b></p><p>Шпион: <b>${escapeHtml(result.spy)}</b></p>` : ""}
        <div class="result-actions">`;

  if (isHost && room.status === "round_end") {
    html += `<button class="primary" id="btn-next-round" type="button">▶️ Следующий раунд</button>`;
  }
  html += `<button class="secondary" id="btn-back-lobby" type="button">🏠 В лобби</button>`;
  html += `</div></div>`;

  if (gameContent.dataset.lastRender === html) return;
  gameContent.dataset.lastRender = html;
  gameContent.innerHTML = html;
}

// === Polling ===
function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(async () => {
    if (!state.room) return;
    try {
      const { room } = await api(`/api/rooms/${state.room.code}`);
      handleRoomUpdate(room);
    } catch (_) {
      stopPolling();
      state.room = null;
      state.role = null;
      showMainUI();
    }
  }, 2000);
  state.chatTimer = setInterval(pollChat, 2500);
}

function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
  if (state.chatTimer) {
    clearInterval(state.chatTimer);
    state.chatTimer = null;
  }
}

async function pollChat() {
  if (!state.room) return;
  try {
    const { messages } = await api(
      `/api/rooms/${state.room.code}/chat?since=${state.lastChatTs}`,
    );
    if (messages.length > 0) {
      messages.forEach((m) => appendChatMessage(m));
      state.lastChatTs = messages[messages.length - 1].ts;
    }
  } catch (_) {}
}

function appendChatMessage(msg) {
  // Prefer the enhanced renderer from app-extras.js if available
  // (adds support for reactions, long-press, message IDs).
  if (
    typeof window.appendChatMessage === "function" &&
    window.appendChatMessage !== appendChatMessage
  ) {
    window.appendChatMessage(msg);
    return;
  }
  const div = document.createElement("div");
  div.className = "chat-msg";
  div.dataset.messageId = msg.id || `tmp-${msg.ts}`;
  div.dataset.playerId = msg.playerId || "";
  div.innerHTML = `<div class="chat-msg-body"><b class="chat-msg-name">${escapeHtml(msg.name)}</b> <span class="chat-msg-text">${escapeHtml(msg.text)}</span></div><div class="chat-reactions" data-message-id="${escapeHtml(msg.id || "")}"></div>`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function sendChatMessage() {
  const text = chatInput.value.trim();
  if (!text || !state.room) return;
  chatInput.value = "";
  try {
    await api(`/api/rooms/${state.room.code}/chat`, {
      method: "POST",
      body: { text, name: state.name, playerId: state.playerId },
    });
  } catch (_) {}
}

// === Room actions ===
async function loadPacks() {
  try {
    const { packs } = await api("/api/packs");
    state.packs = packs;
  } catch (_) {}
}

async function createRoom() {
  try {
    const { room, playerId, link } = await api("/api/rooms", {
      method: "POST",
      body: {
        name: state.name,
        playerId: state.playerId,
        telegramId: tgUser ? tgUser.id : undefined,
      },
    });
    state.playerId = playerId;
    localStorage.setItem(ID_KEY, String(playerId));
    state.lastChatTs = 0;
    state.role = null;
    state._voted = false;
    state.statsRecordedFor = null;
    handleRoomUpdate(room);
    startPolling();
    if (link) history.replaceState(null, "", new URL(link).search);
  } catch (e) {
    toast(e.message || "Не удалось создать комнату", "error");
  }
}

async function joinRoom(code) {
  if (!code) return;
  try {
    const { room, playerId } = await api(`/api/rooms/${code}/join`, {
      method: "POST",
      body: {
        playerId: state.playerId,
        name: state.name,
        telegramId: tgUser ? tgUser.id : undefined,
      },
    });
    state.playerId = playerId;
    localStorage.setItem(ID_KEY, String(playerId));
    state.lastChatTs = 0;
    state.role = null;
    state._voted = false;
    state.statsRecordedFor = null;
    handleRoomUpdate(room);
    startPolling();
    const params = new URLSearchParams(location.search);
    const bot = params.get("bot");
    history.replaceState(
      null,
      "",
      `?join=${room.code}${bot ? `&bot=${bot}` : ""}`,
    );
  } catch (e) {
    toast(e.message || "Не удалось войти", "error");
  }
}

async function leaveRoom() {
  if (!state.room) return;
  try {
    await api(`/api/rooms/${state.room.code}/leave`, {
      method: "POST",
      body: { playerId: state.playerId },
    });
  } catch (_) {}
  stopPolling();
  state.room = null;
  state.role = null;
  showMainUI();
  history.replaceState(null, "", location.pathname);
}

async function kickPlayer(targetId) {
  if (!state.room) return;
  try {
    const { room } = await api(`/api/rooms/${state.room.code}/kick`, {
      method: "POST",
      body: { requesterId: state.playerId, targetId },
    });
    handleRoomUpdate(room);
  } catch (e) {
    toast(e.message, "error");
  }
}

async function transferHost(targetId) {
  if (!state.room) return;
  try {
    const { room } = await api(`/api/rooms/${state.room.code}/transfer`, {
      method: "POST",
      body: { requesterId: state.playerId, targetId },
    });
    handleRoomUpdate(room);
  } catch (e) {
    toast(e.message, "error");
  }
}

async function togglePack(packId) {
  if (!state.room) return;
  try {
    const { room } = await api(`/api/rooms/${state.room.code}/packs`, {
      method: "POST",
      body: { packId, requesterId: state.playerId },
    });
    handleRoomUpdate(room);
  } catch (_) {}
}

async function startGame() {
  if (!state.room) return;
  try {
    state.role = null;
    state._voted = false;
    state.statsRecordedFor = null;
    const { room } = await api(`/api/rooms/${state.room.code}/start`, {
      method: "POST",
      body: { requesterId: state.playerId },
    });
    handleRoomUpdate(room);
  } catch (err) {
    toast(err.message, "error");
  }
}

async function nextTurn() {
  if (!state.room) return;
  try {
    const { room } = await api(`/api/rooms/${state.room.code}/next-turn`, {
      method: "POST",
    });
    handleRoomUpdate(room);
  } catch (_) {}
}

async function vote(targetId) {
  if (!state.room) return;
  state._voted = true;
  try {
    const data = await api(`/api/rooms/${state.room.code}/vote`, {
      method: "POST",
      body: { voterId: state.playerId, targetId },
    });
    handleRoomUpdate(data.room);
  } catch (_) {}
}

function showGuessForm() {
  const form = $("guess-form");
  if (form) {
    form.classList.remove("hidden");
    const input = $("guess-input");
    if (input) input.focus();
  }
}

function hideGuessForm() {
  const form = $("guess-form");
  if (form) form.classList.add("hidden");
}

async function submitGuess() {
  const input = $("guess-input");
  const guess = input ? input.value.trim() : "";
  if (!guess || !state.room) return;
  try {
    const data = await api(`/api/rooms/${state.room.code}/guess`, {
      method: "POST",
      body: { playerId: state.playerId, guess },
    });
    handleRoomUpdate(data.room);
  } catch (e) {
    toast(e.message, "error");
  }
}

async function nextRound() {
  if (!state.room) return;
  try {
    state.role = null;
    state._voted = false;
    state.statsRecordedFor = null;
    const { room } = await api(`/api/rooms/${state.room.code}/next-round`, {
      method: "POST",
      body: { requesterId: state.playerId },
    });
    handleRoomUpdate(room);
  } catch (e) {
    toast(e.message, "error");
  }
}

async function backToLobby() {
  if (!state.room) return;
  try {
    state.role = null;
    state._voted = false;
    state.statsRecordedFor = null;
    const { room } = await api(`/api/rooms/${state.room.code}/back-to-lobby`, {
      method: "POST",
    });
    handleRoomUpdate(room);
  } catch (_) {}
}

function getRoomLink() {
  return `${location.origin}${location.pathname}?join=${state.room.code}`;
}

// === Matchmaking ===
function showMatchmakingUI() {
  actionsSection.classList.add("hidden");
  matchmakingCard.classList.remove("hidden");
}

function hideMatchmakingUI() {
  matchmakingCard.classList.add("hidden");
  actionsSection.classList.remove("hidden");
}

function updateMatchmakingProgress(count, target) {
  const t = Math.max(3, Math.min(8, target || 3));
  const c = Math.max(1, Math.min(t, count));
  mmProgressBar.style.width = `${(c / t) * 100}%`;
  mmMeta.textContent = `${c} из ${t} игроков`;
  if (c >= 3 && c < 8) {
    mmStatus.textContent = "Игра собрана! Ждём ещё игроков (по желанию)...";
  } else if (c >= 8) {
    mmStatus.textContent = "Полный состав! Подключаем...";
  } else {
    mmStatus.textContent = "Ждём ещё игроков (минимум 3)...";
  }
}

async function findGame() {
  if (state.inMatchmaking || state.room) return;
  try {
    const data = await api("/api/matchmaking/join", {
      method: "POST",
      body: {
        playerId: state.playerId,
        name: state.name,
        telegramId: tgUser ? tgUser.id : undefined,
      },
    });
    state.inMatchmaking = true;
    showMatchmakingUI();
    updateMatchmakingProgress(
      data.queueSize || 1,
      data.target || (data.matched ? 8 : 3),
    );
    if (data.matched && data.code) {
      await handleMatchmakingMatched(data.code);
      return;
    }
    startMatchmakingPolling();
  } catch (e) {
    toast(e.message || "Не удалось войти в очередь", "error");
  }
}

async function cancelMatchmaking() {
  stopMatchmakingPolling();
  state.inMatchmaking = false;
  hideMatchmakingUI();
  try {
    await api("/api/matchmaking/leave", {
      method: "POST",
      body: { playerId: state.playerId },
    });
  } catch (_) {}
  toast("Поиск отменён");
}

function startMatchmakingPolling() {
  stopMatchmakingPolling();
  state.matchTimer = setInterval(async () => {
    try {
      const data = await api(
        `/api/matchmaking/status?playerId=${state.playerId}`,
      );
      updateMatchmakingProgress(data.queueSize || 1, data.target || 3);
      if (data.matched && data.code) {
        stopMatchmakingPolling();
        await handleMatchmakingMatched(data.code);
      } else if (!data.inQueue && !data.matched) {
        stopMatchmakingPolling();
        state.inMatchmaking = false;
        hideMatchmakingUI();
      }
    } catch (_) {}
  }, 1500);
}

function stopMatchmakingPolling() {
  if (state.matchTimer) {
    clearInterval(state.matchTimer);
    state.matchTimer = null;
  }
}

async function handleMatchmakingMatched(code) {
  state.inMatchmaking = false;
  hideMatchmakingUI();
  mmStatus.textContent = "Игра найдена! Подключаем...";
  try {
    const { room } = await api(`/api/rooms/${code}`);
    state.lastChatTs = 0;
    state.role = null;
    state._voted = false;
    state.statsRecordedFor = null;
    handleRoomUpdate(room);
    startPolling();
    history.replaceState(null, "", `?join=${room.code}`);
    toast("Игра найдена! 🎉", "success");
  } catch (e) {
    toast("Не удалось загрузить комнату", "error");
  }
}

// === Event listeners ===
document.querySelectorAll(".segmented").forEach((container) => {
  container.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const value = button.dataset.value;
    const key = container.dataset.setting;
    if (key === "rounds") state.rounds = Number(value);
    else if (key === "timer") state.timer = Number(value);
    else if (key === "mode") state.mode = value;
    setSegmentValue(container, value);
    saveUserSettings();
  });
});

document
  .querySelectorAll('input[type="checkbox"][data-setting]')
  .forEach((cb) => {
    cb.addEventListener("change", () => {
      state[cb.dataset.setting] = cb.checked;
      saveUserSettings();
    });
  });

// Bottom nav
bottomNav.addEventListener("click", (e) => {
  const item = e.target.closest(".nav-item");
  if (!item) return;
  switchPage(item.dataset.tab);
});

// Theme switch
if (themeSwitch) {
  themeSwitch.addEventListener("click", toggleTheme);
  themeSwitch.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      toggleTheme();
    }
  });
}

// User chip → switch to profile
if (userChipName) {
  userChipName.parentElement.addEventListener("click", () =>
    switchPage("profile"),
  );
}

// Profile name editing
if (profileName) {
  profileName.addEventListener("input", () => {
    const v = profileName.value.trim().slice(0, 24);
    if (v) {
      state.name = v;
      localStorage.setItem(NAME_KEY, v);
      refreshUserChip();
    }
  });
  profileName.addEventListener("change", () => {
    if (!profileName.value.trim()) {
      profileName.value = state.name;
    }
  });
}

// Avatar picker modal
const avatarPicker = $("avatar-picker");
const avatarGrid = $("avatar-grid");
const avatarPickerTrigger = $("avatar-picker-trigger");

function tgPhotoUrl() {
  return tgUser && tgUser.photo_url ? tgUser.photo_url : null;
}

function buildAvatarGrid() {
  if (!avatarGrid) return;
  const photo = tgPhotoUrl();
  const items = [];
  if (photo) {
    items.push({ id: "tg-photo", url: photo, isTelegram: true });
  }
  AVATAR_OPTIONS.forEach((opt) => items.push(opt));
  avatarGrid.innerHTML = items
    .map(
      (opt) =>
        `<button class="avatar-option is-loading ${state.avatar === opt.url ? "is-selected" : ""} ${opt.isTelegram ? "is-telegram" : ""}" type="button" data-avatar-url="${opt.url}">
            <img src="${opt.url}" alt="" loading="lazy" referrerpolicy="no-referrer" onload="this.parentElement.classList.remove('is-loading')" onerror="this.parentElement.classList.remove('is-loading'); this.parentElement.style.display='none'">
        </button>`,
    )
    .join("");
}

function openAvatarPicker() {
  if (!avatarPicker) return;
  buildAvatarGrid();
  avatarPicker.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeAvatarPicker() {
  if (!avatarPicker) return;
  avatarPicker.classList.add("hidden");
  document.body.style.overflow = "";
}

function selectAvatar(url) {
  if (!url) return;
  state.avatar = url;
  localStorage.setItem(AVATAR_KEY, url);
  refreshUserChip();
  avatarGrid.querySelectorAll(".avatar-option").forEach((el) => {
    el.classList.toggle("is-selected", el.dataset.avatarUrl === url);
  });
  try {
    if (
      window.Telegram &&
      window.Telegram.WebApp &&
      window.Telegram.WebApp.HapticFeedback
    ) {
      window.Telegram.WebApp.HapticFeedback.notificationOccurred("success");
    }
  } catch (_) {}
  setTimeout(closeAvatarPicker, 220);
}

if (avatarPickerTrigger) {
  avatarPickerTrigger.addEventListener("click", openAvatarPicker);
}
if (avatarPicker) {
  avatarPicker.addEventListener("click", (e) => {
    if (e.target.closest("[data-close-avatar]")) {
      closeAvatarPicker();
      return;
    }
    const option = e.target.closest(".avatar-option");
    if (option) selectAvatar(option.dataset.avatarUrl);
  });
}
document.addEventListener("keydown", (e) => {
  if (
    e.key === "Escape" &&
    avatarPicker &&
    !avatarPicker.classList.contains("hidden")
  ) {
    closeAvatarPicker();
  }
});

// Reset stats
const resetBtn = $("reset-stats");
if (resetBtn) resetBtn.addEventListener("click", resetStats);

// Rules toggle
if (rulesToggle) {
  rulesToggle.addEventListener("click", () => {
    rulesEl.classList.toggle("hidden");
    rulesToggle.textContent = rulesEl.classList.contains("hidden")
      ? "📖 Показать правила"
      : "📖 Свернуть правила";
  });
}

$("find-game").addEventListener("click", findGame);
$("mm-cancel").addEventListener("click", cancelMatchmaking);
$("create-room").addEventListener("click", createRoom);
$("join-room").addEventListener("click", () =>
  joinRoom(joinCode.value.trim().toUpperCase()),
);
$("copy-link").addEventListener("click", () => {
  if (!state.room) return;
  navigator.clipboard
    .writeText(getRoomLink())
    .then(() => toast("Ссылка скопирована", "success"));
});
$("share-link").addEventListener("click", async () => {
  if (!state.room) return;
  const url = getRoomLink();
  try {
    if (navigator.share)
      await navigator.share({
        title: "Кто шпион",
        text: `Заходи в комнату ${state.room.code}`,
        url,
      });
    else
      await navigator.clipboard
        .writeText(url)
        .then(() => toast("Ссылка скопирована", "success"));
  } catch (_) {}
});

$("leave-room").addEventListener("click", leaveRoom);

roomStatus.addEventListener("click", (e) => {
  if (e.target.closest("#start-game")) startGame();
});

roomPlayers.addEventListener("click", (e) => {
  const kick = e.target.closest(".btn-kick");
  if (kick) {
    e.stopPropagation();
    kickPlayer(Number(kick.dataset.playerId));
    return;
  }
  const transfer = e.target.closest(".btn-transfer");
  if (transfer) {
    e.stopPropagation();
    transferHost(Number(transfer.dataset.playerId));
    return;
  }
  const voteKick = e.target.closest(".btn-vote-kick");
  if (voteKick) {
    e.stopPropagation();
    const targetId = Number(voteKick.dataset.playerId);
    api(`/api/rooms/${state.room.code}/vote-kick`, {
      method: "POST",
      body: { voterId: state.playerId, targetId, vote: true },
    })
      .then((r) => {
        if (r.kicked) toast("Игрок кикнут голосованием", "success");
        else toast(`Голос засчитан: ${r.yes}/${r.required}`, "");
      })
      .catch((err) => toast(err.message, "error"));
  }
});

$("browse-packs").addEventListener("click", () => {
  packsBrowser.classList.toggle("hidden");
  renderPacksBrowser();
});

$("close-packs").addEventListener("click", () => {
  packsBrowser.classList.add("hidden");
});

packsGrid.addEventListener("click", (e) => {
  const item = e.target.closest("[data-pack-id]");
  if (item) togglePack(item.dataset.packId);
});

$("chat-toggle").addEventListener("click", () => {
  chatBody.classList.toggle("hidden");
  if (!chatBody.classList.contains("hidden")) {
    chatMessages.scrollTop = chatMessages.scrollHeight;
    chatInput.focus();
  }
});

$("chat-send").addEventListener("click", sendChatMessage);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendChatMessage();
});

joinCode.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinRoom(joinCode.value.trim().toUpperCase());
});

gameContent.addEventListener("click", (e) => {
  if (e.target.closest("#btn-next-turn")) nextTurn();
  if (e.target.closest("#btn-guess")) showGuessForm();
  if (e.target.closest("#btn-send-guess")) submitGuess();
  if (e.target.closest("#btn-cancel-guess")) hideGuessForm();
  const guessInput = $("guess-input");
  if (guessInput) {
    guessInput.onkeydown = (ev) => {
      if (ev.key === "Enter") submitGuess();
    };
  }
  if (e.target.closest("#btn-next-round")) nextRound();
  if (e.target.closest("#btn-back-lobby")) backToLobby();
  const voteBtn = e.target.closest(".vote-btn");
  if (voteBtn) vote(Number(voteBtn.dataset.voteId));
});

// === Init ===
function init() {
  const savedTheme = localStorage.getItem(THEME_KEY) || "dark";
  applyTheme(savedTheme);
  loadUserSettings();
  applySettingsToUI();
  refreshUserChip();
  renderProfile();
  switchPage("home");

  const params = new URLSearchParams(location.search);
  const join = params.get("join");
  if (join) {
    joinCode.value = join.toUpperCase();
    joinRoom(join.toUpperCase()).catch(() => {});
  }
  loadPacks();
}

init();

// Expose core globals for app-extras.js (WebSocket / friends / shop / voice)
window.state = state;
window.switchPage = switchPage;
window.recordGameResult = recordGameResult;
window.handleRoomUpdate = handleRoomUpdate;
window.joinRoom = joinRoom;
window.startPolling = startPolling;
window.renderProfile = renderProfile;
window.toast = toast;
window.api = api;
