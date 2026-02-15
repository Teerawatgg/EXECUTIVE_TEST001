<?php
require_once __DIR__ . "/../../database.php";
header("Content-Type: application/json; charset=utf-8");

/* =========================
   Session fix (Windows/XAMPP)
========================= */
$savePath = __DIR__ . "/../_sessions";
if (!is_dir($savePath)) { @mkdir($savePath, 0777, true); }
session_save_path($savePath);

// กันชนกับ PHPSESSID ของ phpMyAdmin
session_name("EXECSESSID");

// cookie path ให้ตรงกับโปรเจกต์ executive
session_set_cookie_params([
  "lifetime" => 0,
  "path"     => "/sports_rental_system/executive/",
  "httponly" => true,
  "samesite" => "Lax",
  "secure"   => false, // localhost
]);

if (session_status() === PHP_SESSION_NONE) session_start();

/* =========================
   Read input (JSON + FORM)
========================= */
$ct = $_SERVER["CONTENT_TYPE"] ?? "";
$payload = [];

if (stripos($ct, "application/json") !== false) {
  $raw = file_get_contents("php://input");
  $payload = json_decode($raw, true);
  if (!is_array($payload)) $payload = [];
} else {
  $payload = $_POST;
}

/**
 * รองรับหลายชื่อ field:
 * - login.js ของคุณอาจส่ง email
 * - หน้าใหม่อาจส่ง username
 * - ผมแนะนำใช้ "login" เป็นกลาง
 */
$login    = trim($payload["login"] ?? $payload["email"] ?? $payload["username"] ?? "");
$password = (string)($payload["password"] ?? "");

if ($login === "" || $password === "") {
  http_response_code(400);
  echo json_encode([
    "success" => false,
    "message" => "กรุณากรอก username/email และ password"
  ], JSON_UNESCAPED_UNICODE);
  exit;
}

/* =========================
   Query staff by EMAIL
   (ไม่แตะ username เพื่อกัน Unknown column)
========================= */
$sql = "
  SELECT
    s.staff_id,
    s.password_hash,
    s.role_id,
    s.branch_id,
    s.name,
    b.name AS branch_name
  FROM staff s
  LEFT JOIN branches b ON b.branch_id = s.branch_id
  WHERE s.email = ?
  LIMIT 1
";

$stmt = $conn->prepare($sql);
if (!$stmt) {
  http_response_code(500);
  echo json_encode([
    "success" => false,
    "message" => "Prepare failed: " . $conn->error
  ], JSON_UNESCAPED_UNICODE);
  exit;
}

$stmt->bind_param("s", $login);
$stmt->execute();
$result = $stmt->get_result();

$row = $result->fetch_assoc();
if (!$row) {
  http_response_code(401);
  echo json_encode([
    "success" => false,
    "message" => "ไม่พบผู้ใช้งานนี้ในระบบ"
  ], JSON_UNESCAPED_UNICODE);
  exit;
}

/* =========================
   Verify password
   - รองรับทั้ง hash และ plaintext เดิม
========================= */
$stored = (string)($row["password_hash"] ?? "");
$ok = false;

// ถ้าเป็น hash (มักขึ้นต้น $2y$ / $argon2id$ ฯลฯ)
if (strlen($stored) > 20 && str_contains($stored, "$")) {
  $ok = password_verify($password, $stored);
} else {
  // เผื่อข้อมูลเดิมเก็บ plaintext
  $ok = hash_equals($stored, $password);
}

if (!$ok) {
  http_response_code(401);
  echo json_encode([
    "success" => false,
    "message" => "รหัสผ่านไม่ถูกต้อง"
  ], JSON_UNESCAPED_UNICODE);
  exit;
}

/* =========================
   Executive only (role_id=1)
========================= */
if ((int)$row["role_id"] !== 1) {
  http_response_code(403);
  echo json_encode([
    "success" => false,
    "message" => "คุณไม่มีสิทธิ์เข้าใช้งาน (เฉพาะผู้บริหารเท่านั้น)"
  ], JSON_UNESCAPED_UNICODE);
  exit;
}

/* =========================
   Set session
========================= */
$_SESSION["exec_staff_id"]    = $row["staff_id"];
$_SESSION["exec_name"]        = $row["name"];
$_SESSION["exec_role_id"]     = (int)$row["role_id"];
$_SESSION["exec_branch_id"]   = $row["branch_id"];
$_SESSION["exec_branch_name"] = $row["branch_name"];

// บังคับเขียน session ทันที (กัน request ถัดไปอ่านไม่เจอ)
session_write_close();

echo json_encode([
  "success"     => true,
  "message"     => "เข้าสู่ระบบสำเร็จ",
  "staff_id"    => $row["staff_id"],
  "name"        => $row["name"],
  "branch_id"   => $row["branch_id"],
  "branch_name" => $row["branch_name"]
], JSON_UNESCAPED_UNICODE);

$stmt->close();
$conn->close();