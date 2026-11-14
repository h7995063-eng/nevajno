const API_URL = "https://areas-facilitate-finds-insulation.trycloudflare.com";
const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor?.("#0a0e14"); tg.setBackgroundColor?.("#0a0e14"); }

let initData = "TEST_MODE";
window.TEST_TG_ID = "6999358439"; // Твой ID

function requireAuthOrRedirect() { return true; }
async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", "X-Telegram-Init-Data": initData, "X-Test-Tg-Id": window.TEST_TG_ID, ...(opts.headers || {}) };
  const res = await fetch(API_URL + path, { ...opts, headers });
  let data = null; try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}
function $(sel, root = document) { return root.querySelector(sel); }
function toast(msg, kind = "") {
  let el = $(".toast");
  if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
  el.textContent = msg; el.className = "toast " + kind;
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => el.classList.remove("show"), 2600);
}
