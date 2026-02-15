<?php
header("Content-Type: application/json; charset=utf-8");

$savePath = __DIR__ . "/../_sessions";
if (!is_dir($savePath)) { @mkdir($savePath, 0777, true); }
session_save_path($savePath);

session_name("EXECSESSID");
session_start();

if (!isset($_SESSION["exec_staff_id"])) {
  echo json_encode(["success"=>false,"logged_in"=>false], JSON_UNESCAPED_UNICODE);
  exit;
}

echo json_encode([
  "success"   => true,
  "logged_in" => true,
  "staff_id"  => $_SESSION["exec_staff_id"],
  "name"      => $_SESSION["exec_name"],
  "role_id"   => $_SESSION["exec_role_id"],
  "branch_id" => $_SESSION["exec_branch_id"],
], JSON_UNESCAPED_UNICODE);