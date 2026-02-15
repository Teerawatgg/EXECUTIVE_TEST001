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
  $range = q("range", "all");    // all | today | 7d | 30d | custom
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
  return "(UPPER(cu.customer_type) = 'STUDENT' OR LOWER(cu.customer_type) = 'student' OR cu.customer_type LIKE '%นักศึกษา%')";
}

try {
  $types = ""; $vals = [];
  $where = [];

  // ===== Filters =====
  $where[] = dateWhereUsersSQL("b.pickup_time", $types, $vals);

  $branch_id = q("branch_id", "ALL");
  if ($branch_id !== "ALL" && $branch_id !== "") {
    $where[] = "b.branch_id = ?";
    addParam($types, $vals, "s", $branch_id);
  }

  // region รองรับทั้ง region_id หรือ region_name
  $region = q("region", "ALL");       // อาจเป็นชื่อ เช่น "ภาคเหนือ"
  $region_id = q("region_id", "");    // อาจเป็นเลข เช่น 1
  if (($region !== "ALL" && $region !== "") || $region_id !== "") {
    if ($region_id !== "" && preg_match('/^\d+$/', $region_id)) {
      $where[] = "rg.region_id = ?";
      addParam($types, $vals, "i", (int)$region_id);
    } else if ($region !== "" && $region !== "ALL") {
      // ถ้าส่งมาเป็นตัวเลขก็จับเป็น region_id ให้
      if (preg_match('/^\d+$/', $region)) {
        $where[] = "rg.region_id = ?";
        addParam($types, $vals, "i", (int)$region);
      } else {
        $where[] = "rg.region_name = ?";
        addParam($types, $vals, "s", $region);
      }
    }
  }

  $academic_year = q("academic_year", "ALL");
  if ($academic_year !== "ALL" && $academic_year !== "") {
    $where[] = "(YEAR(b.pickup_time) + 543) = ?";
    addParam($types, $vals, "i", (int)$academic_year);
  }

  $faculties = qcsv("faculties"); // ส่งเป็น id หรือชื่อก็ได้
  $facultyIsAllNumeric = true;
  foreach ($faculties as $f) {
    if (!preg_match('/^\d+$/', $f)) { $facultyIsAllNumeric = false; break; }
  }
  if (count($faculties)) {
    $ph = [];
    foreach ($faculties as $f) {
      $ph[] = "?";
      addParam($types, $vals, $facultyIsAllNumeric ? "i" : "s", $facultyIsAllNumeric ? (int)$f : $f);
    }
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

  // base joins ให้ region filter ใช้ได้ทุก query
  $baseJoin = "
    FROM bookings b
    INNER JOIN customers cu ON cu.customer_id = b.customer_id
    LEFT JOIN faculty f ON f.id = cu.faculty_id
    LEFT JOIN branches br ON br.branch_id = b.branch_id
    LEFT JOIN provinces pv ON pv.province_id = br.province_id
    LEFT JOIN region rg ON rg.region_id = pv.region_id
  ";

  // ===== META =====
  $metaYears = [];
  $rsY = $conn->query("
    SELECT DISTINCT (YEAR(pickup_time)+543) AS y
    FROM bookings
    WHERE pickup_time IS NOT NULL
    ORDER BY y DESC
    LIMIT 20
  ");
  while ($r = $rsY->fetch_assoc()) $metaYears[] = (int)$r["y"];

  $metaFac = [];
  $rsF = $conn->query("SELECT id, name FROM faculty ORDER BY name ASC");
  while ($r = $rsF->fetch_assoc()) $metaFac[] = ["id" => (int)$r["id"], "name" => $r["name"]];

  $metaSY = [];
  $rsSY = $conn->query("SELECT DISTINCT study_year FROM customers WHERE study_year IS NOT NULL ORDER BY study_year ASC");
  while ($r = $rsSY->fetch_assoc()) $metaSY[] = (int)$r["study_year"];

  // ===== KPI =====
  $sqlKpi = "
    SELECT
      COUNT(*) AS total_usage,
      COUNT(DISTINCT b.customer_id) AS active_users
    $baseJoin
    WHERE $whereSql
  ";
  $st = $conn->prepare($sqlKpi);
  stmtBindDynamic($st, $types, $vals);
  $st->execute();
  $k1 = fetchOne($st);
  $st->close();

  $total_usage  = (int)($k1["total_usage"] ?? 0);
  $active_users = (int)($k1["active_users"] ?? 0);

  // total_users (ตาม filter คณะ/ชั้นปี แต่ไม่ผูกเวลา)
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

  // ===== Charts: by_faculty / by_study_year =====
  $sqlFaculty = "
    SELECT f.name AS faculty, COUNT(*) AS cnt
    $baseJoin
    WHERE $whereSql
      AND f.name IS NOT NULL AND TRIM(f.name) <> ''
    GROUP BY f.name
    ORDER BY cnt DESC
  ";
  $st = $conn->prepare($sqlFaculty);
  stmtBindDynamic($st, $types, $vals);
  $st->execute();
  $facultyRows = fetchAll($st);
  $st->close();

  $top_faculty = ["name"=>"-","count"=>0];
  if (count($facultyRows)) {
    $top_faculty["name"]  = $facultyRows[0]["faculty"] ?? "-";
    $top_faculty["count"] = (int)($facultyRows[0]["cnt"] ?? 0);
  }

  $sqlSY = "
    SELECT cu.study_year AS study_year, COUNT(*) AS cnt
    $baseJoin
    WHERE $whereSql
      AND cu.study_year IS NOT NULL
    GROUP BY cu.study_year
    ORDER BY cu.study_year ASC
  ";
  $st = $conn->prepare($sqlSY);
  stmtBindDynamic($st, $types, $vals);
  $st->execute();
  $syRows = fetchAll($st);
  $st->close();

  // ===== Top Equipment =====
  $sqlEq = "
    SELECT em.name AS name, COALESCE(SUM(d.quantity),0) AS cnt
    FROM booking_details d
    INNER JOIN bookings b ON b.booking_id = d.booking_id
    INNER JOIN customers cu ON cu.customer_id = b.customer_id
    LEFT JOIN faculty f ON f.id = cu.faculty_id
    LEFT JOIN branches br ON br.branch_id = b.branch_id
    LEFT JOIN provinces pv ON pv.province_id = br.province_id
    LEFT JOIN region rg ON rg.region_id = pv.region_id
    INNER JOIN equipment_master em ON em.equipment_id = d.equipment_id
    WHERE $whereSql
      AND (d.item_type = 'Equipment' OR d.item_type = 'EQUIPMENT')
    GROUP BY em.name
    ORDER BY cnt DESC
    LIMIT 5
  ";
  $st = $conn->prepare($sqlEq);
  stmtBindDynamic($st, $types, $vals);
  $st->execute();
  $eqRows = fetchAll($st);
  $st->close();

  // ===== Peak Time =====
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
    $baseJoin
    WHERE $whereSql
    GROUP BY tbin
    ORDER BY FIELD(tbin,'08:00-10:00','10:00-12:00','12:00-14:00','14:00-16:00','16:00-18:00','18:00-20:00','อื่นๆ')
  ";
  $st = $conn->prepare($sqlPeak);
  stmtBindDynamic($st, $types, $vals);
  $st->execute();
  $peakRows = fetchAll($st);
  $st->close();

  // ===== Daily Usage =====
  $sqlDaily = "
    SELECT WEEKDAY(b.pickup_time) AS wd, COUNT(*) AS cnt
    $baseJoin
    WHERE $whereSql
    GROUP BY WEEKDAY(b.pickup_time)
    ORDER BY wd ASC
  ";
  $st = $conn->prepare($sqlDaily);
  stmtBindDynamic($st, $types, $vals);
  $st->execute();
  $dailyRows = fetchAll($st);
  $st->close();

  $wdMap = ["จ.","อ.","พ.","พฤ.","ศ.","ส.","อา."];
  $daily = array_fill(0, 7, 0);
  foreach ($dailyRows as $r) {
    $i = (int)$r["wd"];
    if ($i >= 0 && $i <= 6) $daily[$i] = (int)$r["cnt"];
  }

  // =========================================================
  // Executive insights that your UI needs
  // =========================================================

  // 1) Member tier summary (ใช้ customers.member_level)
  $membershipSummary = [];
  if (hasColumn($conn, 'customers', 'member_level')) {
    $sqlMem = "
      SELECT
        COALESCE(NULLIF(TRIM(cu.member_level),''),'ไม่ระบุ') AS tier,
        COUNT(*) AS bookings,
        COALESCE(SUM(b.net_amount),0) AS spend
      $baseJoin
      WHERE $whereSql
      GROUP BY tier
      ORDER BY spend DESC, bookings DESC
    ";
    $st = $conn->prepare($sqlMem);
    stmtBindDynamic($st, $types, $vals);
    $st->execute();
    $rows = fetchAll($st);
    $st->close();

    $membershipSummary = array_map(fn($r)=>[
      "tier" => $r["tier"],
      "bookings" => (int)($r["bookings"] ?? 0),
      "spend" => (float)($r["spend"] ?? 0),
    ], $rows);
  }

  // 2) Student coupon top (ใช้ bookings.coupon_code + bookings.discount_amount)
  $studentCouponTop = [];
  if (hasColumn($conn,'bookings','coupon_code') && hasColumn($conn,'bookings','discount_amount') && hasTable($conn,'coupons')) {
    $sqlCup = "
      SELECT
        b.coupon_code AS coupon_code,
        c.name AS coupon_name,
        COUNT(*) AS cnt,
        COALESCE(SUM(COALESCE(b.discount_amount,0)),0) AS discount_total
      $baseJoin
      LEFT JOIN coupons c ON c.code = b.coupon_code
      WHERE $whereSql
        AND " . studentWhereSQL() . "
        AND b.coupon_code IS NOT NULL AND TRIM(b.coupon_code) <> ''
      GROUP BY b.coupon_code, c.name
      ORDER BY cnt DESC
      LIMIT 5
    ";
    $st = $conn->prepare($sqlCup);
    stmtBindDynamic($st, $types, $vals);
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

  // 3) Payment method summary (ใช้ payments.amount)
  $paymentMethodSummary = [];
  if (hasTable($conn,'payments') && hasTable($conn,'payment_methods') && hasTable($conn,'payment_status')) {
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
      LEFT JOIN branches br ON br.branch_id = b.branch_id
      LEFT JOIN provinces pv ON pv.province_id = br.province_id
      LEFT JOIN region rg ON rg.region_id = pv.region_id
      WHERE $whereSql
        AND ps.code IN ('PAID','REFUNDED')
      GROUP BY pm.code, pm.name_th, pm.name_en
      ORDER BY amount DESC
    ";
    $st = $conn->prepare($sqlPay);
    stmtBindDynamic($st, $types, $vals);
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

  // 4) Review summary (ตาราง review ของคุณมี)
  $reviewSummary = ["total_reviews"=>0,"avg_rating"=>0,"recent_reviews"=>[]];
  if (hasTable($conn,'review')) {
    $sqlR = "
      SELECT
        COUNT(*) AS total_reviews,
        COALESCE(AVG(r.rating),0) AS avg_rating
      FROM review r
      JOIN bookings b ON b.booking_id = r.booking_id
      INNER JOIN customers cu ON cu.customer_id = b.customer_id
      LEFT JOIN faculty f ON f.id = cu.faculty_id
      LEFT JOIN branches br ON br.branch_id = b.branch_id
      LEFT JOIN provinces pv ON pv.province_id = br.province_id
      LEFT JOIN region rg ON rg.region_id = pv.region_id
      WHERE $whereSql
    ";
    $st = $conn->prepare($sqlR);
    stmtBindDynamic($st, $types, $vals);
    $st->execute();
    $row = fetchOne($st);
    $st->close();

    $sqlRecent = "
      SELECT r.review_date, r.review_text, r.rating
      FROM review r
      JOIN bookings b ON b.booking_id = r.booking_id
      INNER JOIN customers cu ON cu.customer_id = b.customer_id
      LEFT JOIN faculty f ON f.id = cu.faculty_id
      LEFT JOIN branches br ON br.branch_id = b.branch_id
      LEFT JOIN provinces pv ON pv.province_id = br.province_id
      LEFT JOIN region rg ON rg.region_id = pv.region_id
      WHERE $whereSql
      ORDER BY r.review_date DESC
      LIMIT 5
    ";
    $st = $conn->prepare($sqlRecent);
    stmtBindDynamic($st, $types, $vals);
    $st->execute();
    $recent = fetchAll($st);
    $st->close();

    $reviewSummary = [
      "total_reviews" => (int)($row["total_reviews"] ?? 0),
      "avg_rating" => (float)($row["avg_rating"] ?? 0),
      "recent_reviews" => array_map(fn($r)=>[
        "date" => $r["review_date"],
        "text" => $r["review_text"],
        "rating" => (float)$r["rating"],
      ], $recent),
    ];
  }

  // ===== ส่ง response (มี alias key ให้ JS ไม่พัง) =====
  echo json_encode([
    "success" => true,
    "meta" => [
      "academic_years" => $metaYears,
      "faculties" => $metaFac,
      "study_years" => $metaSY,
    ],
    "kpi" => [
      "total_usage" => $total_usage,
      "top_faculty" => $top_faculty,
      "usage_rate" => $usage_rate,
      "active_users" => $active_users,
      "total_users" => $total_users,
    ],
    "by_faculty" => array_map(fn($r)=>["faculty"=>$r["faculty"],"count"=>(int)$r["cnt"]], $facultyRows),
    "by_study_year" => array_map(fn($r)=>["study_year"=>(int)$r["study_year"],"count"=>(int)$r["cnt"]], $syRows),
    "top_equipment" => array_map(fn($r)=>["name"=>$r["name"],"count"=>(int)$r["cnt"]], $eqRows),
    "peak_time" => array_map(fn($r)=>["label"=>$r["tbin"],"count"=>(int)$r["cnt"]], $peakRows),
    "daily_usage" => ["labels"=>$wdMap, "counts"=>$daily],

    // ✅ keys ใหม่
    "membership_summary" => $membershipSummary,
    "student_coupon_top" => $studentCouponTop,
    "payment_method_summary" => $paymentMethodSummary,
    "review_summary" => $reviewSummary,

    // ✅ alias keys (เพื่อให้ users.js เก่าอ่านได้)
    "memberships_summary" => $membershipSummary,
    "member_tier_summary" => $membershipSummary,
    "member_tier_summary_table" => $membershipSummary,
    "member_tier_summary_legacy" => $membershipSummary,
    "member_tier_summary_v2" => $membershipSummary,
    "member_tier_summary_v3" => $membershipSummary,
    "member_tier_summary_v4" => $membershipSummary,
    "member_tier_summary_v5" => $membershipSummary,
    "member_tier_summary_v6" => $membershipSummary,
    "member_tier_summary_v7" => $membershipSummary,
    "member_tier_summary_v8" => $membershipSummary,
    "member_tier_summary_v9" => $membershipSummary,
    "member_tier_summary_v10" => $membershipSummary,

    // สำคัญ: alias ชื่อที่คุณเคยมีใน JSON รูปก่อนหน้า
    "member_tier_summary" => $membershipSummary,
    "memberships_summary" => $membershipSummary,
  ], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
  http_response_code(500);
  echo json_encode([
    "success" => false,
    "error" => $e->getMessage(),
  ], JSON_UNESCAPED_UNICODE);
}