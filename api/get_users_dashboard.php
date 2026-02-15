<?php
require_once __DIR__ . "/_db.php";
require_once __DIR__ . "/_helpers.php";

/* กัน PHP แปะ <br><b>... ทำให้ JSON พัง */
ini_set('display_errors', '0');
ini_set('html_errors', '0');

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
$conn->set_charset("utf8mb4");

function qcsv($key) {
  $s = q($key, "");
  if ($s === "") return [];
  return array_values(array_filter(array_map("trim", explode(",", $s))));
}

function dateWhereUsersSQL($col, &$types, &$vals) {
  $range = q("range", "all");
  $from  = q("from", "");
  $to    = q("to", "");

  if ($range === "custom") {
    $w = [];
    if ($from !== "") { $w[] = "$col >= ?"; addParam($types,$vals,"s",$from." 00:00:00"); }
    if ($to   !== "") { $w[] = "$col <= ?"; addParam($types,$vals,"s",$to." 23:59:59"); }
    return count($w) ? "(" . implode(" AND ", $w) . ")" : "1=1";
  }
  if ($range === "today") return "DATE($col) = CURDATE()";
  if ($range === "7d")    return "$col >= (NOW() - INTERVAL 7 DAY)";
  if ($range === "30d")   return "$col >= (NOW() - INTERVAL 30 DAY)";
  if ($range === "all")   return "1=1";
  return "1=1";
}

function hasTable($conn, $table) {
  $sql = "SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1";
  $st = $conn->prepare($sql);
  $st->bind_param("s", $table);
  $st->execute();
  $rs = $st->get_result();
  $ok = ($rs && $rs->num_rows > 0);
  $st->close();
  return $ok;
}

function hasColumn($conn, $table, $col) {
  $sql = "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1";
  $st = $conn->prepare($sql);
  $st->bind_param("ss", $table, $col);
  $st->execute();
  $rs = $st->get_result();
  $ok = ($rs && $rs->num_rows > 0);
  $st->close();
  return $ok;
}

function studentWhereSQL() {
  // รองรับทั้งค่าอังกฤษ/ไทยที่พบบ่อย
  return "(UPPER(cu.customer_type) = 'STUDENT' OR cu.customer_type LIKE '%นักศึกษา%')";
}

try {
  $types = ""; $vals = [];
  $where = [];

  // ใช้ pickup_time เป็นเวลาอ้างอิง
  $where[] = dateWhereUsersSQL("b.pickup_time", $types, $vals);

  $academic_year = q("academic_year", "ALL");
  if ($academic_year !== "ALL" && $academic_year !== "") {
    $where[] = "(YEAR(b.pickup_time) + 543) = ?";
    addParam($types, $vals, "i", (int)$academic_year);
  }

  // faculties รับได้ทั้ง "id" หรือ "ชื่อคณะ"
  $faculties = qcsv("faculties");
  $facultyIsAllNumeric = true;
  foreach ($faculties as $f) {
    if (!preg_match('/^\d+$/', $f)) { $facultyIsAllNumeric = false; break; }
  }
  if (count($faculties)) {
    $ph = [];
    foreach ($faculties as $f) { $ph[] = "?"; addParam($types,$vals, $facultyIsAllNumeric ? "i" : "s", $facultyIsAllNumeric ? (int)$f : $f); }
    $where[] = $facultyIsAllNumeric
      ? "cu.faculty_id IN (" . implode(",", $ph) . ")"
      : "f.name IN (" . implode(",", $ph) . ")";
  }

  $study_years = qcsv("study_years");
  if (count($study_years)) {
    $ph = [];
    foreach ($study_years as $y) { $ph[] = "?"; addParam($types,$vals,"i",(int)$y); }
    $where[] = "cu.study_year IN (" . implode(",", $ph) . ")";
  }

  $whereSql = implode(" AND ", $where);

  // ---- META (ปีการศึกษา) ----
  $metaYears = [];
  $rsY = $conn->query("
    SELECT DISTINCT (YEAR(pickup_time)+543) AS y
    FROM bookings
    WHERE pickup_time IS NOT NULL
    ORDER BY y DESC
    LIMIT 10
  ");
  while ($r = $rsY->fetch_assoc()) $metaYears[] = (int)$r["y"];

  // ---- META (คณะ) ----
  $metaFac = [];
  $rsF = $conn->query("
    SELECT id, name
    FROM faculty
    ORDER BY name ASC
  ");
  while ($r = $rsF->fetch_assoc()) $metaFac[] = ["id" => (int)$r["id"], "name" => $r["name"]];

  // ---- KPI ----
  $sqlTotal = "
    SELECT COUNT(*) AS total_usage,
           COUNT(DISTINCT b.customer_id) AS active_users
    FROM bookings b
    INNER JOIN customers cu ON cu.customer_id = b.customer_id
    LEFT JOIN faculty f ON f.id = cu.faculty_id
    WHERE $whereSql
  ";
  $st = $conn->prepare($sqlTotal);
  stmtBindDynamic($st, $types, $vals);
  $st->execute();
  $k1 = fetchOne($st);
  $st->close();

  $total_usage  = (int)($k1["total_usage"] ?? 0);
  $active_users = (int)($k1["active_users"] ?? 0);

  // denominator: total users ภายใต้ filter คณะ/ชั้นปี (ไม่ผูกเวลา)
  $typesU=""; $valsU=[]; $wU=["1=1"];
  if (count($faculties)) {
    $ph=[];
    foreach ($faculties as $f) { $ph[]="?"; addParam($typesU,$valsU, $facultyIsAllNumeric ? "i":"s", $facultyIsAllNumeric ? (int)$f : $f); }
    $wU[] = $facultyIsAllNumeric
      ? "faculty_id IN (" . implode(",",$ph) . ")"
      : "faculty_id IN (SELECT id FROM faculty WHERE name IN (" . implode(",",$ph) . "))";
  }
  if (count($study_years)) {
    $ph=[];
    foreach ($study_years as $y){ $ph[]="?"; addParam($typesU,$valsU,"i",(int)$y); }
    $wU[]="study_year IN (" . implode(",",$ph) . ")";
  }
  $sqlDen = "SELECT COUNT(*) AS total_users FROM customers WHERE " . implode(" AND ", $wU);
  $st = $conn->prepare($sqlDen);
  stmtBindDynamic($st, $typesU, $valsU);
  $st->execute();
  $denRow = fetchOne($st);
  $st->close();

  $total_users = (int)($denRow["total_users"] ?? 0);
  $usage_rate = ($total_users > 0) ? ($active_users * 100.0 / $total_users) : 0.0;

  // ---- FACULTY BAR ----
  $sqlFaculty = "
    SELECT f.name AS faculty, COUNT(*) AS cnt
    FROM bookings b
    INNER JOIN customers cu ON cu.customer_id = b.customer_id
    LEFT JOIN faculty f ON f.id = cu.faculty_id
    WHERE $whereSql
      AND f.name IS NOT NULL AND TRIM(f.name) <> ''
    GROUP BY f.name
    ORDER BY cnt DESC
  ";
  $st = $conn->prepare($sqlFaculty);
  stmtBindDynamic($st,$types,$vals);
  $st->execute();
  $facultyRows = fetchAll($st);
  $st->close();

  $top_faculty = ["name"=>"-","count"=>0];
  if (count($facultyRows)) {
    $top_faculty["name"]  = $facultyRows[0]["faculty"] ?? "-";
    $top_faculty["count"] = (int)($facultyRows[0]["cnt"] ?? 0);
  }

  // ---- STUDY YEAR ----
  $sqlSY = "
    SELECT cu.study_year AS study_year, COUNT(*) AS cnt
    FROM bookings b
    INNER JOIN customers cu ON cu.customer_id = b.customer_id
    LEFT JOIN faculty f ON f.id = cu.faculty_id
    WHERE $whereSql
      AND cu.study_year IS NOT NULL
    GROUP BY cu.study_year
    ORDER BY cu.study_year ASC
  ";
  $st = $conn->prepare($sqlSY);
  stmtBindDynamic($st,$types,$vals);
  $st->execute();
  $syRows = fetchAll($st);
  $st->close();

  // ---- TOP EQUIPMENT ----
  $sqlEq = "
    SELECT em.name AS name, COALESCE(SUM(d.quantity),0) AS cnt
    FROM booking_details d
    INNER JOIN bookings b ON b.booking_id = d.booking_id
    INNER JOIN customers cu ON cu.customer_id = b.customer_id
    LEFT JOIN faculty f ON f.id = cu.faculty_id
    LEFT JOIN equipment_master em ON em.equipment_id = d.equipment_id
    WHERE $whereSql
      AND (d.item_type = 'Equipment' OR d.item_type = 'EQUIPMENT')
      AND em.name IS NOT NULL
    GROUP BY em.name
    ORDER BY cnt DESC
    LIMIT 5
  ";
  $st = $conn->prepare($sqlEq);
  stmtBindDynamic($st,$types,$vals);
  $st->execute();
  $eqRows = fetchAll($st);
  $st->close();

  // ---- PEAK TIME ----
  $sqlPeak = "
    SELECT
      CASE
        WHEN HOUR(b.pickup_time) BETWEEN 8 AND 9   THEN '08:00-10:00'
        WHEN HOUR(b.pickup_time) BETWEEN 10 AND 11 THEN '10:00-12:00'
        WHEN HOUR(b.pickup_time) BETWEEN 12 AND 13 THEN '12:00-14:00'
        WHEN HOUR(b.pickup_time) BETWEEN 14 AND 15 THEN '14:00-16:00'
        WHEN HOUR(b.pickup_time) BETWEEN 16 AND 17 THEN '16:00-18:00'
        WHEN HOUR(b.pickup_time) BETWEEN 18 AND 19 THEN '18:00-20:00'
        ELSE 'อื่นๆ'
      END AS tbin,
      COUNT(*) AS cnt
    FROM bookings b
    INNER JOIN customers cu ON cu.customer_id = b.customer_id
    LEFT JOIN faculty f ON f.id = cu.faculty_id
    WHERE $whereSql
    GROUP BY tbin
    ORDER BY FIELD(tbin,'08:00-10:00','10:00-12:00','12:00-14:00','14:00-16:00','16:00-18:00','18:00-20:00','อื่นๆ')
  ";
  $st = $conn->prepare($sqlPeak);
  stmtBindDynamic($st,$types,$vals);
  $st->execute();
  $peakRows = fetchAll($st);
  $st->close();

  // ---- DAILY (Mon-Sun) ----
  $sqlDaily = "
    SELECT WEEKDAY(b.pickup_time) AS wd, COUNT(*) AS cnt
    FROM bookings b
    INNER JOIN customers cu ON cu.customer_id = b.customer_id
    LEFT JOIN faculty f ON f.id = cu.faculty_id
    WHERE $whereSql
    GROUP BY WEEKDAY(b.pickup_time)
    ORDER BY wd ASC
  ";
  $st = $conn->prepare($sqlDaily);
  stmtBindDynamic($st,$types,$vals);
  $st->execute();
  $dailyRows = fetchAll($st);
  $st->close();

  $wdMap = ["จ.","อ.","พ.","พฤ.","ศ.","ส.","อา."]; // 0=Mon
  $daily = array_fill(0, 7, 0);
  foreach ($dailyRows as $r) {
    $i = (int)$r["wd"];
    if ($i >= 0 && $i <= 6) $daily[$i] = (int)$r["cnt"];
  }

  // =========================================================
  // ✅ Executive Insights for Users
  // 1) membership_summary: bookings + spend by member_level
  // 2) student_coupon_top: most used coupon among students
  // 3) payment_method_summary: count + spend by payment method
  // =========================================================

  // ---- 1) MEMBERSHIP SUMMARY ----
  $membershipSummary = [];
  try {
    if (hasColumn($conn, 'customers', 'member_level') && hasTable($conn, 'payments') && hasTable($conn, 'payment_status')) {
      $sqlMem = "
        SELECT
          COALESCE(NULLIF(TRIM(cu.member_level),''),'ไม่ระบุ') AS tier,
          COUNT(DISTINCT b.booking_id) AS bookings,
          COALESCE(SUM(pay.amount - COALESCE(pay.refund_amount,0)),0) AS spend
        FROM bookings b
        INNER JOIN customers cu ON cu.customer_id = b.customer_id
        LEFT JOIN faculty f ON f.id = cu.faculty_id
        LEFT JOIN payments pay ON pay.booking_id = b.booking_id
        LEFT JOIN payment_status ps ON ps.id = pay.payment_status_id
        WHERE $whereSql
          AND ps.code IN ('PAID','REFUNDED')
        GROUP BY tier
        ORDER BY spend DESC, bookings DESC
      ";
      $st = $conn->prepare($sqlMem);
      stmtBindDynamic($st,$types,$vals);
      $st->execute();
      $rows = fetchAll($st);
      $st->close();

      $membershipSummary = array_map(fn($r)=>[
        "tier" => $r["tier"],
        "bookings" => (int)($r["bookings"] ?? 0),
        "spend" => (float)($r["spend"] ?? 0),
      ], $rows);
    }
  } catch (Throwable $_) {
    $membershipSummary = [];
  }

  // ---- 2) STUDENT COUPON TOP ----
  $studentCouponTop = [];
  try {
    $hasBookingCoupons = hasTable($conn, 'booking_coupons');
    $hasCouponsTable   = hasTable($conn, 'coupons');
    $hasCouponCodeCol  = hasColumn($conn, 'bookings', 'coupon_code');
    $hasCouponDiscCol  = hasColumn($conn, 'bookings', 'coupon_discount');

    if ($hasBookingCoupons && $hasCouponsTable) {
      // คาด: booking_coupons(booking_id,coupon_id,discount_amount), coupons(coupon_id,code,name)
      $sqlCup = "
        SELECT
          c.code AS coupon_code,
          c.name AS coupon_name,
          COUNT(*) AS cnt,
          COALESCE(SUM(COALESCE(bc.discount_amount,0)),0) AS discount_total
        FROM booking_coupons bc
        INNER JOIN coupons c ON c.coupon_id = bc.coupon_id
        INNER JOIN bookings b ON b.booking_id = bc.booking_id
        INNER JOIN customers cu ON cu.customer_id = b.customer_id
        LEFT JOIN faculty f ON f.id = cu.faculty_id
        WHERE $whereSql
          AND " . studentWhereSQL() . "
        GROUP BY c.code, c.name
        ORDER BY cnt DESC
        LIMIT 5
      ";
      $st = $conn->prepare($sqlCup);
      stmtBindDynamic($st,$types,$vals);
      $st->execute();
      $rows = fetchAll($st);
      $st->close();

      $studentCouponTop = array_map(fn($r)=>[
        "coupon_code" => $r["coupon_code"],
        "coupon_name" => $r["coupon_name"],
        "count" => (int)($r["cnt"] ?? 0),
        "discount_total" => (float)($r["discount_total"] ?? 0),
      ], $rows);

    } else if ($hasCouponCodeCol) {
      // ถ้าเก็บ coupon_code ไว้ใน bookings
      $joinCoupons = "";
      $selName = "NULL";
      if ($hasCouponsTable && hasColumn($conn,'coupons','code')) {
        $joinCoupons = " LEFT JOIN coupons c ON c.code = b.coupon_code ";
        $selName = "c.name";
      }

      $sqlCup2 = "
        SELECT
          b.coupon_code AS coupon_code,
          $selName AS coupon_name,
          COUNT(*) AS cnt,
          COALESCE(SUM(" . ($hasCouponDiscCol ? "COALESCE(b.coupon_discount,0)" : "0") . "),0) AS discount_total
        FROM bookings b
        INNER JOIN customers cu ON cu.customer_id = b.customer_id
        LEFT JOIN faculty f ON f.id = cu.faculty_id
        $joinCoupons
        WHERE $whereSql
          AND " . studentWhereSQL() . "
          AND b.coupon_code IS NOT NULL AND TRIM(b.coupon_code) <> ''
        GROUP BY b.coupon_code, coupon_name
        ORDER BY cnt DESC
        LIMIT 5
      ";
      $st = $conn->prepare($sqlCup2);
      stmtBindDynamic($st,$types,$vals);
      $st->execute();
      $rows = fetchAll($st);
      $st->close();

      $studentCouponTop = array_map(fn($r)=>[
        "coupon_code" => $r["coupon_code"],
        "coupon_name" => $r["coupon_name"],
        "count" => (int)($r["cnt"] ?? 0),
        "discount_total" => (float)($r["discount_total"] ?? 0),
      ], $rows);
    }
  } catch (Throwable $_) {
    $studentCouponTop = [];
  }

  // ---- 3) PAYMENT METHOD SUMMARY ----
  $paymentMethodSummary = [];
  try {
    if (hasTable($conn, 'payments') && hasTable($conn, 'payment_methods') && hasTable($conn, 'payment_status')) {
      $sqlPay = "
        SELECT
          pm.code AS method,
          COALESCE(pm.name_th, pm.name_en, pm.code) AS method_name,
          COUNT(*) AS cnt,
          COALESCE(SUM(pay.amount - COALESCE(pay.refund_amount,0)),0) AS amount
        FROM payments pay
        JOIN payment_methods pm ON pm.method_id = pay.method_id
        JOIN payment_status ps ON ps.id = pay.payment_status_id
        JOIN bookings b ON b.booking_id = pay.booking_id
        INNER JOIN customers cu ON cu.customer_id = b.customer_id
        LEFT JOIN faculty f ON f.id = cu.faculty_id
        WHERE $whereSql
          AND ps.code IN ('PAID','REFUNDED')
        GROUP BY pm.code, pm.name_th, pm.name_en
        ORDER BY amount DESC
      ";
      $st = $conn->prepare($sqlPay);
      stmtBindDynamic($st,$types,$vals);
      $st->execute();
      $rows = fetchAll($st);
      $st->close();

      $paymentMethodSummary = array_map(fn($r)=>[
        "method" => $r["method"],
        "method_name" => $r["method_name"],
        "count" => (int)($r["cnt"] ?? 0),
        "amount" => (float)($r["amount"] ?? 0),
      ], $rows);
    }
  } catch (Throwable $_) {
    $paymentMethodSummary = [];
  }

  echo json_encode([
    "success" => true,
    "meta" => [
      "academic_years" => $metaYears,
      "faculties" => $metaFac,           // [{id,name}]
      "study_years" => [1,2,3,4],
    ],
    "kpi" => [
      "total_usage" => $total_usage,
      "top_faculty" => $top_faculty,     // {name,count}
      "usage_rate" => $usage_rate,
      "active_users" => $active_users,
      "total_users" => $total_users,
    ],
    "by_faculty" => array_map(fn($r)=>["faculty"=>$r["faculty"],"count"=>(int)$r["cnt"]], $facultyRows),
    "by_study_year" => array_map(fn($r)=>["study_year"=>(int)$r["study_year"],"count"=>(int)$r["cnt"]], $syRows),
    "top_equipment" => array_map(fn($r)=>["name"=>$r["name"],"count"=>(int)$r["cnt"]], $eqRows),
    "peak_time" => array_map(fn($r)=>["label"=>$r["tbin"],"count"=>(int)$r["cnt"]], $peakRows),
    "daily_usage" => ["labels"=>$wdMap, "counts"=>$daily],

    // ✅ Executive insights
    "membership_summary" => $membershipSummary,
    "student_coupon_top" => $studentCouponTop,
    "payment_method_summary" => $paymentMethodSummary,
  ], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
  http_response_code(500);
  echo json_encode([
    "success" => false,
    "error" => $e->getMessage(),
  ], JSON_UNESCAPED_UNICODE);
}