// js/auth.js
(async function () {
  if (!requireAuthOrRedirect()) return;

  // Если есть TEST_TG_ID (из URL), отправляем его в заголовке
  const headers = { "Content-Type": "application/json", "X-Telegram-Init-Data": initData };
  if (window.TEST_TG_ID) {
    headers["X-Test-Tg-Id"] = window.TEST_TG_ID;
  }

  const res = await fetch(API_URL + "/api/auth/login", {
    method: "POST",
    headers: headers,
    body: JSON.stringify({ init_data: initData }),
  });

  const data = await res.json();

  if (!data?.ok) {
    toast("Ошибка входа", "error");
    return;
  }

  if (data.need_register) {
    location.replace("login.html");
  } else {
    localStorage.setItem("cs_token", data.token);
    localStorage.setItem("cs_user", JSON.stringify(data.user));
    if (location.pathname.endsWith("index.html") || location.pathname.endsWith("/")) {
      // остаёмся на главной
    }
  }
})();
