(() => {
  "use strict";

  const MAPS = [
    { id: "dust2", name: "Dust 2" },
    { id: "mirage", name: "Mirage" },
    { id: "inferno", name: "Inferno" },
    { id: "nuke", name: "Nuke" },
  ];
  const MODES = [
    { id: "1v1", size: 2, desc: "Дуэль" },
    { id: "2v2", size: 4, desc: "Пара на пару" },
    { id: "5v5", size: 10, desc: "Классика" },
    { id: "DM", size: 16, desc: "Каждый сам за себя" },
  ];
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
  const PERMANENT = 4102444800;
  const NICK_RE = /^[A-Za-z0-9_\-А-Яа-яЁё]{3,20}$/;
  const API = String(window.API_URL || "").replace(/\/+$/, "");

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ICON = (id) => `<svg><use href="#i-${id}"/></svg>`;
  const now = () => Math.floor(Date.now() / 1000);
  const mapName = (id) => (MAPS.find((m) => m.id === id) || { name: id }).name;
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  const tg = (window.Telegram && window.Telegram.WebApp) || null;
  if (tg) {
    try { tg.ready(); tg.expand(); tg.setHeaderColor("#0b0d12"); tg.setBackgroundColor("#0b0d12"); } catch (e) {}
  }

  function haptic(kind) {
    try {
      if (!tg || !tg.HapticFeedback) return;
      if (kind === "ok") tg.HapticFeedback.notificationOccurred("success");
      else tg.HapticFeedback.impactOccurred("light");
    } catch (e) {}
  }

  function store(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      localStorage.setItem(k, v);
    } catch (e) {}
    return null;
  }

  const DEV_ID = 6999358439;

  function readInitData() {
    try {
      if (tg && tg.initData) return tg.initData;
      return new URLSearchParams(location.hash.replace(/^#/, "")).get("tgWebAppData") || "";
    } catch (e) { return ""; }
  }

  async function api(path, opts = {}) {
    const headers = { "Content-Type": "application/json", "Bypass-Tunnel-Reminder": "true", "ngrok-skip-browser-warning": "1" };
    const init = readInitData();
    if (init) headers["X-Init-Data"] = init;
    else headers["X-Dev-User"] = JSON.stringify({ id: DEV_ID, username: "dev" });
    if (opts.admin) headers["X-Admin-Password"] = opts.admin;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    let res;
    try {
      res = await fetch(API + path, {
        method: opts.method || (opts.body ? "POST" : "GET"),
        headers, body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: ctrl.signal, cache: "no-store",
      });
    } catch (e) {
      const err = new Error("Нет связи с сервером. Проверьте подключение");
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

  function toast(msg, type = "ok") {
    const t = $("#toast");
    t.textContent = msg;
    t.className = `toast show ${type}`;
    clearTimeout(toast.id);
    toast.id = setTimeout(() => (t.className = "toast"), 2800);
  }

  function handleErr(e) {
    if (e && e.data && e.data.banned) return showBan(e.data);
    toast(e.message || "Ошибка", "err");
  }

  function fmtDate(ts) {
    if (ts >= PERMANENT) return "навсегда";
    return new Date(ts * 1000).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  let timeOffset = 0;
  const serverNow = () => now() + timeOffset;

  function ago(ts) {
    const m = Math.max(0, Math.floor((serverNow() - ts) / 60));
    if (m < 1) return "только что";
    if (m < 60) return `${m} мин назад`;
    return `${Math.floor(m / 60)} ч назад`;
  }

  function fmtEta(sec) {
    if (sec <= 0) return "скоро";
    if (sec < 60) return "менее минуты";
    const m = Math.round(sec / 60);
    return m > 15 ? "более 15 мин" : `~${m} мин`;
  }

  function copyText(text) {
    const done = () => { toast("Скопировано"); haptic(); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else fallbackCopy(text, done);
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); done(); } catch (e) { toast("Не удалось скопировать", "err"); }
    ta.remove();
  }

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

  let me = null;
  let stack = [];
  let lobbies = [];
  let myLobby = null;
  let filter = "all";
  let listTimer = null;
  let createMode = "5v5";
  let adminPass = "";
  let adminUsers = [];
  let punish = null;
  let confirmCb = null;
  const room = { id: null, data: null, sig: "", offset: 0, poll: null, tick: null, busy: false };

  function show(id) {
    $$(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
    if (tg && tg.BackButton) {
      try { id === "s-register" ? tg.BackButton.show() : id !== "s-main" && tg.BackButton.hide(); } catch (e) {}
    }
  }

  function closeApp() {
    if (tg && tg.close) tg.close(); else toast("Закройте вкладку, чтобы выйти");
  }

  function stopAll() {
    clearInterval(listTimer);
    stopRoomPoll();
  }

  function showBan(data) {
    stopAll();
    const until = data.ban_until >= PERMANENT ? "навсегда" : `до ${fmtDate(data.ban_until)}`;
    $("#ban-text").textContent = `Вы забанены ${until}. Причина: ${data.ban_reason || "не указана"}`;
    show("s-banned");
  }

  async function boot() {
    show("s-loading");
    $("#btn-retry").classList.add("hidden");
    $("#load-msg").textContent = "Подключаемся к серверу";
    try {
      const res = await api("/api/auth", { method: "POST", body: {} });
      if (res.banned) return showBan(res);
      if (!res.registered) {
        if (store("terms") === "1") { resetRegister(); show("s-register"); } else show("s-welcome");
        return;
      }
      me = res.user;
      enterApp(true);
    } catch (e) {
      if (e.data && e.data.banned) return showBan(e.data);
      $("#load-msg").textContent = e.message;
      $("#btn-retry").classList.remove("hidden");
    }
  }

  const reg = { nickOk: false, gidOk: false, step: 1 };

  function resetRegister() {
    reg.step = 1;
    setRegStep(1);
    $("#in-nick").value = "";
    $("#in-gid").value = "";
    updateRegPreview();
    validateNick();
    validateGid();
  }

  function setRegStep(n) {
    reg.step = n;
    $("#reg-step-1").classList.toggle("hidden", n !== 1);
    $("#reg-step-2").classList.toggle("hidden", n !== 2);
    $("#step-bar-2").classList.toggle("on", n === 2);
    $("#reg-step-tag").textContent = `${n} / 2`;
    $("#reg-error").classList.add("hidden");
  }

  function updateRegPreview() {
    const nick = $("#in-nick").value.trim();
    const gid = $("#in-gid").value.trim();
    $("#reg-avatar").textContent = nick ? nick.charAt(0).toUpperCase() : "?";
    $("#reg-pv-nick").textContent = nick || "Твой ник";
    $("#reg-pv-id").textContent = gid ? `ID CounterFlame: ${gid}` : "ID CounterFlame не указан";
    $("#nick-count").textContent = `${$("#in-nick").value.length}/20`;
  }

  function setField(wrapSel, hintSel, state, text) {
    const wrap = $(wrapSel);
    const hint = $(hintSel);
    wrap.classList.toggle("ok", state === "ok");
    wrap.classList.toggle("bad", state === "bad");
    hint.className = `hint ${state === "ok" ? "ok" : state === "bad" ? "bad" : ""}`;
    hint.textContent = text;
  }

  const checkNickRemote = debounce(async (value) => {
    try {
      const r = await api(`/api/check?nickname=${encodeURIComponent(value)}`);
      if ($("#in-nick").value.trim() !== value) return;
      reg.nickOk = r.nickname_free !== false;
      setField("#wrap-nick", "#nick-hint", reg.nickOk ? "ok" : "bad", reg.nickOk ? "Ник свободен" : "Этот ник уже занят");
      $("#btn-step-next").disabled = !reg.nickOk;
    } catch (e) {
      reg.nickOk = true;
      $("#btn-step-next").disabled = false;
    }
  }, 350);

  function validateNick() {
    const v = $("#in-nick").value.trim();
    reg.nickOk = false;
    $("#btn-step-next").disabled = true;
    if (!v) return setField("#wrap-nick", "#nick-hint", "", "3–20 символов: буквы, цифры, _ и -");
    if (!NICK_RE.test(v)) return setField("#wrap-nick", "#nick-hint", "bad", v.length < 3 ? "Слишком короткий ник" : "Только буквы, цифры, _ и -");
    setField("#wrap-nick", "#nick-hint", "", "Проверяем доступность…");
    checkNickRemote(v);
  }

  const checkGidRemote = debounce(async (value) => {
    try {
      const r = await api(`/api/check?game_id=${encodeURIComponent(value)}`);
      if ($("#in-gid").value.trim() !== value) return;
      reg.gidOk = r.game_id_free !== false;
      setField("#wrap-gid", "#gid-hint", reg.gidOk ? "ok" : "bad", reg.gidOk ? "ID свободен" : "Этот ID уже зарегистрирован");
      $("#btn-register").disabled = !reg.gidOk;
    } catch (e) {
      reg.gidOk = true;
      $("#btn-register").disabled = false;
    }
  }, 350);

  function validateGid() {
    const v = $("#in-gid").value.trim();
    reg.gidOk = false;
    $("#btn-register").disabled = true;
    if (!v) return setField("#wrap-gid", "#gid-hint", "", "От 4 до 12 цифр. Его можно найти в профиле игры");
    if (!/^\d{4,12}$/.test(v)) return setField("#wrap-gid", "#gid-hint", "bad", "Нужно от 4 до 12 цифр");
    setField("#wrap-gid", "#gid-hint", "", "Проверяем ID…");
    checkGidRemote(v);
  }

  async function register() {
    const err = $("#reg-error");
    err.classList.add("hidden");
    const btn = $("#btn-register");
    btn.disabled = true;
    try {
      const res = await api("/api/auth", { method: "POST", body: { nickname: $("#in-nick").value.trim(), game_id: $("#in-gid").value.trim() } });
      if (res.banned) return showBan(res);
      me = res.user;
      haptic("ok");
      enterApp(false);
    } catch (e) {
      err.textContent = e.message;
      err.classList.remove("hidden");
      btn.disabled = false;
    }
  }

  function enterApp(resume) {
    $("#btn-open-admin").classList.toggle("hidden", !me.is_admin);
    updateHeader();
    show("s-main");
    stack = [];
    navigate("matches", true);
    clearInterval(listTimer);
    listTimer = setInterval(() => refreshLobbies(false), 5000);
    refreshLobbies(resume);
  }

  function updateHeader() {
    $("#hdr-coins").textContent = Number(me.coins || 0).toLocaleString("ru-RU");
  }

  const current = () => stack[stack.length - 1];

  function navigate(view, reset = false) {
    if (view === "admin" && !me.is_admin) return;
    if (reset) stack = [view];
    else if (current() !== view) stack.push(view);
    renderView(view);
  }

  function back() {
    if ($(".modal:not(.hidden)")) return closeModals();
    if (stack.length > 1) {
      stack.pop();
      renderView(current());
      return;
    }
    closeApp();
  }

  function renderView(view) {
    $$(".view").forEach((v) => v.classList.toggle("active", v.id === `v-${view}`));
    const tabOf = { room: "matches", subs: "profile", admin: "profile" }[view] || view;
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === tabOf));
    $("#main").scrollTop = 0;
    if (view !== "room") stopRoomPoll();
    updatePill();
    if (tg && tg.BackButton) {
      try { stack.length > 1 ? tg.BackButton.show() : tg.BackButton.hide(); } catch (e) {}
    }
    ({
      matches: renderLobbies, leaderboard: loadLeaderboard, missions: renderMissions,
      profile: loadProfile, subs: renderSubs, admin: renderAdminState, room: startRoomPoll,
    })[view]();
  }

  function closeModals() { $$(".modal").forEach((m) => m.classList.add("hidden")); }

  function updatePill() {
    const pill = $("#lobby-pill");
    if (!myLobby || current() === "room") return pill.classList.add("hidden");
    const text = {
      open: `Лобби ${myLobby.mode}: ${myLobby.players}/${myLobby.max_players}`,
      voting: `Голосование за карту · ${myLobby.mode}`,
      started: `Матч ${myLobby.mode} начался`,
    }[myLobby.status] || `Лобби ${myLobby.mode}`;
    $("#pill-text").textContent = text;
    pill.classList.remove("hidden");
  }

  async function refreshLobbies(openMine) {
    try {
      const d = await api("/api/lobbies");
      if (d.server_time) timeOffset = d.server_time - now();
      lobbies = d.lobbies;
      myLobby = d.my_lobby;
      $("#hdr-online").textContent = d.online;
      updatePill();
      if (current() === "matches") renderLobbies();
      if (openMine === true && myLobby && !room.id) openRoom(myLobby.id);
    } catch (e) {
      if (e.data && e.data.banned) showBan(e.data);
    }
  }

  function renderLobbies() {
    const list = lobbies.filter((l) => filter === "all" || l.mode === filter);
    $("#matches-sub").textContent = lobbies.length ? `Открытых лобби: ${lobbies.length}` : "Выбери лобби или создай своё";
    $("#lobby-list").innerHTML = list.length
      ? list.map((l) => {
        const pct = Math.round((l.players / l.max_players) * 100);
        return `
        <div class="card lobby-card m-${esc(l.mode)}">
          <div class="lc-top">
            <span class="mode-tag">${esc(l.mode)}</span>
            <span class="lc-owner">${esc(l.owner)}</span>
            <span class="lc-count">${l.players}/${l.max_players}</span>
          </div>
          <div class="bar"><i style="width:${pct}%"></i></div>
          <div class="lc-bot">
            <div class="meta">
              <span>${ICON("clock")}Ожидание: ${fmtEta(l.eta)}</span>
              <span>${ICON("map")}Карта — голосованием</span>
            </div>
            ${l.mine
              ? `<button class="btn ghost sm" data-room="${l.id}" type="button">Открыть</button>`
              : `<button class="btn primary sm" data-join="${l.id}" type="button">${ICON("game")}Войти</button>`}
          </div>
        </div>`;
      }).join("")
      : `<div class="card empty"><b>Активных лобби нет</b>Создайте первое и позовите друзей</div>`;
  }

  function openLobbyModal() {
    $("#mode-grid").innerHTML = MODES.map((m) => `
      <button class="mode-opt ${m.id === createMode ? "sel" : ""}" data-mode="${m.id}" type="button">
        <b>${m.id}</b><span>${m.desc}</span><em>${m.size} игроков</em>
      </button>`).join("");
    $("#m-lobby").classList.remove("hidden");
  }

  async function submitLobby() {
    const btn = $("#btn-lobby-submit");
    btn.disabled = true;
    try {
      const res = await api("/api/lobbies", { method: "POST", body: { action: "create", mode: createMode } });
      closeModals();
      haptic("ok");
      openRoom(res.id);
      refreshLobbies(false);
    } catch (e) {
      if (e.status === 409 && e.data && e.data.id) { closeModals(); openRoom(e.data.id); toast("Вы уже в лобби", "err"); }
      else handleErr(e);
    } finally { btn.disabled = false; }
  }

  async function doJoin(id) {
    try {
      const res = await api("/api/lobbies", { method: "POST", body: { action: "join", id: Number(id) } });
      haptic("ok");
      openRoom(res.id);
      refreshLobbies(false);
    } catch (e) {
      if (e.status === 409 && e.data && e.data.id) { openRoom(e.data.id); toast("Вы уже в другом лобби", "err"); }
      else { handleErr(e); refreshLobbies(false); }
    }
  }

  function openRoom(id) {
    room.id = Number(id);
    room.data = null;
    room.sig = "";
    $("#room-title").textContent = "Лобби";
    $("#room-status").textContent = "";
    $("#room-body").innerHTML = `<div class="card empty">Загружаем лобби…</div>`;
    if (current() === "room") startRoomPoll(); else navigate("room");
  }

  function startRoomPoll() {
    stopRoomPoll();
    if (!room.id) return navigate("matches", true);
    pollRoom();
    room.poll = setInterval(pollRoom, 2000);
    room.tick = setInterval(updateVoteTimer, 500);
  }

  function stopRoomPoll() {
    clearInterval(room.poll);
    clearInterval(room.tick);
    room.poll = null;
    room.tick = null;
  }

  async function pollRoom() {
    if (!room.id || room.busy || document.hidden) return;
    room.busy = true;
    try {
      const d = await api(`/api/lobby/${room.id}`);
      applyRoom(d.lobby, d.server_time);
    } catch (e) {
      if (e.data && e.data.banned) showBan(e.data);
      else if (e.status === 404 || e.status === 403) leaveRoomLocal("Лобби закрыто");
    } finally { room.busy = false; }
  }

  function leaveRoomLocal(msg) {
    room.id = null;
    room.data = null;
    myLobby = null;
    stopRoomPoll();
    if (msg) toast(msg, "err");
    navigate("matches", true);
    refreshLobbies(false);
  }

  function applyRoom(l, serverTime) {
    if (!room.id) return;
    if (serverTime) { room.offset = serverTime - now(); timeOffset = room.offset; }
    const prev = room.data;
    room.data = l;
    if (prev) {
      if (prev.status !== "started" && l.status === "started") {
        haptic("ok");
        toast(l.is_host ? "Матч начался. Вы хостер" : "Матч начался");
      }
      if (prev.status === "open" && l.status === "voting") toast("Лобби заполнено. Голосуйте за карту");
      if (!prev.code && l.code && !l.is_host) { haptic("ok"); toast("Хостер отправил код"); }
    }
    $("#room-title").textContent = `Лобби · ${l.mode}`;
    const chip = $("#room-status");
    chip.className = `status-chip ${l.status}`;
    chip.textContent = { open: "Ожидание", voting: "Голосование", started: "Матч идёт" }[l.status] || "";
    const sig = JSON.stringify([l.status, l.players, l.members, l.votes, l.my_vote, l.final_map, l.host, l.is_host, l.code, l.eta]);
    if (sig !== room.sig) { room.sig = sig; renderRoom(l); }
    updateVoteTimer();
    myLobby = { id: l.id, mode: l.mode, players: l.players, max_players: l.max_players, status: l.status };
  }

  function updateVoteTimer() {
    const el = $("#vote-left");
    const l = room.data;
    if (!el || !l || l.status !== "voting") return;
    el.textContent = Math.max(0, Math.ceil(l.voting_until - (now() + room.offset)));
  }

  function heroOpen(l) {
    const pct = Math.round((l.players / l.max_players) * 100);
    const left = l.max_players - l.players;
    return `
      <div class="card room-hero">
        <span class="muted">Поиск игроков</span>
        <div class="big">${l.players}<small>/${l.max_players}</small></div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="eta">${ICON("clock")}Примерное ожидание: <b>${fmtEta(l.eta)}</b></div>
        <p>Ещё нужно игроков: ${left}. Голосуй за карту уже сейчас — когда лобби заполнится, останется немного времени, чтобы поменять выбор.</p>
      </div>`;
  }

  function heroVoting(l) {
    const voted = l.members.filter((m) => m.voted).length;
    return `
      <div class="card room-hero">
        <span class="muted">Лобби заполнено · проголосовали ${voted}/${l.members.length}</span>
        <div class="timer" id="vote-left">0</div>
        <p>Выберите карту. Побеждает та, за которую больше голосов; при равенстве выбор случайный среди лидеров.</p>
      </div>`;
  }

  function heroStarted(l) {
    let h = `
      <div class="map-result">
        <img src="assets/maps/${esc(l.final_map)}.jpg" alt="" onerror="this.onerror=null;this.src='assets/maps/${esc(l.final_map)}.svg'">
        <div class="mr"><small>КАРТА МАТЧА</small><h3>${esc(l.final_map_name)}</h3></div>
      </div>`;
    if (l.is_host) {
      h += l.code
        ? `<div class="code-box"><small>Код отправлен всем игрокам</small><div class="code-val">${esc(l.code)}</div></div>`
        : `<div class="notice">${ICON("crown")}<span>Вас выбрали хостером. Создайте игру и отправьте код лобби — он придёт всем игрокам в мини-апп и в Telegram.</span></div>`;
      h += `
        <div class="host-form">
          <div class="input">${ICON("lock")}<input id="in-code" maxlength="24" autocomplete="off" autocapitalize="off" placeholder="Код лобби из игры"></div>
          <button class="btn primary wide" data-act="send-code" type="button">${ICON("send")}${l.code ? "Отправить новый код" : "Отправить код игрокам"}</button>
        </div>`;
    } else if (l.code) {
      h += `
        <div class="code-box">
          <small>Код от хостера ${esc(l.host)}</small>
          <div class="code-val">${esc(l.code)}</div>
          <button class="btn green wide" data-copy="${esc(l.code)}" type="button">${ICON("copy")}Скопировать код</button>
        </div>
        <div class="notice">${ICON("game")}<span>Зайдите в игру по этому коду и дождитесь остальных игроков.</span></div>`;
    } else {
      h += `<div class="notice">${ICON("clock")}<span>Ваш матч начался. Дождитесь хостера (${esc(l.host)}) — он скинет код для входа в игру.</span></div>`;
    }
    return h;
  }

  function membersBlock(l) {
    const showVotes = l.status !== "started";
    const filled = l.members.map((m) => `
      <div class="slot ${m.is_me ? "me" : ""}">
        <div class="avatar">${esc(m.nickname.charAt(0).toUpperCase())}</div>
        <div class="nm">${esc(m.nickname)}${m.is_me ? " (вы)" : ""}<small>${m.elo} ELO</small></div>
        ${m.is_host ? `<svg class="crown">${"<use href=\"#i-crown\"/>"}</svg>` : ""}
        ${showVotes && m.voted ? `<svg class="vtick"><use href="#i-check"/></svg>` : ""}
      </div>`).join("");
    const empties = l.status === "open"
      ? Array.from({ length: Math.max(0, l.max_players - l.members.length) }, () => `<div class="slot empty">Свободно</div>`).join("")
      : "";
    return `
      <div class="section-title"><span>ИГРОКИ</span><span>${l.members.length}/${l.max_players}</span></div>
      <div class="slots">${filled}${empties}</div>`;
  }

  function mapsBlock(l) {
    const max = Math.max(0, ...Object.values(l.votes));
    const total = Object.values(l.votes).reduce((a, b) => a + b, 0);
    return `
      <div class="section-title"><span>ГОЛОСОВАНИЕ ЗА КАРТУ</span><span>${total} гол.</span></div>
      <div class="maps">${MAPS.map((m) => {
        const v = l.votes[m.id] || 0;
        return `
        <button class="map-card ${l.my_vote === m.id ? "sel" : ""} ${max > 0 && v === max ? "lead" : ""}" data-vote="${m.id}" type="button">
          <img src="assets/maps/${m.id}.jpg" alt="" loading="lazy" onerror="this.onerror=null;this.src='assets/maps/${m.id}.svg'">
          <span class="tick">${ICON("check")}</span>
          <span class="mi"><span class="mn">${m.name}</span><span class="mv">${ICON("flag")}${v}</span></span>
        </button>`;
      }).join("")}</div>`;
  }

  function renderRoom(l) {
    const codeEl = $("#in-code");
    const keep = codeEl ? codeEl.value : "";
    const focused = codeEl && document.activeElement === codeEl;
    const hero = l.status === "open" ? heroOpen(l) : l.status === "voting" ? heroVoting(l) : heroStarted(l);
    $("#room-body").innerHTML = `
      ${hero}
      ${membersBlock(l)}
      ${l.status !== "started" ? mapsBlock(l) : ""}
      <div class="leave-row"><button class="btn danger wide" data-act="leave" type="button">${ICON("exit")}${l.status === "started" ? "Выйти из матча" : "Покинуть лобби"}</button></div>`;
    const fresh = $("#in-code");
    if (fresh && keep) { fresh.value = keep; if (focused) fresh.focus(); }
  }

  async function vote(mapId) {
    if (!room.id) return;
    try {
      const d = await api(`/api/lobby/${room.id}/vote`, { method: "POST", body: { map: mapId } });
      haptic();
      applyRoom(d.lobby, d.server_time);
    } catch (e) { handleErr(e); }
  }

  async function sendCode() {
    const input = $("#in-code");
    if (!input || !room.id) return;
    try {
      const d = await api(`/api/lobby/${room.id}/code`, { method: "POST", body: { code: input.value.trim() } });
      room.sig = "";
      applyRoom(d.lobby, d.server_time);
      haptic("ok");
      toast("Код отправлен игрокам");
    } catch (e) { handleErr(e); }
  }

  function askConfirm(title, text, cb) {
    $("#confirm-title").textContent = title;
    $("#confirm-text").textContent = text;
    confirmCb = cb;
    $("#m-confirm").classList.remove("hidden");
  }

  async function leaveRoom() {
    const id = room.id;
    if (!id) return;
    try {
      await api(`/api/lobby/${id}/leave`, { method: "POST", body: {} });
      leaveRoomLocal("");
      toast("Вы вышли из лобби");
    } catch (e) {
      if (e.status === 404 || e.status === 403) leaveRoomLocal("");
      else handleErr(e);
    }
  }

  async function loadLeaderboard() {
    $("#lb-list").innerHTML = `<div class="card empty">Загружаем…</div>`;
    try {
      const d = await api("/api/leaderboard");
      $("#lb-list").innerHTML = d.players.length
        ? d.players.map((p, i) => `
          <div class="card row ${p.is_me ? "me" : ""}">
            <div class="rank ${i < 3 ? "top" + (i + 1) : ""}">${i + 1}</div>
            <div class="grow"><h3>${esc(p.nickname)}${p.is_me ? " (вы)" : ""}</h3><div class="meta"><span>К/Д ${Number(p.kd).toFixed(2)}</span></div></div>
            <span class="pill gold">${p.elo} ELO</span>
          </div>`).join("")
        : `<div class="card empty"><b>Рейтинг пока пуст</b>Сыграй первый матч</div>`;
    } catch (e) { $("#lb-list").innerHTML = `<div class="card empty">${esc(e.message)}</div>`; handleErr(e); }
  }

  function renderMissions() {
    $("#mission-list").innerHTML = MISSIONS.map((m) => `
      <div class="card">
        <div class="row">
          <div class="grow"><h3>${esc(m.title)}</h3><div class="meta"><span>${ICON("coin")}+${m.reward} коинов</span></div></div>
          <span class="pill">0/${m.goal}</span>
        </div>
        <div class="bar" style="margin-top:10px"><i style="width:0%"></i></div>
      </div>`).join("");
  }

  function renderSubs() {
    $("#subs-list").innerHTML = PLANS.map((p) => `
      <div class="card plan ${p.featured ? "featured" : ""}">
        <div class="row"><h3 class="grow">${esc(p.name)}</h3><span class="price">${esc(p.price)}</span></div>
        <ul>${p.perks.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        <button class="btn ${p.featured ? "gold" : "ghost"} wide" data-sub="${esc(p.name)}" type="button">${ICON("star")}Оформить</button>
      </div>`).join("");
  }

  function fillProfile() {
    $("#p-avatar").textContent = me.nickname.charAt(0).toUpperCase();
    $("#p-nick").textContent = me.nickname;
    $("#p-gid").textContent = me.game_id;
    $("#p-rank").textContent = me.rank ? `#${me.rank} в рейтинге` : "#—";
    $("#p-elo").textContent = me.elo;
    $("#p-coins").textContent = Number(me.coins).toLocaleString("ru-RU");
    $("#p-kd").textContent = Number(me.kd).toFixed(2);
    $("#p-avg").textContent = Number(me.avg).toFixed(1);
    const banner = $("#mute-banner");
    banner.classList.toggle("hidden", !me.is_muted);
    if (me.is_muted) $("span", banner).textContent = `Вы заглушены ${me.mute_until >= PERMANENT ? "навсегда" : "до " + fmtDate(me.mute_until)}`;
    updateHeader();
  }

  async function loadProfile() {
    fillProfile();
    try {
      const d = await api("/api/profile");
      me = d.user;
      fillProfile();
    } catch (e) { handleErr(e); }
  }

  function renderAdminState() {
    const unlocked = Boolean(adminPass);
    $("#admin-lock").classList.toggle("hidden", unlocked);
    $("#admin-body").classList.toggle("hidden", !unlocked);
    if (unlocked) loadAdminList();
  }

  async function adminLogin() {
    const err = $("#admin-error");
    err.classList.add("hidden");
    const pass = $("#in-admin-pass").value;
    try {
      const d = await api("/api/admin", { method: "POST", body: { action: "list" }, admin: pass });
      adminPass = pass;
      adminUsers = d.players;
      $("#in-admin-pass").value = "";
      renderAdminState();
    } catch (e) {
      err.textContent = e.message;
      err.classList.remove("hidden");
    }
  }

  async function loadAdminList() {
    try {
      const d = await api("/api/admin", { method: "POST", body: { action: "list" }, admin: adminPass });
      adminUsers = d.players;
      drawAdminList();
    } catch (e) {
      adminPass = "";
      renderAdminState();
      handleErr(e);
    }
  }

  function drawAdminList() {
    const q = $("#in-admin-search").value.trim().toLowerCase();
    const rows = adminUsers.filter((p) => !q || p.nickname.toLowerCase().includes(q) || p.game_id.includes(q) || String(p.tg_id).includes(q));
    $("#admin-list").innerHTML = rows.length ? rows.map((p) => `
      <div class="card admin-row">
        <div class="row">
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
      </div>`).join("") : `<div class="card empty">Игроки не найдены</div>`;
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
      $("#m-punish").classList.remove("hidden");
      return;
    }
    try {
      await api("/api/admin", { method: "POST", admin: adminPass, body: { action, tg_id: p.tg_id } });
      toast(action === "unban" ? "Игрок разбанен" : "Мут снят");
      loadAdminList();
    } catch (e) { handleErr(e); }
  }

  async function submitPunish() {
    const err = $("#punish-error");
    err.classList.add("hidden");
    try {
      await api("/api/admin", {
        method: "POST", admin: adminPass,
        body: { action: punish.action, tg_id: punish.id, minutes: Number($("#sel-time").value), reason: $("#in-reason").value },
      });
      closeModals();
      toast(punish.action === "ban" ? "Игрок забанен" : "Игрок заглушён");
      loadAdminList();
    } catch (e) {
      err.textContent = e.message;
      err.classList.remove("hidden");
    }
  }

  document.addEventListener("click", (ev) => {
    const el = ev.target.closest("button");
    if (!el) return;
    if (el.id === "lobby-pill") { if (myLobby) openRoom(myLobby.id); return; }
    if (el.dataset.join) return doJoin(el.dataset.join);
    if (el.dataset.room) return openRoom(el.dataset.room);
    if (el.dataset.vote) return vote(el.dataset.vote);
    if (el.dataset.copy) return copyText(el.dataset.copy);
    if (el.dataset.adm) return adminAction(el.dataset.adm, el.dataset.id);
    if (el.dataset.sub) return toast("Оплата подписок скоро появится");
    if (el.dataset.filter) {
      filter = el.dataset.filter;
      $$(".fchip").forEach((c) => c.classList.toggle("active", c === el));
      return renderLobbies();
    }
    if (el.dataset.mode) {
      createMode = el.dataset.mode;
      $$(".mode-opt").forEach((c) => c.classList.toggle("sel", c === el));
      return haptic();
    }
    if (el.dataset.view) return navigate(el.dataset.view, el.classList.contains("tab"));
    switch (el.dataset.act) {
      case "back": return back();
      case "close-modal": return closeModals();
      case "register-back": return show("s-welcome");
      case "send-code": return sendCode();
      case "leave":
        return askConfirm(
          room.data && room.data.status === "started" ? "Выйти из матча?" : "Покинуть лобби?",
          room.data && room.data.status === "started" ? "Вы выйдете из матча. Если вы хостер, роль перейдёт к другому игроку." : "Ваше место освободится для других игроков.",
          leaveRoom,
        );
    }
  });

  $("#btn-retry").addEventListener("click", boot);
  $("#chk-terms").addEventListener("change", (e) => { $("#btn-accept").disabled = !e.target.checked; });
  $("#btn-accept").addEventListener("click", () => { store("terms", "1"); resetRegister(); show("s-register"); });
  $("#in-nick").addEventListener("input", () => { updateRegPreview(); validateNick(); });
  $("#in-gid").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/\D/g, ""); updateRegPreview(); validateGid(); });
  $("#btn-step-next").addEventListener("click", () => { setRegStep(2); $("#in-gid").focus(); });
  $("#btn-step-prev").addEventListener("click", () => setRegStep(1));
  $("#btn-register").addEventListener("click", register);
  $("#btn-ban-close").addEventListener("click", () => (tg && tg.close ? tg.close() : boot()));
  $("#btn-create-lobby").addEventListener("click", openLobbyModal);
  $("#btn-lobby-submit").addEventListener("click", submitLobby);
  $("#btn-admin-login").addEventListener("click", adminLogin);
  $("#in-admin-pass").addEventListener("keydown", (e) => { if (e.key === "Enter") adminLogin(); });
  $("#in-admin-search").addEventListener("input", drawAdminList);
  $("#btn-punish-submit").addEventListener("click", submitPunish);
  $("#btn-confirm-ok").addEventListener("click", () => { closeModals(); if (confirmCb) confirmCb(); });
  $$(".modal").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) closeModals(); }));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.id === "in-code") sendCode();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !me) return;
    if (room.id && current() === "room") pollRoom(); else refreshLobbies(false);
  });
  if (tg && tg.BackButton) {
    try {
      tg.BackButton.onClick(() => {
        if ($("#s-register").classList.contains("active")) {
          if (reg.step === 2) setRegStep(1); else show("s-welcome");
        } else back();
      });
    } catch (e) {}
  }

  $$(".logo-img").forEach((img) => { if (img.complete && img.naturalWidth === 0) logoFallback(img); });
  boot();
})();
