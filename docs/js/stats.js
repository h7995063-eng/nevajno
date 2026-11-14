// js/stats.js
(async function () {
  if (!requireAuthOrRedirect()) return;
  const el = $("#top");
  el.innerHTML = '<div class="loader"></div>';
  const { data } = await api("/api/stats/top");
  if (!data?.ok) { el.innerHTML = '<div class="empty">Ошибка</div>'; return; }
  if (!data.top.length) { el.innerHTML = '<div class="empty">Пока нет игроков</div>'; return; }
  el.innerHTML = `<div class="top-list">${data.top.map((u, i) => `
    <div class="top-item">
      <div class="rank">#${i + 1}</div>
      <div class="nick">${escapeHtml(u.nickname)} ${u.is_premium ? '<span class="badge badge-premium">★ PRO</span>' : ''}</div>
      <div class="elo">${u.elo}</div>
    </div>
  `).join("")}</div>`;
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
})();
