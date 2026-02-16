<?php
require_once __DIR__ . "/_db.php";
require_once __DIR__ . "/_helpers.php";

header("Content-Type: application/json; charset=utf-8");

/* -------------------------
   Schema helpers
------------------------- */
function hasTable($conn, $table) {
  $db = $conn->query("SELECT DATABASE() AS db")->fetch_assoc()["db"] ?? "";
  if ($db === "") return false;
  $st = $conn->prepare("
    SELECT 1
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    LIMIT 1
  ");
  $st->bind_param("ss", $db, $table);
  $st->execute();
  $res = $st->get_result();
  $ok = (bool)$res->fetch_assoc();
  $st->close();
  return $ok;
}

function hasColumn($conn, $table, $col) {
  $db = $conn->query("SELECT DATABASE() AS db")->fetch_assoc()["db"] ?? "";
  if ($db === "") return false;
  $st = $conn->prepare("
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
    LIMIT 1
  ");
  $st->bind_param("sss", $db, $table, $col);
  $st->execute();
  $res = $st->get_result();
  $ok = (bool)$res->fetch_assoc();
  $st->close();
  return $ok;
}

function buildNotCancelledJoinAndWhere($conn) {
  $join = "";
  $where = "1=1";

  $hasBS = hasTable($conn, "booking_status");
  $hasBSId = hasColumn($conn, "bookings", "booking_status_id");
  if (!$hasBS || !$hasBSId) return [$join, $where];

  $codeCol = null;
  foreach (["code", "status_code", "booking_status_code"] as $c) {
    if (hasColumn($conn, "booking_status", $c)) { $codeCol = $c; break; }
  }
  if (!$codeCol) return [$join, $where];

  $join  = " LEFT JOIN booking_status bs ON bs.id = b.booking_status_id ";
  $where = " (bs.$codeCol IS NULL OR bs.$codeCol NOT IN ('CANCELLED','CANCELED')) ";
  return [$join, $where];
}

try {
  $types = "";
  $vals  = [];
  $where = [];

  // ✅ เวลา: pickup_time
  $where[] = dateWhereSQL("b.pickup_time", $types, $vals);

  $branch_id = q("branch_id", "ALL");
  $region    = q("region", "ALL");

  if ($branch_id !== "ALL") {
    $where[] = "b.branch_id = ?";
    addParam($types, $vals, "s", $branch_id);
  }

  // ✅ ช่องทาง
  $where[] = bookingTypeWhereSQL($types, $vals, "bt.code");

  if ($region !== "ALL") {
    $where[] = "rg.region_name = ?";
    addParam($types, $vals, "s", $region);
  }

  // ✅ ไม่ยกเลิก (ถ้ามี booking_status)
  [$joinBS, $notCancelledWhere] = buildNotCancelledJoinAndWhere($conn);
  $where[] = $notCancelledWhere;

  $whereSql = implode(" AND ", $where);

  // ✅ สรุปตามวิธีชำระ: เอาเฉพาะ “PAID” เท่านั้น + ไม่ยกเลิก
  $sql = "
    SELECT
      pm.code AS method_code,
      COALESCE(pm.name_th, pm.name_en) AS method_name,
      COUNT(*) AS tx_count,
      COALESCE(SUM(pay.amount - COALESCE(pay.refund_amount,0)),0) AS net_amount
    FROM payments pay
    JOIN payment_methods pm ON pm.method_id = pay.method_id
    JOIN payment_status ps  ON ps.id = pay.payment_status_id
    JOIN bookings b         ON b.booking_id = pay.booking_id
    LEFT JOIN booking_types bt ON bt.id = b.booking_type_id
    $joinBS
    LEFT JOIN branches br      ON br.branch_id = b.branch_id
    LEFT JOIN provinces pv     ON pv.province_id = br.province_id
    LEFT JOIN region rg        ON rg.region_id = pv.region_id
    WHERE $whereSql
      AND ps.code = 'PAID'
    GROUP BY pm.code, pm.name_th, pm.name_en
    ORDER BY tx_count DESC, net_amount DESC
  ";

  $st = $conn->prepare($sql);
  stmtBindDynamic($st, $types, $vals);
  $st->execute();
  $items = fetchAll($st);
  $st->close();

  echo json_encode(["success" => true, "items" => $items]);

} catch (Exception $e) {
  http_response_code(500);
  echo json_encode(["success" => false, "error" => $e->getMessage()]);
}