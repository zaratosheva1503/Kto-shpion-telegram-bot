// admin.js — Telegram Mini App админ-панель.
// Доступ открывается только если сервер подтвердил Telegram WebApp initData
// и Telegram ID есть в ADMIN_USER_IDS.

(function () {
  const $ = (id) => document.getElementById(id);
  const tg = window.Telegram && window.Telegram.WebApp;
  const tgUser = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;

  const KIND_LABELS = {
    frames: '🖼 Рамки',
    themes: '🎨 Темы',
    nameEffects: '✨ Эффект имени',
    statusEmojis: '🎯 Статус',
    animatedAvatars: '🎬 Аватары'
  };

  const state = {
    ready: false,
    adminId: null,
    catalog: null,
    selectedUser: null,
    rooms: []
  };

  function toast(message, variant = '', duration = 2600) {
    if (typeof window.toast === 'function') window.toast(message, variant, duration);
    else console.log('[admin]', variant, message);
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function api(path, options = {}) {
    if (typeof window.api === 'function') return window.api(path, options);
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (tg && tg.initData) headers['X-Telegram-Init-Data'] = tg.initData;
    const playerId = window.state && window.state.playerId;
    if (playerId) headers['X-Admin-User-Id'] = String(playerId);
    return fetch(path, {
      ...options,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Ошибка запроса');
      return data;
    });
  }

  function avatarHtml(user) {
    const avatar = user && (user.avatar || (user.public && user.public.avatar));
    if (avatar && /^(https?:|data:|\/)/.test(avatar)) {
      return `<img src="${escapeHtml(avatar)}" alt="" referrerpolicy="no-referrer">`;
    }
    return '🙂';
  }

  function premiumText(user) {
    if (!user || !user.premium || !user.premiumUntil || user.premiumUntil <= Date.now()) return 'нет';
    const days = Math.max(1, Math.ceil((user.premiumUntil - Date.now()) / 86400000));
    return `${days} дн.`;
  }

  function activePageName() {
    const active = document.querySelector('.page.is-active');
    return active ? active.dataset.page : 'home';
  }

  function revealAdminNav() {
    const navItem = $('admin-nav');
    if (navItem) navItem.classList.remove('hidden');
    const nav = $('bottom-nav');
    if (nav) nav.classList.add('has-admin');
    if (typeof window.switchPage === 'function') window.switchPage(activePageName());
  }

  function renderSummary(summary) {
    if (!summary) return;
    ['usersTotal', 'onlineTotal', 'roomsTotal', 'totalStars'].forEach((key) => {
      const el = document.querySelector(`[data-admin-stat="${key}"]`);
      if (el) el.textContent = String(summary[key] || 0);
    });
  }

  async function refreshSummary() {
    const summary = await api('/api/admin/summary');
    renderSummary(summary);
    state.rooms = summary.rooms || [];
    renderRooms(state.rooms);
    return summary;
  }

  async function loadCatalog() {
    const data = await api('/api/admin/catalog');
    state.catalog = data.catalog || {};
    renderCosmeticKinds(data.kinds || Object.keys(state.catalog));
  }

  function renderCosmeticKinds(kinds) {
    const select = $('admin-cosmetic-kind');
    if (!select) return;
    select.innerHTML = (kinds || [])
      .filter((kind) => state.catalog && state.catalog[kind])
      .map((kind) => `<option value="${escapeHtml(kind)}">${escapeHtml(KIND_LABELS[kind] || kind)}</option>`)
      .join('');
    renderCosmeticItems();
  }

  function renderCosmeticItems() {
    const kindSelect = $('admin-cosmetic-kind');
    const itemSelect = $('admin-cosmetic-item');
    if (!kindSelect || !itemSelect || !state.catalog) return;
    const kind = kindSelect.value;
    const owned = new Set(((state.selectedUser && state.selectedUser.inventory && state.selectedUser.inventory[kind]) || []).map(String));
    itemSelect.innerHTML = (state.catalog[kind] || [])
      .map((item) => {
        const title = `${item.emoji ? item.emoji + ' ' : ''}${item.title || item.id}`;
        const meta = owned.has(String(item.id)) ? ' · есть' : (item.levelRequired ? ` · ур.${item.levelRequired}` : (item.starsPrice ? ` · ${item.starsPrice}⭐` : ''));
        return `<option value="${escapeHtml(item.id)}">${escapeHtml(title + meta)}</option>`;
      })
      .join('');
  }

  async function searchUsers(query) {
    const results = $('admin-users-results');
    if (results) results.innerHTML = '<small class="muted-line">Загрузка...</small>';
    const data = await api(`/api/admin/users?query=${encodeURIComponent(query || '')}&limit=30`);
    renderUsers(data.users || []);
  }

  function renderUsers(users) {
    const results = $('admin-users-results');
    if (!results) return;
    if (!users.length) {
      results.innerHTML = '<small class="muted-line">Никого не нашли</small>';
      return;
    }
    results.innerHTML = users.map((u) => `
      <button class="admin-user-result" type="button" data-admin-user-id="${u.id}">
        <span class="admin-user-result-avatar">${avatarHtml(u)}</span>
        <span class="admin-user-result-main">
          <strong>${escapeHtml(u.name || ('Игрок ' + u.id))}</strong>
          <small>${u.username ? '@' + escapeHtml(u.username) + ' · ' : ''}ID ${u.id} · ур.${u.level || 1}${u.online ? ' · 🟢 онлайн' : ''}${u.isAdmin ? ' · 🛡 admin' : ''}</small>
        </span>
      </button>
    `).join('');
  }

  async function loadUser(id) {
    const data = await api(`/api/admin/users/${id}`);
    setSelectedUser(data.user);
  }

  function setSelectedUser(user) {
    state.selectedUser = user;
    const editor = $('admin-user-editor');
    if (editor) editor.classList.remove('hidden');
    const avatar = $('admin-selected-avatar');
    if (avatar) avatar.innerHTML = avatarHtml(user);
    const name = $('admin-selected-name');
    if (name) name.textContent = user.name || `Игрок ${user.id}`;
    const meta = $('admin-selected-meta');
    if (meta) meta.textContent = `${user.username ? '@' + user.username + ' · ' : ''}ID ${user.id}${user.online ? ' · онлайн' : ''}`;
    const level = $('admin-selected-level');
    if (level) level.textContent = String(user.level || 1);
    const xp = $('admin-selected-xp');
    if (xp) xp.textContent = String(user.xp || 0);
    const premium = $('admin-selected-premium');
    if (premium) premium.textContent = premiumText(user);
    const profileName = $('admin-profile-name');
    if (profileName) profileName.value = user.name || '';
    const profileUsername = $('admin-profile-username');
    if (profileUsername) profileUsername.value = user.username || '';
    const levelInput = $('admin-level-value');
    if (levelInput) levelInput.value = String(user.level || 1);
    const xpInput = $('admin-xp-value');
    if (xpInput) xpInput.value = String(user.xp || 0);
    renderCosmeticItems();
  }

  function requireSelectedUser() {
    if (!state.selectedUser || !state.selectedUser.id) {
      toast('Сначала выбери игрока', 'error');
      return null;
    }
    return state.selectedUser;
  }

  async function mutateSelected(path, body, successText) {
    const user = requireSelectedUser();
    if (!user) return;
    const data = await api(`/api/admin/users/${user.id}${path}`, { method: 'POST', body });
    if (data.user) setSelectedUser(data.user);
    toast(successText || 'Готово', 'success');
    await searchUsers($('admin-user-search') ? $('admin-user-search').value.trim() : '');
    await refreshSummary().catch(() => {});
  }

  function renderRooms(rooms) {
    const list = $('admin-rooms-list');
    if (!list) return;
    if (!rooms || rooms.length === 0) {
      list.innerHTML = '<small class="muted-line">Активных комнат нет</small>';
      return;
    }
    list.innerHTML = rooms.map((room) => `
      <div class="admin-room-card">
        <div class="admin-room-head">
          <div>
            <strong>${escapeHtml(room.code)}</strong>
            <small>${escapeHtml(room.status)} · ${room.playersCount}/8 · хост ${escapeHtml(room.ownerName || room.ownerId)}</small>
          </div>
          <div class="admin-room-actions">
            <button class="secondary" data-room-action="backToLobby" data-code="${escapeHtml(room.code)}" type="button">В лобби</button>
            <button class="danger-soft" data-room-action="close" data-code="${escapeHtml(room.code)}" type="button">Закрыть</button>
          </div>
        </div>
        <div class="admin-room-players">
          ${(room.players || []).map((p) => `
            <span class="admin-room-player">
              ${p.owner ? '👑 ' : ''}${escapeHtml(p.name || p.id)}${p.online ? ' 🟢' : ''}
              <button data-room-action="kick" data-code="${escapeHtml(room.code)}" data-target-id="${p.id}" type="button">кик</button>
            </span>
          `).join('')}
        </div>
      </div>
    `).join('');
  }

  async function refreshRooms() {
    const data = await api('/api/admin/rooms');
    state.rooms = data.rooms || [];
    renderRooms(state.rooms);
  }

  async function roomAction(code, action, targetId) {
    if (action === 'close' && !confirm(`Закрыть комнату ${code}?`)) return;
    const body = { action };
    if (targetId) body.targetId = Number(targetId);
    await api(`/api/admin/rooms/${encodeURIComponent(code)}/action`, { method: 'POST', body });
    toast('Комната обновлена', 'success');
    await refreshSummary();
  }

  function bindEvents() {
    const refresh = $('admin-refresh');
    if (refresh) refresh.addEventListener('click', () => refreshSummary().then(() => toast('Сводка обновлена', 'success')).catch((e) => toast(e.message, 'error')));

    const refreshRoomsBtn = $('admin-refresh-rooms');
    if (refreshRoomsBtn) refreshRoomsBtn.addEventListener('click', () => refreshRooms().catch((e) => toast(e.message, 'error')));

    const searchInput = $('admin-user-search');
    const searchBtn = $('admin-user-search-btn');
    const runSearch = () => searchUsers(searchInput ? searchInput.value.trim() : '').catch((e) => toast(e.message, 'error'));
    if (searchBtn) searchBtn.addEventListener('click', runSearch);
    if (searchInput) searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });

    document.addEventListener('click', (e) => {
      const row = e.target.closest('[data-admin-user-id]');
      if (row) {
        loadUser(Number(row.dataset.adminUserId)).catch((err) => toast(err.message, 'error'));
        return;
      }
      const xpAdd = e.target.closest('[data-admin-xp-add]');
      if (xpAdd) {
        mutateSelected('/xp', { mode: 'add', value: Number(xpAdd.dataset.adminXpAdd) }, 'XP изменён').catch((err) => toast(err.message, 'error'));
        return;
      }
      const roomBtn = e.target.closest('[data-room-action]');
      if (roomBtn) {
        roomAction(roomBtn.dataset.code, roomBtn.dataset.roomAction, roomBtn.dataset.targetId).catch((err) => toast(err.message, 'error'));
      }
    });

    const setXp = $('admin-set-xp');
    if (setXp) setXp.addEventListener('click', () => {
      const value = Number($('admin-xp-value') && $('admin-xp-value').value);
      mutateSelected('/xp', { mode: 'set', value }, 'XP выставлен').catch((e) => toast(e.message, 'error'));
    });

    const setLevel = $('admin-set-level');
    if (setLevel) setLevel.addEventListener('click', () => {
      const level = Number($('admin-level-value') && $('admin-level-value').value);
      mutateSelected('/level', { level }, 'Уровень выставлен').catch((e) => toast(e.message, 'error'));
    });

    const grantPremium = $('admin-grant-premium');
    if (grantPremium) grantPremium.addEventListener('click', () => {
      const days = Number($('admin-premium-days') && $('admin-premium-days').value) || 30;
      mutateSelected('/premium', { days }, 'Премиум выдан').catch((e) => toast(e.message, 'error'));
    });

    const clearPremium = $('admin-clear-premium');
    if (clearPremium) clearPremium.addEventListener('click', () => {
      mutateSelected('/premium', { mode: 'clear' }, 'Премиум забран').catch((e) => toast(e.message, 'error'));
    });

    const kind = $('admin-cosmetic-kind');
    if (kind) kind.addEventListener('change', renderCosmeticItems);

    const grantCosmetic = $('admin-grant-cosmetic');
    if (grantCosmetic) grantCosmetic.addEventListener('click', () => {
      const kindValue = $('admin-cosmetic-kind') && $('admin-cosmetic-kind').value;
      const itemId = $('admin-cosmetic-item') && $('admin-cosmetic-item').value;
      const equip = Boolean($('admin-cosmetic-equip') && $('admin-cosmetic-equip').checked);
      mutateSelected('/cosmetics/grant', { kind: kindValue, itemId, equip }, 'Косметика выдана').catch((e) => toast(e.message, 'error'));
    });

    const revokeCosmetic = $('admin-revoke-cosmetic');
    if (revokeCosmetic) revokeCosmetic.addEventListener('click', () => {
      const kindValue = $('admin-cosmetic-kind') && $('admin-cosmetic-kind').value;
      const itemId = $('admin-cosmetic-item') && $('admin-cosmetic-item').value;
      mutateSelected('/cosmetics/revoke', { kind: kindValue, itemId }, 'Косметика забрана').catch((e) => toast(e.message, 'error'));
    });

    const resetStats = $('admin-reset-user-stats');
    if (resetStats) resetStats.addEventListener('click', () => {
      if (!confirm('Сбросить статистику выбранного игрока?')) return;
      mutateSelected('/stats', { mode: 'reset' }, 'Статистика сброшена').catch((e) => toast(e.message, 'error'));
    });

    const saveProfile = $('admin-save-profile');
    if (saveProfile) saveProfile.addEventListener('click', () => {
      mutateSelected('/profile', {
        name: $('admin-profile-name') && $('admin-profile-name').value,
        username: $('admin-profile-username') && $('admin-profile-username').value
      }, 'Профиль сохранён').catch((e) => toast(e.message, 'error'));
    });

    const notifyBtn = $('admin-send-notify');
    if (notifyBtn) notifyBtn.addEventListener('click', async () => {
      const user = requireSelectedUser();
      if (!user) return;
      const input = $('admin-notify-message');
      const message = input ? input.value.trim() : '';
      if (!message) { toast('Напиши сообщение', 'error'); return; }
      await api('/api/admin/notify', { method: 'POST', body: { targetId: user.id, message } });
      if (input) input.value = '';
      toast('Сообщение отправлено', 'success');
    });
  }

  function bindIncomingAdminMessages() {
    if (window.sock && typeof window.sock.on === 'function') {
      window.sock.on('admin:message', ({ message }) => {
        toast(`🛡 ${message}`, 'success', 6000);
      });
    }
  }

  async function init() {
    bindEvents();
    bindIncomingAdminMessages();
    const wantsAdmin = new URLSearchParams(location.search).get('admin') === '1';
    try {
      const me = await api('/api/admin/me');
      state.ready = true;
      state.adminId = me.adminId;
      revealAdminNav();
      const chip = $('admin-me-chip');
      if (chip) chip.textContent = `ID ${me.adminId}`;
      renderSummary(me.summary);
      state.rooms = (me.summary && me.summary.rooms) || [];
      renderRooms(state.rooms);
      await loadCatalog();
      await searchUsers(tgUser && tgUser.id ? String(tgUser.id) : '');
      if (wantsAdmin && typeof window.switchPage === 'function') window.switchPage('admin');
    } catch (e) {
      if (wantsAdmin) {
        toast(e.message || 'Нет доступа к админке', 'error', 5000);
        if (typeof window.switchPage === 'function') window.switchPage('home');
      }
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
