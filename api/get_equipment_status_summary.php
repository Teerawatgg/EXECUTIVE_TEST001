<?php
// get_equipment_status_summary.php (FIXED v2)
// ✅ เพิ่ม bucket: in_use
// ✅ cards + by_category มี in_use
// ✅ Top5 fallback usage


require_once __DIR__ . "/_db.php";
require_once __DIR__ . "/_helpers.php";

header("Content-Type: application/json; charset=utf-8");

function safePrepare($conn, $sql) {
  $st = $conn->prepare($sql);
  if (!$st) throw new Exception("Prepare failed: " . $conn->error);
  return $st;
}
function tableExists($conn, $table) {
  $t = $conn->real_escape_string($table);
  $res = $conn->query("SHOW TABLES LIKE '{$t}'");
  return $res && $res->num_rows > 0;
}
function columnExists($conn, $table, $col) {
  $t = $conn->real_escape_string($table);
  $c = $conn->real_escape_string($col);
  $res = $conn->query("SHOW COLUMNS FROM `{$t}` LIKE '{$c}'");
  return $res && $res->num_rows > 0;
}

function normalizeStatusBucketExpr() {
  return "CASE
    WHEN ei.status IS NULL OR TRIM(ei.status) = '' THEN 'ready'
    WHEN LOWER(TRIM(ei.status)) IN ('rented','in use','in_use','borrowed','checked out','checkout','occupied','using','reserved','booked')
      OR TRIM(ei.status) IN ('กำลังใช้งาน','ใช้งานอยู่','ยืมอยู่','ถูกยืม','ถูกจอง','จองแล้ว','กำลังถูกใช้งาน')
      OR LOWER(TRIM(ei.status)) LIKE '%rent%'
      OR LOWER(TRIM(ei.status)) LIKE '%borrow%'
      OR LOWER(TRIM(ei.status)) LIKE '%check%'
      OR LOWER(TRIM(ei.status)) LIKE '%reserve%'
      OR TRIM(ei.status) LIKE '%กำลังใช้งาน%'
      OR TRIM(ei.status) LIKE '%ยืม%'
      OR TRIM(ei.status) LIKE '%จอง%'
    THEN 'in_use'
    WHEN TRIM(ei.status) IN ('พร้อมใช้งาน','พร้อมใช้','พร้อม','ว่าง')
      OR LOWER(TRIM(ei.status)) IN ('ready','available','free','idle')
      OR TRIM(ei.status) LIKE '%พร้อม%'
      OR TRIM(ei.status) LIKE '%ว่าง%'
    THEN 'ready'
    WHEN TRIM(ei.status) IN ('เสื่อมสภาพ','เสื่อม','หมดสภาพ')
      OR LOWER(TRIM(ei.status)) IN ('worn','degraded')
      OR TRIM(ei.status) LIKE '%เสื่อม%'
      OR TRIM(ei.status) LIKE '%หมดสภาพ%'
    THEN 'worn'
    WHEN TRIM(ei.status) IN ('ชำรุด','เสีย','พัง','แตก','เสียหาย')
      OR LOWER(TRIM(ei.status)) IN ('broken','damage','damaged')
      OR TRIM(ei.status) LIKE '%ชำรุด%'
      OR TRIM(ei.status) LIKE '%เสีย%'
      OR TRIM(ei.status) LIKE '%พัง%'
      OR TRIM(ei.status) LIKE '%เสียหาย%'
      OR TRIM(ei.status) LIKE '%แตก%'
    THEN 'broken'
    WHEN TRIM(ei.status) IN ('กำลังซ่อมแซม','ซ่อมแซม','ซ่อม','ซ่อมบำรุง','บำรุงรักษา','ส่งซ่อม')
      OR LOWER(TRIM(ei.status)) IN ('maintenance','repair','repairing')
      OR TRIM(ei.status) LIKE '%ซ่อม%'
      OR TRIM(ei.status) LIKE '%บำรุง%'
      OR TRIM(ei.status) LIKE '%ส่งซ่อม%'
    THEN 'maint'
    ELSE 'other'
  END";
}

try {
  $branch_id = q("branch_id", "ALL");
  $region    = q("region", "ALL");
  $search    = q("search", "");
  $catsQ     = q("categories", "");
  $categories = array_values(array_filter(array_map("trim", explode(",", $catsQ))));

  $emTable = "equipment_master";
  $eiTable = "equipment_instances";

  if (!tableExists($conn, $emTable) || !tableExists($conn, $eiTable)) {
    throw new Exception("Missing tables: equipment_master/equipment_instances");
  }

  // ---- geo join (ถ้ามี) ----
  $joinGeo = "";
  $hasGeo = tableExists($conn, "branches") && tableExists($conn, "provinces") && tableExists($conn, "region");
  if ($hasGeo) {
    $joinGeo = "
      LEFT JOIN branches br ON br.branch_id = ei.branch_id
      LEFT JOIN provinces pv ON pv.province_id = br.province_id
      LEFT JOIN region rg ON rg.region_id = pv.region_id
    ";
  }

  // ---- category expression (กัน schema ไม่ตรง) ----
  $catExpr = "'ไม่ระบุหมวดหมู่'";
  $joinCat = "";

  if (columnExists($conn, $emTable, "category_name")) {
    $catExpr = "COALESCE(NULLIF(TRIM(em.category_name),''),'ไม่ระบุหมวดหมู่')";
  } elseif (columnExists($conn, $emTable, "category")) {
    $catExpr = "COALESCE(NULLIF(TRIM(em.category),''),'ไม่ระบุหมวดหมู่')";
  } elseif (columnExists($conn, $emTable, "category_id")) {
    $catTable = null;
    foreach (["equipment_categories","equipment_category","categories","category"] as $t) {
      if (tableExists($conn, $t)) { $catTable = $t; break; }
    }
    if ($catTable) {
      $nameCol = null;
      foreach (["name_th","name","category_name","name_en"] as $c) {
        if (columnExists($conn, $catTable, $c)) { $nameCol = $c; break; }
      }
      $idCol = null;
      foreach (["category_id","id"] as $c) {
        if (columnExists($conn, $catTable, $c)) { $idCol = $c; break; }
      }
      if ($nameCol && $idCol) {
        $joinCat = " LEFT JOIN {$catTable} ec ON ec.{$idCol} = em.category_id ";
        $catExpr = "COALESCE(NULLIF(TRIM(ec.{$nameCol}),''), CONCAT('CAT ', em.category_id))";
      } else {
        $catExpr = "CONCAT('CAT ', em.category_id)";
      }
    } else {
      $catExpr = "CONCAT('CAT ', em.category_id)";
    }
  }

  // ---- WHERE + bind ----
  $where = "1=1";
  $types = "";
  $vals  = [];

  if ($branch_id !== "ALL" && $branch_id !== "") {
    $where .= " AND ei.branch_id = ?";
    addParam($types, $vals, "s", $branch_id);
  }

  if ($region !== "ALL" && $region !== "" && $hasGeo) {
    $where .= " AND rg.region_name = ?";
    addParam($types, $vals, "s", $region);
  }

  if ($search !== "") {
    $where .= " AND (ei.instance_code LIKE ? OR ei.equipment_id LIKE ? OR em.name LIKE ?)";
    $like = "%{$search}%";
    addParam($types, $vals, "s", $like);
    addParam($types, $vals, "s", $like);
    addParam($types, $vals, "s", $like);
  }

  if (count($categories)) {
    $ph = implode(",", array_fill(0, count($categories), "?"));
    $where .= " AND ({$catExpr}) IN ({$ph})";
    foreach ($categories as $c) addParam($types, $vals, "s", $c);
  }

  $bucket = normalizeStatusBucketExpr();

  // 1) Cards
  $sqlCards = "
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN {$bucket}='ready'  THEN 1 ELSE 0 END) AS ready,
      SUM(CASE WHEN {$bucket}='in_use' THEN 1 ELSE 0 END) AS in_use,
      SUM(CASE WHEN {$bucket}='worn'   THEN 1 ELSE 0 END) AS worn,
      SUM(CASE WHEN {$bucket}='broken' THEN 1 ELSE 0 END) AS broken,
      SUM(CASE WHEN {$bucket}='maint'  THEN 1 ELSE 0 END) AS maint
    FROM equipment_instances ei
    JOIN equipment_master em ON em.equipment_id = ei.equipment_id
    {$joinCat}
    {$joinGeo}
    WHERE {$where}
  ";
  $stCards = safePrepare($conn, $sqlCards);
  stmtBindDynamic($stCards, $types, $vals);
  $stCards->execute();
  $cards = fetchOne($stCards);

  // 2) By Category
  $sqlByCat = "
    SELECT
      {$catExpr} AS category,
      COUNT(*) AS total,
      SUM(CASE WHEN {$bucket}='ready'  THEN 1 ELSE 0 END) AS ready,
      SUM(CASE WHEN {$bucket}='in_use' THEN 1 ELSE 0 END) AS in_use,
      SUM(CASE WHEN {$bucket}='worn'   THEN 1 ELSE 0 END) AS worn,
      SUM(CASE WHEN {$bucket}='broken' THEN 1 ELSE 0 END) AS broken,
      SUM(CASE WHEN {$bucket}='maint'  THEN 1 ELSE 0 END) AS maint
    FROM equipment_instances ei
    JOIN equipment_master em ON em.equipment_id = ei.equipment_id
    {$joinCat}
    {$joinGeo}
    WHERE {$where}
    GROUP BY category
    ORDER BY total DESC, category ASC
    LIMIT 200
  ";
  $stByCat = safePrepare($conn, $sqlByCat);
  stmtBindDynamic($stByCat, $types, $vals);
  $stByCat->execute();
  $by_category = fetchAll($stByCat);

  $catList = array_values(array_filter(array_map(function($r){
    return $r["category"] ?? null;
  }, $by_category)));

  // 3) Top5 (issue) -> fallback usage
  $sqlTopIssue = "
    SELECT
      em.equipment_id,
      em.name,
      {$catExpr} AS category,
      SUM(CASE WHEN {$bucket} IN ('worn','broken','maint') THEN 1 ELSE 0 END) AS issue_count
    FROM equipment_instances ei
    JOIN equipment_master em ON em.equipment_id = ei.equipment_id
    {$joinCat}
    {$joinGeo}
    WHERE {$where}
    GROUP BY em.equipment_id, em.name, category
    HAVING issue_count > 0
    ORDER BY issue_count DESC, em.name ASC
    LIMIT 5
  ";
  $stTop = safePrepare($conn, $sqlTopIssue);
  stmtBindDynamic($stTop, $types, $vals);
  $stTop->execute();
  $top5 = fetchAll($stTop);

  $top5_mode = "issue";
  if (!$top5 || count($top5) === 0) {
    $sqlTopUsage = "
      SELECT
        em.equipment_id,
        em.name,
        {$catExpr} AS category,
        SUM(CASE WHEN {$bucket}='in_use' THEN 1 ELSE 0 END) AS issue_count
      FROM equipment_instances ei
      JOIN equipment_master em ON em.equipment_id = ei.equipment_id
      {$joinCat}
      {$joinGeo}
      WHERE {$where}
      GROUP BY em.equipment_id, em.name, category
      HAVING issue_count > 0
      ORDER BY issue_count DESC, em.name ASC
      LIMIT 5
    ";
    $stTopU = safePrepare($conn, $sqlTopUsage);
    stmtBindDynamic($stTopU, $types, $vals);
    $stTopU->execute();
    $top5 = fetchAll($stTopU);
    $top5_mode = "usage";
  }

  // 4) Groups
  $sqlList = "
    SELECT
      {$catExpr} AS category,
      ei.instance_code,
      ei.equipment_id,
      em.name AS equipment_name,
      ei.branch_id,
      ei.status,
      ei.current_location
    FROM equipment_instances ei
    JOIN equipment_master em ON em.equipment_id = ei.equipment_id
    {$joinCat}
    {$joinGeo}
    WHERE {$where}
    ORDER BY category ASC, em.name ASC, ei.instance_code ASC
    LIMIT 1500
  ";
  $stList = safePrepare($conn, $sqlList);
  stmtBindDynamic($stList, $types, $vals);
  $stList->execute();
  $rows = fetchAll($stList);

  $groupsMap = [];
  foreach ($rows as $r) {
    $cat = $r["category"] ?? "ไม่ระบุหมวดหมู่";
    if (!isset($groupsMap[$cat])) $groupsMap[$cat] = [];
    $groupsMap[$cat][] = $r;
  }
  $groups = [];
  foreach ($groupsMap as $cat => $items) {
    $groups[] = ["category" => $cat, "items" => $items];
  }

  // 5) Old items
  $sqlOld = "
    SELECT TRIM(ei.status) AS status, COUNT(*) AS qty
    FROM equipment_instances ei
    JOIN equipment_master em ON em.equipment_id = ei.equipment_id
    {$joinCat}
    {$joinGeo}
    WHERE {$where}
    GROUP BY TRIM(ei.status)
    ORDER BY qty DESC
  ";
  $stOld = safePrepare($conn, $sqlOld);
  stmtBindDynamic($stOld, $types, $vals);
  $stOld->execute();
  $items = fetchAll($stOld);

  echo json_encode([
    "success" => true,
    "cards" => [
      "total"  => (int)($cards["total"] ?? 0),
      "ready"  => (int)($cards["ready"] ?? 0),
      "in_use" => (int)($cards["in_use"] ?? 0),
      "worn"   => (int)($cards["worn"] ?? 0),
      "broken" => (int)($cards["broken"] ?? 0),
      "maint"  => (int)($cards["maint"] ?? 0),
    ],
    "by_category" => array_map(function($r){
      return [
        "category" => $r["category"],
        "total"  => (int)($r["total"] ?? 0),
        "ready"  => (int)($r["ready"] ?? 0),
        "in_use" => (int)($r["in_use"] ?? 0),
        "worn"   => (int)($r["worn"] ?? 0),
        "broken" => (int)($r["broken"] ?? 0),
        "maint"  => (int)($r["maint"] ?? 0),
      ];
    }, $by_category),
    "top5_mode" => $top5_mode,
    "top5" => array_map(function($r){
      return [
        "equipment_id" => $r["equipment_id"],
        "name" => $r["name"],
        "category" => $r["category"],
        "issue_count" => (int)($r["issue_count"] ?? 0),
      ];
    }, $top5),
    "groups" => $groups,
    "categories" => $catList,
    "items" => array_map(function($r){
      return ["status" => $r["status"], "qty" => (int)($r["qty"] ?? 0)];
    }, $items),
  ]);

} catch (Exception $e) {
  http_response_code(500);
  echo json_encode(["success" => false, "error" => $e->getMessage()]);
}