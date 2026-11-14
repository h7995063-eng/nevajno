// js/auth.js
(async function () {
  if (!requireAuthOrRedirect()) return;

  const { status, data } = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ init_data: initData }),
  });

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
