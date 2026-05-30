const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { PACKS } = require("../data/packs");

const root = path.join(__dirname, "..");
const exportDir = path.join(root, "crazygamesport");
const sourceAssetsDir = path.join(root, "assets");
const exportAssetsDir = path.join(exportDir, "assets");
const packsJsonPath = path.join(exportDir, "packs.json");
const requiredStaticFiles = [
  "index.html",
  "style.css",
  "script.js",
  "app-extras.js",
  "admin.js",
  "crazygames-config.js",
  "crazygames-adapter.js",
];

function ensureCrazyStaticFiles() {
  fs.mkdirSync(exportDir, { recursive: true });
  ensureCrazyConfig();
  writeCrazyAdapter();
  syncClientFiles();

  const missing = requiredStaticFiles.filter(
    (fileName) => !fs.existsSync(path.join(exportDir, fileName)),
  );
  if (missing.length) {
    throw new Error(
      `В crazygamesport нет обязательных файлов: ${missing.join(", ")}`,
    );
  }
}

function readRootFile(fileName) {
  return fs.readFileSync(path.join(root, fileName), "utf8");
}

function writeExportFile(fileName, content) {
  fs.writeFileSync(path.join(exportDir, fileName), content);
}

function replaceRequired(content, from, to, fileName) {
  if (!content.includes(from)) {
    throw new Error(`Не удалось применить трансформацию ${fileName}`);
  }
  return content.replace(from, to);
}

function removeBetween(content, startMarker, endMarker, fileName) {
  const startIdx = content.indexOf(startMarker);
  if (startIdx < 0) {
    throw new Error(`Маркер не найден (${fileName}): ${startMarker}`);
  }
  const endIdx = content.indexOf(endMarker, startIdx + startMarker.length);
  if (endIdx < 0) {
    throw new Error(`Конечный маркер не найден (${fileName}): ${endMarker}`);
  }
  return content.slice(0, startIdx) + content.slice(endIdx);
}

function transformIndexHtml(html) {
  html = replaceRequired(
    html,
    "<title>Кто шпион — Telegram игра</title>",
    "<title>Who is the Spy?</title>",
    "index.html:title",
  );
  html = replaceRequired(
    html,
    '<script src="https://telegram.org/js/telegram-web-app.js"></script>',
    [
      "<!-- CrazyGames SDK v3 (loaded by the portal in production). -->",
      '        <script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>',
      '        <script src="crazygames-config.js"></script>',
      '        <script src="crazygames-adapter.js"></script>',
    ].join("\n"),
    "index.html:sdk",
  );

  // Remove premium / "На покушать" card on profile page.
  html = removeBetween(
    html,
    '                    <div\n                        class="card premium-card animate-pop"',
    "                    <button class=\"reset-stats\"",
    "index.html:premium-card",
  );

  // Remove entire SHOP section.
  html = removeBetween(
    html,
    "                <!-- SHOP -->",
    "                <!-- ADMIN -->",
    "index.html:shop-section",
  );

  // Remove shop tab from bottom nav.
  html = replaceRequired(
    html,
    '                <button class="nav-item" data-tab="shop" type="button">\n                    <span class="nav-icon">🛍</span>\n                    <span class="nav-label">Магазин</span>\n                </button>\n',
    "",
    "index.html:nav-shop",
  );

  // Remove donation modal.
  html = removeBetween(
    html,
    '        <!-- Donation modal "На покушать" -->',
    "        <!-- Reaction picker",
    "index.html:donate-modal",
  );

  // Sanitize Telegram-flavored copy that remains in level-up overlay etc.
  html = html.replace(
    /Так держать! За уровни даём косметику\./g,
    "Так держать! Продолжай играть.",
  );

  return html;
}

function transformScriptJs(script) {
  script = replaceRequired(
    script,
    "const tg = window.Telegram && window.Telegram.WebApp;\nif (tg) {\n  try {\n    tg.ready();\n    tg.expand();\n  } catch (_) {}\n}\nconst tgUser = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;",
    "const tg = null;\nconst tgUser = null;",
    "script.js:tg-bootstrap",
  );

  // Replace remaining window.Telegram references with a permanently-false guard.
  script = script.replace(/window\.Telegram/g, "/* removed */ false");

  // Drop the Telegram init-data header.
  script = replaceRequired(
    script,
    '  if (tg && tg.initData) headers["X-Telegram-Init-Data"] = tg.initData;\n',
    "",
    "script.js:init-data-header",
  );

  script = replaceRequired(
    script,
    "// === API ===\nfunction api(path, options = {}) {",
    '// === API ===\nfunction resolveApiUrl(path) {\n  return typeof window.resolveApiUrl === "function"\n    ? window.resolveApiUrl(path)\n    : path;\n}\n\nfunction api(path, options = {}) {',
    "script.js:api-resolver",
  );
  script = replaceRequired(
    script,
    "return fetch(path, {",
    "return fetch(resolveApiUrl(path), {",
    "script.js:fetch",
  );

  // Strip the Telegram-photo avatar option.
  script = replaceRequired(
    script,
    '    items.push({ id: "tg-photo", url: photo, isTelegram: true });\n',
    "",
    "script.js:tg-photo-push",
  );
  script = script.replace(/\$\{opt\.isTelegram \? "is-telegram" : ""\}/g, "");

  return script;
}

function transformAppExtras(extras) {
  // Update file header comment.
  extras = replaceRequired(
    extras,
    "// voice chat (WebRTC mesh), cosmetics shop, Telegram Stars donations,",
    "// voice chat (WebRTC mesh),",
    "app-extras.js:header-comment",
  );

  // Stub out Telegram references at top of IIFE.
  extras = replaceRequired(
    extras,
    "  const tg = window.Telegram && window.Telegram.WebApp;\n  const tgUser = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;",
    "  const tg = null;\n  const tgUser = null;",
    "app-extras.js:tg-bootstrap",
  );
  extras = extras.replace(/window\.Telegram/g, "/* removed */ false");

  extras = replaceRequired(
    extras,
    '    if (tg && tg.initData) headers["X-Telegram-Init-Data"] = tg.initData;\n',
    "",
    "app-extras.js:init-data-header",
  );

  extras = replaceRequired(
    extras,
    "  const $ = (id) => document.getElementById(id);\n  function api(path, options = {}) {",
    '  const $ = (id) => document.getElementById(id);\n  function resolveApiUrl(path) {\n    return typeof window.resolveApiUrl === "function"\n      ? window.resolveApiUrl(path)\n      : path;\n  }\n  function api(path, options = {}) {',
    "app-extras.js:api-resolver",
  );
  extras = replaceRequired(
    extras,
    "return fetch(path, {",
    "return fetch(resolveApiUrl(path), {",
    "app-extras.js:fetch",
  );

  extras = replaceRequired(
    extras,
    '        const scheme = location.protocol === "https:" ? "wss:" : "ws:";\n        const url = `${scheme}//${location.host}/ws`;\n        const ws = new WebSocket(url);',
    '        const url =\n          typeof window.resolveWsUrl === "function"\n            ? window.resolveWsUrl("/ws")\n            : `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;\n        const ws = new WebSocket(url);',
    "app-extras.js:ws",
  );

  // Drop donation:success / purchase:success socket handlers.
  extras = removeBetween(
    extras,
    '  sock.on("donation:success"',
    "\n  // ===================== ME / XP / LEVELS =====================",
    "app-extras.js:donation-socket",
  );

  // Drop the entire SHOP module + its click handlers.
  extras = removeBetween(
    extras,
    "  // ===================== SHOP =====================",
    "  // ===================== DONATIONS =====================",
    "app-extras.js:shop-module",
  );

  // Drop DONATIONS section (donate modal, donate fn, openInvoiceLink).
  extras = removeBetween(
    extras,
    "  // ===================== DONATIONS =====================",
    "  // ===================== VOICE CHAT (WebRTC mesh) =====================",
    "app-extras.js:donations-module",
  );

  // Remove shop refresh hook from setupNavExtras.
  extras = replaceRequired(
    extras,
    '        if (name === "shop") Shop.refresh();\n',
    "",
    "app-extras.js:shop-refresh-hook",
  );

  return extras;
}

function syncClientFiles() {
  writeExportFile("index.html", transformIndexHtml(readRootFile("index.html")));
  writeExportFile("style.css", readRootFile("style.css"));
  writeExportFile("script.js", transformScriptJs(readRootFile("script.js")));
  writeExportFile(
    "app-extras.js",
    transformAppExtras(readRootFile("app-extras.js")),
  );
  writeExportFile("admin.js", readRootFile("admin.js"));
}

function ensureCrazyConfig() {
  const backendUrl = String(process.env.CRAZYGAMES_BACKEND_URL || "").trim();
  const configPath = path.join(exportDir, "crazygames-config.js");
  if (!backendUrl && fs.existsSync(configPath)) return;

  const normalized = backendUrl.replace(/\/+$/, "");
  fs.writeFileSync(
    configPath,
    [
      "// Конфиг CrazyGames-сборки игры «Who is the Spy?».",
      "//",
      "// apiBase — публичный HTTPS URL твоего сервера (server.js).",
      "// Оставь пустым, если игра грузится с того же origin, что и сервер.",
      "window.SPY_APP_CONFIG = {",
      `  apiBase: "${normalized}",`,
      '  wsBase: "",',
      "};",
      "",
    ].join("\n"),
  );
}

function writeCrazyAdapter() {
  fs.writeFileSync(
    path.join(exportDir, "crazygames-adapter.js"),
    CRAZY_ADAPTER_SOURCE,
  );
}

const CRAZY_ADAPTER_SOURCE = `// CrazyGames adapter for "Who is the Spy?".
// Bridges the client to CrazyGames SDK v3: gameplay start/stop, ad lifecycle,
// system mute, API/WebSocket base resolution.
(function () {
  const config = window.SPY_APP_CONFIG || {};
  const params = new URLSearchParams(window.location.search);
  const BACKEND_STORAGE_KEY = "spyCrazyBackendUrl";

  function trimSlash(value) {
    return String(value || "").trim().replace(/\\/+$/, "");
  }

  function normalizeBackendUrl(value) {
    const raw = trimSlash(value);
    if (!raw) return "";
    if (/^https?:\\/\\//i.test(raw)) return raw;
    return "https://" + raw;
  }

  const backendFromQuery =
    params.get("api") || params.get("backend") || params.get("server") || "";
  if (backendFromQuery) {
    try {
      localStorage.setItem(
        BACKEND_STORAGE_KEY,
        normalizeBackendUrl(backendFromQuery),
      );
    } catch (_) {}
  }

  let storedBackend = "";
  try {
    storedBackend = localStorage.getItem(BACKEND_STORAGE_KEY) || "";
  } catch (_) {}

  const apiBase = normalizeBackendUrl(
    backendFromQuery || config.apiBase || storedBackend || "",
  );
  const wsBase = trimSlash(config.wsBase || "");

  function isAbsoluteUrl(value) {
    return /^https?:\\/\\//i.test(String(value || ""));
  }

  function joinUrl(base, suffix) {
    if (!base || isAbsoluteUrl(suffix)) return suffix;
    const tail = String(suffix || "");
    return base + (tail.startsWith("/") ? "" : "/") + tail;
  }

  window.SPY_PLATFORM = "crazygames";
  window.SPY_API_BASE = apiBase;
  window.resolveApiUrl = function (path) {
    return joinUrl(apiBase, path);
  };
  window.resolveWsUrl = function (path) {
    const suffix = path || "/ws";
    if (wsBase) return joinUrl(wsBase, suffix);
    if (apiBase) {
      return joinUrl(
        apiBase.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:"),
        suffix,
      );
    }
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    return scheme + "//" + location.host + (suffix.startsWith("/") ? "" : "/") + suffix;
  };

  // --- CrazyGames SDK lifecycle -----------------------------------------
  const sdk = window.CrazyGames && window.CrazyGames.SDK ? window.CrazyGames.SDK : null;
  window.crazySdk = sdk;

  let inGameplay = false;
  function gameplayStart() {
    if (inGameplay || !sdk || !sdk.game) return;
    try {
      sdk.game.gameplayStart();
      inGameplay = true;
    } catch (_) {}
  }
  function gameplayStop() {
    if (!inGameplay || !sdk || !sdk.game) return;
    try {
      sdk.game.gameplayStop();
      inGameplay = false;
    } catch (_) {}
  }
  function happytime() {
    if (!sdk || !sdk.game) return;
    try {
      sdk.game.happytime();
    } catch (_) {}
  }
  function sdkLoadingStop() {
    if (!sdk || !sdk.game) return;
    try {
      sdk.game.sdkGameLoadingStop();
    } catch (_) {}
  }

  window.spyGameplayStart = gameplayStart;
  window.spyGameplayStop = gameplayStop;
  window.spyHappytime = happytime;

  function initSdk() {
    if (!sdk) return;
    try {
      if (sdk.game && typeof sdk.game.sdkGameLoadingStart === "function") {
        sdk.game.sdkGameLoadingStart();
      }
    } catch (_) {}
  }
  initSdk();

  function onReady() {
    sdkLoadingStop();
    gameplayStart();
  }
  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(onReady, 0);
  } else {
    document.addEventListener("DOMContentLoaded", onReady, { once: true });
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) gameplayStop();
    else gameplayStart();
  });
  window.addEventListener("blur", gameplayStop);
  window.addEventListener("focus", gameplayStart);

  // --- Ad helpers --------------------------------------------------------
  let lastMidgameAt = 0;
  const MIDGAME_COOLDOWN_MS = 3 * 60 * 1000;
  const SESSION_START = Date.now();
  const FIRST_AD_GRACE_MS = 60 * 1000;

  function callAd(type, callbacks) {
    if (!sdk || !sdk.ad || typeof sdk.ad.requestAd !== "function") {
      callbacks && callbacks.adError && callbacks.adError(new Error("no-sdk"));
      return;
    }
    let finished = false;
    const finish = function (kind, payload) {
      if (finished) return;
      finished = true;
      const cb = callbacks && callbacks[kind];
      if (cb) cb(payload);
    };
    const timer = setTimeout(function () {
      finish("adError", new Error("timeout"));
    }, 8000);
    try {
      sdk.ad.requestAd(type, {
        adStarted: function () {},
        adFinished: function () {
          clearTimeout(timer);
          finish("adFinished");
        },
        adError: function (err) {
          clearTimeout(timer);
          finish("adError", err);
        },
      });
    } catch (err) {
      clearTimeout(timer);
      finish("adError", err);
    }
  }

  window.spyShowMidgameAd = function () {
    if (!sdk) return Promise.resolve(false);
    const now = Date.now();
    if (now - SESSION_START < FIRST_AD_GRACE_MS) return Promise.resolve(false);
    if (now - lastMidgameAt < MIDGAME_COOLDOWN_MS) return Promise.resolve(false);
    return new Promise(function (resolve) {
      const wasInGameplay = inGameplay;
      gameplayStop();
      callAd("midgame", {
        adFinished: function () {
          lastMidgameAt = Date.now();
          if (wasInGameplay) gameplayStart();
          resolve(true);
        },
        adError: function () {
          if (wasInGameplay) gameplayStart();
          resolve(false);
        },
      });
    });
  };

  window.spyShowRewardedAd = function () {
    if (!sdk) return Promise.resolve(false);
    return new Promise(function (resolve) {
      const wasInGameplay = inGameplay;
      gameplayStop();
      callAd("rewarded", {
        adFinished: function () {
          if (wasInGameplay) gameplayStart();
          resolve(true);
        },
        adError: function () {
          if (wasInGameplay) gameplayStart();
          resolve(false);
        },
      });
    });
  };

  window.spyGetUserToken = function () {
    if (!sdk || !sdk.user || typeof sdk.user.getUserToken !== "function") {
      return Promise.resolve(null);
    }
    try {
      return Promise.resolve(sdk.user.getUserToken()).catch(function () {
        return null;
      });
    } catch (_) {
      return Promise.resolve(null);
    }
  };
})();
`;

function copyDirectory(source, destination) {
  if (!fs.existsSync(source)) return;
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
}

function localSvgAsset(kind, id, fallback) {
  const relativePath = `assets/${kind}/${id}.svg`;
  const absolutePath = path.join(sourceAssetsDir, kind, `${id}.svg`);
  return fs.existsSync(absolutePath) ? relativePath : fallback;
}

function serializePacks() {
  return PACKS.map((pack) => ({
    id: pack.id,
    title: pack.title,
    titleEn: pack.titleEn || pack.title,
    emoji: pack.emoji || "🎒",
    cover: localSvgAsset("packs", pack.id, pack.cover),
    count: pack.cards.length,
    cards: pack.cards.map((card) => ({
      id: card.id,
      name: card.name,
      image: localSvgAsset("cards", card.id, card.image),
      nameEn: card.nameEn || card.name,
    })),
  }));
}

function writePacksJson(packs) {
  fs.writeFileSync(packsJsonPath, `${JSON.stringify(packs, null, 2)}\n`);
}

function createZip() {
  const output = path.join(root, "crazygamesport.zip");
  fs.rmSync(output, { force: true });
  const result = spawnSync("tar", ["-acf", output, "-C", exportDir, "."], {
    stdio: "inherit",
  });
  if (result.error) {
    throw new Error(
      `Не удалось создать ZIP через tar: ${result.error.message}. Заархивируй папку crazygamesport вручную.`,
    );
  }
  if (result.status !== 0) process.exit(result.status);
  console.log(`ZIP готов: ${path.relative(root, output)}`);
}

function main() {
  ensureCrazyStaticFiles();
  copyDirectory(sourceAssetsDir, exportAssetsDir);
  const packs = serializePacks();
  writePacksJson(packs);

  const cardsCount = packs.reduce((sum, pack) => sum + pack.cards.length, 0);
  console.log(
    `CrazyGames export ready: ${packs.length} паков, ${cardsCount} карточек -> ${path.relative(root, exportDir)}`,
  );

  if (process.argv.includes("--zip")) createZip();
}

main();
