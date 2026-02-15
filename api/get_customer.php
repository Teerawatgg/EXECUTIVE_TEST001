<?php
require_once __DIR__ . "/_db.php";

try {
  $search = q("search","");
  $type   = q("customer_type","ALL");   // optional
  $level  = q("member_level","ALL");    // optional

  $sql = "
    SELECT customer_id, name, customer_type, faculty, study_year, phone, email, current_points, member_level
    FROM customers
    WHERE 1=1
  ";
  $params = [];

  if ($search !== "") {
    $sql .= " AND (customer_id LIKE :s OR name LIKE :s OR phone LIKE :s OR email LIKE :s)";
    $params[":s"] = "%{$search}%";
  }
  if ($type !== "ALL") {
    $sql .= " AND customer_type = :t";
    $params[":t"] = $type;
  }
  if ($level !== "ALL") {
    $sql .= " AND member_level = :lv";
    $params[":lv"] = $level;
  }

  $sql .= " ORDER BY customer_id DESC LIMIT 300";

  $st = $pdo->prepare($sql);
  $st->execute($params);

  echo json_encode(["success"=>true, "items"=>$st->fetchAll()]);
} catch (Exception $e) {
  http_response_code(500);
  echo json_encode(["success"=>false, "error"=>$e->getMessage()]);
}