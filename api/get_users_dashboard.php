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
  ], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
  http_response_code(500);
  echo json_encode([
    "success" => false,
    "error" => $e->getMessage(),
  ], JSON_UNESCAPED_UNICODE);
}