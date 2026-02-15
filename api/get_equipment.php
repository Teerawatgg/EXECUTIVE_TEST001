<?php
require_once __DIR__ . "/_db.php";

try {
  $search = q("search","");
  $minp   = q("min_price","");
  $maxp   = q("max_price","");

  $sql = "
    SELECT equipment_id, name, price_per_unit, total_stock, description
    FROM equipment_master
    WHERE 1=1
  ";
  $params = [];

  if ($search !== "") {
    $sql .= " AND (equipment_id LIKE :s OR name LIKE :s)";
    $params[":s"] = "%{$search}%";
  }
  if ($minp !== "" && is_numeric($minp)) {
    $sql .= " AND price_per_unit >= :minp";
    $params[":minp"] = (float)$minp;
  }
  if ($maxp !== "" && is_numeric($maxp)) {
    $sql .= " AND price_per_unit <= :maxp";
    $params[":maxp"] = (float)$maxp;
  }

  $sql .= " ORDER BY equipment_id DESC LIMIT 300";

  $st = $pdo->prepare($sql);
  $st->execute($params);

  echo json_encode(["success"=>true, "items"=>$st->fetchAll()]);
} catch (Exception $e) {
  http_response_code(500);
  echo json_encode(["success"=>false, "error"=>$e->getMessage()]);
}