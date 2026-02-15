<?php
require_once "../../database.php";
session_start();

header("Content-Type: application/json; charset=utf-8");

$data = json_decode(file_get_contents("php://input"), true);

$email = trim($data["email"] ?? "");
$password = $data["password"] ?? "";

if ($email === "" || $password === "") {
  echo json_encode(["success"=>false, "message"=>"กรุณากรอกข้อมูลให้ครบ"]);
  exit;
}

$stmt = $conn->prepare("
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
");
$stmt->bind_param("s", $email);
$stmt->execute();
$result = $stmt->get_result();

if (!$row = $result->fetch_assoc()) {
  echo json_encode(["success"=>false, "message"=>"ไม่พบผู้ใช้งานนี้ในระบบ"]);
  exit;
}

/**
 * ⚠️ ตัวอย่างเดิมของคุณเช็คแบบ plaintext: if ($password === $row["password_hash"])
 * ถ้าคุณใช้ hash จริงในอนาคต ค่อยเปลี่ยนเป็น password_verify()
 */
if ($password !== $row["password_hash"]) {
  echo json_encode(["success"=>false, "message"=>"รหัสผ่านไม่ถูกต้อง"]);
  exit;
}

/** ✅ Executive only */
if ((int)$row["role_id"] !== 1) {
  echo json_encode(["success"=>false, "message"=>"คุณไม่มีสิทธิ์เข้าใช้งาน (เฉพาะผู้บริหารเท่านั้น)"]);
  exit;
}

/** ✅ set session */
$_SESSION["exec_staff_id"] = $row["staff_id"];
$_SESSION["exec_name"] = $row["name"];
$_SESSION["exec_role_id"] = (int)$row["role_id"];
$_SESSION["exec_branch_id"] = $row["branch_id"];
$_SESSION["exec_branch_name"] = $row["branch_name"];

echo json_encode([
  "success" => true,
  "staff_id" => $row["staff_id"],
  "name" => $row["name"],
  "branch_id" => $row["branch_id"],
  "branch_name" => $row["branch_name"],
]);

$stmt->close();
$conn->close();