<?php
// executive/api/login.php
require_once __DIR__ . "/../../database.php";
// ✅ บังคับ session cookie ให้ใช้ได้ทั้งเว็บ (สำคัญบน localhost + หลายโฟลเดอร์)
session_set_cookie_params([
  "lifetime" => 0,
  "path" => "/",
  "httponly" => true,
  "samesite" => "Lax",
  "secure" => false, // localhost ใช้ http
]);

session_start();
header("Content-Type: application/json; charset=utf-8");

// ---------- Read input (JSON + FORM) ----------
$ct = $_SERVER["CONTENT_TYPE"] ?? "";
$payload = [];

if (stripos($ct, "application/json") !== false) {
  $raw = file_get_contents("php://input");
  $payload = json_decode($raw, true);
  if (!is_array($payload)) $payload = [];
} else {
  $payload = $_POST;
}

$login    = trim($payload["email"] ?? $payload["login"] ?? $payload["username"] ?? "");
$password = (string)($payload["password"] ?? "");

if ($login === "" || $password === "") {
  http_response_code(400);
  echo json_encode(["success"=>false, "message"=>"กรุณากรอกอีเมลและรหัสผ่าน"], JSON_UNESCAPED_UNICODE);
  exit;
}

// ---------- Query staff by email ----------
$sql = "
  SELECT
    s.staff_id,
    s.name,
    s.email,
    s.password_hash,
    s.role_id,
    s.branch_id,
    b.name AS branch_name,
    r.role_name
  FROM staff s
  LEFT JOIN branches b ON b.branch_id = s.branch_id
  LEFT JOIN roles r ON r.role_id = s.role_id
  WHERE s.email = ?
  LIMIT 1
";

$stmt = $conn->prepare($sql);
if (!$stmt) {
  http_response_code(500);
  echo json_encode(["success"=>false, "message"=>"Prepare failed: ".$conn->error], JSON_UNESCAPED_UNICODE);
  exit;
}

$stmt->bind_param("s", $login);
$stmt->execute();
$rs = $stmt->get_result();
$row = $rs->fetch_assoc();

if (!$row) {
  http_response_code(401);
  echo json_encode(["success"=>false, "message"=>"ไม่พบผู้ใช้งานนี้ในระบบ"], JSON_UNESCAPED_UNICODE);
  exit;
}

// ---------- Verify password ----------
$stored = (string)($row["password_hash"] ?? "");
$ok = false;

// ถ้าเป็น hash ปกติ
if ($stored !== "" && strlen($stored) > 20 && strpos($stored, "$") !== false) {
  $ok = password_verify($password, $stored);
} else {
  // เผื่อบางข้อมูลเก็บ plaintext เดิม
  $ok = hash_equals($stored, $password);
}

if (!$ok) {
  http_response_code(401);
  echo json_encode(["success"=>false, "message"=>"รหัสผ่านไม่ถูกต้อง"], JSON_UNESCAPED_UNICODE);
  exit;
}

// ---------- Executive only ----------
if ((int)$row["role_id"] !== 1) {
  http_response_code(403);
  echo json_encode(["success"=>false, "message"=>"คุณไม่มีสิทธิ์เข้าใช้งาน (เฉพาะผู้บริหารเท่านั้น)"], JSON_UNESCAPED_UNICODE);
  exit;
}

// ---------- Set session ----------
session_regenerate_id(true);

$_SESSION["exec_staff_id"]    = $row["staff_id"];
$_SESSION["exec_role_id"]     = (int)$row["role_id"];
$_SESSION["exec_name"]        = $row["name"];
$_SESSION["exec_email"]       = $row["email"];
$_SESSION["exec_role_name"]   = $row["role_name"] ?? "";
$_SESSION["exec_branch_id"]   = $row["branch_id"];
$_SESSION["exec_branch_name"] = $row["branch_name"] ?? "";

// ให้แน่ใจว่า session ถูกเขียนก่อนตอบกลับ
session_write_close();

echo json_encode([
  "success"     => true,
  "message"     => "เข้าสู่ระบบสำเร็จ",
  "staff_id"    => $row["staff_id"],
  "name"        => $row["name"],
  "email"       => $row["email"],
  "role_id"     => (int)$row["role_id"],
  "role_name"   => $row["role_name"] ?? "-",
  "branch_id"   => $row["branch_id"],
  "branch_name" => $row["branch_name"] ?? "-",
], JSON_UNESCAPED_UNICODE);

$stmt->close();
$conn->close();