"use strict";

// Low-level HTTP helpers: body reading (with size guard), JSON responses,
// CORS headers and static file serving.
const fs = require("fs");
const path = require("path");
const { MAX_BODY_BYTES } = require("./config");

function readRaw(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const err = new Error("PAYLOAD_TOO_LARGE");
        err.statusCode = 413;
        try {
          req.destroy();
        } catch (_) {}
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

module.exports = {
  readRaw,
  readBody,
  sendJson,
  applyCorsHeaders,
  serveStatic,
};
