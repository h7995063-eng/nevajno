// js/config_v2.js
const API_URL = "https://areas-facilitate-finds-insulation.trycloudflare.com";

const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  tg.setHeaderColor?.("#0a0e14");
  tg.setBackgroundColor?.("#0a0e14");
}

let initData = tg?.initData || "";

// ТЕСТОВЫЙ РЕЖИМ (для браузера)
if (!initData) {
  const urlParams = new URLSearchParams(window.location.search);
  const testTgId = urlParams.get('tg_id');
  if (testTgId) {
    initData = "TEST_MODE";
    window.TEST_TG_ID = testTgId;
    console.log("[TEST MODE] Using tg_id:", testTgId);
  }
}

function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

async function api(path, opts = {}) {
  const headers = {
    "Content-Type": "application/json",
    "X-Telegram-Init-Data": initData,
    ...(opts.headers || {}),
  };
  if (window.TEST_TG_ID) {
    headers["X-Test-Tg-Id"] = window.TEST_TG_ID;
  }
  if (window.TEST_TG_ID) {
    headers["X-Test-Tg-Id"] = window.TEST_TG_ID;
  }
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
