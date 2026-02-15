<?php
// executive/api/_db.php

require_once __DIR__ . "/../../database.php";
require_once __DIR__ . "/_helpers.php";

session_start();
header("Content-Type: application/json; charset=utf-8");

// ต้องล็อกอิน executive และ role_id = 1
$ok = isset($_SESSION["exec_staff_id"]) && (int)($_SESSION["exec_role_id"] ?? 0) === 1;
if (!$ok) {
  http_response_code(401);
  echo json_encode(["success"=>false, "message"=>"Unauthorized"]);
  exit;
}

if (!isset($_SESSION["exec_branch_id"]) || $_SESSION["exec_branch_id"] === "" || $_SESSION["exec_branch_id"] === null) {
  http_response_code(400);
  echo json_encode(["success"=>false, "message"=>"Missing exec_branch_id"]);
  exit;
}

if (!isset($conn) || !$conn) {
  http_response_code(500);
  echo json_encode(["success"=>false, "error"=>"Database connection not found"]);
  exit;
}