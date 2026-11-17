// js/lobby.js
(async function () {
  if (!requireAuthOrRedirect()) return;

  const listEl = $("#lobbies");
  const createBtn = $("#create-btn");
  const formEl = $("#create-form");
  const modeSel = $("#mode");
  const mapSel = $("#map");

  async function load() {
    listEl.innerHTML = '<div class="loader"></div>';
    const { data } = await api("/api/lobbies");
    if (!data?.ok) { listEl.innerHTML = '<div class="empty">Ошибка загрузки</div>'; return; }

    if (!modeSel.options.length) {
      data.modes.forEach(m => modeSel.add(new Option(m.name, m.id)));
    }
    if (!mapSel.options.length) {
      data.maps.forEach(m => mapSel.add(new Option(m, m)));
    }

    if (!data.lobbies.length) {
      listEl.innerHTML = '<div class="empty">Пока нет открытых лобби. Создай первое!</div>';
      return;
    }

    listEl.innerHTML = data.lobbies.map(l => `
      <div class="card" data-id="${l.id}">
        <div class="row">
          <div>
            <div class="name">${escapeHtml(l.creator)}</div>
            <div class="meta">${l.map} · ${l.players}/${l.max_players}</div>
          </div>
          <div class="code">${escapeHtml(l.code)}</div>
        </div>
        <div class="row" style="margin-top:12px">
          <span class="badge badge-mode">${modeName(l.mode)}</span>
          <button class="btn btn-secondary join-btn" style="width:auto;padding:8px 16px;font-size:12px">Войти</button>
        </div>
      </div>
    `).join("");

    listEl.querySelectorAll(".join-btn").forEach(btn => {
      btn.onclick = async () => {
        const id = btn.closest(".card").dataset.id;
        const { status, data } = await api(`/api/lobbies/${id}/join`, { method: "POST" });
        if (data?.ok) { toast("Ты в лобби ✅", "ok"); load(); }
        else if (data?.error === "full") toast("Лобби заполнено", "error");
        else if (data?.error === "already_joined") toast("Ты уже в лобби", "warn");
        else toast("Не удалось войти", "error");
      };
    });
  }

  function modeName(id) {
    return ({ "1x1": "1×1 Дуэль", "dm": "Deathmatch" })[id] || id;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  createBtn.onclick = () => formEl.classList.toggle("hidden");

  formEl.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(formEl);
    const { data } = await api("/api/lobbies", {
      method: "POST",
      body: JSON.stringify({
        code: fd.get("code"),
        mode: fd.get("mode"),
        map: fd.get("map"),
      }),
    });
    if (data?.ok) {
      toast("Лобби создано ✅", "ok");
      formEl.reset();
      formEl.classList.add("hidden");
      load();
    } else {
      toast("Не удалось создать", "error");
    }
  };

  load();
  setInterval(load, 15000);
})();
