<?php
// executive/api/get_equipment_overview.php
require_once __DIR__ . "/_db.php";
require_once __DIR__ . "/_helpers.php";

// ✅ Always JSON (no HTML warnings)
ini_set("display_errors", "0");
error_reporting(E_ALL);
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
header("Content-Type: application/json; charset=utf-8");

// -------------------------
// Helpers
// -------------------------
function containsAny($text, $keywords) {
  $text = (string)$text;
  foreach ($keywords as $k) {
    $k = (string)$k;
    if ($k === "") continue;
    if (mb_strpos($text, $k, 0, "UTF-8") !== false) return true;
  }
  return false;
}

try {
  // -------------------------
  // Inputs
  // -------------------------
  $branch_id  = q("branch_id", "ALL");
  $region     = q("region", "ALL");
  $search     = trim((string)q("search", ""));
  $categories = (string)q("categories", ""); // single or comma
  $statuses   = (string)q("statuses", "");   // comma (status codes or raw text)

  $catArr = array_values(array_filter(array_map("trim", explode(",", $categories))));
  $stArr  = array_values(array_filter(array_map("trim", explode(",", $statuses))));

  // -------------------------
  // GEO join (ตามโครงของโปรเจค)
  // -------------------------
  $joinGeo = "
    LEFT JOIN branches br ON br.branch_id = ei.branch_id
    LEFT JOIN provinces pv ON pv.province_id = br.province_id
    LEFT JOIN region rg ON rg.region_id = pv.region_id
  ";

  // -------------------------
  // WHERE builder
  // -------------------------
  $types = "";
  $vals  = [];
  $where = ["1=1"];

  if ($branch_id !== "ALL") { $where[] = "ei.branch_id = ?"; addParam($types,$vals,"s",$branch_id); }
  if ($region !== "ALL")    { $where[] = "rg.region_name = ?"; addParam($types,$vals,"s",$region); }

  if ($search !== "") {
    $where[] = "(ei.instance_code LIKE ? OR ei.equipment_id LIKE ? OR em.name LIKE ?)";
    $s = "%{$search}%";
    addParam($types,$vals,"s",$s);
    addParam($types,$vals,"s",$s);
    addParam($types,$vals,"s",$s);
  }

  // categories filter (single/comma)
  if (count($catArr)) {
    $ph = [];
    foreach ($catArr as $c) { $ph[] = "?"; addParam($types,$vals,"s",$c); }
    $where[] = "em.category_id IN (" . implode(",", $ph) . ")";
  }

  // statuses filter (exact match in DB)
  if (count($stArr)) {
    $ph = [];
    foreach ($stArr as $st) { $ph[] = "?"; addParam($types,$vals,"s",$st); }
    $where[] = "TRIM(ei.status) IN (" . implode(",", $ph) . ")";
  }

  $whereSql = implode(" AND ", $where);

  // =========================================================
  // 1) SUMMARY BY REAL STATUS (Group by status in DB)
  // =========================================================
  $sqlStatusCounts = "
    SELECT
      COALESCE(TRIM(ei.status), '') AS status,
      COUNT(*) AS cnt
    FROM equipment_instances ei
    JOIN equipment_master em ON em.equipment_id = ei.equipment_id
    $joinGeo
    WHERE $whereSql
    GROUP BY COALESCE(TRIM(ei.status), '')
  ";

  $st = $conn->prepare($sqlStatusCounts);
  stmtBindDynamic($st, $types, $vals);
  $st->execute();
  $statusRows = fetchAll($st);
  $st->close();

  // totals
  $total = 0;
  foreach ($statusRows as $r) $total += (int)($r["cnt"] ?? 0);

  // ✅ Keyword mapping (กว้าง ๆ ให้ครอบคลุม DB หลากหลาย)
  $KW_AVAILABLE = ["ว่าง","พร้อม","พร้อมใช้","พร้อมใช้งาน","READY","AVAILABLE"];
  $KW_INUSE     = [
    "กำลังใช้","ใช้งาน","กำลังใช้งาน","กำลังเช่า","เช่าอยู่","ถูกยืม","ยืมอยู่","กำลังยืม","กำลังให้ยืม",
    "IN_USE","IN USE","BORROW","BORROWED","RENT","RENTED","INUSE"
  ];
  $KW_BROKEN    = [
    "ชำรุด","เสีย","พัง","เสียหาย","แตก","หัก","ร้าว","ขาด","เสื่อม","เสื่อมสภาพ",
    "BROKEN","DAMAGE","DAMAGED","DEFECT"
  ];
  $KW_MAINT     = [
    "ซ่อม","ซ่อมแซม","ซ่อมบำรุง","กำลังซ่อม","กำลังซ่อมแซม","ส่งซ่อม",
    "MAINT","MAINTENANCE","REPAIR","FIX"
  ];

  $available = 0; $in_use = 0; $broken = 0; $maintenance = 0;
  $summary_by_status = [];

  foreach ($statusRows as $r) {
    $raw = (string)($r["status"] ?? "");
    $cnt = (int)($r["cnt"] ?? 0);

    $rawTrim = trim($raw);
    $rawUpper = mb_strtoupper($rawTrim, "UTF-8"); // ครอบคลุม EN

    $summary_by_status[] = ["status" => $raw, "count" => $cnt];

    // ✅ contains match (ทั้ง raw และ upper)
    if (containsAny($rawTrim, $KW_AVAILABLE) || containsAny($rawUpper, $KW_AVAILABLE)) {
      $available += $cnt;
    } elseif (containsAny($rawTrim, $KW_INUSE) || containsAny($rawUpper, $KW_INUSE)) {
      $in_use += $cnt;
    } elseif (containsAny($rawTrim, $KW_BROKEN) || containsAny($rawUpper, $KW_BROKEN)) {
      $broken += $cnt;
    } elseif (containsAny($rawTrim, $KW_MAINT) || containsAny($rawUpper, $KW_MAINT)) {
      $maintenance += $cnt;
    }
  }

  // =========================================================
  // 2) CATEGORIES LIST (sidebar)
  // - ไม่บังคับ category filter เพื่อให้ list หมวดครบใน scope
  // =========================================================
  $types2=""; $vals2=[];
  $where2=["1=1"];

  if ($branch_id !== "ALL") { $where2[] = "ei.branch_id = ?"; addParam($types2,$vals2,"s",$branch_id); }
  if ($region !== "ALL")    { $where2[] = "rg.region_name = ?"; addParam($types2,$vals2,"s",$region); }

  if ($search !== "") {
    $where2[] = "(ei.instance_code LIKE ? OR ei.equipment_id LIKE ? OR em.name LIKE ?)";
    $s = "%{$search}%";
    addParam($types2,$vals2,"s",$s);
    addParam($types2,$vals2,"s",$s);
    addParam($types2,$vals2,"s",$s);
  }

  if (count($stArr)) {
    $ph = [];
    foreach ($stArr as $stt) { $ph[] = "?"; addParam($types2,$vals2,"s",$stt); }
    $where2[] = "TRIM(ei.status) IN (" . implode(",", $ph) . ")";
  }

  $whereSql2 = implode(" AND ", $where2);

  $sqlCats = "
    SELECT
      em.category_id,
      COALESCE(c.name, em.category_id) AS category_name,
      COUNT(*) AS total
    FROM equipment_instances ei
    JOIN equipment_master em ON em.equipment_id = ei.equipment_id
    LEFT JOIN categories c ON c.category_id = em.category_id
    $joinGeo
    WHERE $whereSql2
    GROUP BY em.category_id, COALESCE(c.name, em.category_id)
    ORDER BY total DESC, category_name ASC
  ";

  $st = $conn->prepare($sqlCats);
  stmtBindDynamic($st, $types2, $vals2);
  $st->execute();
  $categoriesRows = fetchAll($st);
  $st->close();

  // =========================================================
  // 3) ITEMS (grouping list)
  // =========================================================
  $sqlItems = "
    SELECT
      em.category_id,
      COALESCE(c.name, em.category_id) AS category_name,
      ei.instance_code AS code,
      em.name,
      ei.status,
      ei.received_date,
      ei.expiry_date
    FROM equipment_instances ei
    JOIN equipment_master em ON em.equipment_id = ei.equipment_id
    LEFT JOIN categories c ON c.category_id = em.category_id
    $joinGeo
    WHERE $whereSql
    ORDER BY category_name ASC, em.name ASC, ei.instance_code ASC
    LIMIT 2000
  ";

  $st = $conn->prepare($sqlItems);
  stmtBindDynamic($st, $types, $vals);
  $st->execute();
  $rows = fetchAll($st);
  $st->close();

  $groupsMap = [];
  foreach ($rows as $r) {
    $cid = $r["category_id"] ?? "UNKNOWN";
    if (!isset($groupsMap[$cid])) {
      $groupsMap[$cid] = [
        "category_id" => $cid,
        "category_name" => $r["category_name"] ?? $cid,
        "total" => 0,
        "items" => []
      ];
    }
    $groupsMap[$cid]["total"]++;

    $groupsMap[$cid]["items"][] = [
      "code" => $r["code"] ?? "-",
      "name" => $r["name"] ?? "-",
      "status" => $r["status"] ?? "-",
      "received_date" => $r["received_date"] ?? null,
      "expiry_date" => $r["expiry_date"] ?? null
    ];
  }

  echo json_encode([
    "success" => true,
    "summary" => [
      "total" => (int)$total,
      "available" => (int)$available,
      "in_use" => (int)$in_use,
      "broken" => (int)$broken,
      "maintenance" => (int)$maintenance
    ],
    // ✅ ส่งกลับไว้ดูค่า status จริง ๆ ใน DB (ช่วย debug)
    "summary_by_status" => $summary_by_status,

    "categories" => $categoriesRows,
    "groups" => array_values($groupsMap),
  ]);

} catch (Throwable $e) {
  http_response_code(500);
  echo json_encode(["success" => false, "error" => $e->getMessage()]);
}