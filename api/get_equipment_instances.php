<?php
require_once __DIR__ . "/_db.php";
require_once __DIR__ . "/_helpers.php";

try {
  $branch_id = q("branch_id","ALL");
  $search    = q("search","");
  $statuses  = q("statuses","");
  $categories= q("categories","");

  $types = ""; $vals = [];
  $where = ["1=1"];

  if ($branch_id !== "ALL") { $where[]="ei.branch_id = ?"; addParam($types,$vals,"s",$branch_id); }

  if ($search !== "") {
    $where[]="(ei.instance_code LIKE ? OR ei.equipment_id LIKE ? OR em.name LIKE ?)";
    $s = "%".$search."%";
    addParam($types,$vals,"s",$s);
    addParam($types,$vals,"s",$s);
    addParam($types,$vals,"s",$s);
  }

  if ($statuses !== "") {
    $arr = array_values(array_filter(array_map("trim", explode(",", $statuses))));
    if (count($arr)) {
      $ph = [];
      foreach ($arr as $v){ $ph[]="?"; addParam($types,$vals,"s",$v); }
      $where[] = "ei.status IN (" . implode(",", $ph) . ")";
    }
  }

  if ($categories !== "") {
    $arr = array_values(array_filter(array_map("trim", explode(",", $categories))));
    if (count($arr)) {
      $ph = [];
      foreach ($arr as $v){ $ph[]="?"; addParam($types,$vals,"s",$v); }
      $where[] = "COALESCE(TRIM(c.name),'ไม่ระบุหมวดหมู่') IN (" . implode(",", $ph) . ")";
    }
  }

  $whereSql = implode(" AND ", $where);

  $sql = "
    SELECT
      ei.instance_code,
      em.name AS name,
      COALESCE(TRIM(c.name),'ไม่ระบุหมวดหมู่') AS category,
      ei.current_location AS location,
      ei.status,
      DATE_FORMAT(ei.received_date,'%Y-%m-%d') AS received_date,
      DATE_FORMAT(ei.expiry_date,'%Y-%m-%d') AS expiry_date
    FROM equipment_instances ei
    JOIN equipment_master em ON em.equipment_id = ei.equipment_id
    LEFT JOIN categories c ON c.category_id = em.category_id
    WHERE $whereSql
    ORDER BY category, ei.instance_code
    LIMIT 2000
  ";

  $st = $conn->prepare($sql);
  stmtBindDynamic($st,$types,$vals);
  $st->execute();
  $rows = fetchAll($st);
  $st->close();

  echo json_encode(["success"=>true,"items"=>$rows]);

} catch (Exception $e) {
  http_response_code(500);
  echo json_encode(["success"=>false,"error"=>$e->getMessage()]);
}