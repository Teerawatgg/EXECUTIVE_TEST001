(function (global) {
  var API_BASE = "/sports_rental_system/executive/api";

  function moneyTHB(n) {
    try { return n.toLocaleString("th-TH", { style: "currency", currency: "THB" }); }
    catch (e) { return "฿" + (Math.round(n * 100) / 100).toLocaleString("th-TH"); }
  }
  function num(n) { return (n || 0).toLocaleString("th-TH"); }

  function apiGet(file, params) {
    var url = new URL(API_BASE + "/" + file, window.location.origin);
    if (params) Object.keys(params).forEach(function (k) { url.searchParams.set(k, params[k]); });
    return fetch(url.toString(), { credentials: "include" }).then(function (r) { return r.json(); });
  }

  global.ExecCommon = { API_BASE: API_BASE, moneyTHB: moneyTHB, num: num, apiGet: apiGet };
})(window);

// ✅ auth helpers
ExecCommon.requireExecutive = function () {
  return ExecCommon.apiGet("me.php").then(function (res) {
    if (!res || !res.logged_in) {
      window.location.href = "login.html";
      return false;
    }
    return true;
  });
};

ExecCommon.logout = function () {
  return ExecCommon.apiGet("logout.php").then(function () {
    window.location.href = "login.html";
  });
};