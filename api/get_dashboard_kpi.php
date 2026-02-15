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

  // 1) total bookings
  $sqlBookings = "
    SELECT COUNT(*) AS total_bookings
    FROM bookings b
    LEFT JOIN booking_types bt ON bt.id = b.booking_type_id
    LEFT JOIN branches br ON br.branch_id = b.branch_id
    LEFT JOIN provinces pv ON pv.province_id = br.province_id
    LEFT JOIN region rg ON rg.region_id = pv.region_id
    WHERE $whereSql
  ";
  $st = $conn->prepare($sqlBookings);
  stmtBindDynamic($st,$types,$vals);
  $st->execute();
  $row = fetchOne($st); $st->close();
  $total_bookings = (int)($row["total_bookings"] ?? 0);

  // 2) total users
  $rowU = $conn->query("SELECT COUNT(*) AS c FROM customers")->fetch_assoc();
  $total_users = (int)($rowU["c"] ?? 0);

  // 3) net revenue (PAID = +, REFUNDED = -)
  $sqlNet = "
    SELECT COALESCE(SUM(
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
  ";
  $st = $conn->prepare($sqlNet);
  stmtBindDynamic($st,$types,$vals);
  $st->execute();
  $row = fetchOne($st); $st->close();
  $net_revenue = (float)($row["net_revenue"] ?? 0);

  // 4) pay rate
  $sqlPaid = "
    SELECT COUNT(*) AS paid_bookings
    FROM bookings b
    LEFT JOIN payment_status ps ON ps.id = b.payment_status_id
    LEFT JOIN booking_types bt ON bt.id = b.booking_type_id
    LEFT JOIN branches br ON br.branch_id = b.branch_id
    LEFT JOIN provinces pv ON pv.province_id = br.province_id
    LEFT JOIN region rg ON rg.region_id = pv.region_id
    WHERE $whereSql
      AND ps.code = 'PAID'
  ";
  $st = $conn->prepare($sqlPaid);
  stmtBindDynamic($st,$types,$vals);
  $st->execute();
  $row = fetchOne($st); $st->close();
  $paid_bookings = (int)($row["paid_bookings"] ?? 0);

  $pay_rate = $total_bookings > 0 ? ($paid_bookings * 100.0 / $total_bookings) : 0;

  echo json_encode([
    "success"=>true,
    "total_bookings"=>$total_bookings,
    "total_users"=>$total_users,
    "net_revenue"=>$net_revenue,
    "pay_rate"=>$pay_rate
  ]);
} catch (Exception $e) {
  http_response_code(500);
  echo json_encode(["success"=>false,"error"=>$e->getMessage()]);
}