const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { PACKS } = require("../data/packs");

const root = path.join(__dirname, "..");
const exportDir = path.join(root, "yandexport");
const sourceAssetsDir = path.join(root, "assets");
const exportAssetsDir = path.join(exportDir, "assets");
const packsJsonPath = path.join(exportDir, "packs.json");
const requiredStaticFiles = [
  "index.html",
  "style.css",
  "script.js",
  "app-extras.js",
  "admin.js",
  "yandex-config.js",
  "yandex-adapter.js",
];

function ensureYandexStaticFiles() {
  fs.mkdirSync(exportDir, { recursive: true });
  ensureYandexConfig();
  syncClientFiles();

  const missing = requiredStaticFiles.filter(
    (fileName) => !fs.existsSync(path.join(exportDir, fileName)),
  );
  if (missing.length) {
    throw new Error(
      `В yandexport нет обязательных файлов: ${missing.join(", ")}`,
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

function syncClientFiles() {
  let html = readRootFile("index.html");
  html = replaceRequired(
    html,
    "<title>Кто шпион — Telegram игра</title>",
    "<title>Кто шпион — Яндекс Игры</title>",
    "index.html:title",
  );
  html = replaceRequired(
    html,
    '<script src="https://telegram.org/js/telegram-web-app.js"></script>',
    '<!-- В Яндекс Играх SDK доступен как /sdk.js. Локально файл может не загрузиться — игра всё равно работает. -->\n        <script src="/sdk.js"></script>\n        <script src="yandex-config.js"></script>\n        <script src="yandex-adapter.js"></script>',
    "index.html:sdk",
  );
  writeExportFile("index.html", html);

  writeExportFile("style.css", readRootFile("style.css"));

  let script = readRootFile("script.js");
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
  writeExportFile("script.js", script);

  let extras = readRootFile("app-extras.js");
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
  writeExportFile("app-extras.js", extras);

  writeExportFile("admin.js", readRootFile("admin.js"));
}

function ensureYandexConfig() {
  const backendUrl = String(process.env.YANDEX_BACKEND_URL || "").trim();
  const configPath = path.join(exportDir, "yandex-config.js");
  if (!backendUrl && fs.existsSync(configPath)) return;

  const normalized = backendUrl.replace(/\/+$/, "");
  fs.writeFileSync(
    configPath,
    `// Настройки full-online версии для Яндекс Игр.\n//\n// Если игра загружена в консоль Яндекс Игр, укажи здесь публичный HTTPS URL\n// сервера из этого проекта (server.js), например:\n//   apiBase: \"https://your-domain.example\",\n//\n// Для локальной проверки через npm start можно оставить пустые строки —\n// API и WebSocket будут использовать текущий origin.\nwindow.SPY_APP_CONFIG = {\n  apiBase: \"${normalized}\",\n  wsBase: \"\",\n};\n`,
  );
}

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
  const output = path.join(root, "yandexport.zip");
  fs.rmSync(output, { force: true });
  const result = spawnSync("tar", ["-acf", output, "-C", exportDir, "."], {
    stdio: "inherit",
  });
  if (result.error) {
    throw new Error(
      `Не удалось создать ZIP через tar: ${result.error.message}. Заархивируй папку yandexport вручную.`,
    );
  }
  if (result.status !== 0) process.exit(result.status);
  console.log(`ZIP готов: ${path.relative(root, output)}`);
}

function main() {
  ensureYandexStaticFiles();
  copyDirectory(sourceAssetsDir, exportAssetsDir);
  const packs = serializePacks();
  writePacksJson(packs);

  const cardsCount = packs.reduce((sum, pack) => sum + pack.cards.length, 0);
  console.log(
    `Yandex export ready: ${packs.length} паков, ${cardsCount} карточек -> ${path.relative(root, exportDir)}`,
  );

  if (process.argv.includes("--zip")) createZip();
}

main();
