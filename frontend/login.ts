document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("loginForm") as HTMLFormElement;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const payload = {
      email: (document.getElementById("email") as HTMLInputElement).value,
      password: (document.getElementById("password") as HTMLInputElement).value,
    };

    try {
      const res = await fetch("/sports_rental_system/executive/api/login.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (data.success) {
        window.location.href = "index.html";
      } else {
        alert(data.message || "เข้าสู่ระบบไม่สำเร็จ");
      }
    } catch (err) {
      alert("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
      console.error(err);
    }
  });
});