<?php
require_once __DIR__ . "/_db.php";

try {
  // ✅ บังคับตามสาขาของ executive
  $branch_id = $_SESSION["exec_branch_id"];
  $branch_name = $_SESSION["exec_branch_name"] ?? "";

  $search    = q("search", "");
  $catCsv    = q("categories", ""); // category_id CSV
  $stsCsv    = q("statuses", "");   // AVAILABLE,IN_USE,BROKEN

  $catIds = array_values(array_filter(array_map("trim", explode(",", $catCsv))));
  $sts    = array_values(array_filter(array_map("trim", explode(",", $stsCsv))));

  $allowed = ["AVAILABLE","IN_USE","BROKEN","MAINTENANCE"];
  $sts = array_values(array_filter($sts, fn($x)=>in_array($x, $allowed, true)));

  $w = [];
  $types = "";
  $vals = [];

  // ✅ branch filter always
  $w[] = "ei.branch_id = ?";
  $types .= "s";
  $vals[] = $branch_id;

  if ($search !== "") {
    $w[] = "(ei.instance_code LIKE ? OR em.equipment_id LIKE ? OR em.name LIKE ?)";
    $like = "%{$search}%";
    $types .= "sss";
    array_push($vals, $like, $like, $like);
  }

  if (count($catIds)) {
    $place = implode(",", array_fill(0, count($catIds), "?"));
    $w[] = "em.category_id IN ($place)";
    $types .= str_repeat("s", count($catIds));
    foreach ($catIds as $cid) $vals[] = $cid;
  }

  if (count($sts)) {
    $place = implode(",", array_fill(0, count($sts), "?"));
    $w[] = "ei.status IN ($place)";
    $types .= str_repeat("s", count($sts));
    foreach ($sts as $s) $vals[] = $s;
  }

  $whereSql = count($w) ? implode(" AND ", $w) : "1=1";

  // 1) summary
  $sqlSummary = "
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN ei.status='AVAILABLE' THEN 1 ELSE 0 END) AS available,
      SUM(CASE WHEN ei.status='IN_USE' THEN 1 ELSE 0 END) AS in_use,
      SUM(CASE WHEN ei.status='BROKEN' THEN 1 ELSE 0 END) AS broken
    FROM equipment_instances ei
    LEFT JOIN equipment_master em ON em.equipment_id = ei.equipment_id
    WHERE $whereSql
  ";
  $st = $conn->prepare($sqlSummary);
  $st->bind_param($types, ...$vals);
  $st->execute();
  $sum = $st->get_result()->fetch_assoc() ?: ["total"=>0,"available"=>0,"in_use"=>0,"broken"=>0];
  $st->close();

  // 2) categories list (sidebar)
  $sqlCats = "
    SELECT
      em.category_id,
      TRIM(c.name) AS category_name,
      COUNT(*) AS total
    FROM equipment_instances ei
    LEFT JOIN equipment_master em ON em.equipment_id = ei.equipment_id
    LEFT JOIN categories c ON c.category_id = em.category_id
    WHERE $whereSql
    GROUP BY em.category_id, c.name
    ORDER BY total DESC, category_name ASC
  ";
  $st = $conn->prepare($sqlCats);
  $st->bind_param($types, ...$vals);
  $st->execute();
  $rs = $st->get_result();
  $categories = [];
  while ($r = $rs->fetch_assoc()) {
    $categories[] = [
      "category_id" => $r["category_id"],
      "category_name" => $r["category_name"] ?: "-",
      "total" => (int)$r["total"]
    ];
  }
  $st->close();

  // 3) groups (main tables)
  $sqlItems = "
    SELECT
      em.category_id,
      TRIM(c.name) AS category_name,
      ei.instance_code,
      em.name AS equipment_name,
      ei.status,
      ei.received_date,
      ei.expiry_date
    FROM equipment_instances ei
    LEFT JOIN equipment_master em ON em.equipment_id = ei.equipment_id
    LEFT JOIN categories c ON c.category_id = em.category_id
    WHERE $whereSql
    ORDER BY category_name ASC, ei.instance_code ASC
    LIMIT 2000
  ";
  $st = $conn->prepare($sqlItems);
  $st->bind_param($types, ...$vals);
  $st->execute();
  $rs = $st->get_result();

  $map = [];
  while ($r = $rs->fetch_assoc()) {
    $cid = $r["category_id"] ?? "0";
    if (!isset($map[$cid])) {
      $map[$cid] = [
        "category_id" => $cid,
        "category_name" => $r["category_name"] ?: "-",
        "total" => 0,
        "items" => []
      ];
    }
    $map[$cid]["total"]++;
    $map[$cid]["items"][] = [
      "code" => $r["instance_code"],
      "name" => $r["equipment_name"],
      "status" => $r["status"],
      "received_date" => $r["received_date"],
      "expiry_date" => $r["expiry_date"]
    ];
  }
  $st->close();

  echo json_encode([
    "success" => true,
    "branch_id" => $branch_id,
    "branch_name" => $branch_name,
    "summary" => [
      "total" => (int)$sum["total"],
      "available" => (int)$sum["available"],
      "in_use" => (int)$sum["in_use"],
      "broken" => (int)$sum["broken"],
    ],
    "categories" => $categories,
    "groups" => array_values($map),
  ], JSON_UNESCAPED_UNICODE);

} catch (Exception $e) {
  http_response_code(500);
  echo json_encode(["success"=>false, "error"=>$e->getMessage()], JSON_UNESCAPED_UNICODE);
}