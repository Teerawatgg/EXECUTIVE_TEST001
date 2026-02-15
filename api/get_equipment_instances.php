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

  // filter on eff_status (not raw status)
  $statusFilterSql = "";
  if (count($statuses) > 0) {
    $in = implode(",", array_fill(0, count($statuses), "?"));
    $statusFilterSql = " HAVING eff_status IN ($in) ";
    foreach ($statuses as $s) addParam($types, $vals, "s", $s);
  }

  $sql = "
    SELECT
      ei.instance_code,
      em.name AS name,
      COALESCE(TRIM(c.name),'ไม่ระบุหมวดหมู่') AS category,
      COALESCE(NULLIF(TRIM(ei.current_location),''), '-') AS location,

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
      END AS eff_status,

      ei.received_date,
      ei.expiry_date

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
    $statusFilterSql
    ORDER BY ei.instance_code DESC
    LIMIT 1000
  ";

  $st = safePrepare($conn, $sql);
  stmtBindDynamic($st, $types, $vals);
  $st->execute();
  $rows = fetchAll($st);
  $st->close();

  // return with "status" field expected by JS/table
  $items = array_map(function($r){
    $r["status"] = $r["eff_status"];
    unset($r["eff_status"]);
    return $r;
  }, $rows);

  echo json_encode(["success"=>true, "items"=>$items], JSON_UNESCAPED_UNICODE);

} catch (Exception $e) {
  http_response_code(500);
  echo json_encode(["success"=>false,"error"=>$e->getMessage()], JSON_UNESCAPED_UNICODE);
}