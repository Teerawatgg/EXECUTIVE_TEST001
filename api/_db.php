<?php
// executive/api/_db.php
require_once __DIR__ . "/../../database.php";

header("Content-Type: application/json; charset=utf-8");

if (!isset($conn) || !$conn) {
  http_response_code(500);
  echo json_encode(["success"=>false, "error"=>"Database connection not found"]);
  exit;
}
$conn->set_charset("utf8mb4");