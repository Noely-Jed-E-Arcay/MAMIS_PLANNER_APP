const DB_NAME = "LovelyDayPlannerDB",
  DB_VERSION = 5;
const stores = [
  "routines",
  "school",
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
];
const MAX_TASKS = 5;
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
const studyTimer = JSON.parse(localStorage.getItem("LovelyDayPlannerStudyTimer") || "null") || {
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
const ACCOUNT_KEY = "LovelyDayPlannerAccounts";
const SESSION_KEY = "LovelyDayPlannerSession";
const API_BASE = window.PLANNER_CONFIG?.apiBase || "";
const remoteAuthEnabled = location.protocol !== "file:";
function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
let currentDate = localDateKey();
let viewMonth = new Date(currentDate + "T12:00:00");
let journalSearch = "";
let activeJournalEntry = null;
let journalPageProperties = [];
let journalPageComments = [];
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
  if (!response.ok) throw new Error(body.error || "The planner server is unavailable.");
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
    await apiRequest("/api/planner", { method: "PUT", body: JSON.stringify({ data: await readData() }) });
  } catch {
    toast("Could not sync planner changes.");
  }
}
async function loadRemotePlanner() {
  if (!activeAccount?.token) return;
  const { data } = await apiRequest("/api/planner");
  if (!data) return;
  remoteHydrating = true;
  for (const store of stores) for (const item of await all(store)) await del(store, item.id);
  for (const store of stores) for (const item of data[store] || []) await put(store, item);
  remoteHydrating = false;
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
  $("#accountEmail").textContent = activeAccount?.email || "Guest mode";
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
  $("#mobileMoreMenu")?.classList.add("hidden");
  $("[data-mobile-more]")?.setAttribute("aria-expanded", "false");
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
function calendarHTML(date, selected, items) {
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
    h += `<span class="${muted ? "muted " : ""}${ds === selected ? "selected " : ""}${has ? "has-item" : ""}" data-calendar-date="${ds}">${day}</span>`;
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
function saveStudyTimer() {
  localStorage.setItem("LovelyDayPlannerStudyTimer", JSON.stringify(studyTimer));
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
function streakDays(data) {
  const dates = completedDates(data);
  let d = currentDate,
    count = 0;
  while (dates.has(d)) {
    count++;
    d = dateShift(d, -1);
  }
  return count;
}
function renderMonth(data) {
  const itemDates = new Set();
  data.routines.forEach((x) => itemDates.add(x.date));
  data.school.forEach((x) => itemDates.add(x.date));
  data.activities.forEach((x) => itemDates.add(x.due));
  $("#monthLabel").textContent = viewMonth.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  $("#monthGrid").innerHTML = calendarHTML(viewMonth, currentDate, itemDates);
  $("#largeCalendar").innerHTML =
    `<div class="large-month-head"><button class="soft-button" id="largePrev">‹</button><h3>${viewMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h3><button class="soft-button" id="largeNext">›</button></div><div class="weekdays"><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div><div class="large-month-grid">${calendarHTML(viewMonth, currentDate, itemDates).replaceAll("<span ", "<div ").replaceAll("</span>", "</div>")}</div>`;
}
function renderStreak(data) {
  const streak = streakDays(data),
    dates = completedDates(data);
  const completedTotal =
    data.routines.filter((x) => x.done).length +
    data.activities.filter((x) => x.done).length;
  const completedToday = completedRequirementCount(data, currentDate);
  const rewards = {
    ...DEFAULT_REWARDS,
    ...(data.settings.find((x) => x.id === "main")?.rewards || {}),
  };
  const settings = data.settings.find((x) => x.id === "main") || { id: "main" };
  const currentLevel = [...STREAK_LEVELS]
    .reverse()
    .find((level) => completedTotal >= level.goal);
  const nextLevel = STREAK_LEVELS.find((level) => completedTotal < level.goal);
  const progressStart = currentLevel?.goal || 0;
  const progressEnd = nextLevel?.goal || progressStart + 1;
  const levelProgress = nextLevel
    ? Math.min(
        100,
        Math.round(
          ((completedTotal - progressStart) / (progressEnd - progressStart)) *
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
    ? `${Math.max(0, nextLevel.goal - completedTotal)} more completed to reach ${nextLevel.name}`
    : "Highest milestone reached";
  $("#streakReward").textContent = completedToday
    ? "Reward: Take a relaxing break"
    : "Complete a task today to unlock your reward";
  if (currentLevel && currentLevel.goal > (Number(settings.rewardAlertLevel) || 0)) {
    toast(`🎀 ${currentLevel.name} unlocked! Claim your reward: ${rewards[currentLevel.name]}`);
    put("settings", { ...settings, rewardAlertLevel: currentLevel.goal });
  }
  const days = [];
  const base = new Date(currentDate + "T12:00:00");
  base.setDate(base.getDate() - 6);
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const ds = localDateKey(d);
    const completed = dates.has(ds);
    days.push(
      `<div class="day-chip ${ds === currentDate ? "today" : ""} ${completed ? "active" : ""}"><span>${d.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 2)}</span><div class="day-circle">${completed ? "🔥" : d.getDate()}</div></div>`,
    );
  }
  $("#streakWeek").innerHTML = days.join("");
  $("#streakCountLabel").textContent = `${streak} day`;
  $("#streakQuestions").textContent = dates.has(currentDate)
    ? "Streak active"
    : "Complete a task to start";
}
function renderRewardStation(data) {
  const completedTotal = data.routines.filter((x) => x.done).length + data.activities.filter((x) => x.done).length;
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
    const completedTotal = data.routines.filter((x) => x.done).length + data.activities.filter((x) => x.done).length;
    const rewards = { ...DEFAULT_REWARDS, ...(data.settings.find((x) => x.id === "main")?.rewards || {}) };
    if (!level || completedTotal < level.goal) return;
    reward = { id, type: "milestone", title: `${level.name} reward`, description: rewards[level.name], unlockedAt: Date.now(), claimed: false };
    await put("rewards", reward);
  }
  if (!reward || reward.claimed) return;
  reward.claimed = true;
  reward.claimedAt = Date.now();
  await put("rewards", reward);
  await render();
  showCongratulations(reward);
  toast(`Reward claimed: ${reward.description || "Enjoy it!"} 🎀`, true);
}
function renderDashboard(data) {
  const routines = data.routines.filter((x) => x.date === currentDate),
    school = data.school.filter((x) => x.date === currentDate),
    acts = data.activities.filter((x) => x.due === currentDate);
  const done =
      routines.filter((x) => x.done).length + acts.filter((x) => x.done).length,
    total = routines.length + acts.length;
  $("#completedStat").textContent = `${done} / ${total}`;
  $("#taskProgress").style.width = progressPercent(done, total) + "%";
  $("#studyStat").textContent =
    `${Math.floor(getActivityStudyMinutes(data) / 60)}h ${String(getActivityStudyMinutes(data) % 60).padStart(2, "0")}m`;
  $("#upcomingStat").textContent = `${school.length + acts.length} Events`;
  $("#focusText").textContent =
    window.plannerFocus || "Be proud of how far you've come.";
  const events = [
    ...routines.map((x) => ({
      time: x.time,
      title: x.title,
      meta: x.description,
      done: x.done,
      color:
        x.category === "study"
          ? "lavender"
          : x.category === "break"
            ? "peach"
            : "",
      toggle: `data-toggle-r="${x.id}"`,
      edit: `data-edit-r="${x.id}"`,
    })),
    ...acts.map((x) => ({
      time: x.time,
      title: x.title,
      meta: `${x.type || "Task"}${x.description ? " · " + x.description : ""}`,
      done: x.done,
      color: "peach",
      toggle: `data-toggle-a="${x.id}"`,
      edit: `data-edit-a="${x.id}"`,
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
            `<div class="event"><div class="time">${esc(formatTime(x.time))}</div><div class="eventbox ${x.color}"><div><b>${esc(x.title)}</b><small>${esc(x.meta || "")}</small></div>${x.toggle ? `<div class="actions"><button class="dot ${x.done ? "done" : ""}" ${x.toggle} title="${x.done ? "Uncheck" : "Complete"}">${x.done ? "✓" : ""}</button><button class="small-button" ${x.edit} title="Edit schedule">Edit</button></div>` : '<span class="dot"></span>'}</div></div>`,
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
  renderStudyTimer(data);
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
    $("#settingsName").value = window.plannerName || "";
    $("#settingsFocus").value = window.plannerFocus || "";
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
            p = Math.min(100, (days / 7) * 100);
          return `<article class="habit-card"><h3>${esc(x.name)}</h3><p>${days}/7 days this week</p><div class="habit-bar"><span style="width:${p}%"></span></div><button data-habit="${x.id}">＋ Mark today</button><button class="small-button" data-del-h="${x.id}">Delete</button></article>`;
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
          `<article class="journal-card"><div class="journal-page-icon">${x.title?.slice(0, 1).toUpperCase() || "J"}</div><div class="journal-body"><h3>${esc(x.title)}</h3><small>${esc(x.date)} · Edited ${new Date(x.updated).toLocaleDateString()}</small><p>${esc(x.content)}</p><div class="actions"><button class="small-button" data-edit-j="${x.id}">Open page</button><button class="small-button" data-del-j="${x.id}">Delete</button></div></div></article>`,
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
  $("#journalPageTitle").value = entry.title || "My Daily Journal";
  $("#journalPageDate").value = entry.date || "";
  $("#journalPageContent").value = entry.content || "";
  $("#journalPageDelete").classList.toggle("hidden", !entry.id);
  renderJournalPageProperties();
  resetJournalCommentComposer();
  renderJournalPageComments();
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
      body: `<label>Title<input name="title" required value="${esc(x.title)}" placeholder="Morning routine"></label><div class="two"><label>Time<input name="time" type="time" required value="${esc(x.time || "07:00")}"></label><label>Date<input name="date" type="date" required value="${esc(x.date || currentDate)}"></label></div><label>Description<textarea name="description">${esc(x.description)}</textarea></label><label>Category<select name="category">${["routine", "study", "break", "personal", "health"].map((v) => `<option ${x.category === v ? "selected" : ""}>${v}</option>`).join("")}</select></label><label>Study duration (minutes)<input name="minutes" type="number" min="1" max="720" value="${Number(x.minutes) || 45}"><small>Used by the study timer when this is a study schedule.</small></label>`,
    },
    activity: {
      title: x.id ? "Edit Task" : "Add Task",
      body: `<label>Title<input name="title" required value="${esc(x.title)}"></label><label>Description<textarea name="description">${esc(x.description)}</textarea></label><div class="two"><label>Due date<input name="due" type="date" required value="${esc(x.due || currentDate)}"></label><label>Due time<input name="time" type="time" value="${esc(x.time)}"></label></div><div class="two"><label>Type<select name="type">${["assignment", "quiz", "project", "presentation", "event", "other"].map((v) => `<option ${x.type === v ? "selected" : ""}>${v}</option>`).join("")}</select></label><label>Priority<select name="priority">${["low", "medium", "high"].map((v) => `<option ${x.priority === v ? "selected" : ""}>${v}</option>`).join("")}</select></label></div>`,
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
      body: `<label>Habit<input name="name" required value="${esc(x.name)}" placeholder="Review notes for 15 minutes"></label>`,
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
    if (type === "routine") o.minutes = Math.max(1, Number(o.minutes) || 45);
    if (type === "routine" || type === "activity" || type === "goal")
      o.done = !!x.done;
    if (type === "habit") o.days = x.days || 0;
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
        o.image = f.type.startsWith("image/") ? fileContents : x.image || "";
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
    if (data.activities.length > MAX_TASKS) {
      throw new Error(`A backup cannot contain more than ${MAX_TASKS} tasks.`);
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
    toast("Great job! Task completed 🎀", true);
  } else {
    toast("Marked active");
  }
}
async function render() {
  await removeWebDevelopmentSchedule();
  const data = await readData();
  $("#currentDate").value = currentDate;
  window.__data = data;
  const settings = data.settings.find((x) => x.id === "main") || {};
  window.plannerName = settings.name || "Lovely";
  window.plannerFocus = settings.focus || "Be proud of how far you've come.";
  $("#profileName").textContent = `Hello, ${window.plannerName}!`;
  const active = $(".page.active")?.id || "dashboard";
  if (active === "dashboard")
    $("#pageTitle").innerHTML =
      `Good morning, ${esc(window.plannerName)}! <span>☀️</span>`;
  renderPage(active, data);
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  const dateEl = e.target.closest("[data-calendar-date]");
  if (dateEl) {
    currentDate = dateEl.dataset.calendarDate;
    viewMonth = new Date(currentDate + "T12:00:00");
    render();
    return;
  }
  if (!b) return;
  if (b.dataset.mobileMore !== undefined) {
    const menu = $("#mobileMoreMenu");
    const isHidden = menu.classList.toggle("hidden");
    b.setAttribute("aria-expanded", String(!isHidden));
    return;
  }
  if (b.dataset.page) {
    show(b.dataset.page);
    return;
  }
  if (b.dataset.add) {
    if (b.dataset.add === "activity" && (await all("activities")).length >= MAX_TASKS) {
      toast(`You can only have ${MAX_TASKS} tasks`);
      return;
    }
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
  if (b.dataset.toggleG) {
    await toggle("goals", b.dataset.toggleG);
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
      x.days = Math.min(7, (x.days || 0) + 1);
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
  currentDate = localDateKey();
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
  });
  toast("Settings saved ♡");
  render();
};
$("#clearData").onclick = async () => {
  if (!confirm("Reset all planner data stored in this browser?")) return;
  for (const s of stores) for (const x of await all(s)) await del(s, x.id);
  toast("Planner reset");
  location.reload();
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
  try {
    await openDB();
    if (remoteAuthEnabled && activeAccount?.token) await loadRemotePlanner();
    let d = await readData();
    if (
      !d.routines.length &&
      !d.school.length &&
      !d.activities.length &&
      !d.notes.length
    ) {
      const now = currentDate;
      await put("routines", {
        id: uid(),
        title: "Morning Routine",
        description: "Get ready, breakfast, journal",
        time: "07:00",
        date: now,
        category: "routine",
        done: true,
        minutes: 20,
        updated: Date.now(),
      });
      await put("routines", {
        id: uid(),
        title: "Study Session",
        description: "Review notes & practice",
        time: "10:00",
        date: now,
        category: "study",
        done: false,
        minutes: 65,
        updated: Date.now(),
      });
      await put("routines", {
        id: uid(),
        title: "Personal Time",
        description: "Read a book / watch a movie",
        time: "18:00",
        date: now,
        category: "personal",
        done: false,
        minutes: 45,
        updated: Date.now(),
      });
      await put("school", {
        id: uid(),
        subject: "Web Development",
        teacher: "Your Teacher",
        room: "Lab 2",
        start: "08:00",
        end: "09:30",
        date: now,
        color: "lavender",
      });
      await put("activities", {
        id: uid(),
        title: "Finish UI Design",
        description: "Complete the dashboard prototype.",
        due: now,
        time: "17:00",
        type: "assignment",
        priority: "high",
        done: false,
        updated: Date.now(),
      });
      await put("activities", {
        id: uid(),
        title: "Review for Quiz",
        description: "Read the next chapter.",
        due: now,
        time: "19:00",
        type: "quiz",
        priority: "medium",
        done: true,
        updated: Date.now(),
      });
      await put("notes", {
        id: uid(),
        title: "Web Development Notes",
        content:
          "Remember: keep your components organized and your layout responsive.",
        image: "",
        updated: Date.now(),
      });
      await put("decks", {
        id: "school",
        name: "School",
        progress: 33,
        icon: "🏠",
      });
      await put("decks", {
        id: "streak",
        name: "Streak",
        progress: 64,
        icon: "🔥",
      });
      await put("decks", {
        id: "study",
        name: "Study",
        progress: 42,
        icon: "📁",
      });
      await put("decks", {
        id: "profile",
        name: "Profile",
        progress: 0,
        icon: "🌸",
      });
      await put("settings", {
        id: "main",
        name: "Lovely",
        focus: "Be proud of how far you've come.",
      });
    }
    d = await readData();
    const dates = new Set([
      ...d.routines.filter((x) => x.done).map((x) => x.date),
      ...d.activities.filter((x) => x.done).map((x) => x.due),
    ]);
    for (const date of dates) await syncStreak(date, d);
    await render();
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
