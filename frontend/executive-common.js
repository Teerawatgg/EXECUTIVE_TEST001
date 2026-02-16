// executive-common.js
const EXEC_API_BASE = "/sports_rental_system/executive/api/";

function execApiUrl(file) {
  return EXEC_API_BASE + file;
}

async function execFetchJSON(file) {
  const res = await fetch(execApiUrl(file), { credentials: "include" });

  // ✅ ถ้า 401 ค่อยเด้งไป login
  if (res.status === 401) return { __unauthorized: true };

  // ✅ ถ้า error อื่น ๆ ไม่เด้ง ให้โชว์ปัญหาแทน
  if (!res.ok) return { __error: true, status: res.status };

  try {
    return await res.json();
  } catch {
    return { __error: true, status: "bad_json" };
  }
}

// ✅ ใช้ในทุกหน้าที่ต้อง login (ยกเว้น login.html)
async function requireExecutiveLogin() {
  // กัน redirect loop ถ้าอยู่หน้า login อยู่แล้ว
  const isLoginPage = location.pathname.endsWith("/login.html") || location.pathname.endsWith("login.html");
  if (isLoginPage) return;

  const me = await execFetchJSON("me.php");

  if (me && me.__unauthorized) {
    // ใส่ return url กลับมาหน้าเดิมหลัง login ได้
    const back = encodeURIComponent(location.pathname.split("/").pop() || "index.html");
    location.href = "login.html?return=" + back;
    return;
  }

  if (!me || me.__error) {
    console.warn("me.php error:", me);
    // ไม่เด้งไป login เพราะไม่ใช่ 401 (อาจเป็น DB/Server error)
    return;
  }

  // ✅ รองรับหลายรูปแบบ: {success:true,data:{...}} หรือ {success:true,user:{...}} หรือ {...}
  const u = (me.data || me.user || me) || {};

  // ถ้าคุณต้องการ “เฉพาะ role executive” ให้เช็คเพิ่มได้
  // เช่น role_id ต้องเป็น 1
  if (u.role_id != null && Number(u.role_id) !== 1) {
    location.href = "login.html";
  }

  // ถ้าต้องการให้หน้าอื่นใช้ข้อมูล me ได้
  window.__EXEC_ME__ = u;
}

// เรียกอัตโนมัติทุกหน้า
document.addEventListener("DOMContentLoaded", requireExecutiveLogin);