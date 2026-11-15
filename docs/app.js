(() => {
  "use strict";

  /* ================= Конфигурация ================= */
  const DB_KEY = "cs_db_v1";
  const TEST_TG_ID = 6999358439;
  const ADMIN_IDS = [6999358439];
  const ADMIN_PASSWORD = "shoke26";
  const PERMANENT = 4102444800;
  const LOBBY_TTL = 1800;
  const PLAYING_TTL = 10800;
  // Адрес бэкенда с /api/notify (например "https://api.example.com"). Пусто = уведомления в канал выключены.
  const SUPPORT_URL = "https://t.me/crymbog";
  const NOTIFY_URL = "https://instructors-built-mate-drain.trycloudflare.com";
const API_URL = NOTIFY_URL;
  const MAPS = ["Dust II", "Mirage", "Inferno", "Vertigo"];
  const MAP_IMAGES = {
    "Mirage": "assets/maps/mirage.jpeg",
    "Inferno": "assets/maps/inferno.jpg",
    "Dust II": "assets/maps/dust2.webp",
    "Vertigo": "assets/maps/vertigo.webp",
    // Остальные пока без картинок
  };
  const MODE_SIZE = { "1v1": 2, "5v5": 10, "DM": 10 };
  const MODE_INFO = {
    "1v1": "Дуэль до 13 раундов",
    "5v5": "Премьер, до 13 раундов",
    "DM": "Deathmatch — против всех",
  };
  const WARNING_TEXT = "После матча вы обязаны отправить скриншот с результатами. Если не отправите — вы будете заглушены на площадке CYBERSHOKE.";
  const MISSIONS = [
    { title: "Сыграй 3 матча", reward: 150, goal: 3 },
    { title: "Победи в 2 матчах подряд", reward: 300, goal: 2 },
    { title: "Сделай 20 киллов за день", reward: 200, goal: 20 },
    { title: "Создай своё лобби", reward: 50, goal: 1 },
  ];
  const PLANS = [
    { id: "premium", cls: "premium", name: "PREMIUM", price: "50 ★", perks: ["Золотой значок в профиле", "Приоритет в лобби", "+25% кибер-поинтов", "Эксклюзивные турниры"] },
    { id: "lite", cls: "lite", name: "LITE", price: "25 ★", perks: ["Синий значок в профиле", "+10% кибер-поинтов"] },
  ];
  const TIMES = [
    { label: "15 минут", min: 15 }, { label: "1 час", min: 60 }, { label: "1 день", min: 1440 },
    { label: "7 дней", min: 10080 }, { label: "30 дней", min: 43200 }, { label: "Навсегда", min: 0 },
  ];

  /* ================= Утилиты ================= */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ICON = (id) => `<svg><use href="#i-${id}"/></svg>`;
  const now = () => Math.floor(Date.now() / 1000);

  function toast(msg, type = "ok") {
    const t = $("#toast");
    t.textContent = msg;
    t.className = `toast show ${type}`;
    clearTimeout(toast.id);
    toast.id = setTimeout(() => (t.className = "toast"), 2600);
  }

  function fmtDate(ts) {
    if (ts >= PERMANENT) return "навсегда";
    return new Date(ts * 1000).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function ago(ts) {
    const m = Math.max(0, Math.floor((now() - ts) / 60));
    if (m < 1) return "только что";
    if (m < 60) return `${m} мин назад`;
    return `${Math.floor(m / 60)} ч назад`;
  }

  /* ================= Telegram ================= */
  const tg = (window.Telegram && window.Telegram.WebApp) || null;
  if (tg) { try { tg.ready(); tg.expand(); } catch (e) { /* старый клиент */ } }

  /** Реальный пользователь Telegram (если клиент передал initData), иначе null. */
  function readTgUser() {
    try {
      if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) return tg.initDataUnsafe.user;
    } catch (e) { /* нет данных */ }
    try {
      const raw = new URLSearchParams(location.hash.replace(/^#/, "")).get("tgWebAppData");
      const user = raw && new URLSearchParams(raw).get("user");
      if (user) return JSON.parse(user);
    } catch (e) { /* нет данных */ }
    return null;
  }

  /** DEV_ID: 1) ?tg_id=... в URL, 2) localStorage cs_dev_id, 3) тестовый 6999358439. */
  function resolveDevId() {
    const valid = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };
    let id = 0;
    try { id = valid(new URLSearchParams(location.search).get("tg_id")); } catch (e) { /* нет параметра */ }
    if (id) {
      try { localStorage.setItem("cs_dev_id", String(id)); } catch (e) { /* storage недоступен */ }
      return id;
    }
    try { id = valid(localStorage.getItem("cs_dev_id")); } catch (e) { /* storage недоступен */ }
    return id || TEST_TG_ID;
  }
  const DEV_ID = resolveDevId();
  const TG_ID = (() => {
    // 1. Пробуем взять tg_id из URL (?tg_id=...)
    try {
      const urlId = new URLSearchParams(location.search).get("tg_id");
      if (urlId && /^\d+$/.test(urlId)) return Number(urlId);
    } catch (e) { /* нет URL */ }
    // 2. Пробуем из initData
    const tgUser = readTgUser();
    if (tgUser && tgUser.id) return Number(tgUser.id);
    // 3. Fallback: DEV_ID
    return DEV_ID;
  })();

  function closeApp() {
    if (tg && tg.close) tg.close(); else toast("Закройте вкладку, чтобы выйти");
  }

  /** Открывает чат поддержки @crymbog (и покупку премиума). */
  function openSupport() {
    try {
      if (tg && tg.openTelegramLink) return tg.openTelegramLink(SUPPORT_URL);
    } catch (e) { /* откроем как обычную ссылку */ }
    window.open(SUPPORT_URL, "_blank");
  }

  function readInitData() {
    try {
      if (tg && tg.initData) return tg.initData;
      return new URLSearchParams(location.hash.replace(/^#/, "")).get("tgWebAppData") || "";
    } catch (e) { return ""; }
  }

  /** Уведомление в Telegram-канал через бэкенд. Любая ошибка молча игнорируется, приложение продолжает работать. */
  function notifyChannel(payload) {
    if (!NOTIFY_URL) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const headers = { "Content-Type": "application/json", "Bypass-Tunnel-Reminder": "true" };
    const initData = readInitData();
    if (initData) headers["X-Init-Data"] = initData;
    headers["X-Dev-User"] = JSON.stringify({ id: TG_ID, username: "dev" });
    fetch(NOTIFY_URL.replace(/\/+$/, "") + "/api/notify", {
      method: "POST", headers, body: JSON.stringify(payload), signal: ctrl.signal, cache: "no-store",
    }).catch(() => { /* канал недоступен */ }).finally(() => clearTimeout(timer));
  }

  /** Если файл логотипа не загрузился, подставляем встроенную SVG-иконку. */
  function logoFallback(img) {
    if (!img.parentNode) return;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", img.className.replace("logo-img", "").trim());
    svg.innerHTML = '<use href="#i-logo"/>';
    if (img.classList.contains("logo-xl")) $$(".brand, .brand-sub").forEach((el) => el.classList.remove("hidden"));
    img.replaceWith(svg);
  }
  document.addEventListener("error", (e) => {
    if (e.target instanceof HTMLImageElement && e.target.classList.contains("logo-img")) logoFallback(e.target);
  }, true);

  /* ================= Локальная «база данных» ================= */
  let memoryDb = null; // запасной вариант, если localStorage недоступен

  function loadDb() {
    let db = null;
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (raw) db = JSON.parse(raw);
    } catch (e) { db = memoryDb; }
    if (!db || typeof db !== "object") db = memoryDb || {};
    ["users", "lobbies", "matches"].forEach((k) => { if (!Array.isArray(db[k])) db[k] = []; });
    return db;
  }

  function saveDb(db) {
    memoryDb = db;
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) { /* остаётся в памяти */ }
  }

  /** Читает БД и применяет истечение банов, мутов и лобби. */
  function readDb() {
    const db = loadDb();
    const t = now();
    let changed = false;
    db.users.forEach((u) => {
      if (u.is_banned && u.ban_until <= t) { u.is_banned = false; u.ban_reason = ""; u.ban_until = 0; changed = true; }
      if (u.is_muted && u.mute_until <= t) { u.is_muted = false; u.mute_until = 0; changed = true; }
    });
    db.lobbies.forEach((l) => {
      if (!l.teams) { l.teams = { KT: (l.players || []).slice(), T: [] }; changed = true; }
      if (l.status === "started") { l.status = "playing"; l.started_at = l.created_at; changed = true; }
      if (l.comment === undefined) { l.comment = ""; l.code = ""; l.started_at = l.started_at || 0; changed = true; }
      if (l.status === "open" && l.created_at < t - LOBBY_TTL) { l.status = "closed"; changed = true; }
      if (l.status === "playing" && l.started_at < t - PLAYING_TTL) { l.status = "closed"; changed = true; }
    });
    if (changed) saveDb(db);
    return db;
  }

  function initDb() { saveDb(loadDb()); } // первый запуск: пустые users, lobbies, matches

  function untilFromMinutes(min) {
    const m = Number(min);
    return !m || m <= 0 ? PERMANENT : now() + m * 60;
  }

  function withAdmin(u) { return u ? { ...u, is_admin: ADMIN_IDS.includes(u.tg_id) } : null; }

  /* ----- Пользователи ----- */
  async function getUser() {
    try {
      const res = await fetch(API_URL + "/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Dev-User": JSON.stringify({ id: TG_ID, username: "dev" }) },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.registered && data.user) return withAdmin(data.user);
    } catch (e) { /* сервер недоступен */ }
    return null;
  }

  async function registerUser(nickname, game_id) {
    nickname = String(nickname || "").trim();
    game_id = String(game_id || "").trim();
    if (!/^[A-Za-z0-9_\-А-Яа-яЁё]{3,20}$/.test(nickname)) throw new Error("Ник: 3–20 символов, буквы, цифры, _ и -");
    if (!/^\d{4,12}$/.test(game_id)) throw new Error("ID CounterFlame: от 4 до 12 цифр");

    const res = await fetch(API_URL + "/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Dev-User": JSON.stringify({ id: TG_ID, username: "dev" }) },
      body: JSON.stringify({ nickname, game_id }),
    });
    const data = await res.json();
    if (!data.registered) throw new Error(data.error || "Ошибка регистрации");
    return withAdmin(data.user);
  }

  function getAllUsers() {
    return readDb().users.slice().sort((a, b) => b.created_at - a.created_at);
  }

  function getLeaderboard() {
    return readDb().users.filter((u) => !u.is_banned).sort((a, b) => b.elo - a.elo || a.created_at - b.created_at).slice(0, 20);
  }

  function updateUser(tg_id, patch) {
    const db = readDb();
    const u = db.users.find((x) => x.tg_id === Number(tg_id));
    if (!u) throw new Error("Игрок не найден");
    if (ADMIN_IDS.includes(u.tg_id) && (patch.is_banned || patch.is_muted)) throw new Error("Нельзя наказать администратора");
    Object.assign(u, patch);
    saveDb(db);
  }

  function banUser(tg_id, reason, minutes) {
    reason = String(reason || "").trim().slice(0, 200);
    if (!reason) throw new Error("Укажите причину бана");
    updateUser(tg_id, { is_banned: true, ban_reason: reason, ban_until: untilFromMinutes(minutes) });
  }
  function unbanUser(tg_id) { updateUser(tg_id, { is_banned: false, ban_reason: "", ban_until: 0 }); }
  function muteUser(tg_id, minutes) { updateUser(tg_id, { is_muted: true, mute_until: untilFromMinutes(minutes) }); }
  function unmuteUser(tg_id) { updateUser(tg_id, { is_muted: false, mute_until: 0 }); }

  /* ----- Лобби ----- */
  const TEAMS = ["KT", "T"];
  const lobbyPlayers = (l) => l.teams.KT.concat(l.teams.T);

  function requireActiveUser(db) {
    const u = db.users.find((x) => x.tg_id === TG_ID);
    if (!u) throw new Error("Сначала пройдите регистрацию");
    if (u.is_banned) throw new Error("Вы забанены");
    if (u.is_muted) throw new Error("Вы заглушены и не можете создавать или входить в лобби");
    return u;
  }

  function findLobby(db, id) {
    const l = db.lobbies.find((x) => x.id === Number(id) && (x.status === "open" || x.status === "playing"));
    if (!l) throw new Error("Лобби не найдено или уже закрыто");
    return l;
  }

  function findHostLobby(db, id) {
    const l = findLobby(db, id);
    if (l.owner_tg_id !== TG_ID) throw new Error("Это действие доступно только хосту");
    return l;
  }

  /** Создатель становится хостом и сразу входит в выбранную команду. */
  async function createLobby(map, mode, team) {
    const res = await fetch(API_URL + "/api/lobbies", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Dev-User": JSON.stringify({ id: TG_ID, username: "dev" }) },
      body: JSON.stringify({ map, mode, team }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Ошибка создания лобби");
    return data.lobby_id;
  }

  async function getLobbies() {
    try {
      const res = await fetch(API_URL + "/api/lobbies", {
        headers: { "X-Dev-User": JSON.stringify({ id: TG_ID, username: "dev" }) },
      });
      const data = await res.json();
      if (data.ok && data.lobbies) return data.lobbies;
    } catch (e) { /* сервер недоступен */ }
    return [];
  }

  /** Подробности лобби (комментарий, код) доступны только участникам. */
  function getLobby(id) {
    const l = findLobby(readDb(), id);
    if (!lobbyPlayers(l).includes(TG_ID)) throw new Error("Вы не участник этого лобби");
    return l;
  }

  async function joinLobby(id, team) {
    const res = await fetch(API_URL + `/api/lobbies/${id}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Dev-User": JSON.stringify({ id: TG_ID, username: "dev" }) },
      body: JSON.stringify({ team }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Ошибка входа");
    return data;
  }

  /** Возвращает true, если лобби закрылось (вышел хост). */
  async function leaveLobby(id) {
    const res = await fetch(API_URL + `/api/lobbies/${id}/leave`, {
      method: "POST",
      headers: { "X-Dev-User": JSON.stringify({ id: TG_ID, username: "dev" }) },
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Ошибка выхода");
    return data;
  }

  function setLobbyComment(id, text) {
    const db = readDb();
    findHostLobby(db, id).comment = String(text || "").trim().slice(0, 300);
    saveDb(db);
  }

  function sendLobbyCode(id, code) {
    code = String(code || "").trim();
    if (code.length < 1 || code.length > 80) throw new Error("Код: от 1 до 80 символов");
    const db = readDb();
    findHostLobby(db, id).code = code;
    saveDb(db);
  }

  function startLobby(id) {
    const db = readDb();
    const l = findHostLobby(db, id);
    if (l.status !== "open") throw new Error("Матч уже начался");
    if (lobbyPlayers(l).length < 2) throw new Error("Для старта нужно минимум 2 игрока");
    l.status = "playing";
    l.started_at = now();
    db.matches.push({ id: db.matches.length + 1, lobby_id: l.id, map: l.map, mode: l.mode, started_at: l.started_at });
    saveDb(db);
    return l;
  }

  function getOnlineCount() {
    const ids = new Set();
    readDb().lobbies.filter((l) => l.status === "open" || l.status === "playing").forEach((l) => lobbyPlayers(l).forEach((p) => ids.add(p)));
    return ids.size;
  }

  /* ================= Интерфейс ================= */
  let me = null;
  let stack = [];
  let timers = [];
  let adminUnlocked = false;
  let punish = null;

  function show(id) {
    $$(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
    if (tg && tg.BackButton) {
      try { (id === "s-register" || id === "s-main") ? tg.BackButton.show() : tg.BackButton.hide(); } catch (e) { /* не поддерживается */ }
    }
  }

  function stopTimers() { timers.forEach(clearInterval); timers = []; }

  function showBan(u) {
    stopTimers();
    const term = u.ban_until >= PERMANENT ? "Срок: навсегда." : `Срок: до ${fmtDate(u.ban_until)}.`;
    $("#ban-text").textContent = `Вы заблокированы на серверах CYBERSHOKE. Причина: ${u.ban_reason || "не указана"}. Оспорить бан можно в поддержке @crymbog.\n${term}`;
    show("s-banned");
  }

  async function boot() {
    show("s-loading");
    $("#btn-retry").classList.add("hidden");
    $("#load-msg").textContent = "Загружаем данные";
    try {
      initDb();
      await wait(900);
      const user = await getUser();
      if (!user) return show(localStorage_get("terms") === "1" ? "s-register" : "s-welcome");
      if (user.is_banned) return showBan(user);
      me = user;
      enterApp();
    } catch (e) {
      $("#load-msg").textContent = e.message;
      $("#btn-retry").classList.remove("hidden");
    }
  }

  function localStorage_get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function localStorage_set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* игнор */ } }

  async function register() {
    const err = $("#reg-error");
    err.classList.add("hidden");
    try {
      me = await registerUser($("#in-nick").value, $("#in-gid").value);
      if (me.is_banned) return showBan(me);
      enterApp();
    } catch (e) {
      err.textContent = e.message;
      err.classList.remove("hidden");
    }
  }

  function enterApp() {
    $("#nav-admin").classList.toggle("hidden", !me.is_admin);
    updateHeader();
    show("s-main");
    stopTimers();
    stack = [];
    navigate("matches", true);
    timers.push(setInterval(() => {
      updateHeader();
      const v = stack[stack.length - 1];
      if (v === "matches") loadLobbies();
      // renderRoom убран из автообновления (вызывается только при входе в комнату и вручную)
    }, 10000));
  }

  async function updateHeader() {
    const fresh = await getUser();
    if (fresh) me = fresh;
    $("#hdr-coins").textContent = me.coins.toLocaleString("ru-RU");
    $("#hdr-online").textContent = getOnlineCount();
  }

  function toggleMenu(open) { $("#s-main").classList.toggle("menu-open", open); }

  function navigate(view, reset = false) {
    if (view === "admin" && !me.is_admin) return;
    if (reset) stack = [view];
    else if (stack[stack.length - 1] !== view) stack.push(view);
    renderView(view);
    toggleMenu(false);
  }

  function back() {
    if ($(".modal:not(.hidden)")) return closeModals();
    if (stack.length > 1) { stack.pop(); renderView(stack[stack.length - 1]); return; }
    closeApp();
  }

  function renderView(view) {
    updateHeader();
    if (me.is_banned) return showBan(me);
    $$(".view").forEach((v) => v.classList.toggle("active", v.id === `v-${view}`));
    $$(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.view === view));
    $("main").scrollTop = 0;
    ({ matches: loadLobbies, leaderboard: loadLeaderboard, missions: renderMissions, profile: loadProfile, subs: renderSubs, admin: renderAdminState, news: loadNews, lobby: () => renderRoom(true) })[view]();
  }

  function closeModals() { $$(".modal").forEach((m) => m.classList.add("hidden")); }

  /* ----- Матчи ----- */
  let roomId = null;
  let joinTarget = null;
  const isMember = (l) => lobbyPlayers(l).includes(TG_ID);
  const guard = (fn) => { try { fn(); } catch (e) { toast(e.message, "err"); } };
  const nameOf = (id) => { const u = getAllUsers().find((x) => x.tg_id === id); return u ? u.nickname : "Игрок"; };
  const lobbyInfo = (l) => ({ lobby_id: l.id, map: l.map, mode: l.mode, players: lobbyPlayers(l).length, max_players: l.max_players });

  async function loadLobbies() {
    const el = $("#lobby-list");
    el.innerHTML = '<div class="loader"></div>';
    try {
      const res = await fetch(API_URL + "/api/lobbies", {
        headers: { "X-Dev-User": JSON.stringify({ id: TG_ID, username: "dev" }) },
      });
      const data = await res.json();
      if (!data.ok || !data.lobbies.length) {
        el.innerHTML = '<div class="card empty">Активных лобби нет. Создайте первое.</div>';
        return;
      }
      el.innerHTML = data.lobbies.map((l) => {
        const n = (l.teams?.KT?.length || 0) + (l.teams?.T?.length || 0);
        const isMember = (l.teams?.KT || []).includes(TG_ID) || (l.teams?.T || []).includes(TG_ID);
        const isHost = l.owner_tg_id === TG_ID;
        let action = "";
        if (isHost) {
          action = `<button class="btn primary sm" data-open="${l.id}" type="button">${ICON("game")}Открыть</button>`;
        } else if (isMember) {
          action = `<button class="btn ghost sm" data-open="${l.id}" type="button">${ICON("game")}Открыть</button>`;
        } else if (l.status === "playing") {
          action = '<span class="pill gold">идёт матч</span>';
        } else if (n >= l.max_players) {
          action = '<span class="pill">заполнено</span>';
        } else {
          action = `<button class="btn ghost sm" data-join="${l.id}" type="button">${ICON("game")}Войти</button>`;
        }
        const img = MAP_IMAGES[l.map] || "";
        return `
        <div class="card row" data-lobby-id="${l.id}">
          ${img ? `<img src="${img}" alt="${esc(l.map)}" style="width:60px;height:60px;object-fit:cover;border-radius:8px;margin-right:12px;">` : ""}
          <div class="grow">
            <h3>${esc(l.map)} · ${esc(l.mode)}</h3>
            <div class="meta">
              <span>${ICON("users")}${n}/${l.max_players}</span>
              <span>${ICON("clock")}${ago(l.created_at)}</span>
            </div>
          </div>
          ${action}
        </div>`;
      }).join("");
    } catch (e) {
      el.innerHTML = '<div class="card empty">Ошибка загрузки лобби</div>';
    }
  }

  
  function openLobbyModal() {
    $("#sel-map").innerHTML = MAPS.map((m) => `<option>${esc(m)}</option>`).join("");
    $("#sel-mode").innerHTML = Object.keys(MODE_SIZE).map((m) => `<option>${esc(m)}</option>`).join("");
    const updateDesc = () => {
      const mode = $("#sel-mode").value;
      $("#mode-desc").textContent = MODE_INFO[mode] || "";
    };
    $("#sel-mode").onchange = updateDesc;
    updateDesc();
    $("#m-lobby").classList.remove("hidden");
  }

  async function submitLobby() {
    try {
      const team = Math.random() < 0.5 ? "KT" : "T";
      const lobbyId = await createLobby($("#sel-map").value, $("#sel-mode").value, team);
      notifyChannel({ type: "create", owner: me.nickname, lobby_id: lobbyId, map: $("#sel-map").value, mode: $("#sel-mode").value, players: 1, max_players: MODE_SIZE[$("#sel-mode").value] });
      closeModals();
      toast(`Лобби создано. Вы хост, ваша команда: ${team}`);
      openRoom(lobbyId);
    } catch (e) {
      toast(e.message, "err");
      // Отладка на экран
      const debugEl = document.createElement("div");
      debugEl.style.cssText = "position:fixed; bottom:0; left:0; right:0; background:red; color:white; padding:10px; font-size:12px; z-index:9999;";
      debugEl.textContent = "DEBUG: " + e.message;
      document.body.appendChild(debugEl);
      setTimeout(() => debugEl.remove(), 10000);
    }
  }

  
  async function openTeamModal(id) {
    try {
      const lobbies = await getLobbies();
      const l = lobbies.find((x) => String(x.id) === String(id));
      if (!l) {
        toast("Лобби не найдено в списке (ID: " + id + ")", "err");
        return;
      }
    joinTarget = l.id;
    const ktCount = (l.teams?.KT || []).length;
    const tCount = (l.teams?.T || []).length;
    const cap = l.max_players / 2;
    let team;
    if (ktCount < cap && tCount < cap) {
      team = ktCount <= tCount ? "KT" : "T";
    } else if (ktCount < cap) {
      team = "KT";
    } else if (tCount < cap) {
      team = "T";
    } else {
      return toast("Лобби заполнено", "err");
    }
    await doJoin(team);
    } catch (e) {
      toast("Ошибка: " + e.message, "err");
      const debugEl = document.createElement("div");
      debugEl.style.cssText = "position:fixed; bottom:0; left:0; right:0; background:red; color:white; padding:10px; font-size:12px; z-index:9999;";
      debugEl.textContent = "DEBUG openTeamModal: " + e.message;
      document.body.appendChild(debugEl);
      setTimeout(() => debugEl.remove(), 10000);
    }
  }

  async function doJoin(team) {
    try {
      await joinLobby(joinTarget, team);
      closeModals();
      toast(`Вы вошли в команду ${team}`);
      openRoom(joinTarget);
    } catch (e) {
      toast(e.message, "err");
    }
  }

  /* ----- Комната лобби ----- */
  function openRoom(id) { roomId = Number(id); navigate("lobby"); }

  async function submitMatchResult() {
    toast("Отправка скриншота...", "ok");
    try {
      // Получаем лобби с сервера
      const res = await fetch(API_URL + "/api/lobbies", {
        headers: { "X-Dev-User": JSON.stringify({ id: TG_ID, username: "dev" }) },
      });
      const data = await res.json();
      if (!data.ok) throw new Error("Не удалось получить лобби");
      const l = data.lobbies.find((x) => String(x.id) === String(roomId));
      if (!l) throw new Error("Лобби не найдено");

      const fileInput = document.getElementById("result-screenshot");
      if (!fileInput.files.length) {
        toast("Выберите скриншот матча", "err");
        return;
      }
      const file = fileInput.files[0];
      const formData = new FormData();
      formData.append("screenshot", file);
      formData.append("lobby_id", l.id);
      formData.append("map", l.map);
      formData.append("mode", l.mode);
      formData.append("owner", me.nickname);
      const ktNicks = (l.teams?.KT || []).map((id) => nameOf(id));
      const tNicks = (l.teams?.T || []).map((id) => nameOf(id));
      const allPlayers = ktNicks.concat(tNicks);
      formData.append("players", JSON.stringify(allPlayers));
      formData.append("teams", JSON.stringify({ KT: ktNicks, T: tNicks }));

      const uploadRes = await fetch(API_URL + "/api/match/submit", {
        method: "POST",
        headers: { "X-Dev-User": JSON.stringify({ id: TG_ID, username: "dev" }) },
        body: formData,
      });
      if (!uploadRes.ok) throw new Error("Ошибка отправки скриншота");
      toast("Скриншот отправлен админу ✅", "ok");
      fileInput.value = "";
      // Удаляем лобби (выходим)
      await leaveLobby(l.id);
      roomId = null;
      setTimeout(() => back(), 1000);
    } catch (e) {
      toast("Ошибка: " + e.message, "err");
    }
  }

  async function renderRoom(full) {
    let l;
    try {
      const res = await fetch(API_URL + "/api/lobbies", {
        headers: { "X-Dev-User": JSON.stringify({ id: TG_ID, username: "dev" }) },
      });
      const data = await res.json();
      if (!data.ok || !data.lobbies) throw new Error("Лобби не найдено");
      l = data.lobbies.find((x) => String(x.id) === String(roomId));
      if (!l) throw new Error("Лобби не найдено или закрыто");
    } catch (e) {
      toast(e.message, "err");
      roomId = null;
      if (stack.length > 1) back(); else navigate("matches", true);
      return;
    }
    const isHost = l.owner_tg_id === TG_ID;
    const cap = l.max_players / 2;
    $("#room-title").innerHTML = `${MAP_IMAGES[l.map] ? `<img src="${MAP_IMAGES[l.map]}" style="width:80px;height:50px;object-fit:cover;border-radius:8px;vertical-align:middle;margin-right:8px;">` : ""}${esc(l.map)} · ${esc(l.mode)}`;
    const st = $("#room-status");
    st.textContent = l.status === "playing" ? "идёт матч" : "набор игроков";
    st.className = `pill ${l.status === "playing" ? "gold" : "blue"}`;
    TEAMS.forEach((tm) => {
      const teamArr = l.teams?.[tm] || [];
      $(`#count-${tm}`).textContent = `${teamArr.length}/${cap}`;
      $(`#room-${tm}`).innerHTML = teamArr.length
        ? teamArr.map((id) => `<li>${ICON(id === l.owner_tg_id ? "crown" : "user")}<span>${esc(nameOf(id))}</span></li>`).join("")
        : '<li class="muted">Пока никого</li>';
    });
    $$(".host-only").forEach((el) => el.classList.toggle("hidden", !isHost));
    $$(".guest-only").forEach((el) => el.classList.toggle("hidden", isHost));
    if (full) { $("#in-comment").value = l.comment || ""; $("#in-code").value = l.code || ""; }
    $("#room-comment-view").textContent = l.comment || "Комментария нет";
    $("#room-code-view").innerHTML = l.code ? `Код для CounterFlame: <b>${esc(l.code)}</b>` : '<span class="muted">Хост ещё не отправил код</span>';
    $("#btn-room-start").disabled = l.status !== "open";
    $("#leave-label").textContent = isHost ? "Закрыть лобби" : "Покинуть";
  }

  function roomAction(act) {
    if (act === "room-refresh") { renderRoom(false); return toast("Состав обновлён"); }
    guard(() => {
      if (act === "room-comment") { setLobbyComment(roomId, $("#in-comment").value); toast("Комментарий сохранён"); }
      if (act === "room-code") { sendLobbyCode(roomId, $("#in-code").value); toast("Код отправлен участникам"); }
      if (act === "room-start") {
        const l = startLobby(roomId);
        notifyChannel({ type: "start", owner: me.nickname, ...lobbyInfo(l) });
        toast("Матч начался");
      }
      if (act === "room-leave") {
        const closed = leaveLobby(roomId);
        toast(closed ? "Лобби закрыто" : "Вы вышли из лобби");
        roomId = null;
        return back();
      }
      renderRoom(false);
    });
  }

  /* ----- Лидерборд, миссии, подписки ----- */

  async function loadNews() {
    // Показываем кнопку создания только админу
    const btnCreate = $("#btn-create-news");
    if (btnCreate) btnCreate.classList.toggle("hidden", !me || !me.is_admin);
    const el = $("#news-list");
    el.innerHTML = '<div class="loader"></div>';
    try {
      const res = await fetch(API_URL + "/api/news", {
        headers: { "X-Dev-User": JSON.stringify({ id: TG_ID, username: "dev" }) },
      });
      const data = await res.json();
      if (!data.ok || !data.news.length) {
        el.innerHTML = '<div class="card empty">Пока нет новостей.</div>';
        return;
      }
      const isAdmin = me && me.is_admin;
      el.innerHTML = data.news.map((n) => `
        <div class="card" style="margin-bottom:12px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <h3 style="flex:1;">${esc(n.title)}</h3>
            ${isAdmin ? `<button class="btn danger sm" data-del-news="${n.id}" type="button" style="width:auto;padding:4px 10px;font-size:11px;">Удалить</button>` : ""}
          </div>
          ${n.photo_id ? `<img src="https://api.telegram.org/file/bot${BOT_TOKEN}/${n.photo_id}" style="width:100%; border-radius:12px; margin-top:8px;" onerror="this.style.display='none'">` : ""}
          <p style="color:var(--muted); font-size:14px; margin-top:8px;">${esc(n.content)}</p>
        </div>
      `).join("");
    } catch (e) {
      el.innerHTML = '<div class="card empty">Ошибка загрузки новостей.</div>';
    }
  }

  async function loadLeaderboard() {
    const el = $("#lb-list");
    el.innerHTML = '<div class="loader"></div>';
    let players = [];
    try {
      const res = await fetch(API_URL + "/api/leaderboard", {
        headers: { "X-Dev-User": JSON.stringify({ id: TG_ID, username: "dev" }) },
      });
      const data = await res.json();
      if (data.ok && data.players) players = data.players;
    } catch (e) {
      players = [];
    }
    if (!players.length) {
      el.innerHTML = '<div class="card empty">Рейтинг пока пуст.</div>';
      return;
    }

    const top3 = players.slice(0, 3);
    const rest = players.slice(3);

    // Подиум (2, 1, 3)
    let podiumHtml = "";
    if (top3.length >= 3) {
      const getAvatar = (nick) => {
        const saved = localStorage_get("avatar_" + nick);
        if (saved) return `<img src="${saved}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
        return nick.charAt(0).toUpperCase();
      };
      podiumHtml = `
        <div class="podium">
          <div class="podium-item pos-2">
            <div class="avatar">${getAvatar(top3[1].nickname)}</div>
            <div class="nick">${esc(top3[1].nickname)}</div>
            <div class="points">${top3[1].points} CP</div>
            <div class="podium-block">2</div>
          </div>
          <div class="podium-item pos-1">
            <div class="avatar">
              <svg class="crown" viewBox="0 0 24 24" fill="#f0b358"><path d="M2 18h20v2H2zM2 8l5 5 5-8 5 8 5-5v8H2z"/></svg>
              ${getAvatar(top3[0].nickname)}
            </div>
            <div class="nick">${esc(top3[0].nickname)}</div>
            <div class="points">${top3[0].points} CP</div>
            <div class="podium-block">1</div>
          </div>
          <div class="podium-item pos-3">
            <div class="avatar">${getAvatar(top3[2].nickname)}</div>
            <div class="nick">${esc(top3[2].nickname)}</div>
            <div class="points">${top3[2].points} CP</div>
            <div class="podium-block">3</div>
          </div>
        </div>
      `;
    }

    // Остальной список (с 4 места)
    const restHtml = rest.map((p, i) => `
      <div class="card row" style="margin-bottom:8px;">
        <div class="rank" style="font-family:'Orbitron'; font-weight:900; color:var(--muted); width:32px;">#${i + 4}</div>
        <div class="grow"><h3 style="margin:0;">${esc(p.nickname)}</h3></div>
        <span class="pill gold">${p.points} CP</span>
      </div>
    `).join("");

    el.innerHTML = podiumHtml + (restHtml ? `<div style="margin-top:16px;">${restHtml}</div>` : "");
  }

  function renderMissions() {
    $("#mission-list").innerHTML = MISSIONS.map((m) => `
      <div class="card">
        <div class="row" style="padding:0">
          <div class="grow"><h3>${esc(m.title)}</h3><div class="meta"><span>${ICON("coin")}+${m.reward} коинов</span></div></div>
          <span class="pill">0/${m.goal}</span>
        </div>
        <div class="bar"><i style="width:0%"></i></div>
      </div>`).join("");
  }

  function renderSubs() {
    $("#subs-list").innerHTML = PLANS.map((p) => `
      <div class="card plan ${p.cls}">
        <div class="row" style="padding:0"><h3 class="grow">${esc(p.name)}</h3><span class="price">${esc(p.price)}</span></div>
        <ul>${p.perks.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        <button class="btn ${p.cls === "premium" ? "gold" : "lite"} wide" data-sub="${esc(p.id)}" type="button">${ICON("star")}Купить</button>
      </div>`).join("") + '<p class="muted small">Оплата в Telegram Stars: после нажатия откроется чат с @crymbog.</p>';
  }

  /* ----- Профиль ----- */
  async function loadProfile() {
    // Подтягиваем поинты с сервера (если доступен)
    try {
      const res = await fetch(API_URL + "/api/points/get", {
        headers: { "X-Dev-User": JSON.stringify({ id: TG_ID, username: "dev" }) },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.points !== undefined) {
          me.points = data.points;
          // Обновляем localStorage
          const db = readDb();
          const u = db.users.find((x) => x.tg_id === TG_ID);
          if (u) { u.points = data.points; saveDb(db); }
        }
      }
    } catch (e) { /* сервер недоступен, используем localStorage */ }

    // Показываем аватарку (если загружена)
    const savedAvatar = localStorage_get("avatar_" + TG_ID);
    if (savedAvatar) {
      $("#p-avatar").innerHTML = `<img src="${savedAvatar}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
    } else {
      $("#p-avatar").textContent = me.nickname.charAt(0).toUpperCase();
    }
    $("#p-nick").textContent = me.nickname;
    $("#p-gid").textContent = me.game_id;
    $("#p-points").textContent = me.points.toLocaleString("ru-RU");
    $("#p-coins").textContent = me.coins.toLocaleString("ru-RU");
    $("#p-kd").textContent = Number(me.kd).toFixed(2);
    $("#p-avg").textContent = Number(me.avg).toFixed(1);
    const banner = $("#mute-banner");
    banner.classList.toggle("hidden", !me.is_muted);
    if (me.is_muted) $("span", banner).textContent = `${me.mute_until >= PERMANENT ? "Вы заглушены навсегда" : "Вы заглушены до " + fmtDate(me.mute_until)}. Оспорить мут можно в поддержке @crymbog.`;
  }

  /* ----- Админка ----- */
  function renderAdminState() {
    $("#admin-lock").classList.toggle("hidden", adminUnlocked);
    $("#admin-body").classList.toggle("hidden", !adminUnlocked);
    if (adminUnlocked) drawAdminList();
  }

  function adminLogin() {
    const err = $("#admin-error");
    err.classList.add("hidden");
    if ($("#in-admin-pass").value !== ADMIN_PASSWORD) {
      err.textContent = "Неверный пароль";
      err.classList.remove("hidden");
      return;
    }
    adminUnlocked = true;
    $("#in-admin-pass").value = "";
    renderAdminState();
  }

  function drawAdminList() {
    const q = $("#in-admin-search").value.trim().toLowerCase();
    const rows = getAllUsers().filter((p) => !q || p.nickname.toLowerCase().includes(q) || p.game_id.includes(q) || String(p.tg_id).includes(q));
    $("#admin-list").innerHTML = rows.length ? rows.map((p) => `
      <div class="card row admin-row">
        <div class="row" style="padding:0">
          <div class="grow">
            <h3>${esc(p.nickname)}</h3>
            <div class="meta"><span>ID ${esc(p.game_id)}</span><span>TG ${p.tg_id}</span><span>${p.points} Поинтов</span></div>
          </div>
          ${p.is_banned ? '<span class="pill red">бан</span>' : ""}${p.is_muted ? '<span class="pill gold">мут</span>' : ""}
        </div>
        ${p.is_banned ? `<div class="meta"><span>Причина: ${esc(p.ban_reason)} · ${fmtDate(p.ban_until)}</span></div>` : ""}
        <div class="actions">
          <button class="btn danger" data-adm="ban" data-id="${p.tg_id}" type="button">${ICON("ban")}Бан</button>
          <button class="btn ghost" data-adm="mute" data-id="${p.tg_id}" type="button">${ICON("mute")}Мут</button>
          <button class="btn ghost" data-adm="unban" data-id="${p.tg_id}" type="button">${ICON("check")}Разбан</button>
          <button class="btn ghost" data-adm="unmute" data-id="${p.tg_id}" type="button">${ICON("check")}Размут</button>
        </div>
      </div>`).join("") : `<div class="card empty">Игроки не найдены.</div>`;
  }

  function adminAction(action, id) {
    const p = getAllUsers().find((x) => x.tg_id === Number(id));
    if (!p) return;
    if (action === "ban" || action === "mute") {
      punish = { action, id: p.tg_id };
      $("#punish-title").textContent = action === "ban" ? "Бан игрока" : "Мут игрока";
      $("#punish-target").textContent = `${p.nickname} · ID ${p.game_id}`;
      $("#sel-time").innerHTML = TIMES.map((t) => `<option value="${t.min}">${esc(t.label)}</option>`).join("");
      $("#in-reason").value = "";
      $("#punish-error").classList.add("hidden");
      $("#m-punish").classList.remove("hidden");
      return;
    }
    try {
      if (action === "unban") { unbanUser(p.tg_id); toast("Игрок разбанен"); } else { unmuteUser(p.tg_id); toast("Мут снят"); }
      drawAdminList();
    } catch (e) { toast(e.message, "err"); }
  }

  function submitPunish() {
    const err = $("#punish-error");
    err.classList.add("hidden");
    try {
      const minutes = Number($("#sel-time").value);
      if (punish.action === "ban") banUser(punish.id, $("#in-reason").value, minutes);
      else muteUser(punish.id, minutes);
      closeModals();
      toast(punish.action === "ban" ? "Игрок забанен" : "Игрок заглушён");
      drawAdminList();
    } catch (e) {
      err.textContent = e.message;
      err.classList.remove("hidden");
    }
  }

  /* ================= События ================= */
  document.addEventListener("click", (ev) => {
    const el = ev.target.closest("button");
    if (!el) return;
    if (el.dataset.delNews) {
      if (!confirm("Удалить новость?")) return;
      fetch(API_URL + "/api/news/" + el.dataset.delNews, {
        method: "DELETE",
        headers: { "X-Dev-User": JSON.stringify({ id: TG_ID, username: "dev" }) },
      }).then((r) => r.json()).then((d) => {
        if (d.ok) { toast("Новость удалена", "ok"); loadNews(); }
        else toast(d.error || "Ошибка", "err");
      });
      return;
    }
    if (el.dataset.join) return openTeamModal(el.dataset.join);
    if (el.dataset.open) return openRoom(el.dataset.open);
    if (el.dataset.team) return doJoin(el.dataset.team);
    if (el.dataset.adm) return adminAction(el.dataset.adm, el.dataset.id);
    if (el.dataset.sub) return openSupport();
    if (el.dataset.view) return navigate(el.dataset.view, el.classList.contains("nav-item"));
    switch (el.dataset.act) {
      case "back": return back();
      case "close-modal": return closeModals();
      case "welcome-back": return closeApp();
      case "register-back": return show("s-welcome");
      case "support": return openSupport();
      case "room-submit": return submitMatchResult();
      case "room-refresh": case "room-comment": case "room-code": case "room-start": case "room-leave":
        return roomAction(el.dataset.act);
    }
  });

  $("#btn-retry").addEventListener("click", boot);
  $("#btn-accept").addEventListener("click", () => { localStorage_set("terms", "1"); show("s-register"); });
  $("#btn-register").addEventListener("click", register);
  $("#in-gid").addEventListener("input", (e) => (e.target.value = e.target.value.replace(/\D/g, "")));
  $("#btn-ban-close").addEventListener("click", () => (tg && tg.close ? tg.close() : boot()));
  $("#btn-burger").addEventListener("click", () => toggleMenu(!$("#s-main").classList.contains("menu-open")));
  $("#overlay").addEventListener("click", () => toggleMenu(false));
  $("#btn-create-lobby").addEventListener("click", openLobbyModal);
  $("#btn-lobby-submit").addEventListener("click", submitLobby);
  $("#btn-submit-result").addEventListener("click", () => {
    const fileInput = document.getElementById("result-screenshot");
    if (!fileInput) return toast("Ошибка: поле для файла не найдено", "err");
    fileInput.click();
  });

  // Когда файл выбран — отправляем
  document.addEventListener("change", (e) => {
    if (e.target && e.target.id === "result-screenshot" && e.target.files.length) {
      submitMatchResult();
    }
  });
  $("#btn-admin-login").addEventListener("click", adminLogin);
  $("#in-admin-pass").addEventListener("keydown", (e) => { if (e.key === "Enter") adminLogin(); });
  $("#in-admin-search").addEventListener("input", drawAdminList);
  $("#btn-punish-submit").addEventListener("click", submitPunish);
  if (tg && tg.BackButton) {
    try { tg.BackButton.onClick(() => ($("#s-register").classList.contains("active") ? show("s-welcome") : back())); } catch (e) { /* не поддерживается */ }
  }

  $$(".logo-img").forEach((img) => { if (img.complete && img.naturalWidth === 0) logoFallback(img); });
  // Загрузка аватарки (клик на аватарку)
  const avatarEl = document.getElementById("p-avatar");
  const avatarInput = document.getElementById("avatar-upload");
  if (avatarEl && avatarInput) {
    avatarEl.addEventListener("click", () => {
      avatarInput.click();
    });
    avatarInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const base64 = ev.target.result;
        localStorage_set("avatar_" + TG_ID, base64);
        $("#p-avatar").innerHTML = `<img src="${base64}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
        toast("Аватарка обновлена ✅", "ok");
      };
      reader.readAsDataURL(file);
    });
  }


  // Создание новости (только админ)
  const btnNewsSubmit = document.getElementById("btn-news-submit");
  if (btnNewsSubmit) {
    btnNewsSubmit.addEventListener("click", async () => {
      toast("Публикация...", "ok");
      const title = $("#in-news-title").value.trim();
      const content = $("#in-news-content").value.trim();
      if (!title || !content) return toast("Заполните заголовок и текст", "err");
      try {
        const res = await fetch(API_URL + "/api/news", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Dev-User": JSON.stringify({ id: TG_ID, username: "dev" }) },
          body: JSON.stringify({ title, content }),
        });
        const data = await res.json();
        if (data.ok) {
          toast("Новость опубликована ✅", "ok");
          closeModals();
          $("#in-news-title").value = "";
          $("#in-news-content").value = "";
          loadNews();
        } else {
          toast(data.error || "Ошибка", "err");
        }
      } catch (e) { toast("Ошибка сервера", "err"); }
    });
  }

  // Кнопка "Создать" в новостях (только админ)
  const btnCreateNews = document.getElementById("btn-create-news");
  if (btnCreateNews) {
    btnCreateNews.addEventListener("click", () => {
      const modal = document.getElementById("m-news");
      if (modal) modal.classList.remove("hidden");
    });
  }

  window.submitNews = async function() {
    const title = document.getElementById("in-news-title").value.trim();
    const content = document.getElementById("in-news-content").value.trim();
    const photoInput = document.getElementById("in-news-photo");
    toast("DEBUG: title=" + title + " | content=" + content, "ok");
    if (!title || !content) return toast("Заполните заголовок и текст", "err");
    const formData = new FormData();
    formData.append("title", title);
    formData.append("content", content);
    if (photoInput && photoInput.files.length) {
      formData.append("photo", photoInput.files[0]);
    }
    try {
      const res = await fetch(API_URL + "/api/news", {
        method: "POST",
        headers: { "X-Dev-User": JSON.stringify({ id: TG_ID, username: "dev" }) },
        body: formData,
      });
      const data = await res.json();
      if (data.ok) {
        toast("Новость опубликована ✅", "ok");
        closeModals();
        document.getElementById("in-news-title").value = "";
        document.getElementById("in-news-content").value = "";
        if (photoInput) photoInput.value = "";
        loadNews();
      } else {
        toast(data.error || "Ошибка", "err");
      }
    } catch (e) { toast("Ошибка сервера", "err"); }
  };

  boot();
})();
