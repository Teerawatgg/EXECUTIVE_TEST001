<?php
require_once __DIR__ . "/_db.php";
require_once __DIR__ . "/_helpers.php";

header("Content-Type: application/json; charset=utf-8");

function safePrepare($conn, $sql) {
  $st = $conn->prepare($sql);
  if (!$st) throw new Exception("Prepare failed: " . $conn->error);
  return $st;
}

try {
  $branch_id = q("branch_id","ALL");
  $search    = q("search","");
  $statusesQ = q("statuses","");
  $catsQ     = q("categories","");

  $statuses   = array_values(array_filter(array_map("trim", explode(",", $statusesQ))));
  $categories = array_values(array_filter(array_map("trim", explode(",", $catsQ))));

  // ---------- WHERE for equipment_instances ----------
  $where = "1=1";
  $types = "";
  $vals  = [];

  if ($branch_id !== "ALL" && $branch_id !== "") {
    $where .= " AND ei.branch_id = ?";
    addParam($types, $vals, "s", $branch_id);
  }

  if ($search !== "") {
    $where .= " AND (ei.instance_code LIKE ? OR em.name LIKE ?)";
    addParam($types, $vals, "s", "%{$search}%");
    addParam($types, $vals, "s", "%{$search}%");
  }

  if (count($categories) > 0) {
    $in = implode(",", array_fill(0, count($categories), "?"));
    $where .= " AND COALESCE(TRIM(c.name),'ไม่ระบุหมวดหมู่') IN ($in)";
    foreach ($categories as $cat) addParam($types, $vals, "s", $cat);
  }

  // ---------- Base query: compute eff_status ----------
  $sqlBase = "
    SELECT
      ei.instance_code,
      em.name AS equip_name,
      COALESCE(TRIM(c.name),'ไม่ระบุหมวดหมู่') AS category,
      ei.branch_id,
      CASE
        WHEN om.instance_code IS NOT NULL THEN 'กำลังซ่อมแซม'

        WHEN TRIM(ei.status) IN ('ว่าง','พร้อมใช้งาน','พร้อมใช้','พร้อม')
          OR LOWER(TRIM(ei.status)) IN ('ready','available','in_service','free','idle')
          THEN 'พร้อมใช้งาน'

        WHEN TRIM(ei.status) IN ('เสื่อมสภาพ','เสื่อม')
          OR LOWER(TRIM(ei.status)) IN ('worn','degraded')
          THEN 'เสื่อมสภาพ'

        WHEN TRIM(ei.status) IN ('ชำรุด','เสีย','พัง')
          OR LOWER(TRIM(ei.status)) IN ('broken','damaged')
          THEN 'ชำรุด'

        WHEN TRIM(ei.status) IN ('กำลังซ่อมแซม','ซ่อมแซม','ซ่อม','กำลังซ่อม')
          OR LOWER(TRIM(ei.status)) IN ('maintenance','repair','in_repair')
          THEN 'กำลังซ่อมแซม'

        WHEN ld.damage_level = 'High' THEN 'ชำรุด'
        WHEN ld.damage_level IN ('Low','Medium') THEN 'เสื่อมสภาพ'
        ELSE 'พร้อมใช้งาน'
      END AS eff_status

    FROM equipment_instances ei
    JOIN equipment_master em ON em.equipment_id = ei.equipment_id
    LEFT JOIN categories c ON c.category_id = em.category_id

    LEFT JOIN (
      SELECT ml.instance_code
      FROM maintenance_logs ml
      WHERE TRIM(ml.status) IN ('รอดำเนินการ','กำลังดำเนินการ')
      GROUP BY ml.instance_code
    ) om ON om.instance_code = ei.instance_code

    LEFT JOIN (
      SELECT x.instance_code, x.damage_level
      FROM maintenance_logs x
      JOIN (
        SELECT instance_code, MAX(report_date) AS max_date
        FROM maintenance_logs
        WHERE TRIM(status) IN ('ดำเนินการเสร็จสิ้น')
        GROUP BY instance_code
      ) t ON t.instance_code = x.instance_code AND t.max_date = x.report_date
    ) ld ON ld.instance_code = ei.instance_code

    WHERE $where
  ";

  // ✅ status filter ต้องไปอยู่ชั้นนอก (เพราะ eff_status เป็น alias)
  $typesX = $types;
  $valsX  = $vals;
  $filterX = "";
  if (count($statuses) > 0) {
    $in = implode(",", array_fill(0, count($statuses), "?"));
    $filterX = " WHERE X.eff_status IN ($in) ";
    foreach ($statuses as $s) addParam($typesX, $valsX, "s", $s);
  }

  // ---------- Cards ----------
  $sqlCards = "
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN X.eff_status='พร้อมใช้งาน' THEN 1 ELSE 0 END) AS ready,
      SUM(CASE WHEN X.eff_status='เสื่อมสภาพ' THEN 1 ELSE 0 END) AS worn,
      SUM(CASE WHEN X.eff_status='ชำรุด' THEN 1 ELSE 0 END) AS broken,
      SUM(CASE WHEN X.eff_status='กำลังซ่อมแซม' THEN 1 ELSE 0 END) AS maintenance
    FROM ($sqlBase) X
    $filterX
  ";
  $st = safePrepare($conn, $sqlCards);
  stmtBindDynamic($st, $typesX, $valsX);
  $st->execute();
  $cards = fetchOne($st);
  $st->close();

  // ---------- status_counts ----------
  $sqlStatusCounts = "
    SELECT X.eff_status AS status, COUNT(*) AS qty
    FROM ($sqlBase) X
    $filterX
    GROUP BY X.eff_status
    ORDER BY qty DESC
  ";
  $st = safePrepare($conn, $sqlStatusCounts);
  stmtBindDynamic($st, $typesX, $valsX);
  $st->execute();
  $status_counts = fetchAll($st);
  $st->close();

  // ---------- category_counts ----------
  $sqlCatCounts = "
    SELECT X.category, COUNT(*) AS qty
    FROM ($sqlBase) X
    $filterX
    GROUP BY X.category
    ORDER BY qty DESC
  ";
  $st = safePrepare($conn, $sqlCatCounts);
  stmtBindDynamic($st, $typesX, $valsX);
  $st->execute();
  $category_counts = fetchAll($st);
  $st->close();

  // ---------- chart ----------
  $sqlChart = "
    SELECT X.category, X.eff_status AS status, COUNT(*) AS qty
    FROM ($sqlBase) X
    $filterX
    GROUP BY X.category, X.eff_status
    ORDER BY X.category
  ";
  $st = safePrepare($conn, $sqlChart);
  stmtBindDynamic($st, $typesX, $valsX);
  $st->execute();
  $rows = fetchAll($st);
  $st->close();

  $labels = [];
  $statusesList = ["พร้อมใช้งาน","เสื่อมสภาพ","ชำรุด","กำลังซ่อมแซม"];
  $series = [];
  foreach ($statusesList as $s) $series[$s] = [];

  $catIndex = [];
  foreach ($rows as $r) {
    $cat = $r["category"];
    if (!isset($catIndex[$cat])) {
      $catIndex[$cat] = count($labels);
      $labels[] = $cat;
    }
  }
  foreach ($statusesList as $s) $series[$s] = array_fill(0, count($labels), 0);

  foreach ($rows as $r) {
    $cat = $r["category"];
    $stt = $r["status"];
    $qty = (int)$r["qty"];
    if (!in_array($stt, $statusesList, true)) continue;
    $i = $catIndex[$cat];
    $series[$stt][$i] = $qty;
  }

  $chart = ["labels"=>$labels, "statuses"=>$statusesList, "series"=>$series];

  // ---------- Top5 ----------
  $types2 = "";
  $vals2  = [];
  $w2 = "1=1";
  if ($branch_id !== "ALL" && $branch_id !== "") {
    $w2 .= " AND ml.branch_id = ?";
    addParam($types2, $vals2, "s", $branch_id);
  }
  if ($search !== "") {
    $w2 .= " AND (ml.instance_code LIKE ? OR em.name LIKE ?)";
    addParam($types2, $vals2, "s", "%{$search}%");
    addParam($types2, $vals2, "s", "%{$search}%");
  }
  if (count($categories) > 0) {
    $in = implode(",", array_fill(0, count($categories), "?"));
    $w2 .= " AND COALESCE(TRIM(c.name),'ไม่ระบุหมวดหมู่') IN ($in)";
    foreach ($categories as $cat) addParam($types2, $vals2, "s", $cat);
  }

  $sqlTop5 = "
    SELECT em.name AS name, COUNT(*) AS count
    FROM maintenance_logs ml
    JOIN equipment_instances ei ON ei.instance_code = ml.instance_code
    JOIN equipment_master em ON em.equipment_id = ei.equipment_id
    LEFT JOIN categories c ON c.category_id = em.category_id
    WHERE $w2
    GROUP BY em.name
    ORDER BY COUNT(*) DESC
    LIMIT 5
  ";
  $st = safePrepare($conn, $sqlTop5);
  stmtBindDynamic($st, $types2, $vals2);
  $st->execute();
  $top5 = fetchAll($st);
  $st->close();

  echo json_encode([
    "success"=>true,
    "cards"=>[
      "total" => (int)($cards["total"] ?? 0),
      "ready" => (int)($cards["ready"] ?? 0),
      "worn"  => (int)($cards["worn"] ?? 0),
      "broken"=> (int)($cards["broken"] ?? 0),
      "maintenance" => (int)($cards["maintenance"] ?? 0),
    ],
    "status_counts"=>array_map(fn($r)=>["status"=>$r["status"],"qty"=>(int)$r["qty"]], $status_counts),
    "category_counts"=>array_map(fn($r)=>["category"=>$r["category"],"qty"=>(int)$r["qty"]], $category_counts),
    "chart"=>$chart,
    "top5"=>array_map(fn($r)=>["name"=>$r["name"],"count"=>(int)$r["count"]], $top5),
  ], JSON_UNESCAPED_UNICODE);

} catch (Exception $e) {
  http_response_code(500);
  echo json_encode(["success"=>false,"error"=>$e->getMessage()], JSON_UNESCAPED_UNICODE);
}