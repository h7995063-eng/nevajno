// js/profile.js
(async function () {
  if (!requireAuthOrRedirect()) return;
  const { data } = await api("/api/profile/me");
  if (!data?.ok) { toast("Ошибка профиля", "error"); return; }
  const u = data.user;

  $("#nick").textContent = u.nickname;
  $("#game-id").textContent = u.game_id || "—";
  $("#elo").textContent = u.elo;
  $("#coins").textContent = u.coins;
  $("#premium-badge").innerHTML = u.is_premium
    ? '<span class="badge badge-premium">★ PRO</span>'
    : '<span class="badge badge-muted">FREE</span>';
  $("#premium-until").textContent = u.premium_until
    ? new Date(u.premium_until).toLocaleDateString("ru-RU")
    : "—";

  $("#nick-form").onsubmit = async (e) => {
    e.preventDefault();
    const v = $("#nick-input").value.trim();
    if (!v) return;
    const { data: r } = await api("/api/profile/nickname", {
      method: "POST",
      body: JSON.stringify({ nickname: v }),
    });
    if (r?.ok) { toast("Ник обновлён ✅", "ok"); $("#nick").textContent = r.nickname; }
    else toast("Ошибка", "error");
  };

  $("#buy-premium").onclick = async () => {
    const { data: r } = await api("/api/profile/premium/buy", { method: "POST" });
    if (r?.ok) {
      toast("Премиум активирован ✅", "ok");
      setTimeout(() => location.reload(), 800);
    } else if (r?.error === "not_enough_coins") {
      toast(`Не хватает коинов: нужно ${r.need}, есть ${r.have}`, "error");
    } else {
      toast("Ошибка", "error");
    }
  };
})();
