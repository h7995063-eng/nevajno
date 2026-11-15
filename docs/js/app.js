const API_URL = "https://api.trycloudflare.com";
(() => {
  "use strict";

  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg) { tg.ready(); tg.expand(); }

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ICON = (id) => `<svg><use href="#i-${id}"/></svg>`;
  const PERMANENT = 4102444800;

  const MAPS = ["Mirage", "Inferno", "Dust II", "Nuke", "Ancient", "Anubis", "Overpass", "Vertigo"];
  const MODES = ["1v1", "2v2", "5v5", "DM"];
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
  const TITLES = { matches: "Матчи", leaderboard: "Лидерборд", missions: "Миссии", profile: "Профиль", subs: "Подписки", admin: "Админка" };

  let me = null;
  let adminPass = "";
  let stack = [];
  let timers = [];
  let adminPlayers = [];
  let punish = null;

  /* ---------- helpers ---------- */
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
    const m = Math.max(0, Math.floor((Date.now() / 1000 - ts) / 60));
    if (m < 1) return "только что";
    if (m < 60) return `${m} мин назад`;
    return `${Math.floor(m / 60)} ч назад`;
  }

  async function api(path, body, admin = false) {
    const headers = { "Content-Type": "application/json" };
    if (tg && tg.initData) headers["X-Init-Data"] = tg.initData;
    else headers["X-Dev-User"] = JSON.stringify({ id: 6999358439, username: "shoke", first_name: "Owner" });
    if (admin) headers["X-Admin-Password"] = adminPass;
    let res;
    try {
      res = await fetch(API_URL + path, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
      console.error("FETCH ERROR:", e);
      document.body.innerHTML += `<div style="position:fixed; bottom:0; left:0; right:0; background:red; color:white; padding:10px; font-size:12px; z-index:9999;">Ошибка сети: ${e.message}</div>`;
      throw Object.assign(new Error("Нет связи с сервером"), { status: 0 });
    }
    let data = {};
    try { data = await res.json(); } catch (e) { /* пустой ответ */ }
    if (res.status === 403 && data.banned) { showBan(data); throw Object.assign(new Error("banned"), { banned: true }); }
    if (!res.ok) throw Object.assign(new Error(data.error || "Ошибка сервера"), { status: res.status });
    return data;
  }

  function show(id) {
    $$(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
    if (tg) {
      if (id === "s-register" || id === "s-main") tg.BackButton.show(); else tg.BackButton.hide();
    }
  }

  /* ---------- ban ---------- */
  function showBan(d) {
    stopTimers();
    const until = d.ban_until >= PERMANENT ? "навсегда" : `до ${fmtDate(d.ban_until)}`;
    $("#ban-text").textContent = `Вы забанены ${until} по причине: ${d.ban_reason}`;
    show("s-banned");
  }

  /* ---------- boot ---------- */
  async function boot() {
    show("s-loading");
    $("#btn-retry").classList.add("hidden");
    $("#load-msg").textContent = "Подключаемся к серверу";
    try {
      const [res] = await Promise.all([api("/api/auth", {}), wait(1000)]);
      if (res.banned) return showBan(res);
      if (res.registered) { me = res.user; return enterApp(); }
      show(localStorage.getItem("terms") === "1" ? "s-register" : "s-welcome");
    } catch (e) {
      if (e.banned) return;
      $("#load-msg").textContent = e.message;
      $("#btn-retry").classList.remove("hidden");
    }
  }

  /* ---------- registration ---------- */
  async function register() {
    const err = $("#reg-error");
    err.classList.add("hidden");
    const nickname = $("#in-nick").value.trim();
    const game_id = $("#in-gid").value.trim();
    const btn = $("#btn-register");
    btn.disabled = true;
    try {
      const res = await api("/api/auth", { nickname, game_id });
      if (res.banned) return showBan(res);
      me = res.user;
      enterApp();
    } catch (e) {
      if (e.banned) return;
      err.textContent = e.message;
      err.classList.remove("hidden");
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- app shell ---------- */
  function enterApp() {
    $("#nav-admin").classList.toggle("hidden", !me.is_admin);
    updateHeader();
    show("s-main");
    stack = [];
    navigate("matches", true);
    refreshOnline();
    stopTimers();
    timers.push(setInterval(refreshOnline, 30000));
  }

  function stopTimers() { timers.forEach(clearInterval); timers = []; }

  function updateHeader() { $("#hdr-coins").textContent = me.coins.toLocaleString("ru-RU"); }

  async function refreshOnline() {
    try { $("#hdr-online").textContent = (await api("/api/online")).online; } catch (e) { /* баннер бана покажет api() */ }
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
    if ($("#m-lobby:not(.hidden), #m-punish:not(.hidden)")) return closeModals();
    if (stack.length > 1) { stack.pop(); renderView(stack[stack.length - 1]); return; }
    if (tg) tg.close();
  }

  function renderView(view) {
    $$(".view").forEach((v) => v.classList.toggle("active", v.id === `v-${view}`));
    $$(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.view === view));
    $("main").scrollTop = 0;
    const loaders = { matches: loadLobbies, leaderboard: loadLeaderboard, missions: renderMissions, profile: loadProfile, subs: renderSubs, admin: renderAdminState };
    loaders[view]();
  }

  /* ---------- lobbies ---------- */
  async function loadLobbies() {
    const box = $("#lobby-list");
    try {
      const { lobbies } = await api("/api/lobbies");
      box.innerHTML = lobbies.length
        ? lobbies.map((l) => `
          <div class="card row">
            <div class="grow">
              <h3>${esc(l.map)} · ${esc(l.mode)}</h3>
              <div class="meta">
                <span>${ICON("users")}${l.players}/${l.max_players}</span>
                <span>${ICON("clock")}${ago(l.created_at)}</span>
              </div>
            </div>
            <button class="btn ghost sm" data-join="${l.id}" type="button">${ICON("game")}Войти</button>
          </div>`).join("")
        : `<div class="card empty">Активных лобби нет. Создайте первое.</div>`;
    } catch (e) { if (!e.banned) box.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
  }

  function openLobbyModal() {
    $("#sel-map").innerHTML = MAPS.map((m) => `<option>${esc(m)}</option>`).join("");
    $("#sel-mode").innerHTML = MODES.map((m) => `<option>${esc(m)}</option>`).join("");
    $("#m-lobby").classList.remove("hidden");
  }

  async function createLobby() {
    try {
      await api("/api/lobbies", { action: "create", map: $("#sel-map").value, mode: $("#sel-mode").value });
      closeModals();
      toast("Лобби создано");
      loadLobbies();
    } catch (e) { if (!e.banned) toast(e.message, "err"); }
  }

  async function joinLobby(id) {
    try {
      const res = await api("/api/lobbies", { action: "join", id: Number(id) });
      toast(res.started ? "Лобби заполнено, матч начался" : "Вы вошли в лобби");
      loadLobbies();
    } catch (e) { if (!e.banned) toast(e.message, "err"); }
  }

  function closeModals() { $$(".modal").forEach((m) => m.classList.add("hidden")); }

  /* ---------- leaderboard / missions / subs ---------- */
  async function loadLeaderboard() {
    const box = $("#lb-list");
    try {
      const { players } = await api("/api/leaderboard");
      box.innerHTML = players.length
        ? players.map((p, i) => `
          <div class="card row">
            <div class="rank ${i < 3 ? "top" + (i + 1) : ""}">${i + 1}</div>
            <div class="grow"><h3>${esc(p.nickname)}</h3><div class="meta"><span>К/Д ${p.kd}</span></div></div>
            <span class="pill gold">${p.elo} ELO</span>
          </div>`).join("")
        : `<div class="card empty">Рейтинг пока пуст.</div>`;
    } catch (e) { if (!e.banned) box.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
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

  /* ---------- profile ---------- */
  async function loadProfile() {
    try { me = (await api("/api/profile")).user; updateHeader(); } catch (e) { if (e.banned) return; }
    $("#p-avatar").textContent = me.nickname.charAt(0).toUpperCase();
    $("#p-nick").textContent = me.nickname;
    $("#p-gid").textContent = me.game_id;
    $("#p-points").textContent = me.points.toLocaleString("ru-RU");
    $("#p-coins").textContent = me.coins.toLocaleString("ru-RU");
    $("#p-kd").textContent = me.kd.toFixed(2);
    $("#p-avg").textContent = me.avg.toFixed(1);
    const banner = $("#mute-banner");
    banner.classList.toggle("hidden", !me.is_muted);
    if (me.is_muted) $("span", banner).textContent = `Вы заглушены ${me.mute_until >= PERMANENT ? "навсегда" : "до " + fmtDate(me.mute_until)}`;
  }

  /* ---------- admin ---------- */
  function renderAdminState() {
    const unlocked = !!adminPass;
    $("#admin-lock").classList.toggle("hidden", unlocked);
    $("#admin-body").classList.toggle("hidden", !unlocked);
    if (unlocked) loadAdminList();
  }

  async function adminLogin() {
    const err = $("#admin-error");
    err.classList.add("hidden");
    adminPass = $("#in-admin-pass").value;
    try {
      await api("/api/admin", { action: "list" }, true);
      $("#in-admin-pass").value = "";
      renderAdminState();
    } catch (e) {
      adminPass = "";
      if (e.banned) return;
      err.textContent = e.message;
      err.classList.remove("hidden");
    }
  }

  async function adminCall(payload) {
    try {
      return await api("/api/admin", payload, true);
    } catch (e) {
      if (e.status === 403) { adminPass = ""; renderAdminState(); }
      if (!e.banned) toast(e.message, "err");
      throw e;
    }
  }

  async function loadAdminList() {
    try { adminPlayers = (await adminCall({ action: "list" })).players; } catch (e) { return; }
    drawAdminList();
  }

  function drawAdminList() {
    const q = $("#in-admin-search").value.trim().toLowerCase();
    const rows = adminPlayers.filter((p) => !q || p.nickname.toLowerCase().includes(q) || p.game_id.includes(q) || String(p.tg_id).includes(q));
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

  async function adminAction(action, id) {
    const p = adminPlayers.find((x) => x.tg_id === Number(id));
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
      await adminCall({ action, tg_id: p.tg_id });
      toast(action === "unban" ? "Игрок разбанен" : "Мут снят");
      loadAdminList();
    } catch (e) { /* toast уже показан */ }
  }

  async function submitPunish() {
    const err = $("#punish-error");
    err.classList.add("hidden");
    try {
      await adminCall({ action: punish.action, tg_id: punish.id, minutes: Number($("#sel-time").value), reason: $("#in-reason").value.trim() });
      closeModals();
      toast(punish.action === "ban" ? "Игрок забанен" : "Игрок заглушён");
      loadAdminList();
    } catch (e) {
      err.textContent = e.message;
      err.classList.remove("hidden");
    }
  }

  /* ---------- events ---------- */
  document.addEventListener("click", (ev) => {
    const el = ev.target.closest("button");
    if (!el) return;
    if (el.dataset.join) return joinLobby(el.dataset.join);
    if (el.dataset.adm) return adminAction(el.dataset.adm, el.dataset.id);
    if (el.dataset.sub) return toast("Оплата подписок скоро появится");
    if (el.dataset.view) return navigate(el.dataset.view, el.classList.contains("nav-item"));
    switch (el.dataset.act) {
      case "back": return back();
      case "close-modal": return closeModals();
      case "welcome-back": return tg ? tg.close() : toast("Закройте вкладку, чтобы выйти");
      case "register-back": return show("s-welcome");
    }
  });

  $("#btn-retry").addEventListener("click", boot);
  $("#btn-accept").addEventListener("click", () => { localStorage.setItem("terms", "1"); show("s-register"); });
  $("#btn-register").addEventListener("click", register);
  $("#in-gid").addEventListener("input", (e) => (e.target.value = e.target.value.replace(/\D/g, "")));
  $("#btn-ban-close").addEventListener("click", () => (tg ? tg.close() : boot()));
  $("#btn-burger").addEventListener("click", () => toggleMenu(!$("#s-main").classList.contains("menu-open")));
  $("#overlay").addEventListener("click", () => toggleMenu(false));
  $("#btn-create-lobby").addEventListener("click", openLobbyModal);
  $("#btn-lobby-submit").addEventListener("click", createLobby);
  $("#btn-admin-login").addEventListener("click", adminLogin);
  $("#in-admin-pass").addEventListener("keydown", (e) => { if (e.key === "Enter") adminLogin(); });
  $("#in-admin-search").addEventListener("input", drawAdminList);
  $("#btn-punish-submit").addEventListener("click", submitPunish);
  if (tg) tg.BackButton.onClick(() => {
    if ($("#s-register").classList.contains("active")) show("s-welcome"); else back();
  });

  boot();
})();
