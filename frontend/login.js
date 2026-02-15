document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("loginForm");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const payload = {
      username: document.getElementById("username").value.trim(),
      password: document.getElementById("password").value
    };

    try {
      const res = await fetch("/sports_rental_system/executive/api/login.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (data.success) {
        // ✅ ไปหน้า dashboard
        window.location.href = "index.html";
      } else {
        alert(data.message || "เข้าสู่ระบบไม่สำเร็จ");
      }
    } catch (err) {
      console.error(err);
      alert("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
    }
  });
});