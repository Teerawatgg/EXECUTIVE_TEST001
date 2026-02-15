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

  $whereSql = implode(" AND ", $where);

  $sql = "
    SELECT
      pm.code AS method_code,
      COALESCE(pm.name_th, pm.name_en) AS method_name,
      COUNT(*) AS tx_count,
      COALESCE(SUM(pay.amount - COALESCE(pay.refund_amount,0)),0) AS net_amount
    FROM payments pay
    JOIN payment_methods pm ON pm.method_id = pay.method_id
    JOIN payment_status ps ON ps.id = pay.payment_status_id
    JOIN bookings b ON b.booking_id = pay.booking_id
    LEFT JOIN booking_types bt ON bt.id = b.booking_type_id
    LEFT JOIN branches br ON br.branch_id = b.branch_id
    LEFT JOIN provinces pv ON pv.province_id = br.province_id
    LEFT JOIN region rg ON rg.region_id = pv.region_id
    WHERE $whereSql
      AND ps.code IN ('PAID','REFUNDED')
    GROUP BY pm.code, pm.name_th, pm.name_en
    ORDER BY net_amount DESC
  ";

  $st = $conn->prepare($sql);
  stmtBindDynamic($st,$types,$vals);
  $st->execute();
  $items = fetchAll($st);
  $st->close();

  echo json_encode(["success"=>true,"items"=>$items]);
} catch (Exception $e) {
  http_response_code(500);
  echo json_encode(["success"=>false,"error"=>$e->getMessage()]);
}