(() => {
  "use strict";

  /* ================= Конфигурация ================= */
  const DB_KEY = "cs_db_v1";
  const TEST_TG_ID = 6999358439;
  const ADMIN_IDS = [6999358439];
  const ADMIN_PASSWORD = "shoke26";
  const PERMANENT = 4102444800;
  const LOBBY_TTL = 1800;
  // Адрес бэкенда с /api/notify (например "https://api.example.com"). Пусто = уведомления в канал выключены.
  const NOTIFY_URL = "";
  const MAPS = ["Mirage", "Inferno", "Dust II", "Nuke", "Ancient", "Anubis", "Overpass", "Vertigo"];
  const MODE_SIZE = { "1v1": 2, "2v2": 4, "5v5": 10, "DM": 16 };
  const MISSIONS = [
    { title: "Сыграй 3 матча", reward: 150, goal: 3 },
    { title: "Победи в 2 матчах подряд", reward: 300, goal: 2 },
    { title: "Сделай 20 киллов за день", reward: 200, goal: 20 },
    { title: "Создай своё лобби", reward: 50, goal: 1 },
  ];
  const PLANS = [
    { name: "Basic", price: "199 ₽/мес", perks: ["Значок в профиле", "+10% кибер-поинтов"] },
    { name: "Pro", price: "499 ₽/мес", perks: ["Всё из Basic", "Приоритет в лобби", "+25% кибер-поинтов"], featured: true },
    { name: "Elite", price: "999 ₽/мес", perks: ["Всё из Pro", "Эксклюзивные турниры", "+50% кибер-поинтов"] },
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

  function readTgUser() {
    try {
      if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) return tg.initDataUnsafe.user;
    } catch (e) { /* нет данных */ }
    try {
      const raw = new URLSearchParams(location.hash.replace(/^#/, "")).get("tgWebAppData");
      const user = raw && new URLSearchParams(raw).get("user");
      if (user) return JSON.parse(user);
    } catch (e) { /* нет данных */ }
    return { id: TEST_TG_ID, username: "dev" };
  }
  const TG_ID = Number(readTgUser().id) || TEST_TG_ID;

  function closeApp() {
    if (tg && tg.close) tg.close(); else toast("Закройте вкладку, чтобы выйти");
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
    else headers["X-Dev-User"] = JSON.stringify({ id: TG_ID, username: "dev" });
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
      if (l.status === "open" && l.created_at < t - LOBBY_TTL) { l.status = "closed"; changed = true; }
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
  function getUser() {
    return withAdmin(readDb().users.find((u) => u.tg_id === TG_ID) || null);
  }

  function registerUser(nickname, game_id) {
    const db = readDb();
    const existing = db.users.find((u) => u.tg_id === TG_ID);
    if (existing) return withAdmin(existing);
    nickname = String(nickname || "").trim();
    game_id = String(game_id || "").trim();
    if (!/^[A-Za-z0-9_\-А-Яа-яЁё]{3,20}$/.test(nickname)) throw new Error("Ник: 3–20 символов, буквы, цифры, _ и -");
    if (!/^\d{4,12}$/.test(game_id)) throw new Error("ID CounterFlame: от 4 до 12 цифр");
    if (db.users.some((u) => u.game_id === game_id)) throw new Error("Этот ID CounterFlame уже зарегистрирован");
    const user = {
      tg_id: TG_ID, nickname, game_id, elo: 1000, coins: 0, points: 0, kd: 0, avg: 0,
      is_banned: false, ban_reason: "", ban_until: 0, is_muted: false, mute_until: 0, created_at: now(),
    };
    db.users.push(user);
    saveDb(db);
    return withAdmin(user);
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
  function requireActiveUser(db) {
    const u = db.users.find((x) => x.tg_id === TG_ID);
    if (!u) throw new Error("Сначала пройдите регистрацию");
    if (u.is_banned) throw new Error("Вы забанены");
    if (u.is_muted) throw new Error("Вы заглушены и не можете создавать или входить в лобби");
    return u;
  }

  function createLobby(map, mode) {
    const db = readDb();
    requireActiveUser(db);
    if (!MAPS.includes(map) || !MODE_SIZE[mode]) throw new Error("Неверная карта или режим");
    const lobby = {
      id: db.lobbies.reduce((m, l) => Math.max(m, l.id), 0) + 1,
      owner_tg_id: TG_ID, map, mode, max_players: MODE_SIZE[mode],
      players: [TG_ID], status: "open", created_at: now(),
    };
    db.lobbies.push(lobby);
    saveDb(db);
    return lobby;
  }

  function getLobbies() {
    return readDb().lobbies.filter((l) => l.status === "open").sort((a, b) => b.created_at - a.created_at).slice(0, 50);
  }

  function joinLobby(id) {
    const db = readDb();
    requireActiveUser(db);
    const lobby = db.lobbies.find((l) => l.id === Number(id) && l.status === "open");
    if (!lobby) throw new Error("Лобби уже закрыто");
    if (lobby.players.includes(TG_ID)) throw new Error("Вы уже в этом лобби");
    lobby.players.push(TG_ID);
    let started = false;
    if (lobby.players.length >= lobby.max_players) {
      lobby.status = "started";
      started = true;
      db.matches.push({ id: db.matches.length + 1, lobby_id: lobby.id, map: lobby.map, mode: lobby.mode, started_at: now() });
    }
    saveDb(db);
    return { lobby, started };
  }

  function getOnlineCount() {
    const ids = new Set();
    readDb().lobbies.filter((l) => l.status === "open").forEach((l) => l.players.forEach((p) => ids.add(p)));
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
    const until = u.ban_until >= PERMANENT ? "навсегда" : `до ${fmtDate(u.ban_until)}`;
    $("#ban-text").textContent = `Вы забанены ${until} по причине: ${u.ban_reason || "не указана"}`;
    show("s-banned");
  }

  function boot() {
    show("s-loading");
    $("#btn-retry").classList.add("hidden");
    $("#load-msg").textContent = "Загружаем данные";
    try {
      initDb();
      wait(900).then(() => {
        const user = getUser();
        if (!user) return show(localStorage_get("terms") === "1" ? "s-register" : "s-welcome");
        if (user.is_banned) return showBan(user);
        me = user;
        enterApp();
      });
    } catch (e) {
      $("#load-msg").textContent = e.message;
      $("#btn-retry").classList.remove("hidden");
    }
  }

  function localStorage_get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function localStorage_set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* игнор */ } }

  function register() {
    const err = $("#reg-error");
    err.classList.add("hidden");
    try {
      me = registerUser($("#in-nick").value, $("#in-gid").value);
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
    timers.push(setInterval(() => { updateHeader(); if (stack[stack.length - 1] === "matches") loadLobbies(); }, 15000));
  }

  function updateHeader() {
    const fresh = getUser();
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
    ({ matches: loadLobbies, leaderboard: loadLeaderboard, missions: renderMissions, profile: loadProfile, subs: renderSubs, admin: renderAdminState })[view]();
  }

  function closeModals() { $$(".modal").forEach((m) => m.classList.add("hidden")); }

  /* ----- Матчи ----- */
  function loadLobbies() {
    const lobbies = getLobbies();
    $("#lobby-list").innerHTML = lobbies.length
      ? lobbies.map((l) => `
        <div class="card row">
          <div class="grow">
            <h3>${esc(l.map)} · ${esc(l.mode)}</h3>
            <div class="meta">
              <span>${ICON("users")}${l.players.length}/${l.max_players}</span>
              <span>${ICON("clock")}${ago(l.created_at)}</span>
            </div>
          </div>
          <button class="btn ghost sm" data-join="${l.id}" type="button">${ICON("game")}Войти</button>
        </div>`).join("")
      : `<div class="card empty">Активных лобби нет. Создайте первое.</div>`;
  }

  function openLobbyModal() {
    $("#sel-map").innerHTML = MAPS.map((m) => `<option>${esc(m)}</option>`).join("");
    $("#sel-mode").innerHTML = Object.keys(MODE_SIZE).map((m) => `<option>${esc(m)}</option>`).join("");
    $("#m-lobby").classList.remove("hidden");
  }

  function submitLobby() {
    try {
      const lobby = createLobby($("#sel-map").value, $("#sel-mode").value);
      notifyChannel({ type: "create", lobby_id: lobby.id, owner: me.nickname, map: lobby.map, mode: lobby.mode, players: 1, max_players: lobby.max_players });
      closeModals();
      toast("Лобби создано");
      updateHeader();
      loadLobbies();
    } catch (e) { toast(e.message, "err"); }
  }

  function doJoin(id) {
    try {
      const res = joinLobby(id);
      if (res.lobby.players.length === 2) {
        const owner = getAllUsers().find((u) => u.tg_id === res.lobby.owner_tg_id);
        notifyChannel({ type: "join", lobby_id: res.lobby.id, owner: owner ? owner.nickname : "Игрок", joiner: me.nickname, map: res.lobby.map, mode: res.lobby.mode, players: 2, max_players: res.lobby.max_players });
      }
      toast(res.started ? "Лобби заполнено, матч начался" : "Вы вошли в лобби");
      updateHeader();
      loadLobbies();
    } catch (e) { toast(e.message, "err"); }
  }

  /* ----- Лидерборд, миссии, подписки ----- */
  function loadLeaderboard() {
    const players = getLeaderboard();
    $("#lb-list").innerHTML = players.length
      ? players.map((p, i) => `
        <div class="card row">
          <div class="rank ${i < 3 ? "top" + (i + 1) : ""}">${i + 1}</div>
          <div class="grow"><h3>${esc(p.nickname)}</h3><div class="meta"><span>К/Д ${p.kd}</span></div></div>
          <span class="pill gold">${p.elo} ELO</span>
        </div>`).join("")
      : `<div class="card empty">Рейтинг пока пуст.</div>`;
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
      <div class="card plan ${p.featured ? "featured" : ""}">
        <div class="row" style="padding:0"><h3 class="grow">${esc(p.name)}</h3><span class="price">${esc(p.price)}</span></div>
        <ul>${p.perks.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        <button class="btn ${p.featured ? "gold" : "ghost"} wide" data-sub="${esc(p.name)}" type="button">${ICON("star")}Оформить</button>
      </div>`).join("");
  }

  /* ----- Профиль ----- */
  function loadProfile() {
    $("#p-avatar").textContent = me.nickname.charAt(0).toUpperCase();
    $("#p-nick").textContent = me.nickname;
    $("#p-gid").textContent = me.game_id;
    $("#p-points").textContent = me.points.toLocaleString("ru-RU");
    $("#p-coins").textContent = me.coins.toLocaleString("ru-RU");
    $("#p-kd").textContent = Number(me.kd).toFixed(2);
    $("#p-avg").textContent = Number(me.avg).toFixed(1);
    const banner = $("#mute-banner");
    banner.classList.toggle("hidden", !me.is_muted);
    if (me.is_muted) $("span", banner).textContent = `Вы заглушены ${me.mute_until >= PERMANENT ? "навсегда" : "до " + fmtDate(me.mute_until)}`;
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
            <div class="meta"><span>ID ${esc(p.game_id)}</span><span>TG ${p.tg_id}</span><span>${p.elo} ELO</span></div>
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
    if (el.dataset.join) return doJoin(el.dataset.join);
    if (el.dataset.adm) return adminAction(el.dataset.adm, el.dataset.id);
    if (el.dataset.sub) return toast("Оплата подписок скоро появится");
    if (el.dataset.view) return navigate(el.dataset.view, el.classList.contains("nav-item"));
    switch (el.dataset.act) {
      case "back": return back();
      case "close-modal": return closeModals();
      case "welcome-back": return closeApp();
      case "register-back": return show("s-welcome");
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
  $("#btn-admin-login").addEventListener("click", adminLogin);
  $("#in-admin-pass").addEventListener("keydown", (e) => { if (e.key === "Enter") adminLogin(); });
  $("#in-admin-search").addEventListener("input", drawAdminList);
  $("#btn-punish-submit").addEventListener("click", submitPunish);
  if (tg && tg.BackButton) {
    try { tg.BackButton.onClick(() => ($("#s-register").classList.contains("active") ? show("s-welcome") : back())); } catch (e) { /* не поддерживается */ }
  }

  $$(".logo-img").forEach((img) => { if (img.complete && img.naturalWidth === 0) logoFallback(img); });
  boot();
})();
