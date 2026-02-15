document.addEventListener("DOMContentLoaded", function () {
  var form = document.getElementById("loginForm");

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    var payload = {
      email: document.getElementById("email").value,
      password: document.getElementById("password").value
    };

    fetch("/sports_rental_system/executive/api/login.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload)
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.success) {
          window.location.href = "index.html";
        } else {
          alert(data.message || "เข้าสู่ระบบไม่สำเร็จ");
        }
      })
      .catch(function (err) {
        alert("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
        console.error(err);
      });
  });
});