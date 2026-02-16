<?php
require_once __DIR__ . "/_db.php";
require_once __DIR__ . "/_helpers.php";

header("Content-Type: application/json; charset=utf-8");

/* -------------------------
   Schema helpers (กัน DB ไม่ตรง)
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

/* -------------------------
   Booking status cancellation filter
   - ถ้ามี booking_status + bookings.booking_status_id:
       ใช้ bs.code NOT IN ('CANCELLED','CANCELED')
------------------------- */
function buildNotCancelledJoinAndWhere($conn) {
  $join = "";
  $where = "1=1";

  $hasBS = hasTable($conn, "booking_status");
  $hasBSId = hasColumn($conn, "bookings", "booking_status_id");
  if (!$hasBS || !$hasBSId) return [$join, $where];

  // หาคอลัมน์ code ใน booking_status
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

  // ✅ เวลา (ยึด pickup_time)
  $where[] = dateWhereSQL("b.pickup_time", $types, $vals);

  // ✅ filter branch/region/channels
  $branch_id = q("branch_id", "ALL");
  $region    = q("region", "ALL");

  if ($branch_id !== "ALL") {
    $where[] = "b.branch_id = ?";
    addParam($types, $vals, "s", $branch_id);
  }

  // ช่องทาง (Walk-in/Online -> WALK_IN/ONLINE)
  $where[] = bookingTypeWhereSQL($types, $vals, "bt.code");

  if ($region !== "ALL") {
    $where[] = "rg.region_name = ?";
    addParam($types, $vals, "s", $region);
  }

  // ✅ ไม่ยกเลิก (ถ้าระบบมี booking_status)
  [$joinBS, $notCancelledWhere] = buildNotCancelledJoinAndWhere($conn);
  $where[] = $notCancelledWhere;

  // ✅ เงื่อนไข “ชำระเงินสำเร็จ” (จาก bookings.payment_status_id)
  // (ใช้ payment_status ตารางเดียวกับไฟล์เดิมของคุณ)
  $wherePaid = "ps.code = 'PAID'";

  $whereSql = implode(" AND ", $where);

  // 1) total bookings (เฉพาะ PAID + ไม่ยกเลิก)
  $sqlBookings = "
    SELECT COUNT(*) AS total_bookings
    FROM bookings b
    LEFT JOIN payment_status ps ON ps.id = b.payment_status_id
    LEFT JOIN booking_types bt  ON bt.id = b.booking_type_id
    $joinBS
    LEFT JOIN branches br   ON br.branch_id = b.branch_id
    LEFT JOIN provinces pv  ON pv.province_id = br.province_id
    LEFT JOIN region rg     ON rg.region_id = pv.region_id
    WHERE $whereSql
      AND $wherePaid
  ";
  $st = $conn->prepare($sqlBookings);
  stmtBindDynamic($st, $types, $vals);
  $st->execute();
  $row = fetchOne($st);
  $st->close();
  $total_bookings = (int)($row["total_bookings"] ?? 0);

  // 2) total users (distinct customer ในกลุ่ม PAID + ไม่ยกเลิก)
  $sqlUsers = "
    SELECT COUNT(DISTINCT b.customer_id) AS total_users
    FROM bookings b
    LEFT JOIN payment_status ps ON ps.id = b.payment_status_id
    LEFT JOIN booking_types bt  ON bt.id = b.booking_type_id
    $joinBS
    LEFT JOIN branches br   ON br.branch_id = b.branch_id
    LEFT JOIN provinces pv  ON pv.province_id = br.province_id
    LEFT JOIN region rg     ON rg.region_id = pv.region_id
    WHERE $whereSql
      AND $wherePaid
  ";
  $st = $conn->prepare($sqlUsers);
  stmtBindDynamic($st, $types, $vals);
  $st->execute();
  $row = fetchOne($st);
  $st->close();
  $total_users = (int)($row["total_users"] ?? 0);

  // 3) net revenue (เฉพาะ PAID + ไม่ยกเลิก)
  // ใช้ b.net_amount ตามโครงเดิม (ให้สอดคล้อง KPI)
  $sqlNet = "
    SELECT COALESCE(SUM(b.net_amount),0) AS net_revenue
    FROM bookings b
    LEFT JOIN payment_status ps ON ps.id = b.payment_status_id
    LEFT JOIN booking_types bt  ON bt.id = b.booking_type_id
    $joinBS
    LEFT JOIN branches br   ON br.branch_id = b.branch_id
    LEFT JOIN provinces pv  ON pv.province_id = br.province_id
    LEFT JOIN region rg     ON rg.region_id = pv.region_id
    WHERE $whereSql
      AND $wherePaid
  ";
  $st = $conn->prepare($sqlNet);
  stmtBindDynamic($st, $types, $vals);
  $st->execute();
  $row = fetchOne($st);
  $st->close();
  $net_revenue = (float)($row["net_revenue"] ?? 0);

  // 4) pay rate
  // เมื่อเรา “นับเฉพาะ PAID” แล้ว pay_rate จะเป็น 100% เสมอ
  // แต่ยังส่งไว้เพื่อไม่ให้หน้าเว็บพัง
  $pay_rate = $total_bookings > 0 ? 100.0 : 0.0;

  echo json_encode([
    "success"        => true,
    "total_bookings" => $total_bookings,
    "total_users"    => $total_users,
    "net_revenue"    => $net_revenue,
    "pay_rate"       => $pay_rate
  ]);

} catch (Exception $e) {
  http_response_code(500);
  echo json_encode(["success" => false, "error" => $e->getMessage()]);
}