import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { FfmpegStreamController } from "./stream-controller.js";

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
]);

function sendJson(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createAppServer({ controller, publicRoot }) {
  const root = path.resolve(publicRoot);
  return http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, "http://127.0.0.1");
      const origin = request.headers.origin;
      const isLocalOrigin =
        typeof origin === "string" && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin);
      if (isLocalOrigin) {
        response.setHeader("access-control-allow-origin", origin);
        response.setHeader("vary", "Origin");
      }
      if (request.method === "OPTIONS" && requestUrl.pathname === "/open-stream") {
        if (!isLocalOrigin) return sendJson(response, 403, { error: "Origin not allowed" });
        response.setHeader("access-control-allow-methods", "POST, OPTIONS");
        response.setHeader("access-control-allow-headers", "content-type");
        response.writeHead(204);
        return response.end();
      }
      if (request.method === "POST" && requestUrl.pathname === "/open-stream") {
        const body = await readJson(request);
        if (typeof body.filename !== "string" || body.filename === "") {
          return sendJson(response, 400, { error: "filename is required" });
        }
        return sendJson(response, 200, controller.open(body.filename));
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        return sendJson(response, 405, { error: "Method not allowed" });
      }

      const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
      const file = path.resolve(root, `.${decodeURIComponent(pathname)}`);
      if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
        return sendJson(response, 403, { error: "Forbidden" });
      }
      const info = await stat(file);
      if (!info.isFile()) return sendJson(response, 404, { error: "Not found" });
      const content = await readFile(file);
      response.writeHead(200, {
        "content-type": MIME_TYPES.get(path.extname(file)) ?? "application/octet-stream",
      });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      const status = error?.code === "ENOENT" ? 404 : 409;
      sendJson(response, status, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const projectRoot = path.dirname(fileURLToPath(import.meta.url));
  const liveDirectory = path.join(projectRoot, "live");
  const files = readdirSync(liveDirectory)
    .filter((name) => /^test-\d+\.flv$/i.test(name))
    .sort()
    .map((name) => path.join(liveDirectory, name));
  const controller = new FfmpegStreamController({
    files,
    spawnImpl: spawn,
    rtmpBaseUrl: "rtmp://127.0.0.1:1935/live",
  });
  const server = createAppServer({ controller, publicRoot: projectRoot });

  server.listen(3000, "127.0.0.1", () => {
    console.log("App: http://127.0.0.1:3000");
    console.log("FFmpeg is idle; click Connect & Play to start test-000");
  });

  const shutdown = () => {
    controller.stopAll();
    server.close(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
