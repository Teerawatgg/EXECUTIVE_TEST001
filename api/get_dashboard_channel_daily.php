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
      WEEKDAY(b.pickup_time) AS wd,
      SUM(CASE WHEN bt.code='WALK_IN' THEN 1 ELSE 0 END) AS walkin_cnt,
      SUM(CASE WHEN bt.code='ONLINE'  THEN 1 ELSE 0 END) AS online_cnt
    FROM bookings b
    LEFT JOIN booking_types bt ON bt.id = b.booking_type_id
    LEFT JOIN branches br ON br.branch_id = b.branch_id
    LEFT JOIN provinces pv ON pv.province_id = br.province_id
    LEFT JOIN region rg ON rg.region_id = pv.region_id
    WHERE $whereSql
    GROUP BY WEEKDAY(b.pickup_time)
    ORDER BY wd ASC
  ";

  $st = $conn->prepare($sql);
  stmtBindDynamic($st,$types,$vals);
  $st->execute();
  $rows = fetchAll($st);
  $st->close();

  $walkin = array_fill(0,7,0);
  $online = array_fill(0,7,0);

  foreach ($rows as $r) {
    $i = (int)$r["wd"];
    if ($i >= 0 && $i <= 6) {
      $walkin[$i] = (int)$r["walkin_cnt"];
      $online[$i] = (int)$r["online_cnt"];
    }
  }

  echo json_encode([
    "success"=>true,
    "labels"=>["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],
    "walkin"=>$walkin,
    "online"=>$online
  ]);
} catch (Exception $e) {
  http_response_code(500);
  echo json_encode(["success"=>false,"error"=>$e->getMessage()]);
}