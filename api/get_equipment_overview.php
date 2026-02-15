<?php
require_once __DIR__ . "/_db.php";

try {
  $search    = q("search", "");
  $catCsv    = q("categories", ""); // เช่น "1,2,3"
  $statusCsv = q("statuses", "");   // เช่น "AVAILABLE,IN_USE,BROKEN" หรือเว้นว่าง=ทั้งหมด

  // ---- parse filters ----
  $catIds = array_values(array_filter(array_map("trim", explode(",", $catCsv))));
  $sts    = array_values(array_filter(array_map("trim", explode(",", $statusCsv))));

  // normalize statuses
  $allowed = ["AVAILABLE","IN_USE","BROKEN","MAINTENANCE"];
  $sts = array_values(array_filter($sts, fn($x)=>in_array($x, $allowed, true)));

  // ✅ dynamic columns (กัน DB บางชุดไม่มี usage_count/usage_limit)
  $hasUsageCount = false;
  $hasUsageLimit = false;

  $chk = $conn->query("SHOW COLUMNS FROM equipment_instances LIKE 'usage_count'");
  if ($chk && $chk->num_rows > 0) $hasUsageCount = true;
  if ($chk) $chk->close();

  $chk = $conn->query("SHOW COLUMNS FROM equipment_instances LIKE 'usage_limit'");
  if ($chk && $chk->num_rows > 0) $hasUsageLimit = true;
  if ($chk) $chk->close();

  $usageCols = "";
  if ($hasUsageCount) $usageCols .= ", ei.usage_count";
  if ($hasUsageLimit) $usageCols .= ", ei.usage_limit";

  // ---- WHERE builder (mysqli bind) ----
  $w = [];
  $types = "";
  $vals = [];

  // search
  if ($search !== "") {
    $w[] = "(ei.instance_code LIKE ? OR em.equipment_id LIKE ? OR em.name LIKE ?)";
    $like = "%{$search}%";
    $types .= "sss";
    array_push($vals, $like, $like, $like);
  }

  // categories
  if (count($catIds)) {
    $place = implode(",", array_fill(0, count($catIds), "?"));
    $w[] = "em.category_id IN ($place)";
    $types .= str_repeat("s", count($catIds));
    foreach ($catIds as $cid) $vals[] = $cid;
  }

  // statuses
  if (count($sts)) {
    $place = implode(",", array_fill(0, count($sts), "?"));
    $w[] = "ei.status IN ($place)";
    $types .= str_repeat("s", count($sts));
    foreach ($sts as $s) $vals[] = $s;
  }

  $whereSql = count($w) ? implode(" AND ", $w) : "1=1";

  // ---- 1) summary cards ----
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
  if ($types !== "") $st->bind_param($types, ...$vals);
  $st->execute();
  $sum = $st->get_result()->fetch_assoc() ?: ["total"=>0,"available"=>0,"in_use"=>0,"broken"=>0];
  $st->close();

  // ---- 2) categories counts (left filter list) ----
  $sqlCats = "
    SELECT
      em.category_id,
      TRIM(c.name) AS category_name,
      COUNT(*) AS total,
      SUM(CASE WHEN ei.status='AVAILABLE' THEN 1 ELSE 0 END) AS available,
      SUM(CASE WHEN ei.status='IN_USE' THEN 1 ELSE 0 END) AS in_use,
      SUM(CASE WHEN ei.status='BROKEN' THEN 1 ELSE 0 END) AS broken
    FROM equipment_instances ei
    LEFT JOIN equipment_master em ON em.equipment_id = ei.equipment_id
    LEFT JOIN categories c ON c.category_id = em.category_id
    WHERE $whereSql
    GROUP BY em.category_id, c.name
    ORDER BY total DESC, category_name ASC
  ";

  $st = $conn->prepare($sqlCats);
  if ($types !== "") $st->bind_param($types, ...$vals);
  $st->execute();
  $catRows = [];
  $rs = $st->get_result();
  while ($r = $rs->fetch_assoc()) {
    $catRows[] = [
      "category_id"   => $r["category_id"],
      "category_name" => $r["category_name"] ?: "-",
      "total"         => (int)$r["total"],
      "available"     => (int)$r["available"],
      "in_use"        => (int)$r["in_use"],
      "broken"        => (int)$r["broken"],
    ];
  }
  $st->close();

  // ---- 3) grouped items (main tables) ----
  $sqlItems = "
    SELECT
      em.category_id,
      TRIM(c.name) AS category_name,
      ei.instance_code,
      em.name AS equipment_name,
      ei.status
      $usageCols,
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
  if ($types !== "") $st->bind_param($types, ...$vals);
  $st->execute();
  $rs = $st->get_result();

  $groupsMap = []; // catId => group
  while ($r = $rs->fetch_assoc()) {
    $cid = $r["category_id"] ?? "0";
    if (!isset($groupsMap[$cid])) {
      $groupsMap[$cid] = [
        "category_id"   => $cid,
        "category_name" => $r["category_name"] ?: "-",
        "total"         => 0,
        "items"         => []
      ];
    }

    $uc = $hasUsageCount ? (int)($r["usage_count"] ?? 0) : null;
    $ul = $hasUsageLimit ? (int)($r["usage_limit"] ?? 0) : null;

    $groupsMap[$cid]["total"]++;

    $groupsMap[$cid]["items"][] = [
      "code"         => $r["instance_code"],
      "name"         => $r["equipment_name"],
      "status"       => $r["status"],
      "usage_count"  => $uc,
      "usage_limit"  => $ul,
      "received_date"=> $r["received_date"],
      "expiry_date"  => $r["expiry_date"],
    ];
  }
  $st->close();

  $groups = array_values($groupsMap);

  echo json_encode([
    "success"    => true,
    "summary"    => [
      "total"     => (int)$sum["total"],
      "available" => (int)$sum["available"],
      "in_use"    => (int)$sum["in_use"],
      "broken"    => (int)$sum["broken"],
    ],
    "categories" => $catRows,
    "groups"     => $groups,
  ], JSON_UNESCAPED_UNICODE);

} catch (Exception $e) {
  http_response_code(500);
  echo json_encode([
    "success" => false,
    "error"   => "Fatal error",
    "detail"  => $e->getMessage()
  ], JSON_UNESCAPED_UNICODE);
}