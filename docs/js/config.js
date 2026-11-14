// js/config.js
const API_URL = "https://areas-facilitate-finds-insulation.trycloudflare.com";

const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  tg.setHeaderColor?.("#0a0e14");
  tg.setBackgroundColor?.("#0a0e14");
}

const initData = tg?.initData || "";

console.log("[DEBUG] Telegram object:", window.Telegram);
console.log("[DEBUG] WebApp:", window.Telegram?.WebApp);
console.log("[DEBUG] initData length:", (window.Telegram?.WebApp?.initData || "").length);
console.log("[DEBUG] initDataUnsafe:", window.Telegram?.WebApp?.initDataUnsafe);


// ── Хелперы ──
function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

async function api(path, opts = {}) {
  const headers = {
    "Content-Type": "application/json",
    "X-Telegram-Init-Data": initData,
    ...(opts.headers || {}),
  };
  const res = await fetch(API_URL + path, { ...opts, headers });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}

function toast(msg, kind = "") {
  let el = $(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = "toast " + kind;
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(window.__toastT);
  window.__toastT = setTimeout(() => el.classList.remove("show"), 2600);
}

function requireAuthOrRedirect() {
  if (!initData) {
    document.body.innerHTML = `
      <div class="container">
        <div class="empty">
          <p>⚠️ Открой через Telegram-бота</p>
          <p style="margin-top:8px;font-size:13px">Это приложение работает только внутри Telegram.</p>
        </div>
      </div>`;
    return false;
  }
  return true;
}

function ico(name, cls = "") {
  return `<svg class="${cls}" style="width:1em;height:1em;vertical-align:-0.15em"><use href="assets/icons/${name}.svg#i"/></svg>`;
}
