<?php
// executive/api/get_equipment.php (REWRITE)
// ✅ ใช้โครงเดียวกับไฟล์อื่นใน executive/api
// - รองรับ filter: branch_id / region / search / categories / statuses
// - คืน items สำหรับแสดงรายการอุปกรณ์ (instance) แบบตรง ๆ

require_once __DIR__ . "/_auth.php";
require_once __DIR__ . "/_db.php";
require_once __DIR__ . "/_helpers.php";

// Always JSON (กัน warning เป็น HTML)
ini_set("display_errors", "0");
error_reporting(E_ALL);
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
header("Content-Type: application/json; charset=utf-8");

try {
  $branch_id  = q("branch_id", "ALL");
  $region     = q("region", "ALL");
  $search     = trim((string)q("search", ""));
  $catsQ      = (string)q("categories", ""); // comma / single (category_id)
  $statusesQ  = (string)q("statuses", "");   // comma (raw status)

  $catArr = array_values(array_filter(array_map("trim", explode(",", $catsQ))));
  $stArr  = array_values(array_filter(array_map("trim", explode(",", $statusesQ))));

  // ✅ GEO join (เหมือน get_equipment_overview.php)
  $joinGeo = "
    LEFT JOIN branches br ON br.branch_id = ei.branch_id
    LEFT JOIN provinces pv ON pv.province_id = br.province_id
    LEFT JOIN region rg ON rg.region_id = pv.region_id
  ";

  $where = ["1=1"];
  $types = "";
  $vals  = [];

  if ($branch_id !== "ALL" && $branch_id !== "") {
    $where[] = "ei.branch_id = ?";
    addParam($types, $vals, "s", $branch_id);
  }
  if ($region !== "ALL" && $region !== "") {
    $where[] = "rg.region_name = ?";
    addParam($types, $vals, "s", $region);
  }
  if ($search !== "") {
    $where[] = "(ei.instance_code LIKE ? OR ei.equipment_id LIKE ? OR em.name LIKE ? OR COALESCE(c.name,'') LIKE ?)";
    $like = "%{$search}%";
    addParam($types, $vals, "s", $like);
    addParam($types, $vals, "s", $like);
    addParam($types, $vals, "s", $like);
    addParam($types, $vals, "s", $like);
  }

  // categories: รับเป็น category_id เป็นหลัก
  if (count($catArr) > 0) {
    $ph = [];
    foreach ($catArr as $c) {
      $ph[] = "?";
      addParam($types, $vals, "s", $c);
    }
    $where[] = "em.category_id IN (" . implode(",", $ph) . ")";
  }

  // statuses: ตรงกับค่าจริงใน equipment_instances.status
  if (count($stArr) > 0) {
    $ph = [];
    foreach ($stArr as $s) {
      $ph[] = "?";
      addParam($types, $vals, "s", $s);
    }
    $where[] = "TRIM(ei.status) IN (" . implode(",", $ph) . ")";
  }

  $whereSql = implode(" AND ", $where);

  $sql = "
    SELECT
      ei.instance_code,
      ei.branch_id,
      ei.status,
      COALESCE(NULLIF(TRIM(ei.current_location),''), '-') AS current_location,
      ei.received_date,
      ei.expiry_date,
      em.equipment_id,
      em.name AS equipment_name,
      em.category_id,
      COALESCE(c.name, em.category_id) AS category_name
    FROM equipment_instances ei
    JOIN equipment_master em ON em.equipment_id = ei.equipment_id
    LEFT JOIN categories c ON c.category_id = em.category_id
    $joinGeo
    WHERE $whereSql
    ORDER BY category_name ASC, em.name ASC, ei.instance_code ASC
  ";

  $st = $conn->prepare($sql);
  stmtBindDynamic($st, $types, $vals);
  $st->execute();
  $items = fetchAll($st);
  $st->close();

  echo json_encode([
    "success" => true,
    "items" => $items,
  ], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
  http_response_code(500);
  echo json_encode([
    "success" => false,
    "error" => $e->getMessage(),
  ], JSON_UNESCAPED_UNICODE);
}