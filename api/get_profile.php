<?php
require_once __DIR__ . "/../../database.php";
session_start();
header("Content-Type: application/json; charset=utf-8");

// ตัวอย่าง: staff login มักเก็บ session เป็น staff_id
// ปรับชื่อตัวแปร session ตรงนี้ให้ตรงของจริงที่คุณใช้
if (!isset($_SESSION["staff_id"])) {
  echo json_encode(["success"=>false, "logged_in"=>false]);
  exit;
}

$staff_id = $_SESSION["staff_id"];

$stmt = $conn->prepare("
  SELECT
    s.staff_id,
    s.name,
    s.email,
    s.role_id,
    COALESCE(r.role_name, '-') AS department
  FROM staff s
  LEFT JOIN roles r ON r.role_id = s.role_id
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

echo json_encode([
  "success"    => true,
  "staff_id"   => $row["staff_id"],
  "name"       => $row["name"],
  "email"      => $row["email"],
  "department" => $row["department"], // ให้ตรงกับ profile.html ที่คุณใช้อยู่
]);

$stmt->close();
$conn->close();