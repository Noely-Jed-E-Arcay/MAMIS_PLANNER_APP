const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const FALLBACK_DATA_DIR = path.join(ROOT, "data");

function resolveDataDirectory() {
  const configuredDir = process.env.DATA_DIR;
  const fallbackDir = FALLBACK_DATA_DIR;
  if (!configuredDir) return fallbackDir;

  const candidate = path.isAbsolute(configuredDir) ? configuredDir : path.resolve(ROOT, configuredDir);

  try {
    fs.mkdirSync(candidate, { recursive: true });
    fs.accessSync(candidate, fs.constants.R_OK | fs.constants.W_OK);
    return candidate;
  } catch (error) {
    console.warn(`DATA_DIR "${configuredDir}" is not writable; using "${fallbackDir}" instead.`);
    try {
      fs.mkdirSync(fallbackDir, { recursive: true });
      return fallbackDir;
    } catch {
      return candidate;
    }
  }
}

const DATA_DIR = resolveDataDirectory();
const DATA_FILE = path.join(DATA_DIR, "server-db.json");
const MAX_BODY = 15 * 1024 * 1024;
const SESSION_SECRET_FILE = path.join(DATA_DIR, ".session-secret");
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SESSION_SECRET_FILE)) {
    fs.writeFileSync(SESSION_SECRET_FILE, crypto.randomBytes(32).toString("hex"));
  }
  return fs.readFileSync(SESSION_SECRET_FILE, "utf8").trim();
}

function signSession(payload) {
  return crypto.createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

function readDatabase() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) return { users: {}, planners: {} };
  try {
    const database = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (!database || typeof database !== "object" || !database.users || !database.planners) {
      throw new Error("Database must contain users and planners.");
    }
    return database;
  } catch (error) {
    throw new Error(`Could not read the planner database: ${error.message}`);
  }
}
function writeDatabase(database) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporaryFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(database, null, 2));
  fs.renameSync(temporaryFile, DATA_FILE);
}
function send(response, status, payload, headers = {}) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(payload));
}
function getToken(request) {
  const header = request.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}
function getUser(request) {
  const token = getToken(request);
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;
  const expectedSignature = signSession(encodedPayload);
  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (!payload.userId || payload.expiresAt < Math.floor(Date.now() / 1000)) return null;
    return readDatabase().users[payload.userId] || null;
  } catch {
    return null;
  }
}
function parseBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) reject(new Error("Request body is too large."));
    });
    request.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error("Request body must be valid JSON.")); }
    });
    request.on("error", reject);
  });
}
function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString("hex") };
}
function passwordMatches(password, record) {
  const candidate = crypto.scryptSync(password, record.salt, 64);
  return crypto.timingSafeEqual(candidate, Buffer.from(record.hash, "hex"));
}
function createSession(userId) {
  const payload = Buffer.from(JSON.stringify({
    userId,
    expiresAt: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  })).toString("base64url");
  return `${payload}.${signSession(payload)}`;
}
function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name };
}
function plannerData(database, userId) {
  return database.planners[userId] || null;
}
function handleApi(request, response, url) {
  response.setHeader("access-control-allow-origin", process.env.CLIENT_ORIGIN || "https://noely-jed-e-arcay.github.io");
  response.setHeader("access-control-allow-headers", "Content-Type, Authorization");
  response.setHeader("access-control-allow-methods", "GET, PUT, POST, OPTIONS");
  if (request.method === "OPTIONS") return send(response, 204, {});

  const database = readDatabase();
  if (request.method === "POST" && url.pathname === "/api/register") {
    return parseBody(request).then((body) => {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const name = String(body.name || "Lovely").trim().slice(0, 80) || "Lovely";
      if (!/^\S+@\S+\.\S+$/.test(email)) return send(response, 400, { error: "Enter a valid email address." });
      if (password.length < 6) return send(response, 400, { error: "Password must be at least 6 characters." });
      if (Object.values(database.users).some((user) => user.email === email)) return send(response, 409, { error: "An account with this email already exists." });
      const id = crypto.randomUUID();
      const passwordRecord = hashPassword(password);
      const user = { id, email, name, ...passwordRecord, createdAt: new Date().toISOString() };
      database.users[id] = user;
      database.planners[id] = {};
      writeDatabase(database);
      return send(response, 201, { user: publicUser(user), token: createSession(id) });
    }).catch((error) => send(response, 400, { error: error.message }));
  }
  if (request.method === "POST" && url.pathname === "/api/login") {
    return parseBody(request).then((body) => {
      const email = String(body.email || "").trim().toLowerCase();
      const user = Object.values(database.users).find((candidate) => candidate.email === email);
      if (!user || !passwordMatches(String(body.password || ""), user)) return send(response, 401, { error: "Email or password is incorrect." });
      return send(response, 200, { user: publicUser(user), token: createSession(user.id) });
    }).catch((error) => send(response, 400, { error: error.message }));
  }
  if (request.method === "POST" && url.pathname === "/api/logout") {
    return send(response, 200, { ok: true });
  }
  if (url.pathname === "/api/me") {
    const user = getUser(request);
    if (!user) return send(response, 401, { error: "Please log in." });
    return send(response, 200, { user: publicUser(user) });
  }
  if (url.pathname === "/api/planner") {
    const user = getUser(request);
    if (!user) return send(response, 401, { error: "Please log in." });
    if (request.method === "GET") return send(response, 200, { data: plannerData(database, user.id) });
    if (request.method === "PUT") {
      return parseBody(request).then((body) => {
        if (!body.data || typeof body.data !== "object") return send(response, 400, { error: "Planner data is required." });
        database.planners[user.id] = body.data;
        writeDatabase(database);
        return send(response, 200, { ok: true });
      }).catch((error) => send(response, 400, { error: error.message }));
    }
  }
  return send(response, 404, { error: "Not found." });
}
function serveStatic(request, response, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.resolve(ROOT, `.${requested}`);
  if (!filePath.startsWith(path.resolve(ROOT)) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return send(response, 404, { error: "Not found." });
  const extensions = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8" };
  response.writeHead(200, { "content-type": extensions[path.extname(filePath)] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(response);
}
const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) return handleApi(request, response, url);
  if (request.method === "GET") return serveStatic(request, response, url);
  return send(response, 405, { error: "Method not allowed." });
});
server.listen(PORT, () => console.log(`Lovely Day Planner server running at http://localhost:${PORT}`));
