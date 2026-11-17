(() => {
  "use strict";

  const PERMANENT = 4102444800;
  const SUPPORT_URL = "https://t.me/crymbog";
  const MAPS = ["Dust II", "Mirage", "Inferno", "Vertigo"];
  const MAP_IMAGES = {
    "Mirage": "assets/maps/mirage.jpeg",
    "Inferno": "assets/maps/inferno.jpg",
    "Dust II": "assets/maps/dust2.webp",
    "Vertigo": "assets/maps/vertigo.webp",
  };
  const MODE_SIZE = { "1v1": 2, "5v5": 10, "DM": 10 };
  const MODE_INFO = {
    "1v1": "Дуэль до 13 раундов",
    "5v5": "Премьер, до 13 раундов",
    "DM": "Deathmatch — против всех",
  };
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
  const BADGES = {
    owner: "Владелец", admin: "Админ", dev: "Разработчик", mod: "Модератор",
    vip: "VIP", pixel: "Pixel", premium: "PREMIUM", lite: "LITE",
  };
  const GRANT = ["vip", "pixel", "mod", "dev", "admin", "owner"];
  const BANNERS = {
    flame: "linear-gradient(120deg,#ff4655,#7a1020 60%,#1a0508)",
    ice: "linear-gradient(120deg,#6080ff,#1d2c73 60%,#0a1430)",
    neon: "linear-gradient(120deg,#ff3cac,#784ba0 50%,#2b86c5)",
    gold: "linear-gradient(120deg,#f0b358,#9c5f12 60%,#241505)",
    void: "linear-gradient(120deg,#2a2f3a,#10131a 60%,#05060a)",
    sakura: "linear-gradient(120deg,#ff7eb3,#a43a6b 55%,#1a0a14)",
    toxic: "linear-gradient(120deg,#2de2a1,#0e6b4d 55%,#04140e)",
    sunset: "linear-gradient(120deg,#ff9a44,#e0344f 55%,#2a1050)",
  };
  const STEPS = ["Набор", "Подтверждение", "Матч", "Результат"];
  const STATUS = {
    open: ["набор игроков", "blue"],
    confirming: ["подтверждение", "gold"],
    playing: ["идёт матч", "green"],
    review: ["результаты на проверке", "gold"],
    finished: ["матч завершён", "green"],
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ICON = (id) => `<svg><use href="#i-${id}"/></svg>`;
  const now = () => Math.floor(Date.now() / 1000);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function store(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    } catch (e) {}
    return null;
  }

  function toast(msg, type = "ok") {
    const t = $("#toast");
    t.textContent = msg;
    t.className = `toast show ${type}`;
    clearTimeout(toast.id);
    toast.id = setTimeout(() => (t.className = "toast"), 2600);
  }

  let timeOffset = 0;
  const serverNow = () => now() + timeOffset;

  function fmtDate(ts) {
    if (ts >= PERMANENT) return "навсегда";
    return new Date(ts * 1000).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function ago(ts) {
    const m = Math.max(0, Math.floor((serverNow() - ts) / 60));
    if (m < 1) return "только что";
    if (m < 60) return `${m} мин назад`;
    if (m < 1440) return `${Math.floor(m / 60)} ч назад`;
    return `${Math.floor(m / 1440)} дн назад`;
  }

  const tg = (window.Telegram && window.Telegram.WebApp) || null;
  if (tg) { try { tg.ready(); tg.expand(); } catch (e) {} }

  function haptic(kind) {
    try {
      if (!tg || !tg.HapticFeedback) return;
      if (kind === "ok") tg.HapticFeedback.notificationOccurred("success");
      else if (kind === "warn") tg.HapticFeedback.notificationOccurred("warning");
      else tg.HapticFeedback.impactOccurred("light");
    } catch (e) {}
  }

  function readTgUser() {
    try {
      if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) return tg.initDataUnsafe.user;
    } catch (e) {}
    try {
      const raw = new URLSearchParams(location.hash.replace(/^#/, "")).get("tgWebAppData");
      const user = raw && new URLSearchParams(raw).get("user");
      if (user) return JSON.parse(user);
    } catch (e) {}
    return null;
  }

  function resolveDevId() {
    const valid = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };
    let id = 0;
    try { id = valid(new URLSearchParams(location.search).get("tg_id")); } catch (e) {}
    if (id) { store("cs_dev_id", String(id)); return id; }
    id = valid(store("cs_dev_id"));
    return id || 6999358439;
  }
  const DEV_ID = resolveDevId();
  const TG_ID = Number((readTgUser() || {}).id) || DEV_ID;

  function readInitData() {
    try {
      if (tg && tg.initData) return tg.initData;
      return new URLSearchParams(location.hash.replace(/^#/, "")).get("tgWebAppData") || "";
    } catch (e) { return ""; }
  }

  function closeApp() {
    if (tg && tg.close) tg.close(); else toast("Закройте вкладку, чтобы выйти");
  }

    try {
      if (tg && tg.openTelegramLink) return tg.openTelegramLink(SUPPORT_URL);
    } catch (e) {}
    window.open(SUPPORT_URL, "_blank");
  }

  const cleanBase = (u) => String(u || "").trim().replace(/\/+$/, "");
  const validBase = (u) => /^https?:\/\/[^\s"'<>]+$/i.test(u);
  let API = "";

  function apiCandidates() {
    const list = [];
    let fromUrl = "";
    try { fromUrl = cleanBase(new URLSearchParams(location.search).get("api")); } catch (e) {}
    if (fromUrl && validBase(fromUrl)) { store("cs_api", fromUrl); list.push(fromUrl); }
    const saved = cleanBase(store("cs_api"));
    if (saved && validBase(saved)) list.push(saved);
    const conf = cleanBase(window.API_URL) || "https://discussed-delhi-appears-devel.trycloudflare.com";
    if (conf && validBase(conf)) list.push(conf);
    list.push("");
    return list.filter((v, i) => list.indexOf(v) === i);
  }

  async function ping(base) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch(base + "/api/ping", { cache: "no-store", signal: ctrl.signal, headers: { "Bypass-Tunnel-Reminder": "true" } });
      const data = await res.json();
      return Boolean(res.ok && data && data.ok);
    } catch (e) { return false; } finally { clearTimeout(timer); }
  }

  async function findApi() {
    const list = apiCandidates();
    for (const base of list) {
      if (await ping(base)) { API = base; return true; }
    }
    API = list[0] || "";
    return false;
  }

  async function api(path, opts = {}) {
    const headers = { "Bypass-Tunnel-Reminder": "true", "ngrok-skip-browser-warning": "1" };
    if (!opts.form) headers["Content-Type"] = "application/json";
    const init = readInitData();
    if (init) headers["X-Init-Data"] = init;
    headers["X-Dev-User"] = JSON.stringify({ id: TG_ID, username: "dev" });
    if (opts.admin) headers["X-Admin-Password"] = opts.admin;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.form ? 45000 : 12000);
    let res;
    try {
      res = await fetch(API + path, {
        method: opts.method || (opts.body || opts.form ? "POST" : "GET"),
        headers, signal: ctrl.signal, cache: "no-store",
        body: opts.form ? opts.form : opts.body ? JSON.stringify(opts.body) : undefined,
      });
    } catch (e) {
      const err = new Error("Нет связи с сервером");
      err.status = 0;
      throw err;
    } finally { clearTimeout(timer); }
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      const err = new Error(data.error || `Ошибка сервера (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function handleErr(e) {
    if (e && e.data && e.data.banned) return showBan(e.data);
    toast((e && e.message) || "Ошибка", "err");
  }

  const run = (fn) => Promise.resolve().then(fn).catch(handleErr);

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

  const imgUrl = (u) => (String(u).startsWith("/uploads/") ? API + u : u);

  function bannerCss(value) {
    if (value && value.startsWith("preset:") && BANNERS[value.slice(7)]) return BANNERS[value.slice(7)];
    if (value && value.startsWith("/uploads/")) return `url('${encodeURI(API + value)}') center/cover no-repeat`;
    return "linear-gradient(120deg,rgba(255,70,85,.45),rgba(96,128,255,.45))";
  }

  const sgn = (n) => (n > 0 ? "+" : "") + n;
  const verifiedIcon = () => '<svg class="vfy" role="img" aria-label="Верифицирован"><use href="#i-verified"/></svg>';
  const nameHtml = (nick, verified) => `<span class="nm"><span class="nm-t">${esc(nick)}</span>${verified ? verifiedIcon() : ""}</span>`;

  function avatarHtml(u, size) {
    const letter = esc(String(u.nickname || "?").charAt(0).toUpperCase());
    const img = u.avatar ? `<img src="${esc(imgUrl(u.avatar))}" alt="" loading="lazy" onerror="this.remove()">` : "";
    return `<span class="av" style="--s:${size}px">${letter}${img}</span>`;
  }

  function crownHtml() {
    return `<div class="crown-wrap"><svg class="crown" viewBox="0 0 64 44" aria-hidden="true">
      <defs><linearGradient id="crownGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0d68f"/><stop offset="1" stop-color="#c8963a"/></linearGradient></defs>
      <path d="M6 36L9 12l13 12L32 6l10 18 13-12 3 24z" fill="url(#crownGrad)" stroke="#a97a2a" stroke-width="1.5" stroke-linejoin="round"/>
      <rect x="6" y="36" width="52" height="6" rx="2.5" fill="#d9ac52" stroke="#a97a2a" stroke-width="1.2"/>
      <circle cx="9" cy="11" r="3" fill="#f6e4ae"/><circle cx="32" cy="5.5" r="3.4" fill="#f6e4ae"/><circle cx="55" cy="11" r="3" fill="#f6e4ae"/>
      <circle cx="20" cy="39" r="1.6" fill="#fff3cf"/><circle cx="32" cy="39" r="1.6" fill="#fff3cf"/><circle cx="44" cy="39" r="1.6" fill="#fff3cf"/>
      <path class="spark s1" d="M50 3l1.1 2.8 2.8 1.1-2.8 1.1L50 10.800 48.900 8 46.100 6.900 48.900 5.800z" fill="#fff6d6"/>
      <path class="spark s2" d="M14 20l.9 2.200 2.200.9-2.200.9L14 26.200l-.9-2.200-2.200-.9 2.200-.9z" fill="#fff6d6"/>
    </svg></div>`;
  }

  function badgesHtml(list) {
    return (list || []).filter((b) => BADGES[b]).map((b) => `<span class="badge b-${b}">${esc(BADGES[b])}</span>`).join("");
  }

  let me = null;
  let my = null;
  let stack = [];
  let timers = [];
  let lobbies = [];
  let adminPass = "";
  let adminUsers = [];
  let adminTab = "players";
  let punish = null;
  let badgeTarget = null;
  let planTarget = null;
  let pointsTarget = null;
  let afterAdmin = null;
  let postImage = "";
  let polling = false;

  function show(id) {
    $$(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
    if (tg && tg.BackButton) {
      try { (id === "s-register" || id === "s-main") ? tg.BackButton.show() : tg.BackButton.hide(); } catch (e) {}
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
    $("#api-fix").classList.add("hidden");
    $("#load-msg").textContent = "Загружаем данные";
    const reachable = await findApi();
    if (!reachable) return bootFailed("Не удаётся подключиться к серверу");
    try {
      const res = await api("/api/auth", { method: "POST", body: {} });
      if (res.banned) return showBan(res);
      if (!res.registered) return show(store("terms") === "1" ? "s-register" : "s-welcome");
      me = res.user;
      enterApp();
    } catch (e) {
      if (e.data && e.data.banned) return showBan(e.data);
      bootFailed(e.message);
    }
  }

  function bootFailed(message) {
    $("#load-msg").textContent = message;
    $("#api-current").textContent = API || "этот же адрес";
    $("#in-api").value = API;
    $("#btn-retry").classList.remove("hidden");
    $("#api-fix").classList.remove("hidden");
  }

  async function saveApi() {
    const v = cleanBase($("#in-api").value);
    if (!validBase(v)) return toast("Введите адрес вида https://...", "err");
    store("cs_api", v);
    boot();
  }

  async function register() {
    const err = $("#reg-error");
    err.classList.add("hidden");
    try {
      const res = await api("/api/auth", { method: "POST", body: { nickname: $("#in-nick").value.trim(), game_id: $("#in-gid").value.trim() } });
      if (res.banned) return showBan(res);
      me = res.user;
      enterApp();
    } catch (e) {
      err.textContent = e.message;
      err.classList.remove("hidden");
    }
  }

  function enterApp() {
    $("#nav-admin").classList.toggle("hidden", !me.is_admin);
    $("#btn-news-create").classList.toggle("hidden", !me.is_admin);
    updateHeader();
    show("s-main");
    stopTimers();
    stack = [];
    navigate("matches", true);
    pollMy(true);
    timers.push(setInterval(() => pollMy(false), 2500));
    timers.push(setInterval(() => {
      if (current() !== "matches") return;
      loadLobbies().catch(() => {});
      histTick += 1;
      if (histTick % 6 === 0) loadHistory(true).catch(() => {});
    }, 5000));
    timers.push(setInterval(tickConfirm, 500));
  }

  function updateHeader() {
    $("#hdr-coins").textContent = Number(me.coins || 0).toLocaleString("ru-RU");
  }

  function toggleMenu(open) { $("#s-main").classList.toggle("menu-open", open); }
  const current = () => stack[stack.length - 1];

  function navigate(view, reset = false) {
    if (view === "admin" && !me.is_admin) return;
    if (reset) stack = [view];
    else if (current() !== view) stack.push(view);
    renderView(view);
    toggleMenu(false);
  }

  function back() {
    if ($(".modal:not(.hidden):not(.modal-top)")) return closeModals();
    if (stack.length > 1) { stack.pop(); renderView(current()); return; }
    closeApp();
  }

  function renderView(view) {
    updateHeader();
    $$(".view").forEach((v) => v.classList.toggle("active", v.id === `v-${view}`));
    const navOf = { lobby: "matches", subs: "profile", player: "leaderboard" }[view] || view;
    $$(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.view === navOf));
    $("main").scrollTop = 0;
    updateDot();
    const handlers = {
      matches: loadMatchesView, news: loadNews, leaderboard: loadLeaderboard, missions: renderMissions,
      profile: loadProfile, subs: renderSubs, admin: renderAdminState, lobby: () => renderRoom(true), player: loadPlayer,
    };
    run(handlers[view]);
  }

  function closeModals() { $$(".modal:not(.modal-top)").forEach((m) => m.classList.add("hidden")); }
  function openModal(id) { $(`#${id}`).classList.remove("hidden"); }

  function updateDot() {
    $("#nav-dot").classList.toggle("hidden", !my || current() === "lobby");
  }

  async function pollMy(first) {
    if (polling) return;
    polling = true;
    try {
      const d = await api("/api/my_lobby");
      timeOffset = d.server_time - now();
      $("#hdr-online").textContent = d.online;
      applyMy(d.lobby, first === true);
    } catch (e) {
      if (e.data && e.data.banned) showBan(e.data);
    } finally { polling = false; }
  }

  function applyMy(l, first) {
    const prev = my;
    my = l;
    if (!first) {
      if ((!prev || prev.status !== "confirming") && l && l.status === "confirming") { haptic("warn"); toast("Подтвердите участие в матче"); try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) {} }
      if (prev && prev.status === "confirming" && l && l.status === "playing") { haptic("ok"); toast(l.is_match_host ? "Матч начался. Вас выбрали хостером" : "Матч начался"); }
      if (prev && prev.status === "confirming" && l && l.status === "open") toast("Не все игроки подтвердили участие", "err");
      if (prev && prev.status === "confirming" && !l) toast("Вы не подтвердили участие и удалены из лобби", "err");
      if (prev && l && !prev.code && l.code && !l.is_match_host && !l.is_host) { haptic("ok"); toast("Хост отправил код"); }
      if (prev && l && prev.status !== "finished" && l.status === "finished") { haptic("ok"); toast("Матч завершён, поинты начислены"); loadProfile().catch(() => {}); if (current() === "matches") loadHistory(true).catch(() => {}); }
    }
    renderConfirm();
    updateDot();
    if (current() === "lobby") {
      if (!l) {
        if (prev) toast("Лобби не найдено или уже закрыто", "err");
        if (stack.length > 1) back(); else navigate("matches", true);
      } else renderRoom(false);
    }
    if (first && l && current() === "matches" && l.status !== "finished") navigate("lobby");
  }

  function renderConfirm() {
    const box = $("#m-confirm");
    if (!my || my.status !== "confirming") return box.classList.add("hidden");
    const l = my;
    const all = l.teams.KT.concat(l.teams.T);
    $("#cf-map").style.backgroundImage = MAP_IMAGES[l.map] ? `url("${MAP_IMAGES[l.map]}")` : "none";
    $("#cf-info").textContent = `${l.map} · ${l.mode}`;
    $("#cf-count").textContent = `${l.confirmed}/${l.players}`;
    $("#cf-bar").style.width = `${l.players ? Math.round((l.confirmed / l.players) * 100) : 0}%`;
    $("#cf-players").innerHTML = all.map((p) => `<li class="${p.confirmed ? "ok" : ""}">${ICON(p.confirmed ? "check" : "clock")}<span>${esc(p.nickname)}${p.me ? " (вы)" : ""}</span></li>`).join("");
    const btn = $("#btn-confirm");
    btn.disabled = l.my_confirmed;
    btn.innerHTML = l.my_confirmed ? `${ICON("check")}Вы подтвердили. Ждём остальных` : `${ICON("check")}Подтвердить`;
    box.classList.remove("hidden");
    tickConfirm();
  }

  function tickConfirm() {
    if (!my || my.status !== "confirming") return;
    $("#cf-left").textContent = Math.max(0, my.confirm_until - serverNow());
  }

  const lobbyPlayers = (l) => l.teams.KT.concat(l.teams.T);

  async function loadLobbies() {
    const d = await api("/api/lobbies");
    timeOffset = d.server_time - now();
    lobbies = d.lobbies;
    drawLobbies();
  }

  function drawLobbies() {
    const extra = my && my.status === "finished" ? `
      <div class="card row" data-lobby-id="${my.id}"><div class="grow"><h3>Матч завершён · ${esc(my.map)}</h3><div class="meta"><span>${ICON("trophy")}Посмотреть результат</span></div></div>
      <button class="btn primary sm" data-open="${my.id}" type="button">${ICON("game")}Открыть</button></div>` : "";
    const list = $("#lobby-list");
    list.innerHTML = lobbies.length || extra
      ? extra + lobbies.map((l) => {
        const action = l.mine
          ? `<button class="btn primary sm" data-open="${l.id}" type="button">${ICON("game")}Открыть</button>`
          : l.status === "playing" ? '<span class="pill gold">идёт матч</span>'
          : l.status === "confirming" ? '<span class="pill gold">подтверждение</span>'
          : l.status === "review" ? '<span class="pill gold">результаты</span>'
          : l.players >= l.max_players ? '<span class="pill">заполнено</span>'
          : `<button class="btn ghost sm" data-join="${l.id}" type="button">${ICON("game")}Войти</button>`;
        const img = MAP_IMAGES[l.map] || "";
        return `
        <div class="card row" data-lobby-id="${l.id}">
          ${img ? `<img src="${img}" alt="${esc(l.map)}" style="width:60px;height:60px;object-fit:cover;border-radius:8px;margin-right:12px;">` : ""}
          <div class="grow">
            <h3>${esc(l.map)} · ${esc(l.mode)}</h3>
            <div class="meta">
              <span>${ICON("users")}${l.players}/${l.max_players}</span>
              <span>${ICON("crown")}${esc(l.owner)}</span>
              <span>${ICON("clock")}${ago(l.created_at)}</span>
            </div>
          </div>
          ${action}
        </div>`;
      }).join("")
      : `<div class="card empty">Активных лобби нет. Создайте первое.</div>`;
    refreshMatchesEmpty();
  }

  const hist = { items: [], total: 0, totalAll: null, loaded: false };
  let histScope = "all";
  let histTick = 0;

  function refreshMatchesEmpty() {
    const none = hist.loaded && hist.totalAll === 0 && !lobbies.length && !(my && my.status === "finished");
    $("#matches-empty").classList.toggle("hidden", !none);
    $("#history-block").classList.toggle("hidden", none);
    if (none) $("#lobby-list").innerHTML = "";
  }

  function matchCard(m) {
    const side = (tm) => m.players.filter((p) => p.team === tm);
    const mvp = m.players.slice().sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)[0];
    const mins = Math.max(1, Math.round(m.duration / 60));
    const res = m.me
      ? `<span class="res ${m.me.won ? "win" : "lose"}">${m.me.won ? "Победа" : "Поражение"} ${sgn(m.me.points_change)}</span>`
      : `<span class="res">Победа ${esc(m.winner)}</span>`;
    const team = (tm) => `
      <div class="mc-team ${m.winner === tm ? "winner" : ""}">
        <h4><span>${tm}</span>${m.winner === tm ? "<em>победа</em>" : ""}</h4>
        ${side(tm).map((p) => `
          <div class="mc-p" ${p.id ? `data-player="${p.id}"` : ""}>${avatarHtml(p, 22)}${nameHtml(p.nickname + (p.me ? " (вы)" : ""), p.verified)}
          <small>${p.kills}/${p.deaths}/${p.assists}</small><span class="dp ${p.points_change < 0 ? "neg" : p.points_change === 0 ? "zero" : ""}">${sgn(p.points_change)}</span></div>`).join("")}
      </div>`;
    return `
      <article class="card mcard ${m.me ? (m.me.won ? "win" : "lose") : ""}">
        <div class="mc-head">
          <span class="mc-img" style="${MAP_IMAGES[m.map] ? `background-image:url('${MAP_IMAGES[m.map]}')` : ""}"></span>
          <span class="mc-title grow">${esc(m.map)} · ${esc(m.mode)}<small>${ago(m.finished_at)} · ${mins} мин</small></span>
          ${res}
        </div>
        <div class="mc-teams">${team("KT")}<span class="mc-vs">VS</span>${team("T")}</div>
        ${mvp ? `<div class="mc-foot">${ICON("trophy")}<span>MVP</span>${nameHtml(mvp.nickname, mvp.verified)}<span>${mvp.kills}/${mvp.deaths}/${mvp.assists}</span></div>` : ""}
      </article>`;
  }

  function drawHistory() {
    $("#hist-list").innerHTML = hist.items.length
      ? hist.items.map(matchCard).join("")
      : `<div class="card empty">${histScope === "mine" ? "Вы ещё не сыграли ни одного матча." : "Сыгранных матчей пока нет."}</div>`;
    $("#hist-more").classList.toggle("hidden", hist.items.length >= hist.total);
    $$("#hist-scope .fchip").forEach((c) => c.classList.toggle("active", c.dataset.hscope === histScope));
    refreshMatchesEmpty();
  }

  async function loadHistory(reset = true) {
    if (reset) hist.items = [];
    const d = await api(`/api/history?scope=${histScope}&limit=10&offset=${hist.items.length}`);
    timeOffset = d.server_time - now();
    hist.items = hist.items.concat(d.matches);
    hist.total = d.total;
    if (histScope === "all") hist.totalAll = d.total;
    else if (hist.totalAll === null) hist.totalAll = (await api("/api/history?scope=all&limit=1")).total;
    hist.loaded = true;
    drawHistory();
  }

  async function loadMatchesView() {
    await Promise.all([loadLobbies(), loadHistory(true)]);
  }

  function openLobbyModal() {
    $("#sel-map").innerHTML = MAPS.map((m) => `<option>${esc(m)}</option>`).join("");
    $("#sel-mode").innerHTML = Object.keys(MODE_SIZE).map((m) => `<option>${esc(m)}</option>`).join("");
    const updateDesc = () => { $("#mode-desc").textContent = MODE_INFO[$("#sel-mode").value] || ""; };
    $("#sel-mode").onchange = updateDesc;
    updateDesc();
    openModal("m-lobby");
  }

  async function submitLobby() {
    const team = Math.random() < 0.5 ? "KT" : "T";
    await api("/api/lobbies", { method: "POST", body: { action: "create", map: $("#sel-map").value, mode: $("#sel-mode").value, team } });
    closeModals();
    toast(`Лобби создано. Вы хост, ваша команда: ${team}`);
    await pollMy(false);
    navigate("lobby");
  }

  async function doJoin(id) {
    try {
      const r = await api("/api/lobbies", { method: "POST", body: { action: "join", id: Number(id) } });
      closeModals();
      toast(`Вы вошли в команду ${r.team}`);
      await pollMy(false);
      navigate("lobby");
    } catch (e) {
      if (e.status === 409 && e.data && e.data.id) { await pollMy(false); navigate("lobby"); toast(e.message, "err"); return; }
      handleErr(e);
      loadLobbies().catch(() => {});
    }
  }

  async function openRoom() {
    if (!my) await pollMy(false);
    if (!my) return toast("Лобби не найдено или уже закрыто", "err");
    navigate("lobby");
  }

  async function lobbyAction(body) { return api("/api/lobbies", { method: "POST", body: { ...body, id: my.id } }); }

  function stepIndex(status) { return { open: 0, confirming: 1, playing: 2, review: 3, finished: 4 }[status] || 0; }

  function renderRoom(full) {
    const l = my;
    if (!l) {
      toast("Лобби не найдено или уже закрыто", "err");
      if (stack.length > 1) back(); else navigate("matches", true);
      return;
    }
    const isOwner = l.is_host;
    const cap = l.max_players / 2;
    $("#room-title").innerHTML = `${MAP_IMAGES[l.map] ? `<img src="${MAP_IMAGES[l.map]}" style="width:80px;height:50px;object-fit:cover;border-radius:8px;vertical-align:middle;margin-right:8px;">` : ""}${esc(l.map)} · ${esc(l.mode)}`;
    const st = $("#room-status");
    const info = STATUS[l.status] || STATUS.open;
    st.textContent = info[0];
    st.className = `pill status-pill ${info[1]}`;
    const idx = stepIndex(l.status);
    $("#room-steps").innerHTML = STEPS.map((s, i) => `<div class="step ${i < idx ? "done" : i === idx ? "on" : ""}"><i>${i < idx ? ICON("check") : i + 1}</i><span>${s}</span></div>`).join("");

    const banner = $("#room-banner");
    let note = "";
    if (l.status === "confirming") note = `Идёт подтверждение участия: ${l.confirmed}/${l.players}`;
    else if (l.status === "playing" && l.is_match_host) note = "Вас выбрали хостером. Создайте игру и отправьте код — он придёт всем игрокам.";
    else if (l.status === "playing" && !l.code) note = `Ваш матч начался. Дождитесь хостера (${l.host_name}) — он скинет код для входа в игру.`;
    else if (l.status === "review") note = "Матч завершён. Отправьте скриншот результатов — после проверки админом вам начислят поинты.";
    banner.textContent = note;
    banner.classList.toggle("hidden", !note);

    const res = $("#room-result");
    if (l.status === "finished" && l.result) {
      res.innerHTML = `<h3>${ICON("trophy")}Матч завершён · победила команда ${esc(l.result.winner)}</h3>` + l.result.players.map((p) => `
        <div class="res-row ${p.won ? "win" : "lose"}"><span class="grow">${esc(p.nickname)} <small>${p.kills}/${p.deaths}/${p.assists}</small></span>
        <b>${p.points_change > 0 ? "+" : ""}${p.points_change}</b><small>всего ${p.points_total}</small></div>`).join("");
      res.classList.remove("hidden");
    } else res.classList.add("hidden");

    ["KT", "T"].forEach((tm) => {
      $(`#count-${tm}`).textContent = `${l.teams[tm].length}/${cap}`;
      $(`#room-${tm}`).innerHTML = l.teams[tm].length
        ? l.teams[tm].map((p) => {
          const crown = l.status === "open" || l.status === "confirming" ? p.owner : p.host;
          return `<li>${avatarHtml(p, 26)}<span data-player="${p.id}" style="cursor:pointer">${nameHtml(p.nickname + (p.me ? " (вы)" : ""), p.verified)}</span>${crown ? ICON("crown") : ""}${badgesHtml(p.badges)}${l.status === "confirming" ? `<em class="mark ${p.confirmed ? "ok" : ""}">${ICON(p.confirmed ? "check" : "clock")}</em>` : ""}</li>`;
        }).join("")
        : '<li class="muted">Пока никого</li>';
    });

    $$(".host-only").forEach((el) => el.classList.toggle("hidden", !isOwner));
    $$(".guest-only").forEach((el) => el.classList.toggle("hidden", isOwner));
    const canCode = l.is_match_host || (isOwner && (l.status === "open" || l.status === "confirming"));
    $("#code-form").classList.toggle("hidden", !canCode);
    const typing = document.activeElement && (document.activeElement.id === "in-comment" || document.activeElement.id === "in-code");
    if (full || !typing) {
      if (!typing || full) { $("#in-comment").value = l.comment; $("#in-code").value = l.code; }
    }
    $("#room-comment-view").textContent = l.comment || "Комментария нет";
    $("#room-code-view").innerHTML = l.code ? `Код для CounterFlame: <b>${esc(l.code)}</b>` : '<span class="muted">Хост ещё не отправил код</span>';
    $("#btn-room-start").disabled = l.status !== "open";
    $("#btn-room-finish").classList.toggle("hidden", !((l.is_host || l.is_match_host) && l.status === "playing"));
    $("#btn-submit-result").classList.toggle("hidden", !(l.status === "playing" || l.status === "review"));
    $("#leave-label").textContent = l.status === "finished" ? "Закрыть" : (isOwner && (l.status === "open" || l.status === "confirming")) ? "Закрыть лобби" : "Покинуть";
  }

  async function roomAction(act) {
    if (act === "room-refresh") { await pollMy(false); return toast("Состав обновлён"); }
    if (!my) return;
    if (act === "room-comment") { await lobbyAction({ action: "comment", comment: $("#in-comment").value }); toast("Комментарий сохранён"); }
    if (act === "room-code") { await lobbyAction({ action: "code", code: $("#in-code").value }); toast("Код отправлен участникам"); }
    if (act === "room-start") { await lobbyAction({ action: "start" }); toast("Запущено подтверждение участия"); }
    if (act === "room-finish") { await lobbyAction({ action: "finish" }); toast("Матч завершён"); }
    if (act === "room-leave") {
      const r = await lobbyAction({ action: "leave" });
      toast(r.closed ? "Лобби закрыто" : "Вы вышли из лобби");
      my = null;
      await pollMy(false);
      return back();
    }
    await pollMy(false);
  }

  async function doConfirm() {
    if (!my) return;
    try {
      await lobbyAction({ action: "confirm" });
      haptic("ok");
    } catch (e) { handleErr(e); }
    await pollMy(false);
  }

  async function declineConfirm() {
    if (!my) return;
    try {
      await lobbyAction({ action: "leave" });
      toast("Вы вышли из лобби");
    } catch (e) { handleErr(e); }
    my = null;
    await pollMy(false);
    if (current() === "lobby") navigate("matches", true);
  }

  async function submitMatchResult() {
    const fileInput = $("#result-screenshot");
    if (!my || !fileInput.files.length) return toast("Выберите скриншот матча", "err");
    const form = new FormData();
    form.append("screenshot", fileInput.files[0]);
    form.append("lobby_id", my.id);
    try {
      await api("/api/match/submit", { form });
      toast("Скриншот отправлен админу ✅", "ok");
      haptic("ok");
    } catch (e) {
      toast("Ошибка отправки: " + e.message, "err");
    } finally { fileInput.value = ""; }
    await pollMy(false);
  }

  async function loadNews() {
    $("#news-list").innerHTML = '<div class="card empty">Загружаем…</div>';
    const d = await api("/api/posts");
    $("#news-list").innerHTML = d.posts.length ? d.posts.map((p) => postCard(p, me.is_admin)).join("") : '<div class="card empty">Новостей пока нет.</div>';
  }

  function postCard(p, withAdmin) {
    return `
      <article class="card post ${p.pinned ? "pinned" : ""}">
        ${p.image ? `<img class="post-img" src="${esc(imgUrl(p.image))}" alt="" loading="lazy">` : ""}
        <div class="post-body">
          ${p.pinned ? `<span class="pill gold">${ICON("pin")}Закреплено</span>` : ""}
          <h3>${esc(p.title)}</h3>
          ${p.body ? `<p class="post-text">${esc(p.body)}</p>` : ""}
          <div class="meta"><span>${ICON("user")}${nameHtml(p.author, p.verified)}</span><span>${ICON("clock")}${ago(p.created_at)}</span></div>
          ${badgesHtml(p.badges) ? `<div class="badges">${badgesHtml(p.badges)}</div>` : ""}
          ${withAdmin ? `<div class="actions">
            <button class="btn ghost" data-post-pin="${p.id}" type="button">${ICON("pin")}${p.pinned ? "Открепить" : "Закрепить"}</button>
            <button class="btn danger" data-post-del="${p.id}" type="button">${ICON("trash")}Удалить</button></div>` : ""}
        </div>
      </article>`;
  }

  const kdText = (v) => Number(v).toFixed(2);

  function podiumHtml(top) {
    const order = [2, 1, 3].map((n) => top.find((p) => p.place === n)).filter(Boolean);
    return `<div class="podium">${order.map((p) => `
      <div class="pod p${p.place}">
        <button class="pod-card" data-player="${p.id}" type="button">
          <div class="pod-banner" style="background:${bannerCss(p.banner)}"></div>
          <div class="pod-av">${p.place === 1 ? crownHtml() : ""}${avatarHtml(p, p.place === 1 ? 68 : 56)}</div>
          <div class="pod-name">${nameHtml(p.nickname, p.verified)}</div>
          <div class="badges">${badgesHtml(p.badges)}</div>
          <div class="pod-pts"><b>${p.points}</b>Поинтов</div>
          <div class="pod-sub">К/Д ${kdText(p.kd)} · ${p.winrate}% побед</div>
        </button>
        <div class="pod-step">${p.place}</div>
      </div>`).join("")}</div>`;
  }

  async function loadLeaderboard() {
    const d = await api("/api/leaderboard");
    const top = d.players.slice(0, 3);
    $("#lb-podium").innerHTML = top.length ? podiumHtml(top) : "";
    $("#lb-list").innerHTML = top.length
      ? d.players.slice(3).map((p) => `
        <button class="card row lb-row clickable ${p.me ? "me" : ""}" data-player="${p.id}" type="button">
          <div class="rank">${p.place}</div>${avatarHtml(p, 40)}
          <div class="grow"><h3>${nameHtml(p.nickname, p.verified)}</h3>${badgesHtml(p.badges) ? `<div class="badges">${badgesHtml(p.badges)}</div>` : ""}<div class="meta"><span>К/Д ${kdText(p.kd)}</span><span>${p.matches} матчей</span></div></div>
          <span class="pill gold">${p.points} Поинтов</span>
        </button>`).join("")
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

  function planDays(until) { return Math.max(1, Math.ceil((until - now()) / 86400)); }

  function renderSubs() {
    const active = me.plan ? PLANS.find((p) => p.id === me.plan) : null;
    $("#subs-hero").innerHTML = `
      <div class="hero-card ${active ? active.cls : ""}">
        <div class="hero-glow"></div>
        <div class="hero-icon">${ICON("diamond")}</div>
        <h3>CYBERSHOKE PREMIUM</h3>
        <p>Больше кибер-поинтов за каждую победу, золотые значки и доступ к эксклюзивным турнирам.</p>
        ${active ? `<div class="hero-status">${ICON("check")}Активна: ${esc(active.name)} · осталось ${planDays(me.plan_until)} дн.</div>` : ""}
        <div class="hero-perks"><span>${ICON("bolt")}+25% поинтов</span><span>${ICON("crown")}Золотой значок</span><span>${ICON("trophy")}Турниры</span></div>
      </div>`;
    $("#subs-list").innerHTML = PLANS.map((p) => `
      <div class="card plan ${p.cls}">
        ${p.id === "premium" ? '<div class="ribbon">ЛУЧШИЙ ВЫБОР</div>' : ""}
        <div class="row" style="padding:0"><h3 class="grow">${esc(p.name)}</h3><span class="price">${esc(p.price)}</span></div>
        <ul>${p.perks.map((x) => `<li>${ICON("check")}${esc(x)}</li>`).join("")}</ul>
        <button class="btn ${p.cls === "premium" ? "gold" : "lite"} wide" data-sub="${esc(p.id)}" type="button">${ICON("star")}Купить</button>
      </div>`).join("") + '<p class="muted small">Оплата в Telegram Stars: после нажатия откроется чат с @crymbog.</p>';
  }

  function heroHtml(u, own) {
    const avatar = avatarHtml(u, 96);
    const holder = own
      ? `<button class="av-edit" data-act="avatar-pick" type="button" aria-label="Изменить аватарку">${avatar}<span class="cam">${ICON("camera")}</span></button>`
      : avatar;
    return `
      <div class="ph">
        <div class="ph-banner" style="background:${bannerCss(u.banner)}"></div>
        <div class="ph-av">${holder}</div>
        <div class="ph-body">
          <h3 class="ph-nick">${nameHtml(u.nickname, u.verified)}</h3>
          ${badgesHtml(u.badges) ? `<div class="badges">${badgesHtml(u.badges)}</div>` : ""}
          <div class="ph-meta">${u.rank ? `<span class="chip-s">#${u.rank} в рейтинге</span>` : ""}${own ? `<span class="chip-s">ID: ${esc(u.game_id)}</span>` : ""}</div>
        </div>
      </div>`;
  }

  function statsHtml(u, own) {
    const tile = (icon, cls, value, label) => `<div class="card stat"><svg class="${cls}"><use href="#i-${icon}"/></svg><b>${value}</b><span>${label}</span></div>`;
    return `
      <div class="stats-grid">
        ${tile("target", "c-blue", Number(u.points).toLocaleString("ru-RU"), "Кибер-поинты")}
        ${own ? tile("coin", "c-gold", Number(u.coins).toLocaleString("ru-RU"), "Коины") : tile("trophy", "c-gold", u.rank ? "#" + u.rank : "—", "Место")}
        ${tile("game", "c-red", Number(u.kd).toFixed(2), "К/Д")}
        ${tile("trophy", "c-blue", Number(u.avg).toFixed(1), "АВГ")}
        ${tile("chart", "c-blue", u.matches || 0, "Матчей")}
        ${tile("trophy", "c-gold", u.wins || 0, "Побед")}
      </div>
      <div class="card wr">
        <div class="wr-head"><span>Винрейт</span><b>${u.winrate || 0}%</b></div>
        <div class="wr-bar"><i style="width:${u.winrate || 0}%"></i></div>
        <small class="muted">Побед: ${u.wins || 0} из ${u.matches || 0}</small>
      </div>`;
  }

  function fillProfile() {
    $("#p-hero").innerHTML = heroHtml(me, true);
    $("#p-stats").innerHTML = statsHtml(me, true);
    $("#btn-avatar-remove").classList.toggle("hidden", !me.avatar);
    const plan = $("#p-plan");
    const active = me.plan ? PLANS.find((p) => p.id === me.plan) : null;
    plan.className = `plan-status ${active ? active.cls : "hidden"}`;
    plan.innerHTML = active ? `${ICON("star")}<span>${esc(active.name)} · осталось ${planDays(me.plan_until)} дн.</span>` : "";
    const banner = $("#mute-banner");
    banner.classList.toggle("hidden", !me.is_muted);
    if (me.is_muted) $("span", banner).textContent = `${me.mute_until >= PERMANENT ? "Вы заглушены навсегда" : "Вы заглушены до " + fmtDate(me.mute_until)}. Оспорить мут можно в поддержке @crymbog.`;
    updateHeader();
  }

  let playerId = null;

  function openPlayer(id) {
    if (me && Number(id) === me.uid) return navigate("profile");
    playerId = Number(id);
    navigate("player");
  }

  async function loadPlayer() {
    if (!playerId) return back();
    $("#pl-hero").innerHTML = '<div class="card empty">Загружаем…</div>';
    $("#pl-stats").innerHTML = "";
    $("#pl-recent").innerHTML = "";
    const d = await api(`/api/player/${playerId}`);
    const u = d.player;
    $("#pl-hero").innerHTML = heroHtml(u, false);
    $("#pl-stats").innerHTML = statsHtml(u, false);
    $("#pl-recent").innerHTML = u.recent.length ? `<div class="recent"><h3>${ICON("history")}Последние матчи</h3>${u.recent.map((r) => `
      <div class="card rc-row ${r.won ? "win" : ""}"><i class="res-dot"></i><div class="grow"><b>${esc(r.map)} · ${esc(r.mode)}</b><br><small>${ago(r.finished_at)} · ${r.kills}/${r.deaths}/${r.assists}</small></div>
      <span class="res ${r.won ? "win" : "lose"}">${r.won ? "Победа" : "Поражение"} ${sgn(r.points_change)}</span></div>`).join("")}</div>` : "";
  }

  async function loadProfile() {
    fillProfile();
    const d = await api("/api/profile");
    me = d.user;
    fillProfile();
  }

  function prepareImage(file, { max = 1200, square = false, quality = 0.88 } = {}) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        let sx = 0, sy = 0, sw = img.width, sh = img.height;
        if (square) { const side = Math.min(sw, sh); sx = (sw - side) / 2; sy = (sh - side) / 2; sw = sh = side; }
        const scale = Math.min(1, max / Math.max(sw, sh));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(sw * scale));
        canvas.height = Math.max(1, Math.round(sh * scale));
        canvas.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Не удалось обработать картинку"))), "image/jpeg", quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Не удалось прочитать картинку")); };
      img.src = url;
    });
  }

  async function uploadAvatar(file) {
    const blob = await prepareImage(file, { max: 512, square: true, quality: 0.9 });
    const form = new FormData();
    form.append("file", blob, "avatar.jpg");
    const d = await api("/api/profile/avatar", { form });
    me = d.user;
    fillProfile();
    toast("Аватарка обновлена");
    haptic("ok");
  }

  async function removeAvatar() {
    const d = await api("/api/profile/avatar", { method: "POST", body: { avatar: "" } });
    me = d.user;
    fillProfile();
    toast("Фото профиля удалено");
  }

  function openBanners() {
    const cur = me.banner || "";
    $("#banner-grid").innerHTML = `<button class="banner-tile none ${cur === "" ? "sel" : ""}" data-banner="" type="button"><span>Без баннера</span></button>` +
      Object.keys(BANNERS).map((k) => `<button class="banner-tile ${cur === "preset:" + k ? "sel" : ""}" data-banner="preset:${k}" style="background:${BANNERS[k]}" type="button"></button>`).join("") +
      (cur.startsWith("/uploads/") ? `<button class="banner-tile sel" data-banner="${esc(cur)}" style="background:${esc(bannerCss(cur))}" type="button"></button>` : "");
    const can = me.can_upload_banner;
    $("#btn-banner-upload").classList.toggle("locked", !can);
    $("#banner-note").textContent = can ? "Загрузите свою картинку (PNG, JPG, WEBP, GIF до 5 МБ)." : "Свой баннер доступен с подпиской или статусом VIP.";
    openModal("m-banner");
  }

  async function setBanner(value) {
    const d = await api("/api/profile/banner", { method: "POST", body: { banner: value } });
    me = d.user;
    fillProfile();
    openBanners();
    toast("Баннер обновлён");
  }

  async function uploadBanner(file) {
    const blob = await prepareImage(file, { max: 1200, quality: 0.85 });
    const form = new FormData();
    form.append("file", blob, "banner.jpg");
    form.append("purpose", "banner");
    const up = await api("/api/upload", { form });
    await setBanner(up.url);
  }

  function renderAdminState() {
    const unlocked = Boolean(adminPass);
    $("#admin-lock").classList.toggle("hidden", unlocked);
    $("#admin-body").classList.toggle("hidden", !unlocked);
    if (unlocked) loadAdminTab();
  }

  async function adm(body) {
    try {
      return await api("/api/admin", { method: "POST", admin: adminPass, body });
    } catch (e) {
      if (e.status === 403 && e.message === "Неверный пароль") { adminPass = ""; renderAdminState(); }
      throw e;
    }
  }

  async function adminLogin() {
    const err = $("#admin-error");
    err.classList.add("hidden");
    const pass = $("#in-admin-pass").value;
    try {
      await api("/api/admin", { method: "POST", admin: pass, body: { action: "ping" } });
      adminPass = pass;
      $("#in-admin-pass").value = "";
      renderAdminState();
    } catch (e) {
      err.textContent = e.message;
      err.classList.remove("hidden");
    }
  }

  function ensureAdmin(cb) {
    if (adminPass) return cb();
    afterAdmin = cb;
    $("#in-adminpass2").value = "";
    $("#adminpass-error").classList.add("hidden");
    openModal("m-adminpass");
  }

  async function adminPassOk() {
    const err = $("#adminpass-error");
    err.classList.add("hidden");
    const pass = $("#in-adminpass2").value;
    try {
      await api("/api/admin", { method: "POST", admin: pass, body: { action: "ping" } });
      adminPass = pass;
      closeModals();
      const cb = afterAdmin;
      afterAdmin = null;
      if (cb) cb();
    } catch (e) {
      err.textContent = e.message;
      err.classList.remove("hidden");
    }
  }

  async function loadAdminTab() {
    $$("#admin-tabs .fchip").forEach((c) => c.classList.toggle("active", c.dataset.atab === adminTab));
    ["players", "news", "stats"].forEach((t) => $(`#atab-${t}`).classList.toggle("hidden", t !== adminTab));
    if (adminTab === "players") { const d = await adm({ action: "list" }); adminUsers = d.players; drawAdminList(); }
    if (adminTab === "news") {
      const d = await api("/api/posts");
      $("#admin-news-list").innerHTML = d.posts.length ? d.posts.map((p) => postCard(p, true)).join("") : '<div class="card empty">Новостей пока нет.</div>';
    }
    if (adminTab === "stats") {
      const s = await adm({ action: "stats" });
      const items = [["users", "Игроков", s.users], ["bolt", "Онлайн", s.online], ["game", "Активных лобби", s.lobbies], ["trophy", "Матчей", s.matches], ["check", "Результатов начислено", s.finished], ["news", "Постов", s.posts], ["star", "С подпиской", s.premium]];
      $("#admin-stats").innerHTML = items.map((i) => `<div class="card stat">${ICON(i[0])}<b>${i[2]}</b><span>${i[1]}</span></div>`).join("");
    }
  }

  function drawAdminList() {
    const q = $("#in-admin-search").value.trim().toLowerCase();
    const rows = adminUsers.filter((p) => !q || p.nickname.toLowerCase().includes(q) || String(p.game_id).includes(q) || String(p.tg_id).includes(q));
    $("#admin-list").innerHTML = rows.length ? rows.map((p) => `
      <div class="card row admin-row">
        <div class="row" style="padding:0">
          <div class="grow">
            <h3>${nameHtml(p.nickname, p.verified)}</h3>
            ${badgesHtml(p.badges) ? `<div class="badges">${badgesHtml(p.badges)}</div>` : ""}
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
          <button class="btn lite" data-adm="badge" data-id="${p.tg_id}" type="button">${ICON("shield")}Бейдж</button>
          <button class="btn gold" data-adm="plan" data-id="${p.tg_id}" type="button">${ICON("star")}Премиум</button>
          <button class="btn ghost" data-adm="points" data-id="${p.tg_id}" type="button">${ICON("target")}Поинты</button>
        </div>
      </div>`).join("") : `<div class="card empty">Игроки не найдены.</div>`;
  }

  async function adminAction(action, id) {
    const p = adminUsers.find((x) => x.tg_id === Number(id));
    if (!p) return;
    if (action === "ban" || action === "mute") {
      punish = { action, id: p.tg_id };
      $("#punish-title").textContent = action === "ban" ? "Бан игрока" : "Мут игрока";
      $("#punish-target").textContent = `${p.nickname} · ID ${p.game_id}`;
      $("#sel-time").innerHTML = TIMES.map((t) => `<option value="${t.min}">${esc(t.label)}</option>`).join("");
      $("#in-reason").value = "";
      $("#punish-error").classList.add("hidden");
      return openModal("m-punish");
    }
    if (action === "badge") {
      badgeTarget = p;
      $("#badge-target").textContent = `${p.nickname} · ID ${p.game_id}`;
      $("#badge-now").innerHTML = badgesHtml(p.badges) || '<span class="muted small">Бейджей нет</span>';
      $("#vfy-state").textContent = p.verified ? "есть" : "нет";
      $("#sel-badge").innerHTML = GRANT.map((b) => `<option value="${b}">${esc(BADGES[b])}</option>`).join("");
      return openModal("m-badge");
    }
    if (action === "plan") {
      planTarget = p;
      $("#plan-target").textContent = `${p.nickname} · ID ${p.game_id}`;
      $("#plan-error").classList.add("hidden");
      return openModal("m-plan");
    }
    if (action === "points") {
      pointsTarget = p;
      $("#points-target").textContent = `${p.nickname} · сейчас ${p.points} поинтов`;
      $("#in-points").value = "";
      $("#points-error").classList.add("hidden");
      return openModal("m-points");
    }
    await adm({ action, tg_id: p.tg_id });
    toast(action === "unban" ? "Игрок разбанен" : "Мут снят");
    loadAdminTab();
  }

  async function submitPunish() {
    const err = $("#punish-error");
    err.classList.add("hidden");
    try {
      await adm({ action: punish.action, tg_id: punish.id, minutes: Number($("#sel-time").value), reason: $("#in-reason").value });
      closeModals();
      toast(punish.action === "ban" ? "Игрок забанен" : "Игрок заглушён");
      loadAdminTab();
    } catch (e) {
      err.textContent = e.message;
      err.classList.remove("hidden");
    }
  }

  async function badgeChange(kind) {
    await adm({ action: kind, tg_id: badgeTarget.tg_id, badge: $("#sel-badge").value });
    closeModals();
    toast(kind === "badge_add" ? "Бейдж выдан" : "Бейдж снят");
    loadAdminTab();
  }

  async function verifySet(value) {
    await adm({ action: "verify_set", tg_id: badgeTarget.tg_id, value });
    badgeTarget.verified = value;
    $("#vfy-state").textContent = value ? "есть" : "нет";
    toast(value ? "Галочка выдана" : "Галочка снята");
    loadAdminTab();
  }

  async function channelTest() {
    const box = $("#channel-test-result");
    box.innerHTML = '<div class="card empty">Отправляем тестовые сообщения…</div>';
    const d = await adm({ action: "channel_test" });
    box.innerHTML = d.results.map((r) => `
      <div class="card row"><div class="grow"><h3>${esc(r.topic)} · тема ${esc(r.topic_id)}</h3>
      <div class="meta"><span>${ICON(r.ok ? "check" : "close")}${r.ok ? "Сообщение доставлено" : esc(r.error || "Ошибка отправки")}</span></div></div>
      <span class="pill ${r.ok ? "green" : "red"}">${r.ok ? "OK" : "ошибка"}</span></div>`).join("");
  }

  async function submitPlan() {
    const err = $("#plan-error");
    err.classList.add("hidden");
    try {
      await adm({ action: "plan_set", tg_id: planTarget.tg_id, plan: $("#sel-plan").value, days: Number($("#in-plan-days").value) || 30 });
      closeModals();
      toast("Подписка обновлена");
      loadAdminTab();
    } catch (e) {
      err.textContent = e.message;
      err.classList.remove("hidden");
    }
  }

  async function submitPoints() {
    const err = $("#points-error");
    err.classList.add("hidden");
    try {
      await adm({ action: "points_add", tg_id: pointsTarget.tg_id, delta: Number($("#in-points").value) });
      closeModals();
      toast("Поинты обновлены");
      loadAdminTab();
    } catch (e) {
      err.textContent = e.message;
      err.classList.remove("hidden");
    }
  }

  function openPostModal() {
    ensureAdmin(() => {
      postImage = "";
      $("#in-post-title").value = "";
      $("#in-post-body").value = "";
      $("#chk-post-pin").checked = false;
      $("#chk-post-notify").checked = true;
      $("#post-image-label").textContent = "Добавить картинку";
      $("#post-error").classList.add("hidden");
      openModal("m-post");
    });
  }

  async function uploadPostImage(file) {
    const form = new FormData();
    form.append("file", file);
    form.append("purpose", "post");
    try {
      const up = await api("/api/upload", { form, admin: adminPass });
      postImage = up.url;
      $("#post-image-label").textContent = "Картинка загружена ✓";
    } catch (e) { handleErr(e); }
  }

  async function submitPost() {
    const err = $("#post-error");
    err.classList.add("hidden");
    try {
      await adm({ action: "post_create", title: $("#in-post-title").value, body: $("#in-post-body").value, image: postImage, pinned: $("#chk-post-pin").checked, notify: $("#chk-post-notify").checked });
      closeModals();
      toast("Пост опубликован");
      if (current() === "news") loadNews(); else if (current() === "admin") loadAdminTab();
    } catch (e) {
      err.textContent = e.message;
      err.classList.remove("hidden");
    }
  }

  async function postAdmin(action, id) {
    ensureAdmin(async () => {
      await run(async () => {
        await adm({ action, id: Number(id) });
        toast(action === "post_delete" ? "Пост удалён" : "Готово");
        if (current() === "news") loadNews(); else loadAdminTab();
      });
    });
  }

  document.addEventListener("click", (ev) => {
    const pl = ev.target.closest("[data-player]");
    if (pl) return run(() => openPlayer(pl.dataset.player));
    const el = ev.target.closest("button");
    if (!el) return;
    if (el.dataset.hscope) { histScope = el.dataset.hscope; return run(() => loadHistory(true)); }
    if (el.dataset.join) return doJoin(el.dataset.join);
    if (el.dataset.open) return run(openRoom);
    if (el.dataset.adm) return run(() => adminAction(el.dataset.adm, el.dataset.id));
    if (el.dataset.sub) return openSupport();
    if (el.dataset.banner !== undefined) return run(() => setBanner(el.dataset.banner));
    if (el.dataset.atab) { adminTab = el.dataset.atab; return run(loadAdminTab); }
    if (el.dataset.postPin) return postAdmin("post_pin", el.dataset.postPin);
    if (el.dataset.postDel) return postAdmin("post_delete", el.dataset.postDel);
    if (el.dataset.view) return navigate(el.dataset.view, el.classList.contains("nav-item"));
    switch (el.dataset.act) {
      case "back": return back();
      case "close-modal": return closeModals();
      case "welcome-back": return closeApp();
      case "register-back": return show("s-welcome");
      case "support": return openSupport();
      case "create-lobby": return run(openLobbyModal);
      case "hist-more": return run(() => loadHistory(false));
      case "avatar-pick": return $("#avatar-file").click();
      case "avatar-remove": return run(removeAvatar);
      case "channel-test": return run(channelTest);
      case "confirm": return doConfirm();
      case "confirm-decline": return declineConfirm();
      case "open-banners": return openBanners();
      case "banner-upload": return me.can_upload_banner ? $("#banner-file").click() : toast("Свой баннер доступен с подпиской или статусом VIP", "err");
      case "news-create": return openPostModal();
      case "post-image": return $("#post-file").click();
      case "room-submit": return;
      case "room-refresh": case "room-comment": case "room-code": case "room-start": case "room-finish": case "room-leave":
        return run(() => roomAction(el.dataset.act));
    }
  });

  $("#btn-retry").addEventListener("click", boot);
  $("#btn-api-save").addEventListener("click", saveApi);
  $("#btn-accept").addEventListener("click", () => { store("terms", "1"); show("s-register"); });
  $("#btn-register").addEventListener("click", register);
  $("#in-gid").addEventListener("input", (e) => (e.target.value = e.target.value.replace(/\D/g, "")));
  $("#btn-ban-close").addEventListener("click", () => (tg && tg.close ? tg.close() : boot()));
  $("#btn-burger").addEventListener("click", () => toggleMenu(!$("#s-main").classList.contains("menu-open")));
  $("#overlay").addEventListener("click", () => toggleMenu(false));
  $("#btn-create-lobby").addEventListener("click", () => run(openLobbyModal));
  $("#btn-lobby-submit").addEventListener("click", () => run(submitLobby));
  $("#btn-submit-result").addEventListener("click", () => $("#result-screenshot").click());
  $("#result-screenshot").addEventListener("change", (e) => { if (e.target.files.length) run(submitMatchResult); });
  $("#banner-file").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) run(() => uploadBanner(f)); });
  $("#post-file").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) uploadPostImage(f); });
  $("#btn-admin-login").addEventListener("click", adminLogin);
  $("#in-admin-pass").addEventListener("keydown", (e) => { if (e.key === "Enter") adminLogin(); });
  $("#btn-adminpass-ok").addEventListener("click", adminPassOk);
  $("#in-adminpass2").addEventListener("keydown", (e) => { if (e.key === "Enter") adminPassOk(); });
  $("#in-admin-search").addEventListener("input", drawAdminList);
  $("#btn-punish-submit").addEventListener("click", submitPunish);
  $("#avatar-file").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) run(() => uploadAvatar(f)); });
  $("#btn-vfy-on").addEventListener("click", () => run(() => verifySet(true)));
  $("#btn-vfy-off").addEventListener("click", () => run(() => verifySet(false)));
  $("#btn-badge-add").addEventListener("click", () => run(() => badgeChange("badge_add")));
  $("#btn-badge-remove").addEventListener("click", () => run(() => badgeChange("badge_remove")));
  $("#btn-plan-submit").addEventListener("click", submitPlan);
  $("#btn-points-submit").addEventListener("click", submitPoints);
  $("#btn-post-submit").addEventListener("click", submitPost);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && me) pollMy(false); });
  window.addEventListener("unhandledrejection", (e) => { if (e.reason && e.reason.message) handleErr(e.reason); });
  if (tg && tg.BackButton) {
    try { tg.BackButton.onClick(() => ($("#s-register").classList.contains("active") ? show("s-welcome") : back())); } catch (e) {}
  }

  $$(".logo-img").forEach((img) => { if (img.complete && img.naturalWidth === 0) logoFallback(img); });
  boot();
})();

// ==================== ОТПРАВКА ТИКЕТА ====================
async function sendTicket() {
  const text = document.getElementById("support-text").value.trim();
  if (!text) return toast("Введите текст", "err");
  const btn = document.getElementById("btn-send-ticket");
  btn.disabled = true;
  btn.textContent = "Отправка...";
  try {
    const res = await fetch(API_URL + "/api/support", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Dev-User": JSON.stringify({ id: TG_ID, username: "dev" })
      },
      body: JSON.stringify({ text: text, tg_id: TG_ID, nickname: me ? me.nickname : "Игрок" })
    });
    const data = await res.json();
    if (data.ok) {
      toast("Тикет отправлен!");
      document.getElementById("modal-support").style.display = "none";
      document.getElementById("support-text").value = "";
    } else {
      throw new Error(data.error || "Ошибка");
    }
  } catch(e) {
    toast(e.message, "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "Отправить тикет";
  }
}

// ==================== ОТКРЫТИЕ ПОДДЕРЖКИ ====================
window.openSupport = function() {
  const m = document.getElementById("modal-support");
  if (m) {
    m.style.display = "flex";
    m.classList.remove("hidden");
  } else {
    alert("Ошибка: модалка не найдена в HTML");
  }
};
