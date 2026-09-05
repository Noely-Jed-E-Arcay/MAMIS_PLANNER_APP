const DB_NAME = "LovelyDayPlannerDB",
  DB_VERSION = 7;
const stores = [
  "routines",
  "school",
  "events",
  "activities",
  "notes",
  "goals",
  "habits",
  "reminders",
  "journal",
  "decks",
  "settings",
  "streaks",
  "rewards",
  "notifications",
  "studyTimers",
];
const DEFAULT_REWARDS = {
  Basic: "Choose a small treat",
  Gold: "Watch a movie",
  Sapphire: "Enjoy a favorite snack",
  Ruby: "Take a relaxing break",
  Emerald: "Plan a fun outing",
  Amethyst: "Buy yourself something small",
  Pearl: "Enjoy a special day off",
  Diamond: "Celebrate with a big reward",
};
const STREAK_LEVELS = [
  { name: "Basic", goal: 1 },
  { name: "Gold", goal: 3 },
  { name: "Sapphire", goal: 5 },
  { name: "Ruby", goal: 7 },
  { name: "Emerald", goal: 9 },
  { name: "Amethyst", goal: 11 },
  { name: "Pearl", goal: 13 },
  { name: "Diamond", goal: 15 },
];
const PHILIPPINES_SPECIAL_DAYS = {
  "01-01": { name: "New Year's Day", description: "A national holiday welcoming the new year." },
  "02-24": { name: "People Power Anniversary", description: "A special non-working day commemorating the People Power Revolution." },
  "04-09": { name: "Araw ng Kagitingan", description: "Day of Valor, honoring Filipino and American soldiers who served in World War II." },
  "05-01": { name: "Labor Day", description: "A national holiday honoring Filipino workers." },
  "06-12": { name: "Independence Day", description: "The Philippines celebrates its declaration of independence." },
  "08-21": { name: "Ninoy Aquino Day", description: "A special non-working day remembering Benigno ‘Ninoy’ Aquino Jr." },
  "08-26": { name: "National Heroes Day", description: "A national holiday honoring the country’s heroes." },
  "11-01": { name: "All Saints’ Day", description: "Families remember and honor the saints and loved ones who have passed away." },
  "11-30": { name: "Bonifacio Day", description: "A national holiday honoring revolutionary leader Andres Bonifacio." },
  "12-08": { name: "Feast of the Immaculate Conception", description: "A special non-working day observed by many Filipino Catholics." },
  "12-25": { name: "Christmas Day", description: "A national holiday celebrating Christmas." },
  "12-30": { name: "Rizal Day", description: "A national holiday commemorating Dr. Jose Rizal." },
  "12-31": { name: "Last Day of the Year", description: "A special non-working day for year-end preparations and celebrations." },
};
let studyTimer = {
  routineId: "",
  durationMinutes: 0,
  remaining: 0,
  running: false,
};
let studyTimerInterval;
let db;
let activeAccount;
let authMode = "login";
let remoteHydrating = false;
let remoteSyncTimer;
let reminderAlertTimer;
const ACCOUNT_KEY = "LovelyDayPlannerAccounts";
const SESSION_KEY = "LovelyDayPlannerSession";
const API_BASE = window.PLANNER_CONFIG?.apiBase || "";
const remoteAuthEnabled = location.protocol !== "file:";
function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function philippinesDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
function todayLabel(date = currentDate) {
  const today = philippinesDateKey();
  const label = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${date}T12:00:00`));
  if (date === today) return `Today, ${label}`;
  if (date === dateShift(today, -1)) return `Yesterday, ${label}`;
  if (date === dateShift(today, 1)) return `Tomorrow, ${label}`;
  const diff = Math.round((new Date(`${date}T12:00:00`) - new Date(`${today}T12:00:00`)) / 86400000);
  return diff > 0 ? `${diff} days left, ${label}` : `${Math.abs(diff)} days ago, ${label}`;
}
let currentDate = philippinesDateKey();
let viewMonth = new Date(currentDate + "T12:00:00");
let journalSearch = "";
let activeJournalEntry = null;
let journalPageProperties = [];
let journalPageComments = [];
let journalPageImages = [];
let journalImageRotationTimer;
window.__soundSettings = { timer: "timer", alert: "reminder" };
const JOURNAL_PROPERTY_TYPES = {
  text: { name: "Text", icon: "Aa" },
  mood: { name: "Mood", icon: "😊" },
  tags: { name: "Tags", icon: "#" },
  location: { name: "Location", icon: "📍" },
};
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[c],
  );
function openDB() {
  return new Promise((resolve, reject) => {
    const databaseName = activeAccount?.dbName || DB_NAME;
    const r = indexedDB.open(databaseName, DB_VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      stores.forEach((s) => {
        if (!d.objectStoreNames.contains(s))
          d.createObjectStore(s, { keyPath: "id" });
      });
    };
    r.onsuccess = () => {
      db = r.result;
      resolve();
    };
    r.onerror = () => reject(r.error);
  });
}
function all(store) {
  return new Promise((res, rej) => {
    const r = db.transaction(store).objectStore(store).getAll();
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function put(store, obj) {
  return new Promise((res, rej) => {
    const r = db.transaction(store, "readwrite").objectStore(store).put(obj);
    r.onsuccess = () => {
      scheduleRemoteSync();
      res(obj);
    };
    r.onerror = () => rej(r.error);
  });
}
function del(store, id) {
  return new Promise((res, rej) => {
    const r = db.transaction(store, "readwrite").objectStore(store).delete(id);
    r.onsuccess = () => {
      scheduleRemoteSync();
      res();
    };
    r.onerror = () => rej(r.error);
  });
}
function apiUrl(pathname) {
  return `${API_BASE}${pathname}`;
}
async function apiRequest(pathname, options = {}) {
  const headers = { "content-type": "application/json", ...(options.headers || {}) };
  if (activeAccount?.token) headers.authorization = `Bearer ${activeAccount.token}`;
  const response = await fetch(apiUrl(pathname), { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `Planner server returned HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return body;
}
function scheduleRemoteSync() {
  if (!remoteAuthEnabled || !activeAccount?.token || remoteHydrating) return;
  clearTimeout(remoteSyncTimer);
  remoteSyncTimer = setTimeout(syncRemotePlanner, 500);
}
async function syncRemotePlanner() {
  if (!remoteAuthEnabled || !activeAccount?.token || remoteHydrating) return;
  try {
    const payload = JSON.stringify({ data: await readData() });
    if (payload.length > 45 * 1024 * 1024) {
      toast("Could not sync: planner media is larger than 45 MB.");
      return;
    }
    await apiRequest("/api/planner", { method: "PUT", body: payload });
  } catch (error) {
    toast(`Could not sync planner changes${error.status ? ` (HTTP ${error.status})` : ""}: ${error.message}`);
  }
}
async function loadRemotePlanner() {
  if (!activeAccount?.token) return;
  const { data } = await apiRequest("/api/planner");
  if (!data) return;
  remoteHydrating = true;
  try {
    for (const store of stores) {
      for (const item of await all(store)) await del(store, item.id);
      for (const item of data[store] || []) await put(store, item);
    }
  } finally {
    remoteHydrating = false;
  }
}
function ensureAudioContext() {
  try {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    if (!window.__plannerAudioCtx) window.__plannerAudioCtx = new AudioCtor();
    return window.__plannerAudioCtx;
  } catch {
    return null;
  }
}
function playSound(type = "achievement") {
  try {
    const selectedTone = type === "timer" ? window.__soundSettings.timer : window.__soundSettings.alert;
    if (selectedTone === "off") return;
    const customSound = type === "timer" ? window.__soundSettings.timerFile : window.__soundSettings.alertFile;
    if (customSound) {
      const audio = new Audio(customSound);
      audio.volume = 0.7;
      audio.play().catch(() => {});
      return;
    }
    const ctx = ensureAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const preset = {
      achievement: { frequencies: [440, 660, 880], type: "triangle", duration: 0.18, volume: 0.18, repeats: 1, gap: 0.08 },
      streak: { frequencies: [392, 523, 659, 784], type: "sine", duration: 0.22, volume: 0.2, repeats: 1, gap: 0.08 },
      timer: { frequencies: [740, 640, 520], type: "square", duration: 0.28, volume: 0.38, repeats: 8, gap: 0.12 },
      reminder: { frequencies: [620, 770, 980], type: "sawtooth", duration: 0.32, volume: 0.4, repeats: 10, gap: 0.16 },
    }[type] || { frequencies: [523, 698], type: "triangle", duration: 0.18, volume: 0.18, repeats: 1, gap: 0.08 };
    if (selectedTone === "soft") Object.assign(preset, { frequencies: [523, 659], type: "sine", repeats: 1, volume: 0.16 });
    if (selectedTone === "bright") Object.assign(preset, { frequencies: [659, 784, 988], type: "triangle", repeats: 2, volume: 0.2 });
    for (let repeat = 0; repeat < preset.repeats; repeat++) {
      const start = ctx.currentTime + repeat * (preset.duration + preset.gap);
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      gainNode.gain.setValueAtTime(0.0001, start);
      gainNode.gain.exponentialRampToValueAtTime(preset.volume, start + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, start + preset.duration);
      oscillator.type = preset.type;
      preset.frequencies.forEach((frequency, index) => oscillator.frequency.setValueAtTime(frequency, start + index * (preset.duration / preset.frequencies.length)));
      oscillator.start(start);
      oscillator.stop(start + preset.duration + 0.05);
    }
  } catch {
    // Audio is optional and must never interrupt planner actions.
  }
}
function specialDayFor(date) {
  return PHILIPPINES_SPECIAL_DAYS[date.slice(5)] || null;
}
function eventDaysForMonth(data) {
  const holidayDates = new Set(), eventDates = new Set(), eventStickers = new Map();
  for (let day = 1; day <= 31; day++) {
    const date = `${viewMonth.getFullYear()}-${String(viewMonth.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (specialDayFor(date)) holidayDates.add(date);
  }
  (data.events || []).forEach((event) => {
    eventDates.add(event.date);
    if (!eventStickers.has(event.date)) eventStickers.set(event.date, event.icon || "🎉");
  });
  return { holidayDates, eventDates, eventStickers };
}
function renderSpecialDay(data) {
  const specialDay = specialDayFor(currentDate);
  const customEvents = [
    ...(data.events || []).filter((item) => item.date === currentDate).map((item) => item.title),
    ...data.school.filter((item) => item.date === currentDate).map((item) => item.subject),
    ...data.routines.filter((item) => item.date === currentDate).map((item) => item.title),
    ...data.activities.filter((item) => item.due === currentDate).map((item) => item.title),
  ];
  const notice = $("#specialDayNotice");
  if (!notice) return;
  notice.innerHTML = specialDay
    ? `<strong>${esc(fmt(currentDate))} · ${esc(specialDay.name)}</strong><small>${esc(specialDay.description)} <b>Holiday</b></small>${customEvents.length ? `<small>Events: ${esc(customEvents.join(" · "))}</small>` : ""}<button class="small-button" data-add="event">＋ Add event</button>`
    : customEvents.length
      ? `<strong>${esc(fmt(currentDate))}</strong><small>${customEvents.length} event${customEvents.length === 1 ? "" : "s"}: ${esc(customEvents.join(" · "))}</small><button class="small-button" data-add="event">＋ Add event</button>`
      : `<strong>${esc(fmt(currentDate))}</strong><small>No Philippine holiday or special event recorded for this date.</small><button class="small-button" data-add="event">＋ Add event</button>`;
  notice.classList.toggle("holiday", Boolean(specialDay));
}
function triggerSoundOnUserInteraction() {
  ensureAudioContext();
}
async function checkReminderAlerts() {
  try {
    const data = await readData();
    const now = Date.now();
    const alertable = [
      ...(data.reminders || []).map((item) => ({ item, store: "reminders", date: item.date, time: item.time })),
      ...(data.routines || []).map((item) => ({ item, store: "routines", date: item.date, time: item.time })),
      ...(data.activities || []).map((item) => ({ item, store: "activities", date: item.due, time: item.time })),
    ];
    for (const entry of alertable.filter(({ item, date, time }) => date && time && !item.notifiedAt)) {
      const when = new Date(`${entry.date}T${entry.time}:00`).getTime();
      const newlyCreated = entry.item.createdAt && now - entry.item.createdAt < 30 * 60 * 1000;
      if (!newlyCreated && when > now && when - now <= 30 * 60 * 1000) {
        playSound("reminder");
        entry.item.notifiedAt = now;
        await put(entry.store, entry.item);
        toast(`Due in 30 minutes: ${entry.item.title} 🔔`, true);
      }
    }
  } catch (error) {
    console.warn("Reminder alert check failed:", error);
  }
}
function startReminderChecks() {
  if (!reminderAlertTimer) reminderAlertTimer = setInterval(checkReminderAlerts, 15000);
}
function getAccounts() {
  return JSON.parse(localStorage.getItem(ACCOUNT_KEY) || "[]");
}
function saveAccounts(accounts) {
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(accounts));
}
async function hashPassword(password, salt) {
  const bytes = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function authenticate() {
  const email = $("#authEmail").value.trim().toLowerCase();
  const password = $("#authPassword").value;
  const name = $("#authName").value.trim();
  const accounts = getAccounts();
  setAuthMessage(authMode === "register" ? "Creating your account..." : "Logging you in...", false);
  if (remoteAuthEnabled) {
    const result = await apiRequest(authMode === "register" ? "/api/register" : "/api/login", {
      method: "POST",
      body: JSON.stringify({ email, password, name }),
    });
    activeAccount = { ...result.user, token: result.token, dbName: `${DB_NAME}-remote-${result.user.id}` };
    localStorage.setItem(SESSION_KEY, JSON.stringify({ id: activeAccount.id, token: activeAccount.token }));
    return true;
  }
  if (authMode === "register") {
    if (accounts.some((account) => account.email === email)) throw new Error("An account with this email already exists.");
    const salt = uid();
    activeAccount = { id: uid(), email, name: name || "Lovely", salt, dbName: `${DB_NAME}-${uid()}`, passwordHash: await hashPassword(password, salt) };
    saveAccounts([...accounts, activeAccount]);
  } else {
    const account = accounts.find((candidate) => candidate.email === email);
    if (!account || account.passwordHash !== await hashPassword(password, account.salt)) throw new Error("Email or password is incorrect.");
    activeAccount = account;
  }
  localStorage.setItem(SESSION_KEY, activeAccount.id);
  return true;
}
function setAuthMessage(message, isError = true) {
  const element = $("#authMessage");
  element.textContent = message;
  element.style.color = isError ? "var(--pink-dark)" : "var(--green)";
}
function setAuthMode(mode) {
  authMode = mode;
  $$("[data-auth-mode]").forEach((button) => button.classList.toggle("active", button.dataset.authMode === mode));
  $("#authNameField").classList.toggle("hidden", mode !== "register");
  $("#authSubmit").innerHTML = mode === "register" ? "Create account <span>→</span>" : "Log in <span>→</span>";
  $("#authPassword").autocomplete = mode === "register" ? "new-password" : "current-password";
  setAuthMessage("");
}
async function initializeAccount() {
  if (remoteAuthEnabled) {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (session?.token) {
      try {
        const result = await apiRequest("/api/me", { headers: { authorization: `Bearer ${session.token}` } });
        activeAccount = { ...result.user, token: session.token, dbName: `${DB_NAME}-remote-${result.user.id}` };
        return true;
      } catch {
        localStorage.removeItem(SESSION_KEY);
      }
    }
    $("#authConfigNote").textContent = "Create an account to keep your planner on this server and access it from other devices.";
  }
  const sessionId = localStorage.getItem(SESSION_KEY);
  activeAccount = remoteAuthEnabled ? null : getAccounts().find((account) => account.id === sessionId);
  $("#localModeButton").classList.remove("hidden");
  return Boolean(activeAccount);
}
function showPlanner() {
  $("#authScreen").classList.add("hidden");
  $("#accountEmail").textContent = activeAccount?.name || "Guest mode";
  $("#accountButton").title = activeAccount?.email ? `Signed in as ${activeAccount.email}. Sign out` : "Sign out";
}
async function applyTheme(theme = "light", persist = false) {
  document.body.dataset.theme = theme;
  if ($("#themeSelect")) $("#themeSelect").value = theme;
  if (persist) {
    localStorage.setItem("LovelyDayPlannerTheme", theme);
    await saveSettingPatch({ theme });
  }
}
async function saveSettingPatch(patch) {
  if (!db) return;
  const settings = (await all("settings")).find((item) => item.id === "main") || { id: "main" };
  await put("settings", { ...settings, ...patch, id: "main" });
}
function renderProfile(settings) {
  $("#avatarIcon").textContent = settings.avatar || "🌸";
  $("#profileImage").src = settings.profileImage || "";
  $("#profileImage").classList.toggle("hidden", !settings.profileImage);
  $("#avatarIcon").classList.toggle("hidden", Boolean(settings.profileImage));
  $("#bannerImage").src = settings.bannerImage || "";
  $("#bannerImage").classList.toggle("hidden", !settings.bannerImage);
}
async function removeWebDevelopmentSchedule() {
  for (const item of await all("school"))
    if (item.subject === "Web Development") await del("school", item.id);
}
function toast(t, celebrate = false) {
  const x = $("#toast");
  x.textContent = t;
  x.classList.toggle("celebration", celebrate);
  x.classList.add("show");
  clearTimeout(window.__toast);
  window.__toast = setTimeout(() => x.classList.remove("show"), 1800);
}
function fmt(d) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(d + "T12:00:00"));
}
function dateShift(d, n) {
  const x = new Date(d + "T12:00:00");
  x.setDate(x.getDate() + n);
  return localDateKey(x);
}
function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
async function readData() {
  const vals = await Promise.all(stores.map(all));
  return Object.fromEntries(stores.map((s, i) => [s, vals[i]]));
}
function show(page) {
  $$(".page").forEach((x) => x.classList.toggle("active", x.id === page));
  const nextPage = $(`#${CSS.escape(page)}`);
  nextPage?.classList.remove("page-enter");
  if (nextPage) {
    void nextPage.offsetWidth;
    nextPage.classList.add("page-enter");
  }
  $$(".nav,.mobile-nav button").forEach((x) =>
    x.classList.toggle(
      "active",
      x.dataset.page === page ||
        (page === "journal-editor" && x.dataset.page === "journal"),
    ),
  );
  const titles = {
    dashboard: `Good morning, ${window.plannerName || "Lovely"}!`,
    calendar: "Your Calendar ♡",
    routine: "Your Daily Routine 🌷",
    activities: "School Activities & Tasks ✨",
    notes: "Your Notes 📝",
    goals: "Your Goals ♡",
    habits: "Your Habit Tracker 🌱",
    reminders: "Your Reminders 🔔",
    journal: "Your Journal 💗",
    "journal-editor": "Daily Journal Entry",
    rewards: "Your Reward Station 🎀",
    settings: "Planner Settings ⚙",
  };
  $("#pageTitle").innerHTML =
    esc(titles[page] || titles.dashboard) +
    (page === "dashboard" ? " <span>☀️</span>" : "");
  window.scrollTo({ top: 0, behavior: "smooth" });
  renderPage(page, window.__data);
}
function monthCells(date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const start = first.getDay();
  const count = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return { start, count };
}
function calendarHTML(date, selected, items, holidayDates = new Set(), eventDates = new Set(), today = philippinesDateKey(), eventStickers = new Map(), dayStats = new Map()) {
  const { start, count } = monthCells(date);
  const prevCount = new Date(date.getFullYear(), date.getMonth(), 0).getDate();
  let h = "";
  for (let i = 0; i < 42; i++) {
    const n = i - start + 1;
    let day = n,
      muted = false,
      real;
    if (n < 1) {
      day = prevCount + n;
      muted = true;
      real = new Date(date.getFullYear(), date.getMonth() - 1, day);
    } else if (n > count) {
      day = n - count;
      muted = true;
      real = new Date(date.getFullYear(), date.getMonth() + 1, day);
    } else real = new Date(date.getFullYear(), date.getMonth(), day);
    const ds = localDateKey(real);
    const has = items.has(ds);
    const sticker = eventStickers.get(ds);
    const stats = dayStats.get(ds);
    const statsLabel = stats ? `${stats.completed}/${stats.total} completed tasks/schedules` : "No tasks or schedules";
    h += `<span class="${muted ? "muted " : ""}${ds === selected ? "selected " : ""}${ds === today ? "today-date " : ""}${has ? "has-item " : ""}${holidayDates.has(ds) ? "holiday-date " : ""}${eventDates.has(ds) ? "event-date" : ""}" data-calendar-date="${ds}" title="${esc(specialDayFor(ds)?.name || (eventDates.has(ds) ? "Planner event" : ""))} · ${esc(statsLabel)}">${sticker ? `<i class="calendar-sticker" aria-hidden="true">${esc(sticker)}</i>` : ""}${day}${stats?.total ? `<small class="calendar-count" aria-hidden="true">${stats.completed}/${stats.total}</small>` : ""}</span>`;
  }
  return h;
}
function progressPercent(done, total) {
  return total ? Math.round((done / total) * 100) : 0;
}
function getActivityStudyMinutes(data) {
  return data.routines
    .filter((x) => x.date === currentDate && x.category === "study")
    .reduce((n, x) => n + (Number(x.minutes) || 45), 0);
}
async function loadStudyTimer() {
  const saved = (await all("studyTimers")).find((item) => item.id === "main");
  if (saved) {
    studyTimer = { ...studyTimer, ...saved, running: false };
    return;
  }
  const legacy = JSON.parse(localStorage.getItem("LovelyDayPlannerStudyTimer") || "null");
  if (legacy) {
    studyTimer = { ...studyTimer, ...legacy, running: false };
    await put("studyTimers", { id: "main", ...studyTimer });
    localStorage.removeItem("LovelyDayPlannerStudyTimer");
  }
}
function saveStudyTimer() {
  if (db) put("studyTimers", { id: "main", ...studyTimer });
}
function formatTimer(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
function renderStudyTimer(data) {
  const routines = data.routines.filter((x) => x.date === currentDate && x.category === "study");
  const select = $("#studyTimerSelect");
  if (!select) return;
  select.innerHTML = routines.length
    ? routines.map((x) => `<option value="${esc(x.id)}">${esc(x.title)} · ${Number(x.minutes) || 45} min</option>`).join("")
    : `<option value="">No study schedules today</option>`;
  const selected = routines.find((x) => x.id === studyTimer.routineId) || routines[0];
  if (!selected) {
    clearInterval(studyTimerInterval);
    studyTimer.routineId = "";
    studyTimer.durationMinutes = 0;
    studyTimer.remaining = 0;
    studyTimer.running = false;
  } else {
    const durationMinutes = Number(selected.minutes) || 45;
    const durationChanged = studyTimer.routineId !== selected.id || studyTimer.durationMinutes !== durationMinutes;
    if (durationChanged || !studyTimer.remaining) {
      clearInterval(studyTimerInterval);
      studyTimer.running = false;
      studyTimer.durationMinutes = durationMinutes;
      studyTimer.remaining = durationMinutes * 60;
    }
    studyTimer.routineId = selected.id;
  }
  select.value = studyTimer.routineId;
  $("#studyTimerDisplay").textContent = formatTimer(studyTimer.remaining);
  $("#studyTimerStatus").textContent = studyTimer.running ? "Study timer running" : routines.length ? "Ready to study" : "Add a study schedule first";
  $("#studyTimerStart").textContent = studyTimer.running ? "Pause" : "Start";
  $("#studyTimerStart").disabled = !selected;
  $("#studyTimerReset").disabled = !selected;
  saveStudyTimer();
  if (studyTimer.running) {
    studyTimer.running = false;
    startStudyTimer();
  }
}
function startStudyTimer() {
  if (studyTimer.running) {
    studyTimer.running = false;
    clearInterval(studyTimerInterval);
  } else if (studyTimer.remaining > 0) {
    studyTimer.running = true;
    clearInterval(studyTimerInterval);
    studyTimerInterval = setInterval(() => {
      studyTimer.remaining = Math.max(0, studyTimer.remaining - 1);
      if (!studyTimer.remaining) {
        studyTimer.running = false;
        clearInterval(studyTimerInterval);
        toast("Study session complete ♡");
        grantStudyBreakReward();
        playSound("timer");
      }
      saveStudyTimer();
      $("#studyTimerDisplay").textContent = formatTimer(studyTimer.remaining);
      $("#studyTimerStatus").textContent = studyTimer.running ? "Study timer running" : "Study session complete";
      $("#studyTimerStart").textContent = studyTimer.running ? "Pause" : "Start";
    }, 1000);
  }
  saveStudyTimer();
  $("#studyTimerStart").textContent = studyTimer.running ? "Pause" : "Start";
  $("#studyTimerStatus").textContent = studyTimer.running ? "Study timer running" : "Ready to study";
}
function completedRequirementCount(data, date) {
  return (
    data.routines.filter((x) => x.date === date && x.done).length +
    data.activities.filter((x) => x.due === date && x.done).length
  );
}
function weekStartKey(date) {
  const start = new Date(`${date}T12:00:00`);
  start.setDate(start.getDate() - start.getDay() + 1);
  return localDateKey(start);
}
function levelForCompletions(count) {
  return [...STREAK_LEVELS].reverse().find((level) => count >= level.goal);
}
function completedDates(data) {
  return new Set(
    (data.streaks || [])
      .filter((x) => x.active && x.requirementCount > 0)
      .map((x) => x.date),
  );
}
async function syncStreak(date, data) {
  const requirementCount = completedRequirementCount(data, date);
  if (requirementCount) {
    await put("streaks", {
      id: date,
      date,
      active: true,
      requirementCount,
      updated: Date.now(),
    });
    const dailyRewardId = `daily-${date}`;
    const dailyLevel = levelForCompletions(requirementCount);
    const dailyRewards = { ...DEFAULT_REWARDS, ...(data.settings.find((x) => x.id === "main")?.rewards || {}) };
    const existingDailyReward = (await all("rewards")).find((x) => x.id === dailyRewardId);
    await put("rewards", {
      ...(existingDailyReward || {}),
      id: dailyRewardId,
      type: "daily",
      date,
      title: dailyLevel ? `${dailyLevel.name} daily reward` : "Daily reward",
      description: dailyLevel ? dailyRewards[dailyLevel.name] : "Take a 15-minute break",
      requirementCount,
      unlockedAt: existingDailyReward?.unlockedAt || Date.now(),
      claimed: existingDailyReward?.claimed || false,
    });
    const weekKey = weekStartKey(date);
    const weekRewardId = `weekly-${weekKey}`;
    if (!(await all("rewards")).some((x) => x.id === weekRewardId)) {
      await put("rewards", {
        id: weekRewardId,
        type: "weekly",
        week: weekKey,
        title: "Weekly reward",
        description: "Enjoy a special weekly break",
        requirementCount,
        unlockedAt: Date.now(),
        claimed: false,
      });
    }
  } else {
    await del("streaks", date);
    await del("rewards", `daily-${date}`);
  }
}
function streakDays(data, baseDate = currentDate) {
  const dates = completedDates(data);
  let d = baseDate,
    count = 0;
  while (dates.has(d)) {
    count++;
    d = dateShift(d, -1);
  }
  return count;
}
function streakDaysBeforeToday(data, baseDate = currentDate) {
  const dates = completedDates(data);
  let date = dateShift(baseDate, -1);
  let count = 0;
  while (dates.has(date)) {
    count++;
    date = dateShift(date, -1);
  }
  return count;
}
function renderMonth(data) {
  const itemDates = new Set();
  data.routines.forEach((x) => itemDates.add(x.date));
  data.school.forEach((x) => itemDates.add(x.date));
  data.activities.forEach((x) => itemDates.add(x.due));
  (data.events || []).forEach((x) => itemDates.add(x.date));
  const { holidayDates, eventDates, eventStickers } = eventDaysForMonth(data);
  const dayStats = new Map();
  [...data.routines, ...data.activities.map((item) => ({ ...item, date: item.due }))].forEach((item) => {
    const stats = dayStats.get(item.date) || { total: 0, completed: 0 };
    stats.total += 1;
    if (item.done) stats.completed += 1;
    dayStats.set(item.date, stats);
  });
  $("#monthLabel").textContent = viewMonth.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const today = philippinesDateKey();
  $("#monthGrid").innerHTML = calendarHTML(viewMonth, currentDate, itemDates, holidayDates, eventDates, today, eventStickers, dayStats);
  $("#largeCalendar").innerHTML =
    `<div class="large-month-head"><button class="soft-button" id="largePrev">‹</button><h3>${viewMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h3><button class="soft-button" id="largeNext">›</button></div><div class="weekdays"><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div><div class="large-month-grid">${calendarHTML(viewMonth, currentDate, itemDates, holidayDates, eventDates, today, eventStickers, dayStats).replaceAll("<span ", "<div ").replaceAll("</span>", "</div>")}</div>`;
}
function renderStreak(data) {
  const today = philippinesDateKey();
  const selectedDate = currentDate;
  $("#streakTodayLabel").textContent = todayLabel(selectedDate);
  const dates = completedDates(data);
  const activeToday = dates.has(selectedDate);
  const streak = activeToday ? streakDays(data, selectedDate) : streakDaysBeforeToday(data, selectedDate);
  const completedTotal =
    data.routines.filter((x) => x.done).length +
    data.activities.filter((x) => x.done).length;
  const completedToday = completedRequirementCount(data, selectedDate);
  const rewards = {
    ...DEFAULT_REWARDS,
    ...(data.settings.find((x) => x.id === "main")?.rewards || {}),
  };
  const settings = data.settings.find((x) => x.id === "main") || { id: "main" };
  const currentLevel = [...STREAK_LEVELS]
    .reverse()
    .find((level) => completedToday >= level.goal);
  const nextLevel = STREAK_LEVELS.find((level) => completedToday < level.goal);
  const progressStart = currentLevel?.goal || 0;
  const progressEnd = nextLevel?.goal || progressStart + 1;
  const levelProgress = nextLevel
    ? Math.min(
        100,
        Math.round(
          ((completedToday - progressStart) / (progressEnd - progressStart)) *
            100,
        ),
      )
    : 100;
  $("#streakLevel").textContent = currentLevel?.name || "Getting started";
  $(".flame-ring").className = `flame-ring aura-${(currentLevel?.name || "starter").toLowerCase()}`;
  $(".flame-ring").textContent = "🌼";
  $("#streakTotal").textContent = `${completedToday} completed`;
  $("#streakProgress").style.width = `${levelProgress}%`;
  document.querySelectorAll(".streak-levels [data-level]").forEach((item) => {
    item.classList.toggle("current", item.dataset.level === currentLevel?.name);
  });
  $("#streakNextLevel").textContent = nextLevel
    ? `${Math.max(0, nextLevel.goal - completedToday)} more completed to reach ${nextLevel.name}`
    : "Highest milestone reached";
  $("#streakReward").textContent = completedToday
    ? "Reward: Take a relaxing break"
    : "Complete a task today to unlock your reward";
  if (selectedDate === today && currentLevel && (settings.rewardAlertDate !== today || currentLevel.goal > (Number(settings.rewardAlertLevel) || 0))) {
    playSound("streak");
    toast(`🎀 ${currentLevel.name} unlocked! Claim your reward: ${rewards[currentLevel.name]}`);
    put("settings", { ...settings, rewardAlertDate: today, rewardAlertLevel: currentLevel.goal });
  }
  const days = [];
  const base = new Date(selectedDate + "T12:00:00");
  base.setDate(base.getDate() - 6);
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const ds = localDateKey(d);
    const completed = dates.has(ds);
    days.push(
      `<div class="day-chip ${ds === selectedDate ? "today" : ""} ${completed ? "active" : ""}"><span>${d.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 2)}</span><div class="day-circle">${completed ? "🔥" : d.getDate()}</div></div>`,
    );
  }
  $("#streakWeek").innerHTML = days.join("");
  $("#streakCountLabel").textContent = `${streak} day`;
  $("#streakQuestions").textContent = activeToday
    ? "Streak active"
    : streak
      ? `${streak} day streak · Not activated today`
      : "Complete a task to start";
  $("#streakReward").textContent = activeToday
    ? "Reward: Take a relaxing break"
    : streak
      ? "Your streak is waiting for today’s task"
      : "Complete a task today to unlock your reward";
}
function renderRewardStation(data) {
  const completedTotal = completedRequirementCount(data, currentDate);
  const rewards = { ...DEFAULT_REWARDS, ...(data.settings.find((x) => x.id === "main")?.rewards || {}) };
  const rewardRecords = data.rewards || [];
  const claimed = new Set(rewardRecords.filter((x) => x.claimed).map((x) => x.id));
  const milestoneCards = STREAK_LEVELS.map((level) => {
    const unlocked = completedTotal >= level.goal;
    const isClaimed = claimed.has(`level-${level.name}`);
    return `<article class="reward-card ${unlocked ? "unlocked" : "locked"}"><div class="reward-icon">${unlocked ? "🎀" : "🔒"}</div><div><h3>${esc(level.name)} reward</h3><p>${esc(rewards[level.name])}</p><small>${unlocked ? `${level.goal} completions reached` : `Unlock at ${level.goal} completions`}</small></div><button class="small-button" data-claim-reward="level-${level.name}" ${!unlocked || isClaimed ? "disabled" : ""}>${isClaimed ? "Claimed" : "Claim reward"}</button></article>`;
  }).join("");
  const breakRewards = rewardRecords.filter((x) => x.type === "break").sort((a, b) => b.unlockedAt - a.unlockedAt);
  const breakCards = breakRewards.length ? breakRewards.map((reward) => `<article class="reward-card unlocked"><div class="reward-icon">🌷</div><div><h3>${esc(reward.title)}</h3><p>${esc(reward.description)}</p><small>Earned ${esc(new Date(reward.unlockedAt).toLocaleDateString())}</small></div><button class="small-button" data-claim-reward="${esc(reward.id)}" ${reward.claimed ? "disabled" : ""}>${reward.claimed ? "Claimed" : "Claim break"}</button></article>`).join("") : `<div class="empty">Finish a study timer session to earn a break reward 🌷</div>`;
  const dailyReward = rewardRecords.find((x) => x.type === "daily" && x.date === currentDate);
  const dailyCard = dailyReward ? `<article class="reward-card unlocked"><div class="reward-icon">🌸</div><div><h3>${esc(dailyReward.title)} · ${esc(fmt(currentDate))}</h3><p>${esc(dailyReward.description)}</p><small>${dailyReward.requirementCount} completed today</small></div><button class="small-button" data-claim-reward="${esc(dailyReward.id)}" ${dailyReward.claimed ? "disabled" : ""}>${dailyReward.claimed ? "Claimed" : "Claim today"}</button></article>` : `<div class="empty">Complete a task or routine on ${esc(fmt(currentDate))} to unlock today’s reward 🌸</div>`;
  const currentWeek = weekStartKey(currentDate);
  const weeklyReward = rewardRecords.find((x) => x.type === "weekly" && x.week === currentWeek);
  const weeklyCard = weeklyReward ? `<article class="reward-card unlocked"><div class="reward-icon">🎁</div><div><h3>${esc(weeklyReward.title)}</h3><p>${esc(weeklyReward.description)}</p><small>Week of ${esc(fmt(currentWeek))}</small></div><button class="small-button" data-claim-reward="${esc(weeklyReward.id)}" ${weeklyReward.claimed ? "disabled" : ""}>${weeklyReward.claimed ? "Claimed" : "Claim weekly"}</button></article>` : `<div class="empty">Complete a task this week to unlock a weekly reward 🎁</div>`;
  $("#rewardMilestones").innerHTML = milestoneCards;
  $("#rewardDateLabel").textContent = fmt(currentDate);
  $("#rewardDaily").innerHTML = dailyCard;
  $("#rewardWeekly").innerHTML = weeklyCard;
  $("#rewardBreaks").innerHTML = breakCards;
}
function notificationItems(data) {
  const items = [
    ...data.routines
      .filter((item) => item.done && item.date)
      .map((item) => ({
        date: item.date,
        time: item.updated || 0,
        icon: "✓",
        kind: "Completed routine",
        title: item.title,
        description: item.description || "Routine completed",
      })),
    ...data.activities
      .filter((item) => item.done && item.due)
      .map((item) => ({
        date: item.due,
        time: item.updated || 0,
        icon: "✓",
        kind: "Completed task",
        title: item.title,
        description: item.description || `${item.type || "Task"} completed`,
      })),
    ...(data.streaks || [])
      .filter((item) => item.active && item.requirementCount > 0 && item.date)
      .map((item) => ({
        date: item.date,
        time: item.updated || 0,
        icon: "🌼",
        kind: "Achievement",
        title: "Daily streak continued",
        description: `${item.requirementCount} planner ${item.requirementCount === 1 ? "item" : "items"} completed`,
      })),
    ...(data.rewards || [])
      .filter((item) => item.unlockedAt || item.claimedAt)
      .map((item) => ({
        date:
          item.date ||
          item.week ||
          localDateKey(new Date(item.claimedAt || item.unlockedAt)),
        time: item.claimedAt || item.unlockedAt || 0,
        icon: item.claimed ? "🎀" : "🎁",
        kind: item.claimed ? "Reward claimed" : "Reward unlocked",
        title: item.title,
        description: item.description || "A reward is ready for you",
      })),
  ];
  return items
    .filter((item) => item.date)
    .sort((a, b) => `${b.date}-${b.time}`.localeCompare(`${a.date}-${a.time}`));
}
function renderNotifications(data) {
  const items = notificationItems(data);
  const groups = items.reduce((result, item) => {
    (result[item.date] ||= []).push(item);
    return result;
  }, {});
  const content = Object.entries(groups)
    .map(
      ([date, entries]) =>
        `<section class="notification-group"><h3>${esc(fmt(date))}</h3><div class="notification-list">${entries
          .map(
            (item) =>
              `<article class="notification-item"><span class="notification-item-icon">${item.icon}</span><div><strong>${esc(item.title)}</strong><small>${esc(item.kind)} · ${esc(item.description)}</small></div></article>`,
          )
          .join("")}</div></section>`,
    )
    .join("");
  $("#modalBody").innerHTML = `<div class="notification-header"><div><p class="eyebrow">YOUR ACTIVITY</p><h2>Notifications</h2><p>Achievements, rewards, and completed work, organized by date.</p></div><span class="notification-count">${items.length}</span></div>${content || '<div class="empty">Complete a task or claim a reward to see it here ♡</div>'}`;
  $("#modal").classList.add("notification-open");
  $("#modal").classList.remove("hidden");
  $(".modal-box").classList.add("notification-modal");
}
async function syncDeckProgress(data) {
  const completionRate = (items) => {
    const total = items.length;
    return total ? Math.round((items.filter((item) => item.done).length / total) * 100) : 0;
  };
  const today = philippinesDateKey();
  const recentDates = new Set();
  for (let offset = 0; offset < 7; offset++) recentDates.add(dateShift(today, -offset));
  const completedDatesThisWeek = [...completedDates(data)].filter((date) => recentDates.has(date)).length;
  const studyRoutines = data.routines.filter((item) => item.category === "study");
  const settings = data.settings.find((item) => item.id === "main") || {};
  const profileFields = [settings.name, settings.avatar, settings.profileImage, settings.bannerImage].filter(Boolean).length;
  const decks = [
    { id: "school", name: "School", progress: completionRate([...data.routines, ...data.activities]), icon: "🏠" },
    { id: "streak", name: "Streak", progress: Math.round((completedDatesThisWeek / 7) * 100), icon: "🌼" },
    { id: "study", name: "Study", progress: completionRate(studyRoutines), icon: "📁" },
    { id: "profile", name: "Profile", progress: Math.round((profileFields / 4) * 100), icon: "🌸" },
  ];
  data.decks = decks;
  await Promise.all(decks.map((deck) => put("decks", { ...deck, updated: Date.now() })));
}
function showCongratulations(reward) {
  const overlay = $("#congratulations");
  if (!overlay) return;
  $("#congratulationsReward").textContent = reward.description || "Enjoy your reward!";
  overlay.classList.remove("hidden");
  clearTimeout(window.__congratulationsTimer);
  window.__congratulationsTimer = setTimeout(() => overlay.classList.add("hidden"), 3200);
}
async function grantStudyBreakReward() {
  await put("rewards", { id: `break-${Date.now()}`, type: "break", title: "Study break", description: "Take a 15-minute break", unlockedAt: Date.now(), claimed: false });
  toast("Study complete! You earned a break reward 🌷", true);
}
async function claimReward(id) {
  let reward = (await all("rewards")).find((x) => x.id === id);
  if (!reward && id.startsWith("level-")) {
    const levelName = id.replace("level-", "");
    const level = STREAK_LEVELS.find((x) => x.name === levelName);
    const data = await readData();
    const completedTotal = completedRequirementCount(data, currentDate);
    const rewards = { ...DEFAULT_REWARDS, ...(data.settings.find((x) => x.id === "main")?.rewards || {}) };
    if (!level || completedTotal < level.goal) return;
    reward = { id, type: "milestone", title: `${level.name} reward`, description: rewards[level.name], unlockedAt: Date.now(), claimed: false };
    await put("rewards", reward);
  }
  if (!reward || reward.claimed) return;
  reward.claimed = true;
  reward.claimedAt = Date.now();
  await put("rewards", reward);
  playSound("achievement");
  await render();
  showCongratulations(reward);
  toast(`Reward claimed: ${reward.description || "Enjoy it!"} 🎀`, true);
}
function renderDashboard(data) {
  const routines = data.routines.filter((x) => x.date === currentDate),
    school = data.school.filter((x) => x.date === currentDate),
    acts = data.activities.filter((x) => x.due === currentDate);
  $("#dashboardDateLabel").textContent = todayLabel(currentDate);
  const done =
      routines.filter((x) => x.done).length + acts.filter((x) => x.done).length,
    total = routines.length + acts.length;
  $("#completedStat").textContent = `${done} / ${total}`;
  $("#taskProgress").style.width = progressPercent(done, total) + "%";
  $("#studyStat").textContent =
    `${Math.floor(getActivityStudyMinutes(data) / 60)}h ${String(getActivityStudyMinutes(data) % 60).padStart(2, "0")}m`;
  const upcoming = [
    ...Object.entries(PHILIPPINES_SPECIAL_DAYS).map(([monthDay, item]) => ({ date: `${currentDate.slice(0, 4)}-${monthDay}`, ...item, holiday: true })),
    ...(data.events || []).map((item) => ({ ...item, name: item.title })),
    ...school.map((item) => ({ date: item.date, name: item.subject, description: `${item.start || ""}–${item.end || ""}`, holiday: false })),
    ...acts.map((item) => ({ date: item.due, name: item.title, description: item.description, holiday: false })),
  ].filter((item) => item.date >= currentDate).sort((a, b) => a.date.localeCompare(b.date));
  const nextEvent = upcoming[0];
  $("#upcomingStat").textContent = nextEvent ? `${nextEvent.name} · ${nextEvent.date === currentDate ? "Today" : nextEvent.date}` : "No upcoming events";
  $("#upcomingCard").dataset.eventDate = nextEvent?.date || "";
  $("#focusText").textContent =
    window.plannerFocus || "Be proud of how far you've come.";
  const events = [
    ...(data.events || []).filter((x) => x.date === currentDate).map((x) => ({ time: "", title: `${x.icon || "🎉"} ${x.title}`, meta: x.description || "Planner event", color: x.color || "", delete: `data-del-e="${x.id}"`, edit: `data-edit-e="${x.id}"`, toggle: `data-toggle-e="${x.id}"`, done: false })),
    ...routines.map((x) => ({
      time: x.time,
      title: x.title,
      meta: `${x.endTime ? `${formatTime(x.time)}–${formatTime(x.endTime)} · ` : ""}${x.description || ""}`,
      done: x.done,
      color: x.color || (x.category === "study" ? "lavender" : x.category === "break" ? "peach" : ""),
      toggle: `data-toggle-r="${x.id}"`,
      edit: `data-edit-r="${x.id}"`,
      delete: `data-del-r="${x.id}"`,
    })),
    ...acts.map((x) => ({
      time: x.startTime || x.time,
      title: x.title,
      meta: `${x.startTime && x.time ? `${formatTime(x.startTime)}–${formatTime(x.time)} · ` : ""}${x.type || "Task"}${x.description ? " · " + x.description : ""}`,
      done: x.done,
      color: x.color || "peach",
      toggle: `data-toggle-a="${x.id}"`,
      edit: `data-edit-a="${x.id}"`,
      delete: `data-del-a="${x.id}"`,
    })),
    ...school.map((x) => ({
      time: x.start,
      title: x.subject,
      meta: `${x.start}–${x.end} · ${x.room || "Room TBD"}`,
      done: false,
      color: "lavender",
    })),
  ].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  $("#timeline").innerHTML = events.length
    ? events
        .map(
          (x) =>
            `<div class="event"><div class="time">${esc(formatTime(x.time))}</div><div class="eventbox ${x.color}" style="--item-color:${esc(x.color || "pink")}"><div><b>${esc(x.title)}</b><small>${esc(x.meta || "")}</small></div>${x.toggle ? `<div class="actions"><button class="dot ${x.done ? "done" : ""}" ${x.toggle} title="${x.done ? "Uncheck" : "Complete"}">${x.done ? "✓" : ""}</button><button class="small-button" ${x.edit} title="Edit item">Edit</button><button class="small-button" ${x.delete} title="Delete item">Delete</button></div>` : '<span class="dot"></span>'}</div></div>`,
        )
        .join("")
    : `<div class="empty">Nothing planned yet. Add a routine or class 🌷</div>`;
  const jump = [...data.activities]
    .sort((a, b) => b.updated - a.updated)
    .slice(0, 2);
  $("#jumpBack").innerHTML = jump.length
    ? jump
        .map(
          (x) =>
            `<div class="jump-card"><div class="ring" style="--percent:${Math.max(10, x.done ? 100 : 33)}%"><b>${x.done ? 100 : 33}%</b></div><div><b>${esc(x.title)}</b><small>${esc(x.type || "Quiz")}</small></div></div>`,
        )
        .join("")
    : `<div class="empty">Add a task to jump back in ♡</div>`;
  const decks = data.decks.length
    ? data.decks
    : [
        { name: "School", progress: 33, icon: "🏠" },
        { name: "Streak", progress: 64, icon: "🌼" },
        { name: "Study", progress: 42, icon: "📁" },
        { name: "Profile", progress: 0, icon: "🌸" },
      ];
  $("#deckProgress").innerHTML = decks
    .map(
      (x) =>
        `<div class="deck-stat"><div class="deck-icon">${esc(x.name === "Streak" ? "🌼" : x.icon || "📁")}</div><b>${esc(x.name)}</b><small>${Number(x.progress) || 0}%</small></div>`,
    )
    .join("");
  renderStreak(data);
  renderMonth(data);
  renderSpecialDay(data);
  renderStudyTimer(data);
}
function renderUpcomingEvents(data) {
  const year = Number(currentDate.slice(0, 4));
  const entries = [
    ...Object.entries(PHILIPPINES_SPECIAL_DAYS).map(([monthDay, item]) => ({ date: `${year}-${monthDay}`, title: item.name, description: item.description, type: "Philippines holiday", icon: "🇵🇭", holiday: true })),
    ...(data.events || []).map((item) => ({ date: item.date, title: item.title, description: item.description || "Personal event", type: "Personal event", icon: item.icon || "🎉" })),
    ...data.routines.map((item) => ({ date: item.date, title: item.title, description: item.description || "Schedule", type: "Schedule", icon: "🗓️" })),
    ...data.activities.map((item) => ({ date: item.due, title: item.title, description: item.description || item.type || "Task", type: "Task", icon: "✓" })),
    ...data.school.map((item) => ({ date: item.date, title: item.subject, description: item.room || "Class", type: "Class", icon: "📚" })),
  ].filter((item) => item.date >= currentDate).sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  const groups = entries.reduce((result, item) => {
    const key = item.date.slice(0, 7);
    (result[key] ||= []).push(item);
    return result;
  }, {});
  const content = Object.entries(groups).map(([month, items]) => `<section class="upcoming-month"><h3>${esc(new Date(`${month}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" }))}</h3><div class="upcoming-list">${items.map((item) => `<article class="upcoming-item ${item.holiday ? "holiday" : ""}"><span>${item.icon}</span><div><strong>${esc(item.title)}</strong><small>${esc(fmt(item.date))} · ${esc(item.type)}</small><p>${esc(item.description)}</p></div></article>`).join("")}</div></section>`).join("");
  $("#modalBody").innerHTML = `<div class="upcoming-modal"><div class="notification-header"><div><p class="eyebrow">PLAN AHEAD</p><h2>Upcoming events</h2><p>Holidays, schedules, tasks, classes, and your personal events.</p></div><span class="notification-count">${entries.length}</span></div>${content || '<div class="empty">No upcoming events yet.</div>'}</div>`;
  $("#modal").classList.remove("hidden");
}
function ensureSoundSettings() {
  if ($("#timerSound")) return;
  const settingsGrid = $("#settings .settings-grid");
  const rewardSettings = settingsGrid?.querySelector(".reward-settings");
  if (!settingsGrid || !rewardSettings) return;
  rewardSettings.insertAdjacentHTML("beforebegin", `<fieldset class="sound-settings"><legend>Sounds</legend><small>Choose a preset or upload your own audio file.</small><label>Study timer ringtone<select id="timerSound"><option value="timer">Focus bell</option><option value="soft">Soft chime</option><option value="bright">Bright notes</option><option value="off">Muted</option></select></label><label>Upload study timer sound<input id="timerSoundFile" type="file" accept="audio/*"></label><label>Account alert tone<select id="alertSound"><option value="reminder">Reminder bell</option><option value="soft">Soft chime</option><option value="bright">Bright notes</option><option value="off">Muted</option></select></label><label>Upload account alert sound<input id="alertSoundFile" type="file" accept="audio/*"></label><button class="soft-button" id="testSounds" type="button">Test sounds</button></fieldset>`);
  $("#timerSound").onchange = async () => { window.__soundSettings.timer = $("#timerSound").value; await saveSettingPatch({ soundSettings: { ...window.__soundSettings } }); };
  $("#alertSound").onchange = async () => { window.__soundSettings.alert = $("#alertSound").value; await saveSettingPatch({ soundSettings: { ...window.__soundSettings } }); };
  $("#testSounds").onclick = () => { playSound("timer"); setTimeout(() => playSound("reminder"), 350); };
  $("#timerSoundFile").onchange = async () => { const file = $("#timerSoundFile").files[0]; if (file) { window.__soundSettings.timerFile = await fileData(file); await saveSettingPatch({ soundSettings: { ...window.__soundSettings } }); toast("Timer sound added ♡"); } };
  $("#alertSoundFile").onchange = async () => { const file = $("#alertSoundFile").files[0]; if (file) { window.__soundSettings.alertFile = await fileData(file); await saveSettingPatch({ soundSettings: { ...window.__soundSettings } }); toast("Alert sound added ♡"); } };
}
function showGoalReminder(data) {
  const goals = data.goals || [];
  const content = goals.length
    ? goals.map((goal) => `<p><strong>${esc(goal.title)}</strong>${goal.target ? ` · target ${esc(goal.target)}` : ""}</p>`).join("")
    : "<p>There’s no goal for the meantime.</p>";
  $("#modalBody").innerHTML = `<div class="goal-reminder"><p class="eyebrow">A LITTLE REMINDER</p><h2>Your goals</h2>${content}<button class="primary-button" id="closeGoalReminder">Got it ♡</button></div>`;
  $("#modal").classList.remove("hidden");
  $("#closeGoalReminder").onclick = closeModal;
}
function formatTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function renderPage(page, data) {
  if (!data) return;
  if (page === "dashboard") renderDashboard(data);
  if (page === "calendar") {
    renderMonth(data);
    renderDaySummary(data);
  }
  if (page === "routine") renderRoutine(data);
  if (page === "activities") renderActivities(data);
  if (page === "notes") renderNotes(data);
  if (page === "goals") renderGoals(data);
  if (page === "habits") renderHabits(data);
  if (page === "reminders") renderReminders(data);
  if (page === "journal") renderJournal(data);
  if (page === "rewards") renderRewardStation(data);
  if (page === "settings") {
    ensureSoundSettings();
    const soundSettings = data.settings.find((x) => x.id === "main")?.soundSettings || {};
    window.__soundSettings = { timer: soundSettings.timer || "timer", alert: soundSettings.alert || "reminder" };
    $("#timerSound").value = window.__soundSettings.timer;
    $("#alertSound").value = window.__soundSettings.alert;
    $("#settingsName").value = window.plannerName || "";
    $("#settingsFocus").value = window.plannerFocus || "";
    const profileSettings = data.settings.find((x) => x.id === "main") || {};
    $("#avatarSelect").value = profileSettings.avatar || "🌸";
    const rewards = { ...DEFAULT_REWARDS, ...(data.settings.find((x) => x.id === "main")?.rewards || {}) };
    Object.keys(DEFAULT_REWARDS).forEach((level) => {
      $(`#reward${level}`).value = rewards[level];
    });
  }
}
function renderDaySummary(data) {
  const r = data.routines.filter((x) => x.date === currentDate),
    s = data.school.filter((x) => x.date === currentDate),
    a = data.activities.filter((x) => x.due === currentDate);
  $("#daySummary").innerHTML =
    `<p class="eyebrow">SELECTED DAY</p><h3>${esc(fmt(currentDate))}</h3><p><b>${r.length}</b> routines · <b>${s.length}</b> classes · <b>${a.length}</b> tasks</p><hr><h4>What's happening?</h4>${[...r.map((x) => `<p>☼ ${esc(x.time)} — ${esc(x.title)}</p>`), ...s.map((x) => `<p>📚 ${esc(x.start)} — ${esc(x.subject)}</p>`), ...a.map((x) => `<p>✓ ${esc(x.title)}</p>`)].join("") || '<div class="empty">Nothing scheduled for this date.</div>'}`;
}
function renderRoutine(data) {
  const list = [...data.routines].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.time || "").localeCompare(b.time || ""),
  );
  $("#routineList").innerHTML = list.length
    ? list
        .map(
          (x) =>
            `<article class="item ${x.done ? "completed" : ""}"><div><h3>${esc(fmt(x.date))} · ${esc(formatTime(x.time))} · ${esc(x.title)} <span class="badge">${esc(x.category)}</span></h3><p>${esc(x.description || "No description")}</p></div><div class="actions"><button class="small-button" data-toggle-r="${x.id}">${x.done ? "Undo" : "Done"}</button><button class="small-button" data-edit-r="${x.id}">Edit</button><button class="small-button" data-del-r="${x.id}">Delete</button></div></article>`,
        )
        .join("")
    : `<div class="empty">No schedules saved yet. Add one to start your day 🌷</div>`;
}
function renderActivities(data) {
  const list = [...data.activities].sort(
    (a, b) =>
      a.due.localeCompare(b.due) ||
      a.done - b.done ||
      (a.time || "").localeCompare(b.time || ""),
  );
  $("#activityList").innerHTML = list.length
    ? list
        .map(
          (x) =>
            `<article class="item ${x.done ? "completed" : ""}"><div><h3>${esc(fmt(x.due))} · ${esc(x.title)} <span class="badge ${x.priority === "high" ? "high" : x.priority === "medium" ? "medium" : ""}">${esc(x.priority)}</span></h3><p>${esc(x.type)} · ${x.time ? "Due " + esc(formatTime(x.time)) + " · " : ""}${esc(x.description || "No details")}</p></div><div class="actions"><button class="small-button" data-toggle-a="${x.id}">${x.done ? "Undo" : "Done"}</button><button class="small-button" data-edit-a="${x.id}">Edit</button><button class="small-button" data-del-a="${x.id}">Delete</button></div></article>`,
        )
        .join("")
    : `<div class="empty">No tasks saved yet. Add your first task ✨</div>`;
}
function renderNotes(data) {
  $("#notesList").innerHTML = data.notes.length
    ? data.notes
        .sort((a, b) => b.updated - a.updated)
        .map(
          (x) =>
            `<article class="note-card">${x.image ? `<img src="${x.image}" alt="${esc(x.title)}">` : `<div class="note-placeholder">📝</div>`}<div class="note-body"><h3>${esc(x.title)}</h3><p>${esc(x.content || "No note content.")}</p>${x.fileData ? `<a class="note-attachment" href="${x.fileData}" download="${esc(x.fileName || "attachment")}">📎 ${esc(x.fileName || "Attached file")}</a>` : ""}<div class="actions"><button class="small-button" data-edit-n="${x.id}">Edit</button><button class="small-button" data-del-n="${x.id}">Delete</button></div></div></article>`,
        )
        .join("")
    : `<div class="empty">No notes yet. Add your first study note ♡</div>`;
}
function renderGoals(data) {
  $("#goalList").innerHTML = data.goals.length
    ? data.goals
        .map(
          (x) =>
            `<article class="item ${x.done ? "completed" : ""}"><div><h3>${esc(x.title)} <span class="badge">${esc(x.category)}</span></h3><p>Target: ${esc(x.target || "No target date")} · ${esc(x.description || "")}</p></div><div class="actions"><button class="small-button" data-toggle-g="${x.id}">${x.done ? "Undo" : "Complete"}</button><button class="small-button" data-edit-g="${x.id}">Edit</button><button class="small-button" data-del-g="${x.id}">Delete</button></div></article>`,
        )
        .join("")
    : `<div class="empty">No goals yet. Dream a little bigger ♡</div>`;
}
function renderHabits(data) {
  $("#habitList").innerHTML = data.habits.length
    ? data.habits
        .map((x) => {
          const days = x.days || 0,
            targetDays = Number(x.targetDays) || 7,
            p = Math.min(100, (days / targetDays) * 100);
          return `<article class="habit-card"><h3>${esc(x.name)}</h3><p>${days}/${targetDays} days complete</p><div class="habit-bar"><span style="width:${p}%"></span></div><button data-habit="${x.id}" ${days >= targetDays ? "disabled" : ""}>${days >= targetDays ? "✓ Goal complete" : "＋ Mark today"}</button><button class="small-button" data-edit-h="${x.id}">Edit</button><button class="small-button" data-del-h="${x.id}">Delete</button></article>`;
        })
        .join("")
    : `<div class="empty">No habits yet. Add one small habit 🌱</div>`;
}
function renderReminders(data) {
  const list = data.reminders.sort((a, b) => a.date.localeCompare(b.date));
  $("#reminderList").innerHTML = list.length
    ? list
        .map(
          (x) =>
            `<article class="item"><div><h3>🔔 ${esc(x.title)}</h3><p>${esc(x.date)} ${x.time ? "· " + esc(formatTime(x.time)) : ""} · ${esc(x.note || "")}</p></div><button class="small-button" data-del-rem="${x.id}">Delete</button></article>`,
        )
        .join("")
    : `<div class="empty">No reminders yet.</div>`;
}
function renderJournal(data) {
  const journalDate = new Date(`${currentDate}T12:00:00`);
  $("#journalDayNumber").textContent = String(journalDate.getDate()).padStart(2, "0");
  $("#journalDayName").textContent = journalDate.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
  $("#journalWeatherDate").textContent = journalDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const pages = data.journal
    .filter((x) => `${x.title} ${x.content}`.toLowerCase().includes(journalSearch.toLowerCase()))
    .sort((a, b) => b.updated - a.updated);
  $("#journalCount").textContent = `${pages.length} ${pages.length === 1 ? "page" : "pages"}`;
  $("#journalList").innerHTML =
    pages
      .map(
        (x) =>
          `<article class="journal-card">${x.images?.length ? `<div class="journal-card-slideshow">${x.images.map((image, index) => `<img class="journal-card-image ${index === 0 ? "active" : ""}" src="${image.data}" alt="${esc(image.name || "Journal photo")}">`).join("")}</div>` : `<div class="journal-page-icon">${x.title?.slice(0, 1).toUpperCase() || "J"}</div>`}<div class="journal-body"><h3>${esc(x.title)}</h3><small>${esc(x.date)} · Edited ${new Date(x.updated).toLocaleDateString()}${x.images?.length ? ` · ${x.images.length} photo${x.images.length === 1 ? "" : "s"}` : ""}</small><p>${esc(x.content)}</p><div class="actions"><button class="small-button" data-edit-j="${x.id}">Open page</button><button class="small-button" data-del-j="${x.id}">Delete</button></div></div></article>`,
      )
      .join("") ||
    `<div class="empty">${journalSearch ? "No pages match your search." : "Your journal is waiting for its first little story 💗"}</div>`;
}
function syncJournalPageDate() {
  updateJournalDateTrigger();
}
function updateJournalDateTrigger() {
  const dateInput = $("#journalPageDate");
  const trigger = $("#journalPageDateTrigger");
  if (!dateInput || !trigger) return;
  if (dateInput.value) {
    trigger.textContent = new Date(`${dateInput.value}T12:00:00`).toLocaleDateString(
      "en-US",
      { month: "long", day: "numeric", year: "numeric" },
    );
    trigger.classList.add("has-date");
  } else {
    trigger.textContent = "Empty";
    trigger.classList.remove("has-date");
  }
}
function collectJournalPageProperties() {
  return journalPageProperties.map((prop) => {
    const input = $(`[data-prop-input="${prop.id}"]`);
    return { ...prop, value: input ? input.value : prop.value || "" };
  });
}
function renderJournalPageProperties() {
  const container = $("#journalPageCustomProperties");
  if (!container) return;
  container.innerHTML = journalPageProperties
    .map((prop) => {
      const valueField =
        prop.type === "mood"
          ? `<select class="journal-page-property-input" data-prop-input="${prop.id}">${["😊", "😢", "😴", "🥰", "😤", "🤔"].map((m) => `<option ${prop.value === m ? "selected" : ""}>${m}</option>`).join("")}</select>`
          : `<input class="journal-page-property-input" data-prop-input="${prop.id}" type="text" value="${esc(prop.value || "")}" placeholder="Empty">`;
      return `<div class="journal-page-property"><span class="journal-page-property-icon">${esc(prop.icon)}</span><span class="journal-page-property-name">${esc(prop.name)}</span><div class="journal-page-property-value">${valueField}</div><button type="button" class="journal-page-property-remove" data-remove-prop="${prop.id}" title="Remove property">×</button></div>`;
    })
    .join("");
}
function renderJournalPageComments() {
  const list = $("#journalPageCommentsList");
  const addBtn = $("#journalPageAddComment");
  const composer = $("#journalPageCommentComposer");
  if (!list || !addBtn || !composer) return;
  list.innerHTML = journalPageComments
    .map(
      (comment) =>
        `<article class="journal-page-comment"><span class="journal-page-comment-avatar">🌸</span><div class="journal-page-comment-body"><p>${esc(comment.text)}</p><button type="button" class="journal-page-comment-delete" data-remove-comment="${comment.id}">Delete</button></div></article>`,
    )
    .join("");
  const composing = !composer.classList.contains("hidden");
  addBtn.classList.toggle("hidden", composing);
}
function renderJournalPageImages() {
  const preview = $("#journalPageImagePreview");
  if (!preview) return;
  clearInterval(journalImageRotationTimer);
  preview.innerHTML = journalPageImages.map((image, index) => `<figure class="journal-page-image ${index === 0 ? "active" : ""}"><img src="${image.data}" alt="${esc(image.name || "Journal photo")}"><button type="button" data-remove-journal-image="${index}" title="Remove photo">×</button></figure>`).join("");
}
async function addJournalPageImages(files) {
  for (const file of [...files]) {
    if (!file.type.startsWith("image/")) continue;
    if (file.size > 10 * 1024 * 1024) {
      toast(`${file.name} is larger than 10 MB`);
      continue;
    }
    journalPageImages.push({ id: uid(), name: file.name, data: await imageData(file) });
  }
  renderJournalPageImages();
}
function resetJournalCommentComposer() {
  const addBtn = $("#journalPageAddComment");
  const composer = $("#journalPageCommentComposer");
  const input = $("#journalPageCommentInput");
  if (!addBtn || !composer || !input) return;
  input.value = "";
  composer.classList.add("hidden");
  addBtn.classList.remove("hidden");
}
function closeJournalPropertyPicker() {
  $("#journalPagePropertyPicker")?.classList.add("hidden");
}
function toggleJournalPropertyPicker() {
  $("#journalPagePropertyPicker")?.classList.toggle("hidden");
}
function addJournalProperty(type) {
  const def = JOURNAL_PROPERTY_TYPES[type];
  if (!def) return;
  journalPageProperties.push({
    id: uid(),
    type,
    name: def.name,
    icon: def.icon,
    value: type === "mood" ? "😊" : "",
  });
  renderJournalPageProperties();
  closeJournalPropertyPicker();
  const latest = journalPageProperties.at(-1);
  const input = latest ? $(`[data-prop-input="${latest.id}"]`) : null;
  input?.focus();
}
function showJournalCommentComposer() {
  $("#journalPageAddComment")?.classList.add("hidden");
  $("#journalPageCommentComposer")?.classList.remove("hidden");
  $("#journalPageCommentInput")?.focus();
}
function addJournalComment() {
  const input = $("#journalPageCommentInput");
  const text = input?.value.trim();
  if (!text) return;
  journalPageComments.push({ id: uid(), text, created: Date.now() });
  resetJournalCommentComposer();
  renderJournalPageComments();
}
function autoResizeJournalContent() {
  const area = $("#journalPageContent");
  if (!area) return;
  area.style.height = "auto";
  area.style.height = `${Math.max(220, area.scrollHeight)}px`;
}
function openJournalPage(entry = {}) {
  activeJournalEntry = { ...entry };
  journalPageProperties = Array.isArray(entry.properties)
    ? entry.properties.map((prop) => ({ ...prop }))
    : [];
  journalPageComments = Array.isArray(entry.comments)
    ? entry.comments.map((comment) => ({ ...comment }))
    : [];
  journalPageImages = Array.isArray(entry.images)
    ? entry.images.map((image) => ({ ...image }))
    : [];
  $("#journalPageTitle").value = entry.title || "My Daily Journal";
  $("#journalPageDate").value = entry.date || "";
  $("#journalPageContent").value = entry.content || "";
  $("#journalPageDelete").classList.toggle("hidden", !entry.id);
  renderJournalPageProperties();
  resetJournalCommentComposer();
  renderJournalPageComments();
  renderJournalPageImages();
  closeJournalPropertyPicker();
  updateJournalDateTrigger();
  autoResizeJournalContent();
  show("journal-editor");
  const titleInput = $("#journalPageTitle");
  titleInput.focus();
  if (!entry.id) titleInput.select();
}
async function saveJournalPage() {
  const o = {
    id: activeJournalEntry?.id || uid(),
    title: $("#journalPageTitle").value.trim() || "My Daily Journal",
    date: $("#journalPageDate").value || currentDate,
    content: $("#journalPageContent").value,
    properties: collectJournalPageProperties(),
    comments: journalPageComments,
    images: journalPageImages,
    updated: Date.now(),
  };
  await put("journal", o);
  activeJournalEntry = null;
  toast("Saved ♡");
  show("journal");
  await render();
}
function closeJournalPage() {
  activeJournalEntry = null;
  journalPageProperties = [];
  journalPageComments = [];
  journalPageImages = [];
  clearInterval(journalImageRotationTimer);
  closeJournalPropertyPicker();
  resetJournalCommentComposer();
  show("journal");
}
async function deleteJournalPage() {
  if (!activeJournalEntry?.id) return;
  if (!confirm("Delete this journal page?")) return;
  await del("journal", activeJournalEntry.id);
  activeJournalEntry = null;
  toast("Deleted");
  show("journal");
  await render();
}
function form(type, x = {}) {
  const defs = {
    routine: {
      title: x.id ? "Edit Routine" : "Add Routine",
      body: `<label>Title<input name="title" required value="${esc(x.title)}" placeholder="Morning routine"></label><div class="two"><label>Start time<input name="time" type="time" required value="${esc(x.time || "07:00")}"></label><label>Due time<input name="endTime" type="time" required value="${esc(x.endTime || "08:00")}"></label></div><label>Date<input name="date" type="date" required value="${esc(x.date || currentDate)}"></label><label>Description<textarea name="description">${esc(x.description)}</textarea></label><label>Category<select name="category">${["routine", "study", "break", "personal", "health"].map((v) => `<option ${x.category === v ? "selected" : ""}>${v}</option>`).join("")}</select></label><label>Color<select name="color"><option value="pink" ${x.color === "pink" ? "selected" : ""}>Pink</option><option value="lavender" ${x.color === "lavender" ? "selected" : ""}>Lavender</option><option value="peach" ${x.color === "peach" ? "selected" : ""}>Peach</option><option value="mint" ${x.color === "mint" ? "selected" : ""}>Mint</option></select></label><label>Study duration (minutes)<input name="minutes" type="number" min="1" max="720" value="${Number(x.minutes) || 45}"><small>Used by the study timer when this is a study schedule.</small></label>`,
    },
    activity: {
      title: x.id ? "Edit Task" : "Add Task",
      body: `<label>Title<input name="title" required value="${esc(x.title)}"></label><label>Description<textarea name="description">${esc(x.description)}</textarea></label><label>Due date<input name="due" type="date" required value="${esc(x.due || currentDate)}"></label><div class="two"><label>Start time<input name="startTime" type="time" required value="${esc(x.startTime || "09:00")}"></label><label>Due time<input name="time" type="time" required value="${esc(x.time || "10:00")}"></label></div><div class="two"><label>Type<select name="type">${["assignment", "quiz", "project", "presentation", "event", "other"].map((v) => `<option ${x.type === v ? "selected" : ""}>${v}</option>`).join("")}</select></label><label>Priority<select name="priority">${["low", "medium", "high"].map((v) => `<option ${x.priority === v ? "selected" : ""}>${v}</option>`).join("")}</select></label></div><label>Color<select name="color"><option value="pink" ${x.color === "pink" ? "selected" : ""}>Pink</option><option value="lavender" ${x.color === "lavender" ? "selected" : ""}>Lavender</option><option value="peach" ${x.color === "peach" ? "selected" : ""}>Peach</option><option value="mint" ${x.color === "mint" ? "selected" : ""}>Mint</option></select></label>`,
    },
    event: {
      title: x.id ? "Edit Event" : "Add Event",
      body: `<label>Event name<input name="title" required value="${esc(x.title)}" placeholder="Birthday party"></label><label>Description<textarea name="description" placeholder="What is happening on this date?">${esc(x.description)}</textarea></label><label>Date<input name="date" type="date" required value="${esc(x.date || currentDate)}"></label><label>Event logo<select name="icon">${["🎉 Birthday", "🎂 Cake", "🎓 Graduation", "💍 Wedding", "✈️ Travel", "🎵 Concert", "🏆 Milestone", "📌 Other"].map((option) => { const icon = option.split(" ")[0]; return `<option value="${icon}" ${x.icon === icon ? "selected" : ""}>${option}</option>`; }).join("")}</select></label><label>Color<select name="color"><option value="pink" ${x.color === "pink" ? "selected" : ""}>Pink</option><option value="peach" ${x.color === "peach" ? "selected" : ""}>Peach</option><option value="lavender" ${x.color === "lavender" ? "selected" : ""}>Lavender</option></select></label>`,
    },
    note: {
      title: x.id ? "Edit Note" : "New Note",
      body: `<label>Title<input name="title" required value="${esc(x.title)}" placeholder="Web development notes"></label><label>Note<textarea name="content" placeholder="Write your notes...">${esc(x.content)}</textarea></label><label class="file-upload">📎 Attach a file<input id="noteFile" type="file" accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.txt,.csv,.zip"></label><small>Images, documents, presentations, PDFs, and other files up to 10 MB can be attached.</small>`,
    },
    goal: {
      title: x.id ? "Edit Goal" : "Add Goal",
      body: `<label>Goal<input name="title" required value="${esc(x.title)}" placeholder="Finish my project"></label><div class="two"><label>Category<select name="category"><option>school</option><option>personal</option><option>study</option></select></label><label>Target<input name="target" type="date" value="${esc(x.target || currentDate)}"></label></div><label>Description<textarea name="description">${esc(x.description)}</textarea></label>`,
    },
    habit: {
      title: x.id ? "Edit Habit" : "Add Habit",
      body: `<label>Habit<input name="name" required value="${esc(x.name)}" placeholder="Review notes for 15 minutes"></label><label>Habit goal<input name="targetDays" type="number" min="1" max="365" step="1" required value="${Number(x.targetDays) || 7}"></label><small>Choose how many days this habit should last, such as 21 days.</small>`,
    },
    reminder: {
      title: x.id ? "Edit Reminder" : "Add Reminder",
      body: `<label>Title<input name="title" required value="${esc(x.title)}"></label><div class="two"><label>Date<input name="date" type="date" required value="${esc(x.date || currentDate)}"></label><label>Time<input name="time" type="time" value="${esc(x.time)}"></label></div><label>Note<textarea name="note">${esc(x.note)}</textarea></label>`,
    },
  };
  const d = defs[type];
  $("#modalBody").innerHTML =
    `<h2>${d.title}</h2><form class="form" id="dynamicForm">${d.body}<div class="formactions"><button type="button" class="soft-button" id="cancelForm">Cancel</button><button class="primary-button">Save ♡</button></div></form>`;
  $("#modal").classList.remove("hidden");
  $("#cancelForm").onclick = closeModal;
  $("#dynamicForm").onsubmit = async (e) => {
    e.preventDefault();
    const o = Object.fromEntries(new FormData(e.target));
    o.id = x.id || uid();
    o.updated = Date.now();
    if (type === "routine" || type === "activity" || type === "reminder") {
      o.createdAt = x.createdAt || Date.now();
    }
    if (type === "routine") o.minutes = Math.max(1, Number(o.minutes) || 45);
    if (type === "routine" || type === "activity" || type === "goal")
      o.done = !!x.done;
    if (type === "habit") {
      o.days = x.days || 0;
      o.targetDays = Math.min(365, Math.max(1, Number(o.targetDays) || 7));
    }
    if (type === "note") {
      const f = $("#noteFile").files[0];
      if (f) {
        if (f.size > 10 * 1024 * 1024) {
          toast("File is larger than 10 MB");
          return;
        }
        const fileContents = await fileData(f);
        o.fileData = fileContents;
        o.fileName = f.name;
        o.fileType = f.type;
        o.image = f.type.startsWith("image/") ? await imageData(f) : x.image || "";
      } else {
        o.image = x.image || "";
        o.fileData = x.fileData || "";
        o.fileName = x.fileName || "";
        o.fileType = x.fileType || "";
      }
    }
    await put(
      {
        routine: "routines",
        activity: "activities",
        note: "notes",
        goal: "goals",
        habit: "habits",
        reminder: "reminders",
        event: "events",
      }[type],
      o,
    );
    closeModal();
    toast("Saved ♡");
    await render();
  };
}
function fileData(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
function imageData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      image.onerror = reject;
      image.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function closeModal() {
  $("#modal").classList.remove("notification-open");
  $("#modal").classList.add("hidden");
  $("#modalBody").innerHTML = "";
}
async function exportData() {
  const data = await readData();
  const blob = new Blob(
    [
      JSON.stringify(
        { version: DB_VERSION, exportedAt: new Date().toISOString(), data },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = `lovely-day-planner-${currentDate}.json`;
  link.click();
  URL.revokeObjectURL(url);
  toast("Backup downloaded ♡");
}
async function importData(file) {
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text()),
      data = backup.data;
    if (data && !Array.isArray(data.rewards)) data.rewards = [];
    if (
      !data ||
      typeof data !== "object" ||
      !stores.filter((store) => store !== "rewards").every((store) => Array.isArray(data[store]))
    ) {
      throw new Error("This is not a valid planner backup.");
    }
    if (!confirm("Restore this backup? Current planner data will be replaced."))
      return;
    for (const store of stores)
      for (const item of await all(store)) await del(store, item.id);
    for (const store of stores)
      for (const item of data[store]) await put(store, item);
    toast("Backup restored ♡");
    await render();
  } catch (error) {
    toast(error.message || "Could not restore backup");
  }
}
async function toggle(store, id) {
  const x = (await all(store)).find((v) => v.id === id);
  if (!x) return;
  x.done = !x.done;
  x.updated = Date.now();
  await put(store, x);
  if (store === "routines" || store === "activities") {
    const data = await readData();
    await syncStreak(store === "routines" ? x.date : x.due, data);
  }
  await render();
  if (x.done) {
    const item = document.querySelector(
      `[data-toggle-${store === "routines" ? "r" : store === "activities" ? "a" : "g"}="${CSS.escape(id)}"]`,
    )?.closest(".item, .event");
    item?.classList.add("just-completed");
    playSound("achievement");
    toast("Great job! Task completed 🎀", true);
  } else {
    toast("Marked active");
  }
}
async function ensurePlannerProfileName() {
  const desiredName = activeAccount?.name || "Lovely";
  const data = await readData();
  const settings = data.settings.find((x) => x.id === "main") || { id: "main" };
  if (!settings.name || settings.name !== desiredName) {
    await put("settings", {
      ...settings,
      id: "main",
      name: desiredName,
      focus: settings.focus || "Be proud of how far you've come.",
    });
  }
}
async function render() {
  await removeWebDevelopmentSchedule();
  const data = await readData();
  await syncDeckProgress(data);
  $("#currentDate").value = currentDate;
  window.__data = data;
  const settings = data.settings.find((x) => x.id === "main") || {};
  window.plannerName = activeAccount?.name || settings.name || "Lovely";
  window.plannerFocus = settings.focus || "Be proud of how far you've come.";
  window.__soundSettings = {
    timer: settings.soundSettings?.timer || "timer",
    alert: settings.soundSettings?.alert || "reminder",
    timerFile: settings.soundSettings?.timerFile || "",
    alertFile: settings.soundSettings?.alertFile || "",
  };
  window.__profileImage = settings.profileImage || "";
  window.__bannerImage = settings.bannerImage || "";
  renderProfile(settings);
  const savedTheme = settings.theme || localStorage.getItem("LovelyDayPlannerTheme") || "light";
  applyTheme(savedTheme, !settings.theme && Boolean(activeAccount?.token));
  $("#profileName").textContent = `Hello, ${window.plannerName}!`;
  $("#accountEmail").textContent = window.plannerName;
  const active = $(".page.active")?.id || "dashboard";
  if (active === "dashboard")
    $("#pageTitle").innerHTML =
      `Good morning, ${esc(window.plannerName)}! <span>☀️</span>`;
  renderPage(active, data);
}
document.addEventListener("pointerdown", triggerSoundOnUserInteraction, { passive: true });
document.addEventListener("keydown", triggerSoundOnUserInteraction, { passive: true });
document.addEventListener("click", async (e) => {
  const journalImage = e.target.closest(".journal-card-image, .journal-page-image img");
  if (journalImage) {
    $("#modalBody").innerHTML = `<img class="journal-image-lightbox" src="${journalImage.src}" alt="${esc(journalImage.alt || "Journal photo")}">`;
    $("#modal").classList.remove("hidden");
    return;
  }
  const b = e.target.closest("button");
  const upcomingCard = e.target.closest("#upcomingCard");
  if (upcomingCard) {
    await renderUpcomingEvents(await readData());
    return;
  }
  const dateEl = e.target.closest("[data-calendar-date]");
  if (dateEl) {
    currentDate = dateEl.dataset.calendarDate;
    viewMonth = new Date(currentDate + "T12:00:00");
    render();
    return;
  }
  if (!b) return;
  if (b.dataset.page) {
    show(b.dataset.page);
    return;
  }
  if (b.id === "upcomingCard") {
    await renderUpcomingEvents(await readData());
    return;
  }
  if (b.dataset.add) {
    if (b.dataset.add === "journal") {
      openJournalPage({});
      return;
    }
    form(b.dataset.add);
    return;
  }
  if (b.dataset.claimReward) {
    await claimReward(b.dataset.claimReward);
    return;
  }
  if (b.dataset.toggleR) {
    await toggle("routines", b.dataset.toggleR);
    return;
  }
  if (b.dataset.toggleA) {
    await toggle("activities", b.dataset.toggleA);
    return;
  }
  if (b.dataset.toggleE) {
    await toggle("events", b.dataset.toggleE);
    return;
  }
  if (b.dataset.toggleG) {
    await toggle("goals", b.dataset.toggleG);
    return;
  }
  if (b.dataset.editH) {
    form("habit", (await all("habits")).find((x) => x.id === b.dataset.editH));
    return;
  }
  if (b.dataset.editJ) {
    openJournalPage(
      (await all("journal")).find((x) => x.id === b.dataset.editJ) || {},
    );
    return;
  }
  const edits = [
    ["editR", "routines", "routine"],
    ["editA", "activities", "activity"],
    ["editN", "notes", "note"],
    ["editG", "goals", "goal"],
    ["editH", "habits", "habit"],
    ["editRem", "reminders", "reminder"],
    ["editE", "events", "event"],
  ];
  for (const [key, store, type] of edits)
    if (b.dataset[key]) {
      form(
        type,
        (await all(store)).find((x) => x.id === b.dataset[key]),
      );
      return;
    }
  const dels = [
    ["delR", "routines"],
    ["delA", "activities"],
    ["delN", "notes"],
    ["delG", "goals"],
    ["delH", "habits"],
    ["delRem", "reminders"],
    ["delJ", "journal"],
    ["delE", "events"],
  ];
  for (const [key, store] of dels)
    if (b.dataset[key]) {
      if (confirm("Delete this item?")) {
        await del(store, b.dataset[key]);
        toast("Deleted");
        render();
      }
      return;
    }
  if (b.dataset.habit) {
    const x = (await all("habits")).find((v) => v.id === b.dataset.habit);
    if (x) {
      const targetDays = Number(x.targetDays) || 7;
      x.days = Math.min(targetDays, (x.days || 0) + 1);
      x.updated = Date.now();
      await put("habits", x);
      toast("Habit marked for today 🌱");
      render();
    }
    return;
  }
});
$("#closeModal").onclick = closeModal;
$("#modal").onclick = (e) => {
  if (e.target.id === "modal") closeModal();
};
$("#currentDate").onchange = (e) => {
  currentDate = e.target.value;
  viewMonth = new Date(currentDate + "T12:00:00");
  render();
};
$("#todayButton").onclick = () => {
  currentDate = philippinesDateKey();
  viewMonth = new Date(currentDate + "T12:00:00");
  render();
};
$("#prevDay").onclick = () => {
  currentDate = dateShift(currentDate, -1);
  viewMonth = new Date(currentDate + "T12:00:00");
  render();
};
$("#nextDay").onclick = () => {
  currentDate = dateShift(currentDate, 1);
  viewMonth = new Date(currentDate + "T12:00:00");
  render();
};
$("#prevMonth").onclick = () => {
  viewMonth.setMonth(viewMonth.getMonth() - 1);
  render();
};
$("#nextMonth").onclick = () => {
  viewMonth.setMonth(viewMonth.getMonth() + 1);
  render();
};
$("#upcomingCard").onclick = async (event) => {
  event.stopPropagation();
  await renderUpcomingEvents(await readData());
};
$("#shareButton").onclick = async () => {
  const text = `My planner streak: ${streakDays(window.__data)} days ♡`;
  try {
    await navigator.clipboard.writeText(text);
    toast("Streak copied ♡");
  } catch {
    toast(text);
  }
};
document.addEventListener("click", (e) => {
  if (e.target.id === "largePrev") {
    viewMonth.setMonth(viewMonth.getMonth() - 1);
    render();
  }
  if (e.target.id === "largeNext") {
    viewMonth.setMonth(viewMonth.getMonth() + 1);
    render();
  }
});
$("#saveSettings").onclick = async () => {
  await put("settings", {
    id: "main",
    name: $("#settingsName").value.trim() || "Lovely",
    focus:
      $("#settingsFocus").value.trim() || "Be proud of how far you've come.",
    rewards: Object.fromEntries(
      Object.keys(DEFAULT_REWARDS).map((level) => [
        level,
        $(`#reward${level}`).value.trim() || DEFAULT_REWARDS[level],
      ]),
    ),
    avatar: $("#avatarSelect").value,
    profileImage: window.__profileImage || $("#profileImage").src || "",
    bannerImage: window.__bannerImage || $("#bannerImage").src || "",
    soundSettings: { ...window.__soundSettings },
    theme: $("#themeSelect").value,
  });
  toast("Settings saved ♡");
  render();
};
  $("#themeSelect").onchange = async (e) => {
    await applyTheme(e.target.value, true);
  };
$("#avatarSelect").onchange = (e) => {
  $("#avatarIcon").textContent = e.target.value;
  $("#avatarIcon").classList.remove("hidden");
  $("#profileImage").classList.add("hidden");
    saveSettingPatch({ avatar: e.target.value });
};
$("#profileImageFile").onchange = async () => {
  const file = $("#profileImageFile").files[0];
  if (!file) return;
  window.__profileImage = await imageData(file);
  renderProfile({ profileImage: window.__profileImage, avatar: $("#avatarSelect").value, bannerImage: window.__bannerImage });
  await saveSettingPatch({ profileImage: window.__profileImage });
};
$("#bannerImageFile").onchange = async () => {
  const file = $("#bannerImageFile").files[0];
  if (!file) return;
  window.__bannerImage = await imageData(file);
  renderProfile({ profileImage: window.__profileImage, avatar: $("#avatarSelect").value, bannerImage: window.__bannerImage });
  await saveSettingPatch({ bannerImage: window.__bannerImage });
};
$("#clearData").onclick = async () => {
  if (!confirm("Reset all planner data stored in this browser?")) return;
  for (const s of stores) for (const x of await all(s)) await del(s, x.id);
  toast("Planner reset");
  location.reload();
};
$("#deleteAccount").onclick = async () => {
  if (!confirm("Delete this account permanently? This removes the account, password, and all saved planner data.")) return;
  try {
    if (remoteAuthEnabled && activeAccount?.token) {
      await apiRequest("/api/account", { method: "DELETE" });
    } else {
      const currentId = activeAccount?.id || localStorage.getItem(SESSION_KEY);
      const accounts = getAccounts().filter((account) => account.id !== currentId);
      saveAccounts(accounts);
      if (activeAccount?.dbName) {
        await new Promise((resolve, reject) => {
          const request = indexedDB.deleteDatabase(activeAccount.dbName);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error || new Error("Could not delete the local database."));
          request.onblocked = () => resolve();
        }).catch(() => {});
      }
    }
    if (db) db.close();
    localStorage.removeItem(SESSION_KEY);
    location.reload();
    toast("Account deleted");
  } catch (error) {
    toast(error.message || "Could not delete account.");
  }
};
$("#notificationButton").onclick = async () => {
  renderNotifications(await readData());
};
$("#journalSearch").oninput = (e) => {
  journalSearch = e.target.value;
  renderJournal(window.__data);
};
$("#journalPageBack").onclick = closeJournalPage;
$("#journalPageSave").onclick = saveJournalPage;
$("#journalPageDelete").onclick = deleteJournalPage;
$("#journalPageDateTrigger").onclick = () => {
  const input = $("#journalPageDate");
  if (!input) return;
  if (typeof input.showPicker === "function") input.showPicker();
  else input.click();
};
$("#journalPageDate").onchange = syncJournalPageDate;
$("#journalPageDate").oninput = syncJournalPageDate;
$("#journalPageContent").oninput = autoResizeJournalContent;
$("#journalPageImages").onchange = async (e) => {
  await addJournalPageImages(e.target.files);
  e.target.value = "";
};
$("#journalPageImagePreview").onclick = (e) => {
  const removeButton = e.target.closest("[data-remove-journal-image]");
  if (!removeButton) return;
  journalPageImages.splice(Number(removeButton.dataset.removeJournalImage), 1);
  renderJournalPageImages();
};
$("#journalPageAddProperty").onclick = (e) => {
  e.stopPropagation();
  toggleJournalPropertyPicker();
};
$("#journalPagePropertyPicker").onclick = (e) => e.stopPropagation();
$("#journalPagePropertyPicker").querySelectorAll("[data-journal-prop]").forEach((btn) => {
  btn.onclick = () => addJournalProperty(btn.dataset.journalProp);
});
$("#journalPageAddComment").onclick = showJournalCommentComposer;
$("#journalPageCommentCancel").onclick = resetJournalCommentComposer;
$("#journalPageCommentPost").onclick = addJournalComment;
$("#journalPageCommentInput").onkeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    addJournalComment();
  }
};
$("#journalPageCustomProperties").onclick = (e) => {
  const removeBtn = e.target.closest("[data-remove-prop]");
  if (!removeBtn) return;
  journalPageProperties = journalPageProperties.filter(
    (prop) => prop.id !== removeBtn.dataset.removeProp,
  );
  renderJournalPageProperties();
};
$("#journalPageCommentsList").onclick = (e) => {
  const removeBtn = e.target.closest("[data-remove-comment]");
  if (!removeBtn) return;
  journalPageComments = journalPageComments.filter(
    (comment) => comment.id !== removeBtn.dataset.removeComment,
  );
  renderJournalPageComments();
};
document.addEventListener("click", () => closeJournalPropertyPicker());
$("#studyTimerSelect").onchange = async (e) => {
  const routine = (await all("routines")).find((x) => x.id === e.target.value);
  if (!routine) return;
  clearInterval(studyTimerInterval);
  studyTimer.routineId = routine.id;
  studyTimer.durationMinutes = Number(routine.minutes) || 45;
  studyTimer.remaining = studyTimer.durationMinutes * 60;
  studyTimer.running = false;
  await render();
};
$("#studyTimerStart").onclick = startStudyTimer;
$("#studyTimerReset").onclick = async () => {
  const routine = (await all("routines")).find((x) => x.id === studyTimer.routineId);
  if (!routine) return;
  clearInterval(studyTimerInterval);
  studyTimer.running = false;
  studyTimer.durationMinutes = Number(routine.minutes) || 45;
  studyTimer.remaining = studyTimer.durationMinutes * 60;
  await render();
};
$("#exportData").onclick = exportData;
$("#importData").onclick = () => $("#importFile").click();
$("#importFile").onchange = (e) => {
  importData(e.target.files[0]);
  e.target.value = "";
};
$$('[data-auth-mode]').forEach((button) => {
  button.onclick = () => setAuthMode(button.dataset.authMode);
});
$("#authForm").onsubmit = async (e) => {
  e.preventDefault();
  try {
    if (await authenticate()) {
      await startPlanner();
    }
  } catch (error) {
    setAuthMessage(error.message || "Could not access your account.");
  }
};
$("#localModeButton").onclick = startPlanner;
$("#accountButton").onclick = async () => {
  localStorage.removeItem(SESSION_KEY);
  activeAccount = null;
  db?.close();
  location.reload();
};
let plannerStarted = false;
async function startPlanner() {
  if (plannerStarted) return;
  plannerStarted = true;
  showPlanner();
  startReminderChecks();
  try {
    await openDB();
    if (remoteAuthEnabled && activeAccount?.token) await loadRemotePlanner();
    await loadStudyTimer();
    let d = await readData();
    if (
      !d.routines.length &&
      !d.school.length &&
      !d.activities.length &&
      !d.notes.length &&
      !d.goals.length &&
      !d.habits.length &&
      !d.reminders.length &&
      !d.journal.length &&
      !d.decks.length &&
      !d.rewards.length &&
      !d.streaks.length
    ) {
      await put("settings", {
        id: "main",
        name: activeAccount?.name || "Lovely",
        focus: "Be proud of how far you've come.",
      });
    }
    await ensurePlannerProfileName();
    d = await readData();
    const dates = new Set([
      ...d.routines.filter((x) => x.done).map((x) => x.date),
      ...d.activities.filter((x) => x.done).map((x) => x.due),
    ]);
    for (const date of dates) await syncStreak(date, d);
    await render();
    showGoalReminder(await readData());
  } catch (err) {
    plannerStarted = false;
    console.error(err);
    alert("Could not open the planner database: " + err.message);
  }
}
(async () => {
  try {
    await openDB();
    const authenticated = await initializeAccount();
    if (authenticated) {
      await startPlanner();
    }
  } catch (err) {
    console.error(err);
    setAuthMessage(err.message || "Could not connect to your account.");
  }
})();
