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
  $branch_id = q("branch_id", "ALL");

  $where = "1=1";
  $types = "";
  $vals  = [];

  if ($branch_id !== "ALL" && $branch_id !== "") {
    $where .= " AND ei.branch_id = ?";
    addParam($types, $vals, "s", $branch_id);
  }

  // ✅ Cards: normalize status (trim + รองรับหลายคำ)
  // หมายเหตุ: LOWER() ใช้เพื่อรองรับภาษาอังกฤษด้วย
  $sqlCards = "
    SELECT
      COUNT(*) AS total,

      SUM(CASE WHEN TRIM(ei.status) IN ('พร้อมใช้งาน','พร้อมใช้','พร้อม') 
                OR LOWER(TRIM(ei.status)) IN ('ready','available','in_service')
           THEN 1 ELSE 0 END) AS ready,

      SUM(CASE WHEN TRIM(ei.status) IN ('เสื่อมสภาพ','เสื่อม') 
                OR LOWER(TRIM(ei.status)) IN ('worn','degraded')
           THEN 1 ELSE 0 END) AS worn,

      SUM(CASE WHEN TRIM(ei.status) IN ('ชำรุด','เสีย','พัง') 
                OR LOWER(TRIM(ei.status)) IN ('broken','damaged')
           THEN 1 ELSE 0 END) AS broken,

      SUM(CASE WHEN TRIM(ei.status) IN ('กำลังซ่อมแซม','ซ่อมแซม','ซ่อม','กำลังซ่อม') 
                OR LOWER(TRIM(ei.status)) IN ('maintenance','repair','in_repair')
           THEN 1 ELSE 0 END) AS maintenance

    FROM equipment_instances ei
    WHERE $where
  ";
  $st = safePrepare($conn, $sqlCards);
  stmtBindDynamic($st, $types, $vals);
  $st->execute();
  $cardsRow = fetchOne($st);
  $st->close();

  $cards = [
    "total"       => (int)($cardsRow["total"] ?? 0),
    "ready"       => (int)($cardsRow["ready"] ?? 0),
    "worn"        => (int)($cardsRow["worn"] ?? 0),
    "broken"      => (int)($cardsRow["broken"] ?? 0),
    "maintenance" => (int)($cardsRow["maintenance"] ?? 0),
  ];

  // ---- status_counts (เผื่อเอาไปทำ checkbox) ----
  $sqlStatus = "
    SELECT TRIM(ei.status) AS status, COUNT(*) AS qty
    FROM equipment_instances ei
    WHERE $where
    GROUP BY TRIM(ei.status)
    ORDER BY qty DESC
  ";
  $st = safePrepare($conn, $sqlStatus);
  stmtBindDynamic($st, $types, $vals);
  $st->execute();
  $statusCounts = fetchAll($st);
  $st->close();

  // ---- category_counts ----
  $sqlCat = "
    SELECT COALESCE(TRIM(c.name),'ไม่ระบุหมวดหมู่') AS category, COUNT(*) AS qty
    FROM equipment_instances ei
    JOIN equipment_master em ON em.equipment_id = ei.equipment_id
    LEFT JOIN categories c ON c.category_id = em.category_id
    WHERE $where
    GROUP BY category
    ORDER BY qty DESC
  ";
  $st = safePrepare($conn, $sqlCat);
  stmtBindDynamic($st, $types, $vals);
  $st->execute();
  $categoryCounts = fetchAll($st);
  $st->close();

  $labels = array_map(fn($r) => $r["category"], $categoryCounts);

  // ---- chart (เดิม) ----
  $sqlChart = "
    SELECT
      COALESCE(TRIM(c.name),'ไม่ระบุหมวดหมู่') AS category,
      TRIM(ei.status) AS status,
      COUNT(*) AS qty
    FROM equipment_instances ei
    JOIN equipment_master em ON em.equipment_id = ei.equipment_id
    LEFT JOIN categories c ON c.category_id = em.category_id
    WHERE $where
    GROUP BY category, TRIM(ei.status)
  ";
  $st = safePrepare($conn, $sqlChart);
  stmtBindDynamic($st, $types, $vals);
  $st->execute();
  $chartRows = fetchAll($st);
  $st->close();

  $statuses = ["พร้อมใช้งาน","เสื่อมสภาพ","ชำรุด","กำลังซ่อมแซม"];
  $series = [];
  foreach ($statuses as $s) $series[$s] = array_fill(0, count($labels), 0);

  $labelIndex = array_flip($labels);

  // ✅ map status จาก DB -> status มาตรฐาน (กันคำไม่ตรง)
  function normStatus($s){
    $t = trim((string)$s);
    $l = strtolower($t);
    if (in_array($t, ["พร้อมใช้งาน","พร้อมใช้","พร้อม"], true) || in_array($l, ["ready","available","in_service"], true)) return "พร้อมใช้งาน";
    if (in_array($t, ["เสื่อมสภาพ","เสื่อม"], true) || in_array($l, ["worn","degraded"], true)) return "เสื่อมสภาพ";
    if (in_array($t, ["ชำรุด","เสีย","พัง"], true) || in_array($l, ["broken","damaged"], true)) return "ชำรุด";
    if (in_array($t, ["กำลังซ่อมแซม","ซ่อมแซม","ซ่อม","กำลังซ่อม"], true) || in_array($l, ["maintenance","repair","in_repair"], true)) return "กำลังซ่อมแซม";
    return null;
  }

  foreach ($chartRows as $r) {
    $cat = $r["category"];
    $stt = normStatus($r["status"]);
    if (!$stt) continue;
    if (!isset($labelIndex[$cat])) continue;
    $series[$stt][$labelIndex[$cat]] += (int)$r["qty"];
  }

  $chart = ["labels"=>$labels, "statuses"=>$statuses, "series"=>$series];

  // ---- Top5 (เหมือนเดิมของคุณ) ----
  $top5 = []; // ถ้าคุณมีโค้ด Top5 อยู่แล้วจะเอามาใส่ต่อได้

  echo json_encode([
    "success" => true,
    "cards" => $cards,
    "status_counts" => $statusCounts,
    "category_counts" => $categoryCounts,
    "chart" => $chart,
    "top5" => $top5
  ], JSON_UNESCAPED_UNICODE);

} catch (Exception $e) {
  http_response_code(500);
  echo json_encode(["success"=>false,"error"=>$e->getMessage()], JSON_UNESCAPED_UNICODE);
}