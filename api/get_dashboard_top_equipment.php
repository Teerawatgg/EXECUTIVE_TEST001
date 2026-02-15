<?php
require_once __DIR__ . "/_db.php";
require_once __DIR__ . "/_helpers.php";

try {
  $types = ""; $vals = [];
  $where = [];

  $where[] = dateWhereSQL("b.pickup_time", $types, $vals);

  $branch_id = q("branch_id","ALL");
  $region    = q("region","ALL");

  if ($branch_id !== "ALL") { $where[] = "b.branch_id = ?"; addParam($types,$vals,"s",$branch_id); }
  $where[] = bookingTypeWhereSQL($types,$vals,"bt.code");
  if ($region !== "ALL")    { $where[] = "rg.region_name = ?"; addParam($types,$vals,"s",$region); }

  $where[] = "d.item_type = 'Equipment'";
  $whereSql = implode(" AND ", $where);

  $sql = "
    SELECT
      em.equipment_id,
      em.name,
      TRIM(c.name) AS category,
      COALESCE(SUM(d.quantity),0) AS cnt
    FROM booking_details d
    INNER JOIN bookings b ON b.booking_id = d.booking_id
    LEFT JOIN booking_types bt ON bt.id = b.booking_type_id
    LEFT JOIN branches br ON br.branch_id = b.branch_id
    LEFT JOIN provinces pv ON pv.province_id = br.province_id
    LEFT JOIN region rg ON rg.region_id = pv.region_id
    LEFT JOIN equipment_master em ON em.equipment_id = d.equipment_id
    LEFT JOIN categories c ON c.category_id = em.category_id
    WHERE $whereSql
    GROUP BY em.equipment_id, em.name, c.name
    ORDER BY cnt DESC
    LIMIT 5
  ";

  $st = $conn->prepare($sql);
  stmtBindDynamic($st,$types,$vals);
  $st->execute();
  $rows = fetchAll($st);
  $st->close();

  $items = [];
  foreach ($rows as $r) {
    $items[] = [
      "id"       => $r["equipment_id"],
      "name"     => $r["name"],
      "category" => $r["category"] ?: "",
      "count"    => (int)$r["cnt"],
      "status"   => "ยอดนิยม"
    ];
  }

  echo json_encode(["success"=>true,"items"=>$items]);
} catch (Exception $e) {
  http_response_code(500);
  echo json_encode(["success"=>false,"error"=>$e->getMessage()]);
}