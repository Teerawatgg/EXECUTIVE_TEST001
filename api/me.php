<?php
require_once __DIR__ . "/../../database.php";
session_start();
header("Content-Type: application/json; charset=utf-8");

// ต้องล็อกอิน executive และ role_id = 1
$ok = isset($_SESSION["exec_staff_id"]) && (int)($_SESSION["exec_role_id"] ?? 0) === 1;
if (!$ok) {
  echo json_encode(["success"=>false, "logged_in"=>false]);
  exit;
}

$staff_id = $_SESSION["exec_staff_id"];

// ดึงข้อมูลเพิ่มจาก DB (email + role_name)
$stmt = $conn->prepare("
  SELECT
    s.staff_id,
    s.name,
    s.email,
    s.role_id,
    r.role_name,
    s.branch_id,
    b.name AS branch_name
  FROM staff s
  LEFT JOIN roles r ON r.role_id = s.role_id
  LEFT JOIN branches b ON b.branch_id = s.branch_id
  WHERE s.staff_id = ?
  LIMIT 1
");
$stmt->bind_param("s", $staff_id);
$stmt->execute();
$rs = $stmt->get_result();
$row = $rs->fetch_assoc();

if (!$row) {
  echo json_encode(["success"=>false, "message"=>"ไม่พบข้อมูลผู้ใช้"]);
  exit;
}

// อัปเดต session ให้ branch_name ล่าสุด (กัน branch เปลี่ยนแล้วค้าง)
$_SESSION["exec_name"] = $row["name"];
$_SESSION["exec_branch_id"] = $row["branch_id"];
$_SESSION["exec_branch_name"] = $row["branch_name"];

echo json_encode([
  "success"     => true,
  "logged_in"   => true,
  "staff_id"    => $row["staff_id"],
  "name"        => $row["name"],
  "email"       => $row["email"],
  "role_id"     => (int)$row["role_id"],
  "role_name"   => $row["role_name"] ?? "-",
  "branch_id"   => $row["branch_id"],
  "branch_name" => $row["branch_name"] ?? "-",
]);

$stmt->close();
$conn->close();