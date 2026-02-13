import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);
const rootDir = path.resolve(dirname, "..");

const host = process.env.HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "8000", 10);

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
]);

const resolveRequestedPath = (rawPathname) => {
  const pathname = rawPathname === "/" ? "/demo/index.html" : rawPathname;
  const normalizedPath = pathname.replace(/^\/+/, "");
  const absolutePath = path.resolve(rootDir, normalizedPath);
  return absolutePath;
};

const sendError = (res, statusCode, message) => {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
};

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url ?? "/", "http://localhost");
    const pathname = decodeURIComponent(requestUrl.pathname);
    const filePath = resolveRequestedPath(pathname);
    const insideRoot =
      filePath === rootDir || filePath.startsWith(`${rootDir}${path.sep}`);

    if (!insideRoot) {
      sendError(res, 403, "Forbidden");
      return;
    }

    let resolvedFilePath = filePath;
    const fileStat = await stat(resolvedFilePath).catch(() => null);
    if (!fileStat) {
      sendError(res, 404, "Not found");
      return;
    }

    if (fileStat.isDirectory()) {
      resolvedFilePath = path.join(resolvedFilePath, "index.html");
    }

    const content = await readFile(resolvedFilePath).catch(() => null);
    if (!content) {
      sendError(res, 404, "Not found");
      return;
    }

    const contentType =
      mimeTypes.get(path.extname(resolvedFilePath).toLowerCase()) ??
      "application/octet-stream";

    res.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": contentType,
    });
    res.end(content);
  } catch {
    sendError(res, 500, "Internal server error");
  }
});

server.listen(port, host, () => {
  console.log(`VanimatePresence demo server running:
  http://${host}:${port}/demo/index.html`);
});

process.on("SIGINT", () => {
  server.close(() => {
    process.exit(0);
  });
});
