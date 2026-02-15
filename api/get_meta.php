<?php
require_once __DIR__ . "/_db.php";
require_once __DIR__ . "/_helpers.php";

try {
  // branches
  $branches = [];
  $q1 = $conn->query("SELECT branch_id, name FROM branches WHERE is_active=1 ORDER BY branch_id");
  if ($q1) $branches = $q1->fetch_all(MYSQLI_ASSOC);

  // regions
  $regions = [];
  $q2 = $conn->query("SELECT region_name AS region FROM region ORDER BY region_id");
  if ($q2) $regions = $q2->fetch_all(MYSQLI_ASSOC);

  // payment methods
  $methods = [];
  $q3 = $conn->query("SELECT code, COALESCE(name_th,name_en) AS name FROM payment_methods WHERE is_active=1 ORDER BY method_id");
  if ($q3) $methods = $q3->fetch_all(MYSQLI_ASSOC);

  // equipment statuses
  $statuses = [];
  $q4 = $conn->query("SELECT DISTINCT status FROM equipment_instances WHERE status IS NOT NULL AND status<>'' ORDER BY status");
  if ($q4) $statuses = $q4->fetch_all(MYSQLI_ASSOC);

  echo json_encode([
    "success" => true,
    "branches" => $branches,
    "regions" => $regions,
    "methods" => $methods,
    "equipment_statuses" => $statuses
  ]);
} catch (Exception $e) {
  http_response_code(500);
  echo json_encode(["success"=>false,"error"=>$e->getMessage()]);
}