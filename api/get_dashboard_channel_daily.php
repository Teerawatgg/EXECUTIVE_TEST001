<?php
require_once __DIR__ . "/_db.php";
require_once __DIR__ . "/_helpers.php";

header("Content-Type: application/json; charset=utf-8");

try {

  $types = "";
  $vals  = [];
  $where = [];

  // filter วันที่
  $where[] = dateWhereSQL("b.pickup_time", $types, $vals);

  // filter ช่องทาง
  $where[] = bookingTypeWhereSQL($types, $vals, "bt.code");

  $whereSql = implode(" AND ", $where);

  $sql = "
    SELECT
      WEEKDAY(b.pickup_time) AS wd,
      SUM(CASE WHEN bt.code = 'WALK_IN' THEN 1 ELSE 0 END) AS walkin_cnt,
      SUM(CASE WHEN bt.code = 'ONLINE' THEN 1 ELSE 0 END) AS online_cnt
    FROM bookings b
    LEFT JOIN booking_types bt ON bt.id = b.booking_type_id
    WHERE $whereSql
    GROUP BY WEEKDAY(b.pickup_time)
    ORDER BY wd ASC
  ";

  $stmt = $conn->prepare($sql);
  stmtBindDynamic($stmt, $types, $vals);
  $stmt->execute();
  $result = $stmt->get_result();

  // เตรียม array วัน จ-อา
  $walkin = array_fill(0, 7, 0);
  $online = array_fill(0, 7, 0);

  while ($row = $result->fetch_assoc()) {
    $day = (int)$row["wd"];
    $walkin[$day] = (int)$row["walkin_cnt"];
    $online[$day] = (int)$row["online_cnt"];
  }

  $stmt->close();

  // ===== คำนวณค่าเฉลี่ย =====
  $days = 7; // รายสัปดาห์

  $total_walkin = array_sum($walkin);
  $total_online = array_sum($online);

  $avg_walkin = $days > 0 ? round($total_walkin / $days, 2) : 0;
  $avg_online = $days > 0 ? round($total_online / $days, 2) : 0;

  echo json_encode([
    "success"      => true,
    "labels"       => ["จ","อ","พ","พฤ","ศ","ส","อา"],
    "walkin"       => $walkin,
    "online"       => $online,
    "avg_walkin"   => $avg_walkin,
    "avg_online"   => $avg_online
  ]);

} catch (Exception $e) {
  http_response_code(500);
  echo json_encode([
    "success" => false,
    "error"   => $e->getMessage()
  ]);
}