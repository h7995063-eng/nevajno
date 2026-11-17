// js/auth.js
(async function () {
  if (!requireAuthOrRedirect()) return;

  const { status, data } = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ init_data: initData }),
  });

  if (!data?.ok) {
    if (data?.error === "need_register") {
      location.replace("login_v2.html");
    } else {
      toast("Ошибка входа", "error");
    }
    return;
  }

  if (data.need_register) {
    location.replace("login_v2.html");
  } else {
    localStorage.setItem("cs_token", data.token);
    localStorage.setItem("cs_user", JSON.stringify(data.user));
  }
})();
