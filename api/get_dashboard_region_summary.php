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
      COALESCE(rg.region_name,'ไม่ระบุ') AS region,
      COUNT(*) AS bookings,
      COALESCE(SUM(
        CASE ps.code
          WHEN 'PAID' THEN b.net_amount
          WHEN 'REFUNDED' THEN -b.net_amount
          ELSE 0
        END
      ),0) AS net_revenue
    FROM bookings b
    LEFT JOIN payment_status ps ON ps.id = b.payment_status_id
    LEFT JOIN booking_types bt ON bt.id = b.booking_type_id
    LEFT JOIN branches br ON br.branch_id = b.branch_id
    LEFT JOIN provinces pv ON pv.province_id = br.province_id
    LEFT JOIN region rg ON rg.region_id = pv.region_id
    WHERE $whereSql
    GROUP BY rg.region_name
    ORDER BY net_revenue DESC
  ";

  $st = $conn->prepare($sql);
  stmtBindDynamic($st,$types,$vals);
  $st->execute();
  $rows = fetchAll($st);
  $st->close();

  echo json_encode(["success"=>true,"regions"=>$rows]);
} catch (Exception $e) {
  http_response_code(500);
  echo json_encode(["success"=>false,"error"=>$e->getMessage()]);
}