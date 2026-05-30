// app-extras.js — WebSocket client, friends, profile modal, reactions,
// voice chat (WebRTC mesh), cosmetics shop, Telegram Stars donations,
// XP/level UI, stats server backup. Loaded after script.js so it can
// reach the globals declared there.

(function () {
  const tg = window.Telegram && window.Telegram.WebApp;
  const tgUser = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;

  // The original script.js exposes `state`, `api`, helper DOM funcs, etc. Use
  // them via `window` so the second script can stay decoupled.
  const $ = (id) => document.getElementById(id);
  function api(path, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };
    if (tg && tg.initData) headers["X-Telegram-Init-Data"] = tg.initData;
    const s = getState();
    if (s && s.playerId) headers["X-Admin-User-Id"] = String(s.playerId);
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

  function safeToast(text, variant) {
    if (typeof window.toast === "function") window.toast(text, variant);
    else console.log("[toast]", variant, text);
  }

  function getState() {
    return window.state || {};
  }

  // ===================== WEBSOCKET CLIENT =====================
  const sock = {
    ws: null,
    open: false,
    queue: [],
    reconnectAttempts: 0,
    handlers: {},
    on(type, cb) {
      this.handlers[type] = this.handlers[type] || [];
      this.handlers[type].push(cb);
    },
    emit(type, payload) {
      const list = this.handlers[type] || [];
      for (const cb of list) {
        try {
          cb(payload);
        } catch (e) {
          console.error("ws handler", type, e);
        }
      }
    },
    send(obj) {
      if (this.open && this.ws && this.ws.readyState === 1) {
        try {
          this.ws.send(JSON.stringify(obj));
          return true;
        } catch (_) {}
      }
      this.queue.push(obj);
      return false;
    },
    connect() {
      try {
        const scheme = location.protocol === "https:" ? "wss:" : "ws:";
        const url = `${scheme}//${location.host}/ws`;
        const ws = new WebSocket(url);
        this.ws = ws;
        ws.addEventListener("open", () => {
          this.open = true;
          this.reconnectAttempts = 0;
          // Identify ourselves
          const s = getState();
          if (s.playerId) {
            ws.send(
              JSON.stringify({
                type: "identify",
                playerId: s.playerId,
                name: s.name,
                username: (tgUser && tgUser.username) || null,
              }),
            );
          }
          // Flush queue
          const queue = this.queue.slice();
          this.queue = [];
          for (const msg of queue) ws.send(JSON.stringify(msg));
          // Rejoin current room if any
          if (s.room && s.room.code)
            ws.send(JSON.stringify({ type: "room:join", code: s.room.code }));
          this.emit("open");
        });
        ws.addEventListener("message", (event) => {
          let msg;
          try {
            msg = JSON.parse(event.data);
          } catch (_) {
            return;
          }
          if (!msg || !msg.type) return;
          this.emit(msg.type, msg);
          this.emit("*", msg);
        });
        ws.addEventListener("close", () => {
          this.open = false;
          this.ws = null;
          this.emit("close");
          this.reconnectAttempts += 1;
          setTimeout(
            () => this.connect(),
            Math.min(8000, 800 * this.reconnectAttempts),
          );
        });
        ws.addEventListener("error", () => {
          try {
            ws.close();
          } catch (_) {}
        });
      } catch (e) {
        console.error("ws connect failed", e);
        setTimeout(() => this.connect(), 3000);
      }
    },
  };
  window.sock = sock;

  // Replace REST polling with WS-driven room updates. The original
  // `state.pollTimer` interval still runs as a fallback for HTTP-only
  // clients, but we cancel it when the WS connection is healthy.
  sock.on("open", () => {
    const s = getState();
    if (s.pollTimer) {
      clearInterval(s.pollTimer);
      s.pollTimer = null;
    }
    if (s.chatTimer) {
      clearInterval(s.chatTimer);
      s.chatTimer = null;
    }
  });
  sock.on("close", () => {
    // Resume polling if we have a room to keep alive
    const s = getState();
    if (s.room && typeof window.startPolling === "function") {
      try {
        window.startPolling();
      } catch (_) {}
    }
  });

  sock.on("room:update", ({ room }) => {
    if (!room) return;
    if (typeof window.handleRoomUpdate === "function")
      window.handleRoomUpdate(room);
  });
  sock.on("chat:message", ({ message }) => {
    appendChatMessage(message);
    const s = getState();
    if (message && message.ts)
      s.lastChatTs = Math.max(s.lastChatTs || 0, message.ts);
  });
  sock.on("chat:reaction", ({ messageId, reactions }) => {
    updateMessageReactions(messageId, reactions);
  });
  sock.on("presence", ({ playerId, online }) => {
    Friends.markOnline(playerId, online);
  });
  sock.on("presence:initial", ({ onlineFriends, you }) => {
    if (Array.isArray(onlineFriends)) {
      Friends.onlineSet = new Set(onlineFriends.map(Number));
    }
    if (you) Me.set(you);
  });
  sock.on("friend:request", ({ from }) => {
    safeToast(`📩 ${from.name} хочет добавить тебя в друзья`, "success");
    Friends.refresh();
  });
  sock.on("friend:accepted", () => {
    safeToast("💛 Заявка принята", "success");
    Friends.refresh();
  });
  sock.on("room:invite", (msg) => Friends.showInvite(msg));
  sock.on("room:kicked", ({ reason }) => {
    if (typeof window.handleKickedFromRoom === "function") {
      window.handleKickedFromRoom(reason || "host");
    }
  });
  sock.on("me:update", ({ user, full, leveledUp, toLevel }) => {
    Me.set(user, full);
    if (leveledUp) showLevelUp(toLevel);
  });
  sock.on("donation:success", ({ stars, user, full }) => {
    safeToast(`🥹 Спасибо за ${stars} ⭐!`, "success");
    Me.set(user, full);
    Shop.refreshOwned();
  });
  sock.on("purchase:success", ({ stars, itemId, user, full }) => {
    safeToast(`🛒 Куплено: ${itemId} (${stars} ⭐)`, "success");
    Me.set(user, full);
    Shop.refreshOwned();
  });

  // ===================== ME / XP / LEVELS =====================
  const Me = {
    profile: null, // public profile
    full: null, // full server-side user
    listeners: [],
    set(profile, full) {
      this.profile = profile || this.profile;
      if (full) this.full = full;
      this.notify();
      this.applyToUi();
    },
    onChange(cb) {
      this.listeners.push(cb);
    },
    notify() {
      for (const cb of this.listeners)
        try {
          cb(this.profile, this.full);
        } catch (_) {}
    },
    isPremiumActive() {
      return Boolean(
        this.full && this.full.premium && this.full.premiumUntil > Date.now(),
      );
    },
    equipped() {
      return (
        (this.full && this.full.inventory && this.full.inventory.equipped) || {
          frame: "default",
          theme: "dark",
          nameEffect: "none",
          statusEmoji: "none",
          animatedAvatar: null,
        }
      );
    },
    applyToUi() {
      // XP card
      if (this.full) {
        const lvl = this.full.level || 1;
        const xp = this.full.xp || 0;
        const cur = this.full.currentLevelXp || 0;
        const nxt = this.full.nextLevelXp || cur + 100;
        const span = Math.max(1, nxt - cur);
        const within = Math.max(0, xp - cur);
        const pct = Math.min(100, Math.round((within / span) * 100));
        const fill = $("profile-xp-fill");
        if (fill) fill.style.width = `${pct}%`;
        const lvlEl = $("profile-level");
        if (lvlEl) lvlEl.textContent = String(lvl);
        const xpEl = $("profile-xp");
        if (xpEl) xpEl.textContent = `${xp} / ${nxt} XP`;
        const badge = $("profile-level-badge");
        if (badge) badge.textContent = levelBadge(lvl);

        // Premium status
        const ps = $("premium-status");
        if (ps) {
          if (this.isPremiumActive()) {
            const days = Math.max(
              1,
              Math.round(
                (this.full.premiumUntil - Date.now()) / (24 * 60 * 60 * 1000),
              ),
            );
            ps.textContent = `💛 Премиум активен ещё ${days} дн. Поддержано: ${this.full.totalStarsDonated || 0} ⭐`;
          } else {
            ps.textContent = "";
          }
        }
        document.documentElement.classList.toggle(
          "is-premium",
          this.isPremiumActive(),
        );
      }
      // Theme / name effects
      applyEquippedTheme();
      applyEquippedNameEffect();
      applyEquippedFrame();
      applyEquippedStatusEmoji();
    },
    refresh: async function () {
      const s = getState();
      if (!s.playerId) return;
      try {
        const data = await api(`/api/me?playerId=${s.playerId}`);
        this.set(data.user, data.full);
      } catch (_) {}
    },
  };
  window.Me = Me;

  function levelBadge(lvl) {
    if (lvl >= 50) return "👑";
    if (lvl >= 30) return "💎";
    if (lvl >= 20) return "🥇";
    if (lvl >= 10) return "🥈";
    if (lvl >= 5) return "🥉";
    return "🥚";
  }

  function showLevelUp(level) {
    const overlay = $("levelup-overlay");
    const num = $("levelup-level");
    if (!overlay || !num) return;
    num.textContent = String(level);
    overlay.classList.remove("hidden");
    try {
      if (
        window.Telegram &&
        window.Telegram.WebApp &&
        window.Telegram.WebApp.HapticFeedback
      ) {
        window.Telegram.WebApp.HapticFeedback.notificationOccurred("success");
      }
    } catch (_) {}
  }
  document.addEventListener("click", (e) => {
    if (e.target.closest("#levelup-close")) {
      const o = $("levelup-overlay");
      if (o) o.classList.add("hidden");
    }
  });

  // ===================== STATS BACKUP =====================
  async function backupStatsToServer() {
    const s = getState();
    if (!s.playerId) return;
    let stats = null;
    try {
      const raw = localStorage.getItem("spyStats");
      if (raw) stats = JSON.parse(raw);
    } catch (_) {}
    try {
      const data = await api("/api/me/sync-stats", {
        method: "POST",
        body: { playerId: s.playerId, stats: stats || {} },
      });
      if (data && data.full) Me.set(data.user, data.full);
      // After sync, mirror server stats back to localStorage so they survive
      // local cache wipes.
      if (data && data.full && data.full.stats) {
        localStorage.setItem("spyStats", JSON.stringify(data.full.stats));
        if (typeof window.renderProfile === "function") window.renderProfile();
      }
    } catch (e) {
      console.warn("stats sync failed", e.message);
    }
  }
  window.backupStatsToServer = backupStatsToServer;

  // Hook into recordGameResult: when a game ends, ALSO report to server so
  // XP/level go up and the result is mirrored across devices.
  const _origRecord = window.recordGameResult;
  window.recordGameResult = async function (info) {
    if (typeof _origRecord === "function") _origRecord(info);
    const s = getState();
    if (!s.playerId) return;
    try {
      const data = await api("/api/me/game-result", {
        method: "POST",
        body: {
          playerId: s.playerId,
          wasSpy: Boolean(info.wasSpy),
          won: Boolean(info.won),
        },
      });
      if (data && data.full) Me.set(data.user, data.full);
      if (data && data.leveledUp) showLevelUp(data.toLevel);
    } catch (_) {}
  };

  // ===================== CHAT MESSAGE RENDER & REACTIONS =====================
  // Replace the original `appendChatMessage` so we render with ID + reactions
  // and de-duplicate messages received via WS + polling.
  const renderedChatIds = new Set();
  function appendChatMessage(msg) {
    if (!msg) return;
    if (msg.id && renderedChatIds.has(msg.id)) return;
    if (msg.id) renderedChatIds.add(msg.id);
    const container = $("chat-messages");
    if (!container) return;
    const div = document.createElement("div");
    div.className = `chat-msg${msg.system ? " system" : ""}`;
    div.dataset.messageId =
      msg.id || `tmp-${msg.ts}-${Math.random().toString(36).slice(2, 6)}`;
    div.dataset.playerId = msg.playerId || "";
    div.innerHTML = `
      <div class="chat-msg-body">
        <b class="chat-msg-name">${escapeHtml(msg.name)}</b>
        <span class="chat-msg-text">${linkify(escapeHtml(msg.text))}</span>
      </div>
      <div class="chat-reactions" data-message-id="${escapeHtml(div.dataset.messageId)}"></div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    renderReactions(div, msg.reactions || {});
  }
  window.appendChatMessage = appendChatMessage;

  function linkify(text) {
    return text.replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener">$1</a>',
    );
  }

  function renderReactions(messageEl, reactions) {
    const reactionsEl = messageEl.querySelector(".chat-reactions");
    if (!reactionsEl) return;
    const entries = Object.entries(reactions || {}).filter(
      ([_, list]) => Array.isArray(list) && list.length > 0,
    );
    if (entries.length === 0) {
      reactionsEl.innerHTML = "";
      return;
    }
    const s = getState();
    reactionsEl.innerHTML = entries
      .map(([emoji, list]) => {
        const mine = s.playerId && list.includes(Number(s.playerId));
        return `<button type="button" class="chat-reaction ${mine ? "mine" : ""}" data-emoji="${escapeHtml(emoji)}">${escapeHtml(emoji)} <small>${list.length}</small></button>`;
      })
      .join("");
  }

  function updateMessageReactions(messageId, reactions) {
    const el = document.querySelector(
      `.chat-msg[data-message-id="${CSS.escape(String(messageId))}"]`,
    );
    if (!el) return;
    renderReactions(el, reactions || {});
  }

  // Long-press to open reaction picker
  let pressTimer = null;
  let pickerTarget = null;
  function clearPress() {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  }
  document.addEventListener("pointerdown", (e) => {
    const msg = e.target.closest(".chat-msg");
    if (!msg) return;
    pickerTarget = msg;
    clearPress();
    pressTimer = setTimeout(
      () => openReactionPicker(msg, e.clientX, e.clientY),
      350,
    );
  });
  document.addEventListener("pointerup", clearPress);
  document.addEventListener("pointermove", clearPress);
  document.addEventListener("click", (e) => {
    const r = e.target.closest(".chat-reaction");
    if (r && pickerTarget !== r) {
      const msg = r.closest(".chat-msg");
      if (msg) toggleReaction(msg.dataset.messageId, r.dataset.emoji);
    }
    const pick = e.target.closest(".reaction-emoji");
    if (pick) {
      const target = pickerTarget;
      if (target) toggleReaction(target.dataset.messageId, pick.dataset.emoji);
      closeReactionPicker();
    } else if (
      !e.target.closest("#reaction-picker") &&
      !e.target.closest(".chat-msg")
    ) {
      closeReactionPicker();
    }
  });

  function openReactionPicker(messageEl, x, y) {
    const picker = $("reaction-picker");
    if (!picker) return;
    picker.classList.remove("hidden");
    const rect = messageEl.getBoundingClientRect();
    const px = Math.min(window.innerWidth - 280, Math.max(8, rect.left));
    const py = Math.max(8, rect.top - 56);
    picker.style.left = `${px}px`;
    picker.style.top = `${py}px`;
    pickerTarget = messageEl;
    try {
      if (
        window.Telegram &&
        window.Telegram.WebApp &&
        window.Telegram.WebApp.HapticFeedback
      ) {
        window.Telegram.WebApp.HapticFeedback.impactOccurred("light");
      }
    } catch (_) {}
  }
  function closeReactionPicker() {
    const picker = $("reaction-picker");
    if (picker) picker.classList.add("hidden");
    pickerTarget = null;
  }

  async function toggleReaction(messageId, emoji) {
    const s = getState();
    if (!s.playerId || !s.room) return;
    try {
      await api(`/api/rooms/${s.room.code}/chat/react`, {
        method: "POST",
        body: { messageId, emoji, playerId: s.playerId },
      });
    } catch (e) {
      safeToast(e.message || "Ошибка", "error");
    }
  }

  // ===================== FRIENDS =====================
  const Friends = {
    cache: null,
    onlineSet: new Set(),
    refreshTimer: null,
    showInvite(msg) {
      const toastEl = $("invite-toast");
      const from = $("invite-from");
      const room = $("invite-room");
      if (!toastEl || !from || !room) return;
      from.textContent = msg.from.name;
      room.textContent = `приглашает в комнату ${msg.code}`;
      toastEl.classList.remove("hidden");
      toastEl.dataset.code = msg.code;
      try {
        if (
          window.Telegram &&
          window.Telegram.WebApp &&
          window.Telegram.WebApp.HapticFeedback
        )
          window.Telegram.WebApp.HapticFeedback.notificationOccurred("success");
      } catch (_) {}
    },
    hideInvite() {
      const t = $("invite-toast");
      if (t) {
        t.classList.add("hidden");
        t.dataset.code = "";
      }
    },
    async refresh() {
      const s = getState();
      if (!s.playerId) return;
      try {
        const data = await api(`/api/friends?playerId=${s.playerId}`);
        this.cache = data;
        this.render();
      } catch (_) {}
    },
    markOnline(playerId, online) {
      const id = Number(playerId);
      if (online) this.onlineSet.add(id);
      else this.onlineSet.delete(id);
      if (this.cache && this.cache.friends) {
        const f = this.cache.friends.find((x) => Number(x.id) === id);
        if (f) f.online = Boolean(online);
        this.render();
      }
    },
    isOnline(id) {
      return (
        this.onlineSet.has(Number(id)) ||
        (this.cache &&
          this.cache.friends &&
          (this.cache.friends.find((f) => Number(f.id) === Number(id)) || {})
            .online) ||
        false
      );
    },
    render() {
      const list = $("friends-list");
      const requestsCard = $("friend-requests-card");
      const requestsList = $("friend-requests-list");
      const requestsCount = $("req-count");
      const friendCount = $("friend-count");
      const navBadge = $("friends-badge");
      const friends = (this.cache && this.cache.friends) || [];
      const incoming = (this.cache && this.cache.incoming) || [];
      if (friendCount) friendCount.textContent = String(friends.length);
      if (requestsCount) requestsCount.textContent = String(incoming.length);
      if (requestsCard) requestsCard.hidden = incoming.length === 0;
      if (navBadge) {
        if (incoming.length > 0) {
          navBadge.textContent = String(incoming.length);
          navBadge.classList.remove("hidden");
        } else {
          navBadge.classList.add("hidden");
        }
      }
      if (list) {
        if (friends.length === 0) {
          list.innerHTML =
            '<small class="muted-line">Пока никого. Найди по поиску выше.</small>';
        } else {
          list.innerHTML = friends
            .map((f) => friendRowHtml(f, "friend"))
            .join("");
        }
      }
      if (requestsList) {
        requestsList.innerHTML = incoming
          .map((f) => friendRowHtml(f, "incoming"))
          .join("");
      }
    },
  };
  window.Friends = Friends;

  function friendRowHtml(f, kind) {
    const online = f.online ? "online" : "offline";
    const avatar = f.avatar
      ? `<img src="${escapeHtml(f.avatar)}" alt="" referrerpolicy="no-referrer">`
      : "🙂";
    const inGame = f.currentRoom
      ? `<small class="friend-room">в комнате ${escapeHtml(f.currentRoom)}</small>`
      : "";
    const actions = (() => {
      if (kind === "incoming") {
        return `<div class="friend-actions">
          <button class="btn-friend-accept" data-id="${f.id}" type="button">✅ Принять</button>
          <button class="btn-friend-decline" data-id="${f.id}" type="button">✕</button>
        </div>`;
      }
      const inviteBtn =
        window.state && window.state.room
          ? `<button class="btn-friend-invite" data-id="${f.id}" type="button">📩 Позвать</button>`
          : "";
      return `<div class="friend-actions">
        ${inviteBtn}
        <button class="btn-friend-profile" data-id="${f.id}" type="button">👤</button>
        <button class="btn-friend-remove" data-id="${f.id}" type="button">🗑</button>
      </div>`;
    })();
    return `<div class="friend-row ${online}" data-id="${f.id}">
      <div class="friend-info">
        <div class="friend-avatar">${avatar}<span class="friend-dot ${online}"></span></div>
        <div>
          <strong class="friend-name name-fx-${escapeHtml((f.equipped && f.equipped.nameEffect) || "none")}">${escapeHtml(f.name)}</strong>
          <small>ур. ${f.level || 1} · ${f.online ? "онлайн" : "оффлайн"}${f.equipped && f.equipped.statusEmoji && f.equipped.statusEmoji !== "none" ? ` · ${escapeHtml(f.equipped.statusEmoji)}` : ""}</small>
          ${inGame}
        </div>
      </div>
      ${actions}
    </div>`;
  }

  document.addEventListener("click", (e) => {
    const acc = e.target.closest(".btn-friend-accept");
    if (acc) {
      const id = Number(acc.dataset.id);
      api("/api/friends/accept", {
        method: "POST",
        body: { playerId: getState().playerId, fromId: id },
      }).then(() => Friends.refresh());
      return;
    }
    const dec = e.target.closest(".btn-friend-decline");
    if (dec) {
      const id = Number(dec.dataset.id);
      api("/api/friends/decline", {
        method: "POST",
        body: { playerId: getState().playerId, fromId: id },
      }).then(() => Friends.refresh());
      return;
    }
    const inv = e.target.closest(".btn-friend-invite");
    if (inv) {
      const id = Number(inv.dataset.id);
      const code = getState().room && getState().room.code;
      if (!code) {
        safeToast("Сначала зайди в комнату", "error");
        return;
      }
      api("/api/friends/invite", {
        method: "POST",
        body: { playerId: getState().playerId, targetId: id, code },
      })
        .then((r) =>
          safeToast(
            r.delivered
              ? "📩 Приглашение отправлено"
              : "Игрок офлайн — не доставлено",
            r.delivered ? "success" : "error",
          ),
        )
        .catch((err) => safeToast(err.message, "error"));
      return;
    }
    const rem = e.target.closest(".btn-friend-remove");
    if (rem) {
      const id = Number(rem.dataset.id);
      if (!confirm("Точно удалить из друзей?")) return;
      api("/api/friends/remove", {
        method: "POST",
        body: { playerId: getState().playerId, targetId: id },
      }).then(() => Friends.refresh());
      return;
    }
    const prof = e.target.closest(".btn-friend-profile");
    if (prof) {
      openPlayerModal(Number(prof.dataset.id));
      return;
    }
  });

  // Friend search
  function setupFriendSearch() {
    const input = $("friend-search-input");
    const btn = $("friend-search-btn");
    const results = $("friend-search-results");
    if (!input || !btn || !results) return;
    async function run() {
      const q = input.value.trim();
      if (!q) {
        results.innerHTML = "";
        return;
      }
      results.innerHTML = '<small class="muted-line">Ищем...</small>';
      try {
        const data = await api("/api/users/search", {
          method: "POST",
          body: { query: q },
        });
        if (!data.users || data.users.length === 0) {
          results.innerHTML =
            '<small class="muted-line">Никого не нашли</small>';
          return;
        }
        const myId = Number(getState().playerId);
        const friendIds = new Set(
          ((Friends.cache && Friends.cache.friends) || []).map((f) =>
            Number(f.id),
          ),
        );
        const outgoingIds = new Set(
          ((Friends.cache && Friends.cache.outgoing) || []).map((f) =>
            Number(f.id),
          ),
        );
        results.innerHTML = data.users
          .filter((u) => Number(u.id) !== myId)
          .map((u) => {
            const isFriend = friendIds.has(Number(u.id));
            const isPending = outgoingIds.has(Number(u.id));
            const action = isFriend
              ? '<small class="muted-line">уже в друзьях</small>'
              : isPending
                ? '<small class="muted-line">заявка отправлена</small>'
                : `<button class="btn-friend-add" data-id="${u.id}" type="button">➕ Добавить</button>`;
            const avatar = u.avatar
              ? `<img src="${escapeHtml(u.avatar)}" alt="" referrerpolicy="no-referrer">`
              : "🙂";
            return `<div class="friend-row">
            <div class="friend-info">
              <div class="friend-avatar">${avatar}</div>
              <div>
                <strong>${escapeHtml(u.name)}</strong>
                <small>${u.username ? "@" + escapeHtml(u.username) + " · " : ""}ID ${u.id} · ур. ${u.level || 1}${u.online ? " · 🟢" : ""}</small>
              </div>
            </div>
            <div class="friend-actions">${action}<button class="btn-friend-profile" data-id="${u.id}" type="button">👤</button></div>
          </div>`;
          })
          .join("");
      } catch (e) {
        results.innerHTML = `<small class="muted-line">Ошибка: ${escapeHtml(e.message)}</small>`;
      }
    }
    btn.addEventListener("click", run);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") run();
    });
  }
  document.addEventListener("click", async (e) => {
    const add = e.target.closest(".btn-friend-add");
    if (!add) return;
    const id = Number(add.dataset.id);
    add.disabled = true;
    try {
      await api("/api/friends/request", {
        method: "POST",
        body: { playerId: getState().playerId, targetId: id },
      });
      safeToast("Заявка отправлена", "success");
      Friends.refresh();
      add.outerHTML = '<small class="muted-line">заявка отправлена</small>';
    } catch (err) {
      safeToast(err.message, "error");
      add.disabled = false;
    }
  });

  // Invite toast handlers
  document.addEventListener("click", (e) => {
    if (e.target.closest("#invite-accept")) {
      const t = $("invite-toast");
      const code = t && t.dataset.code;
      Friends.hideInvite();
      if (code && typeof window.joinRoom === "function") {
        window.joinRoom(code);
      }
    }
    if (e.target.closest("#invite-decline")) {
      Friends.hideInvite();
    }
  });

  // ===================== PLAYER PROFILE MODAL =====================
  async function openPlayerModal(playerId) {
    const modal = $("player-modal");
    const content = $("player-modal-content");
    if (!modal || !content) return;
    modal.classList.remove("hidden");
    content.innerHTML = '<div class="modal-loading">Загрузка...</div>';
    try {
      const data = await api(`/api/users/${playerId}`);
      const u = data.user;
      const myId = Number(getState().playerId);
      const isMe = Number(u.id) === myId;
      const isFriend = ((Friends.cache && Friends.cache.friends) || []).some(
        (f) => Number(f.id) === Number(u.id),
      );
      const inviteBtn =
        !isMe && window.state && window.state.room && isFriend
          ? `<button class="primary" data-modal-invite="${u.id}" type="button">📩 Позвать в комнату</button>`
          : "";
      const addBtn =
        !isMe && !isFriend
          ? `<button class="primary" data-modal-add="${u.id}" type="button">➕ В друзья</button>`
          : "";
      const avatar = u.avatar
        ? `<img src="${escapeHtml(u.avatar)}" alt="">`
        : "🙂";
      const s = u.stats || {};
      const games = s.games || 0;
      const wins = s.wins || 0;
      const wr = games > 0 ? Math.round((wins / games) * 100) : 0;
      content.innerHTML = `
        <div class="player-modal-header">
          <div class="player-avatar frame-${escapeHtml((u.equipped && u.equipped.frame) || "default")}">${avatar}</div>
          <div>
            <h3 class="name-fx-${escapeHtml((u.equipped && u.equipped.nameEffect) || "none")}">${escapeHtml(u.name)}</h3>
            <small>${u.username ? "@" + escapeHtml(u.username) + " · " : ""}ID ${u.id}</small>
            ${u.equipped && u.equipped.statusEmoji && u.equipped.statusEmoji !== "none" ? `<div class="player-status">${escapeHtml(u.equipped.statusEmoji)}</div>` : ""}
          </div>
        </div>
        <div class="player-modal-stats">
          <div class="pm-stat"><strong>${u.level || 1}</strong><small>уровень</small></div>
          <div class="pm-stat"><strong>${u.xp || 0}</strong><small>XP</small></div>
          <div class="pm-stat"><strong>${games}</strong><small>игр</small></div>
          <div class="pm-stat"><strong>${wins}</strong><small>побед</small></div>
          <div class="pm-stat"><strong>${wr}%</strong><small>винрейт</small></div>
          <div class="pm-stat"><strong>${s.bestStreak || 0}</strong><small>лучшая серия</small></div>
        </div>
        <div class="player-modal-actions">
          ${addBtn}
          ${inviteBtn}
        </div>
      `;
    } catch (err) {
      content.innerHTML = `<div class="modal-loading">Ошибка: ${escapeHtml(err.message)}</div>`;
    }
  }
  window.openPlayerModal = openPlayerModal;

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-close-player]")) {
      $("player-modal") && $("player-modal").classList.add("hidden");
    }
    const inv = e.target.closest("[data-modal-invite]");
    if (inv) {
      const id = Number(inv.dataset.modalInvite);
      const code = getState().room && getState().room.code;
      if (code) {
        api("/api/friends/invite", {
          method: "POST",
          body: { playerId: getState().playerId, targetId: id, code },
        }).then((r) =>
          safeToast(
            r.delivered ? "📩 Отправлено" : "Игрок офлайн",
            r.delivered ? "success" : "error",
          ),
        );
      }
    }
    const add = e.target.closest("[data-modal-add]");
    if (add) {
      const id = Number(add.dataset.modalAdd);
      api("/api/friends/request", {
        method: "POST",
        body: { playerId: getState().playerId, targetId: id },
      })
        .then(() => {
          safeToast("Заявка отправлена", "success");
          Friends.refresh();
          add.disabled = true;
        })
        .catch((err) => safeToast(err.message, "error"));
    }
  });

  // Tap on a player name in the lobby/game/chat → open profile.
  document.addEventListener("click", (e) => {
    const tap = e.target.closest("[data-player-tap]");
    if (tap) openPlayerModal(Number(tap.dataset.playerTap));
    const chatName = e.target.closest(".chat-msg-name");
    if (chatName) {
      const msg = chatName.closest(".chat-msg");
      const pid = msg && msg.dataset.playerId;
      if (pid && Number(pid)) openPlayerModal(Number(pid));
    }
  });

  // ===================== EQUIPPED COSMETIC APPLICATIONS =====================
  function applyEquippedTheme() {
    if (!Me.full) return;
    const themeId = Me.equipped().theme || "dark";
    document.documentElement.setAttribute("data-theme-skin", themeId);
  }
  function applyEquippedNameEffect() {
    const eff =
      (Me.full &&
        Me.full.inventory &&
        Me.full.inventory.equipped &&
        Me.full.inventory.equipped.nameEffect) ||
      "none";
    document.documentElement.setAttribute("data-name-effect", eff);
    const chip = $("user-chip-name");
    if (chip) chip.className = `user-chip-name name-fx-${eff}`;
    const profileName = $("profile-name");
    if (profileName)
      profileName.className = `profile-name-input name-fx-${eff}`;
  }
  function applyEquippedFrame() {
    const frame =
      (Me.full &&
        Me.full.inventory &&
        Me.full.inventory.equipped &&
        Me.full.inventory.equipped.frame) ||
      "default";
    const ring = document.querySelector(".avatar-ring");
    if (ring) ring.dataset.frame = frame;
  }
  function applyEquippedStatusEmoji() {
    const status =
      (Me.full &&
        Me.full.inventory &&
        Me.full.inventory.equipped &&
        Me.full.inventory.equipped.statusEmoji) ||
      "none";
    let el = document.getElementById("user-chip-status");
    const chip = document.querySelector(".user-chip");
    if (!chip) return;
    if (status && status !== "none") {
      if (!el) {
        el = document.createElement("span");
        el.id = "user-chip-status";
        el.className = "user-chip-status";
        chip.appendChild(el);
      }
      el.textContent = status;
    } else if (el) {
      el.remove();
    }
  }

  // ===================== SHOP =====================
  const Shop = {
    catalog: null,
    activeTab: "frames",
    async refresh() {
      try {
        const data = await api("/api/shop/catalog");
        this.catalog = data.catalog;
        this.render();
      } catch (e) {
        safeToast(e.message, "error");
      }
    },
    refreshOwned() {
      this.render();
    },
    render() {
      const grid = $("shop-grid");
      if (!grid || !this.catalog) return;
      const items = this.catalog[this.activeTab] || [];
      const inv = (Me.full && Me.full.inventory) || {
        frames: [],
        themes: [],
        nameEffects: [],
        statusEmojis: [],
        animatedAvatars: [],
        equipped: {},
      };
      const owned = inv[this.activeTab] || [];
      const equippedKey =
        this.activeTab === "animatedAvatars"
          ? "animatedAvatar"
          : this.activeTab.replace(/s$/, "");
      const equippedId = (inv.equipped || {})[equippedKey];
      grid.innerHTML = items
        .map((item) => {
          const isOwned = owned.includes(item.id);
          const isEquipped = equippedId === item.id;
          const rarity = item.rarity || "common";
          const previewHtml = previewItem(this.activeTab, item);
          const action = (() => {
            const level = (Me.full && Me.full.level) || 1;
            const meetsLevel =
              !item.levelRequired || level >= item.levelRequired;
            if (isEquipped)
              return '<button class="shop-action equipped" disabled>Надето</button>';
            if (isOwned)
              return `<button class="shop-action equip" data-equip-kind="${this.activeTab}" data-equip-id="${escapeHtml(item.id)}">Надеть</button>`;
            if (item.levelRequired && !meetsLevel) {
              return `<button class="shop-action locked" disabled>🔒 ур. ${item.levelRequired}</button>`;
            }
            if (
              item.free ||
              item.starsPrice === 0 ||
              (item.freeAt === "level" && meetsLevel)
            )
              return `<button class="shop-action free" data-grant-kind="${this.activeTab}" data-grant-id="${escapeHtml(item.id)}">Получить</button>`;
            return `<button class="shop-action buy" data-buy-kind="${this.activeTab}" data-buy-id="${escapeHtml(item.id)}">⭐ ${item.starsPrice}</button>`;
          })();
          return `<div class="shop-item rarity-${rarity} ${isOwned ? "is-owned" : ""} ${isEquipped ? "is-equipped" : ""}">
            <div class="shop-item-preview">${previewHtml}</div>
            <strong>${isEquipped ? "✅ " : ""}${escapeHtml(item.title || item.id)}</strong>
            <small class="shop-rarity">${isEquipped ? "надето" : rarityLabel(rarity)}</small>
            ${action}
          </div>`;
        })
        .join("");
    },
    setTab(tab) {
      this.activeTab = tab;
      document
        .querySelectorAll(".shop-tab")
        .forEach((b) =>
          b.classList.toggle("active", b.dataset.shopTab === tab),
        );
      this.render();
    },
  };
  window.Shop = Shop;
  Me.onChange(() => Shop.render());

  function rarityLabel(r) {
    return (
      {
        common: "обычная",
        rare: "редкая",
        epic: "эпическая",
        legendary: "легендарная",
        mythic: "мифическая",
      }[r] || r
    );
  }
  function previewItem(kind, item) {
    if (kind === "frames")
      return `<div class="frame-preview frame-${escapeHtml(item.id)}"><span>${item.emoji || "🙂"}</span></div>`;
    if (kind === "themes")
      return `<div class="theme-preview theme-${escapeHtml(item.id)}"><span>${item.emoji || "🎨"}</span></div>`;
    if (kind === "nameEffects")
      return `<div class="name-effect-preview name-fx-${escapeHtml(item.id)}">Имя</div>`;
    if (kind === "statusEmojis")
      return `<div class="status-emoji-preview">${escapeHtml(item.emoji || "⚪")}</div>`;
    if (kind === "animatedAvatars")
      return `<img class="anim-avatar-preview" src="${escapeHtml(item.url)}" alt="" referrerpolicy="no-referrer">`;
    return "";
  }

  document.addEventListener("click", async (e) => {
    const tab = e.target.closest(".shop-tab");
    if (tab) {
      Shop.setTab(tab.dataset.shopTab);
      return;
    }

    const equip = e.target.closest("[data-equip-kind]");
    if (equip) {
      const kind = equip.dataset.equipKind;
      const itemId = equip.dataset.equipId;
      try {
        const data = await api("/api/shop/equip", {
          method: "POST",
          body: { playerId: getState().playerId, kind, itemId },
        });
        if (data.full) Me.set(data.user, data.full);
        Shop.render();
        safeToast("Надето", "success");
      } catch (err) {
        safeToast(err.message, "error");
      }
      return;
    }

    const grant = e.target.closest("[data-grant-kind]");
    if (grant) {
      const kind = grant.dataset.grantKind;
      const itemId = grant.dataset.grantId;
      try {
        const data = await api("/api/shop/equip", {
          method: "POST",
          body: { playerId: getState().playerId, kind, itemId },
        });
        if (data && data.full) Me.set(data.user, data.full);
        Shop.render();
        safeToast("Готово", "success");
      } catch (err) {
        safeToast(err.message, "error");
      }
      return;
    }

    const buy = e.target.closest("[data-buy-kind]");
    if (buy) {
      const kind = buy.dataset.buyKind;
      const itemId = buy.dataset.buyId;
      buy.disabled = true;
      try {
        const data = await api("/api/shop/purchase-link", {
          method: "POST",
          body: { playerId: getState().playerId, kind, itemId },
        });
        if (data && data.link) openInvoiceLink(data.link);
        else safeToast("Не удалось создать инвойс", "error");
      } catch (err) {
        safeToast(err.message, "error");
      } finally {
        buy.disabled = false;
      }
      return;
    }

    if (
      e.target.closest("#btn-shop-donate") ||
      e.target.closest("#btn-open-donate")
    ) {
      openDonateModal();
    }
  });

  // ===================== DONATIONS =====================
  function openDonateModal() {
    const m = $("donate-modal");
    if (m) m.classList.remove("hidden");
  }
  function closeDonateModal() {
    const m = $("donate-modal");
    if (m) m.classList.add("hidden");
  }
  document.addEventListener("click", async (e) => {
    if (e.target.closest("[data-close-donate]")) closeDonateModal();
    const amt = e.target.closest(".donate-amount");
    if (amt) {
      const stars = Number(amt.dataset.stars);
      donate(stars);
    }
    if (e.target.closest("#donate-custom-btn")) {
      const input = $("donate-custom-input");
      const stars = Math.max(
        1,
        Math.min(100000, Math.floor(Number(input && input.value))),
      );
      if (!stars) {
        safeToast("Введи число больше 0", "error");
        return;
      }
      donate(stars);
    }
  });

  async function donate(stars) {
    const s = getState();
    if (!s.playerId) return;
    const foot = $("donate-foot");
    if (foot) foot.textContent = "Создаём инвойс...";
    try {
      const data = await api("/api/donate/create-link", {
        method: "POST",
        body: { playerId: s.playerId, stars, title: `На покушать ${stars} ⭐` },
      });
      if (data && data.link) {
        if (foot)
          foot.textContent = `Открой ссылку и подтверди оплату ${stars} ⭐`;
        openInvoiceLink(data.link);
      } else {
        if (foot) foot.textContent = "Не удалось создать инвойс.";
      }
    } catch (err) {
      if (foot) foot.textContent = `Ошибка: ${err.message}`;
      // Dev fallback: if no bot configured, simulate the success path.
      if (/Бот не настроен/i.test(err.message)) {
        if (foot)
          foot.textContent = "Бот не настроен, выдаём награды локально (dev).";
        try {
          const data = await api("/api/donate/test-grant", {
            method: "POST",
            body: { playerId: s.playerId, stars },
          });
          if (data.full) Me.set(data.user, data.full);
        } catch (e2) {
          if (foot) foot.textContent = `Ошибка: ${e2.message}`;
        }
      }
    }
  }

  function openInvoiceLink(link) {
    try {
      if (tg && typeof tg.openInvoice === "function") {
        tg.openInvoice(link, (status) => {
          if (status === "paid") safeToast("Оплачено!", "success");
          else if (status === "failed") safeToast("Оплата не прошла", "error");
          else if (status === "cancelled")
            safeToast("Оплата отменена", "error");
          Me.refresh();
        });
        return;
      }
    } catch (_) {}
    // Fallback: open link in a new tab
    try {
      window.open(link, "_blank");
    } catch (_) {
      location.href = link;
    }
  }

  // ===================== VOICE CHAT (WebRTC mesh) =====================
  // Mesh: every participant connects to every other participant directly.
  // Works fine for up to 8 players (max room size). Signalling goes through
  // the WebSocket server.
  const Voice = {
    enabled: false,
    localStream: null,
    peers: new Map(), // peerId -> { pc, audioEl, speaking }
    pendingPeers: new Set(),
    speaking: false,
    audioCtx: null,
    analyser: null,
    speakingTimer: null,
    async enable() {
      if (this.enabled) return;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        safeToast(
          "Браузер не поддерживает доступ к микрофону. Открой через HTTPS-ссылку.",
          "error",
        );
        return;
      }
      // getUserMedia only works on https:// or localhost.
      const insecure =
        location.protocol !== "https:" &&
        location.hostname !== "localhost" &&
        location.hostname !== "127.0.0.1";
      if (insecure) {
        safeToast(
          "Голосовой чат работает только по HTTPS. Открой бота через https://-ссылку.",
          "error",
          6000,
        );
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        this.localStream = stream;
        this.enabled = true;
        this.setupLocalAnalyser(stream);
        const code = getState().room && getState().room.code;
        if (code) sock.send({ type: "voice:join" });
        this.renderToggle();
      } catch (e) {
        safeToast(
          "Доступ к микрофону не получен: " + (e.message || e.name),
          "error",
        );
      }
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      sock.send({ type: "voice:leave" });
      if (this.localStream) {
        this.localStream.getTracks().forEach((t) => t.stop());
        this.localStream = null;
      }
      for (const [, peer] of this.peers) {
        try {
          peer.pc.close();
        } catch (_) {}
        if (peer.audioEl) peer.audioEl.remove();
      }
      this.peers.clear();
      this.pendingPeers.clear();
      if (this.audioCtx) {
        try {
          this.audioCtx.close();
        } catch (_) {}
        this.audioCtx = null;
      }
      this.renderToggle();
      this.renderPeers();
    },
    setupLocalAnalyser(stream) {
      try {
        this.audioCtx = new (
          window.AudioContext || window.webkitAudioContext
        )();
        const source = this.audioCtx.createMediaStreamSource(stream);
        this.analyser = this.audioCtx.createAnalyser();
        this.analyser.fftSize = 512;
        source.connect(this.analyser);
        const buf = new Uint8Array(this.analyser.frequencyBinCount);
        const loop = () => {
          if (!this.enabled) return;
          this.analyser.getByteFrequencyData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i += 1) sum += buf[i];
          const avg = sum / buf.length;
          const speakingNow = avg > 18;
          if (speakingNow !== this.speaking) {
            this.speaking = speakingNow;
            sock.send({ type: "voice:speaking", speaking: speakingNow });
          }
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      } catch (e) {
        console.warn("analyser failed", e);
      }
    },
    async getOrCreatePeer(peerId, isInitiator) {
      let peer = this.peers.get(peerId);
      if (peer) return peer;
      const pc = new RTCPeerConnection({
        iceServers: [
          {
            urls: [
              "stun:stun.l.google.com:19302",
              "stun:stun1.l.google.com:19302",
              "stun:stun.cloudflare.com:3478",
            ],
          },
          // Free public TURN (Open Relay Project) — required for users behind
          // symmetric NAT / restrictive firewalls. Free tier, no API key.
          {
            urls: "turn:openrelay.metered.ca:80",
            username: "openrelayproject",
            credential: "openrelayproject",
          },
          {
            urls: "turn:openrelay.metered.ca:443",
            username: "openrelayproject",
            credential: "openrelayproject",
          },
          {
            urls: "turn:openrelay.metered.ca:443?transport=tcp",
            username: "openrelayproject",
            credential: "openrelayproject",
          },
        ],
      });
      if (this.localStream) {
        for (const track of this.localStream.getTracks())
          pc.addTrack(track, this.localStream);
      }
      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      audioEl.setAttribute("playsinline", "");
      audioEl.dataset.peerId = peerId;
      document.body.appendChild(audioEl);
      pc.ontrack = (event) => {
        audioEl.srcObject = event.streams[0];
        // Some mobile browsers require an explicit play() call after a user
        // gesture. We've already had one (the mic toggle), so play() is ok.
        const p = audioEl.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      };
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sock.send({
            type: "voice:signal",
            to: peerId,
            payload: { ice: event.candidate },
          });
        }
      };
      pc.onconnectionstatechange = () => {
        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "closed"
        ) {
          this.removePeer(peerId);
        }
      };
      peer = { pc, audioEl, speaking: false, muted: false };
      this.peers.set(peerId, peer);
      this.renderPeers();
      if (isInitiator) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sock.send({
          type: "voice:signal",
          to: peerId,
          payload: { sdp: pc.localDescription },
        });
      }
      return peer;
    },
    async handleSignal(from, payload) {
      if (!this.enabled) return;
      const peer = await this.getOrCreatePeer(from, false);
      if (payload.sdp) {
        await peer.pc.setRemoteDescription(payload.sdp);
        if (payload.sdp.type === "offer") {
          const ans = await peer.pc.createAnswer();
          await peer.pc.setLocalDescription(ans);
          sock.send({
            type: "voice:signal",
            to: from,
            payload: { sdp: peer.pc.localDescription },
          });
        }
      } else if (payload.ice) {
        try {
          await peer.pc.addIceCandidate(payload.ice);
        } catch (e) {
          console.warn("addIceCandidate", e);
        }
      }
    },
    removePeer(peerId) {
      const peer = this.peers.get(peerId);
      if (!peer) return;
      try {
        peer.pc.close();
      } catch (_) {}
      if (peer.audioEl) peer.audioEl.remove();
      this.peers.delete(peerId);
      this.renderPeers();
    },
    renderToggle() {
      const panel = $("voice-panel");
      const icon = $("voice-icon");
      const label = $("voice-label");
      const status = $("voice-status");
      if (!panel) return;
      const inRoom = Boolean(getState().room);
      panel.classList.toggle("hidden", !inRoom);
      if (icon) icon.textContent = this.enabled ? "🎙" : "🔇";
      if (label) label.textContent = this.enabled ? "Войс ВКЛ" : "Войс";
      if (status)
        status.textContent = this.enabled ? `${this.peers.size} в эфире` : "";
      panel.classList.toggle("on", this.enabled);
    },
    renderPeers() {
      const list = $("voice-peers");
      if (!list) return;
      const peers = Array.from(this.peers.entries());
      if (peers.length === 0) {
        list.innerHTML = "";
        return;
      }
      list.innerHTML = peers
        .map(([id, peer]) => {
          const name = playerNameById(id) || `id${id}`;
          return `<div class="voice-peer ${peer.speaking ? "speaking" : ""} ${peer.muted ? "muted" : ""}" data-peer="${id}">
          <span class="voice-peer-dot"></span>
          <span class="voice-peer-name">${escapeHtml(name)}</span>
          ${peer.muted ? "<span>🔇</span>" : ""}
        </div>`;
        })
        .join("");
    },
  };
  window.Voice = Voice;

  function playerNameById(id) {
    const s = getState();
    if (!s.room) return null;
    const found = (s.room.players || []).find(
      (p) => Number(p.id) === Number(id),
    );
    return found ? found.name : null;
  }

  // Note: we deliberately do NOT initiate an offer when we hear about a new
  // voice peer here. The new joiner receives `voice:peers` with the list of
  // existing peers and initiates offers to each of them. The existing peers
  // create their PeerConnection on demand when they receive the offer (in
  // `voice:signal`). This avoids "glare" (both sides creating offers at once).
  sock.on("voice:peer-ready", () => {});
  sock.on("voice:peers", async ({ peers }) => {
    if (!Voice.enabled) return;
    for (const peerId of peers || []) {
      if (peerId !== getState().playerId)
        await Voice.getOrCreatePeer(peerId, true);
    }
  });
  sock.on("voice:signal", ({ from, payload }) => {
    Voice.handleSignal(from, payload);
  });
  sock.on("voice:peer-left", ({ playerId }) => Voice.removePeer(playerId));
  sock.on("voice:speaking", ({ playerId, speaking }) => {
    const peer = Voice.peers.get(playerId);
    if (peer) {
      peer.speaking = speaking;
      Voice.renderPeers();
    }
  });
  sock.on("voice:mute", ({ playerId, muted }) => {
    const peer = Voice.peers.get(playerId);
    if (peer) {
      peer.muted = muted;
      Voice.renderPeers();
    }
  });

  document.addEventListener("click", (e) => {
    if (e.target.closest("#voice-toggle")) {
      if (Voice.enabled) Voice.disable();
      else Voice.enable();
    }
  });

  // ===================== ROOM HOOKS =====================
  // When the room changes, tell WS so we receive room broadcasts and so voice
  // peers can find each other.
  let lastRoomCode = null;
  const observeRoomState = () => {
    const s = getState();
    const code = s.room && s.room.code;
    if (code !== lastRoomCode) {
      if (lastRoomCode) sock.send({ type: "room:leave" });
      if (code) sock.send({ type: "room:join", code });
      lastRoomCode = code;
    }
    Voice.renderToggle();
  };
  setInterval(observeRoomState, 800);

  // ===================== INIT =====================
  function setupNavExtras() {
    const nav = $("bottom-nav");
    if (!nav) return;
    const items = nav.querySelectorAll(".nav-item");
    // Adjust pill animation to support 5 items
    nav.style.setProperty("--nav-items", String(items.length));
  }

  document.addEventListener("DOMContentLoaded", () => {
    setupFriendSearch();
    setupNavExtras();
    // Hook into page switching
    const origSwitch = window.switchPage;
    if (typeof origSwitch === "function") {
      window.switchPage = function (name) {
        origSwitch(name);
        if (name === "friends") Friends.refresh();
        if (name === "shop") Shop.refresh();
        if (name === "profile") Me.refresh();
      };
    }
    sock.connect();
    Me.refresh().then(() => backupStatsToServer());
    setInterval(() => Friends.refresh(), 30000);
  });
})();
