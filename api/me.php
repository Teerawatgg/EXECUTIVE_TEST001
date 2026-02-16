<?php
// executive/api/me.php
require_once __DIR__ . "/../../database.php";

session_set_cookie_params([
  "lifetime" => 0,
  "path" => "/",
  "httponly" => true,
  "samesite" => "Lax",
  "secure" => false,
]);

session_start();
header("Content-Type: application/json; charset=utf-8");

// ต้องล็อกอิน executive และ role_id = 1
$ok = isset($_SESSION["exec_staff_id"]) && (int)($_SESSION["exec_role_id"] ?? 0) === 1;
if (!$ok) {
  http_response_code(401);
  echo json_encode(["success"=>false, "message"=>"Unauthorized"], JSON_UNESCAPED_UNICODE);
  exit;
}

$staff_id = $_SESSION["exec_staff_id"];

// ดึงข้อมูลจาก DB ให้ชัวร์ (เพื่อให้ role_name/email ขึ้นแน่นอน)
$sql = "
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
";

$stmt = $conn->prepare($sql);
if (!$stmt) {
  http_response_code(500);
  echo json_encode(["success"=>false, "message"=>"Prepare failed: ".$conn->error], JSON_UNESCAPED_UNICODE);
  exit;
}

$stmt->bind_param("s", $staff_id);
$stmt->execute();
$rs = $stmt->get_result();
$row = $rs->fetch_assoc();

if (!$row) {
  http_response_code(404);
  echo json_encode(["success"=>false, "message"=>"ไม่พบข้อมูลผู้ใช้"], JSON_UNESCAPED_UNICODE);
  exit;
}

// อัปเดต session ให้ใหม่ (กันข้อมูลเปลี่ยนแล้วค้าง)
$_SESSION["exec_name"]        = $row["name"];
$_SESSION["exec_email"]       = $row["email"];
$_SESSION["exec_role_id"]     = (int)$row["role_id"];
$_SESSION["exec_role_name"]   = $row["role_name"] ?? "";
$_SESSION["exec_branch_id"]   = $row["branch_id"];
$_SESSION["exec_branch_name"] = $row["branch_name"] ?? "";

echo json_encode([
  "success"     => true,
  "data" => [
    "staff_id"    => $row["staff_id"],
    "name"        => $row["name"],
    "email"       => $row["email"],
    "role_id"     => (int)$row["role_id"],
    "role_name"   => $row["role_name"] ?? "-",
    "branch_id"   => $row["branch_id"],
    "branch_name" => $row["branch_name"] ?? "-",
  ]
], JSON_UNESCAPED_UNICODE);

$stmt->close();
$conn->close();