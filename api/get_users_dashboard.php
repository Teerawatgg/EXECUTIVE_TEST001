<?php
require_once __DIR__ . "/_db.php";
require_once __DIR__ . "/_helpers.php";

ini_set('display_errors','0');
ini_set('html_errors','0');
header("Content-Type: application/json; charset=utf-8");

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
$conn->set_charset("utf8mb4");

/* -------------------------
   Schema helpers
------------------------- */
function hasTable($conn, $table){
  $sql="SELECT 1 FROM information_schema.TABLES
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? LIMIT 1";
  $st=$conn->prepare($sql);
  $st->bind_param("s",$table);
  $st->execute();
  $ok=$st->get_result()->num_rows>0;
  $st->close();
  return $ok;
}
function hasColumn($conn, $table, $col){
  $sql="SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=? LIMIT 1";
  $st=$conn->prepare($sql);
  $st->bind_param("ss",$table,$col);
  $st->execute();
  $ok=$st->get_result()->num_rows>0;
  $st->close();
  return $ok;
}
function qcsv($key){
  $s=q($key,"");
  if($s==="") return [];
  return array_values(array_filter(array_map("trim", explode(",",$s))));
}
function dateWhere($col,&$types,&$vals){
  $range=q("range","all");
  $from=q("from",""); $to=q("to","");

  if($range==="custom"){
    $w=[];
    if($from!==""){ $w[]="$col>=?"; addParam($types,$vals,"s",$from." 00:00:00"); }
    if($to!==""){   $w[]="$col<=?"; addParam($types,$vals,"s",$to." 23:59:59"); }
    return count($w)?("(".implode(" AND ",$w).")"):"1=1";
  }
  if($range==="today") return "DATE($col)=CURDATE()";
  if($range==="7d")    return "$col >= (NOW()-INTERVAL 7 DAY)";
  if($range==="30d")   return "$col >= (NOW()-INTERVAL 30 DAY)";
  return "1=1";
}

try {
  /* -------------------------
     Input filters
  ------------------------- */
  $branch_id = q("branch_id","ALL");
  $region    = q("region","ALL");
  $region_id = q("region_id","");
  $academic_year = q("academic_year","ALL");
  $faculties = qcsv("faculties");
  $study_years = qcsv("study_years");

  // Business rule: paid only + not cancelled
  $needPaidOnly = true;
  $needNotCancelled = true;

  /* -------------------------
     Detect schema
  ------------------------- */
  $hasBranches = hasTable($conn,"branches") && hasColumn($conn,"bookings","branch_id");
  $hasRegionTables = hasTable($conn,"provinces") && hasTable($conn,"region");

  $hasPayStatusB = hasTable($conn,"payment_status") && hasColumn($conn,"bookings","payment_status_id");
  $hasBookStatusB = hasTable($conn,"booking_status") && hasColumn($conn,"bookings","booking_status_id");

  $hasPayments = hasTable($conn,"payments");
  $hasPayStatusP = $hasPayments && hasTable($conn,"payment_status") && hasColumn($conn,"payments","payment_status_id");
  $hasPaymentMethods = hasTable($conn,"payment_methods") && $hasPayments && hasColumn($conn,"payments","method_id");

  $hasBD = hasTable($conn,"booking_details");

  // equipment table naming (บางระบบใช้ equipment_master, บางระบบใช้ equipment)
  $hasEM = hasTable($conn,"equipment_master");
  $hasE  = hasTable($conn,"equipment");

  // review/rating
  $hasReview = hasTable($conn,"review");
  $reviewHasDetail = $hasReview && hasColumn($conn,"review","detail_id");
  $reviewHasRating = $hasReview && hasColumn($conn,"review","rating");

  /* -------------------------
     Build WHERE for bookings (alias b)
  ------------------------- */
  $types=""; $vals=[];
  $where=[];
  $where[] = dateWhere("b.pickup_time", $types, $vals);

  // academic year (พ.ศ.)
  if($academic_year!=="ALL" && $academic_year!==""){
    $where[]="(YEAR(b.pickup_time)+543)=?";
    addParam($types,$vals,"i",(int)$academic_year);
  }

  // faculty filter
  $facultyIsAllNumeric=true;
  foreach($faculties as $f){ if(!preg_match('/^\d+$/',$f)){ $facultyIsAllNumeric=false; break; } }
  if(count($faculties)){
    $ph=[];
    foreach($faculties as $f){
      $ph[]="?";
      addParam($types,$vals,$facultyIsAllNumeric?"i":"s",$facultyIsAllNumeric?(int)$f:$f);
    }
    $where[] = $facultyIsAllNumeric
      ? "cu.faculty_id IN (".implode(",",$ph).")"
      : "f.name IN (".implode(",",$ph).")";
  }

  // study year filter (จากตัวกรอง UI)
  if(count($study_years)){
    $ph=[];
    foreach($study_years as $y){ $ph[]="?"; addParam($types,$vals,"i",(int)$y); }
    $where[]="cu.study_year IN (".implode(",",$ph).")";
  }

  // region/branch filter
  if($branch_id !== "ALL" && $branch_id !== "" && hasColumn($conn,"bookings","branch_id")){
    $where[] = "b.branch_id = ?";
    addParam($types,$vals,"s",$branch_id);
  } else {
    if($hasRegionTables && $hasBranches){
      if($region_id !== "" && $region_id !== "ALL"){
        $where[] = "rg.region_id = ?";
        addParam($types,$vals,"i",(int)$region_id);
      } else if($region !== "ALL" && $region !== ""){
        $col = hasColumn($conn,"region","region_name") ? "rg.region_name" : "rg.name";
        $where[] = "$col = ?";
        addParam($types,$vals,"s",$region);
      }
    }
  }

  /* -------------------------
     JOIN blocks (ใช้ alias เดียวกันทุก query)
  ------------------------- */
  $joinRegion = "";
  if($hasRegionTables && $hasBranches){
    $joinRegion = "
      LEFT JOIN branches br ON br.branch_id = b.branch_id
      LEFT JOIN provinces pv ON pv.province_id = br.province_id
      LEFT JOIN region rg ON rg.region_id = pv.region_id
    ";
  }

  // ✅ alias ps/bs สำหรับ bookings
  $joinStatusB = "";
  if($hasPayStatusB){
    $joinStatusB .= " LEFT JOIN payment_status ps ON ps.id = b.payment_status_id ";
  }
  if($hasBookStatusB){
    $joinStatusB .= " LEFT JOIN booking_status bs ON bs.id = b.booking_status_id ";
  }

  /* -------------------------
     Paid-only + Not cancelled conditions
     ✅ ยืดหยุ่น:
       - paid = (ps.code='PAID' from bookings) OR EXISTS(payments with PAID)
       - not cancelled = bs.code not cancelled (ถ้ามี)
  ------------------------- */
  if($needNotCancelled && $hasBookStatusB){
    $where[] = "bs.code NOT IN ('CANCELLED','CANCELED')";
  }

  if($needPaidOnly){
    $paidConds = [];

    if($hasPayStatusB){
      $paidConds[] = "ps.code = 'PAID'";
    }

    if($hasPayments){
      if($hasPayStatusP){
        // payments มี status table
        $paidConds[] = "EXISTS (
          SELECT 1
          FROM payments payx
          LEFT JOIN payment_status psx ON psx.id = payx.payment_status_id
          WHERE payx.booking_id = b.booking_id
            AND psx.code = 'PAID'
        )";
      } else {
        // payments ไม่มี status -> อย่างน้อยมีแถวจ่าย
        $paidConds[] = "EXISTS (
          SELECT 1 FROM payments payx WHERE payx.booking_id = b.booking_id
        )";
      }
    }

    if(count($paidConds)){
      $where[] = "(".implode(" OR ", $paidConds).")";
    }
  }

  $whereSql = implode(" AND ", $where);

  /* -------------------------
     META (สำหรับ dropdown)
  ------------------------- */
  $metaYears=[];
  $rsY=$conn->query("SELECT DISTINCT (YEAR(pickup_time)+543) AS y
                     FROM bookings
                     WHERE pickup_time IS NOT NULL
                     ORDER BY y DESC LIMIT 20");
  while($r=$rsY->fetch_assoc()) $metaYears[]=(int)$r["y"];

  $metaFac=[];
  if(hasTable($conn,"faculty")){
    $rsF=$conn->query("SELECT id,name FROM faculty ORDER BY name ASC");
    while($r=$rsF->fetch_assoc()) $metaFac[]=["id"=>(int)$r["id"],"name"=>$r["name"]];
  }

  $metaSY=[];
  if(hasTable($conn,"customers") && hasColumn($conn,"customers","study_year")){
    $rsSY=$conn->query("SELECT DISTINCT study_year FROM customers WHERE study_year IS NOT NULL ORDER BY study_year ASC");
    while($r=$rsSY->fetch_assoc()) $metaSY[]=(int)$r["study_year"];
  }

  /* -------------------------
     KPI
  ------------------------- */
  $st=$conn->prepare("
    SELECT COUNT(*) AS total_usage,
           COUNT(DISTINCT b.customer_id) AS active_users
    FROM bookings b
    INNER JOIN customers cu ON cu.customer_id=b.customer_id
    LEFT JOIN faculty f ON f.id=cu.faculty_id
    $joinRegion
    $joinStatusB
    WHERE $whereSql
  ");
  stmtBindDynamic($st,$types,$vals);
  $st->execute();
  $kpi=fetchOne($st);
  $st->close();

  $total_usage=(int)($kpi["total_usage"]??0);
  $active_users=(int)($kpi["active_users"]??0);

  // denominator total_users (ตาม faculty/study_year filter ของลูกค้าอย่างเดียว)
  $typesU=""; $valsU=[]; $wU=["1=1"];
  if(count($faculties)){
    $ph=[];
    foreach($faculties as $f){
      $ph[]="?";
      addParam($typesU,$valsU,$facultyIsAllNumeric?"i":"s",$facultyIsAllNumeric?(int)$f:$f);
    }
    $wU[] = $facultyIsAllNumeric
      ? "faculty_id IN (".implode(",",$ph).")"
      : "faculty_id IN (SELECT id FROM faculty WHERE name IN (".implode(",",$ph)."))";
  }
  if(count($study_years)){
    $ph=[];
    foreach($study_years as $y){ $ph[]="?"; addParam($typesU,$valsU,"i",(int)$y); }
    $wU[]="study_year IN (".implode(",",$ph).")";
  }
  $st=$conn->prepare("SELECT COUNT(*) AS total_users FROM customers WHERE ".implode(" AND ",$wU));
  stmtBindDynamic($st,$typesU,$valsU);
  $st->execute();
  $den=fetchOne($st);
  $st->close();
  $total_users=(int)($den["total_users"]??0);

  $usage_rate = ($total_users>0) ? ($active_users*100.0/$total_users) : 0.0;

  /* -------------------------
     by_faculty + top_faculty
  ------------------------- */
  $st=$conn->prepare("
    SELECT f.name AS faculty, COUNT(*) AS cnt
    FROM bookings b
    INNER JOIN customers cu ON cu.customer_id=b.customer_id
    LEFT JOIN faculty f ON f.id=cu.faculty_id
    $joinRegion
    $joinStatusB
    WHERE $whereSql
      AND f.name IS NOT NULL AND TRIM(f.name)<>'' 
    GROUP BY f.name
    ORDER BY cnt DESC
  ");
  stmtBindDynamic($st,$types,$vals);
  $st->execute();
  $byFaculty=fetchAll($st);
  $st->close();

  $top_faculty=["name"=>"-","count"=>0];
  if(count($byFaculty)){
    $top_faculty=["name"=>$byFaculty[0]["faculty"]??"-","count"=>(int)($byFaculty[0]["cnt"]??0)];
  }

  /* -------------------------
     by_study_year
  ------------------------- */
  $st=$conn->prepare("
    SELECT cu.study_year AS study_year, COUNT(*) AS cnt
    FROM bookings b
    INNER JOIN customers cu ON cu.customer_id=b.customer_id
    LEFT JOIN faculty f ON f.id=cu.faculty_id
    $joinRegion
    $joinStatusB
    WHERE $whereSql
      AND cu.study_year IS NOT NULL
    GROUP BY cu.study_year
    ORDER BY cu.study_year ASC
  ");
  stmtBindDynamic($st,$types,$vals);
  $st->execute();
  $bySY=fetchAll($st);
  $st->close();

  /* -------------------------
     member_tier_summary (ใช้ customers.member_level ของคุณ)
  ------------------------- */
  $tierExpr = hasColumn($conn,"customers","member_level")
    ? "COALESCE(NULLIF(TRIM(cu.member_level),''),'ไม่ระบุ')"
    : "'ไม่ระบุ'";

  $hasNet   = hasColumn($conn,"bookings","net_amount");
  $hasTotal = hasColumn($conn,"bookings","total_amount");
  $hasDisc  = hasColumn($conn,"bookings","discount_amount");
  $hasPen   = hasColumn($conn,"bookings","penalty_fee");
  $hasExtra = hasColumn($conn,"bookings","extra_hour_fee");

  if($hasNet){
    $amountExpr="COALESCE(b.net_amount,0)";
  } else if($hasTotal){
    $amountExpr="COALESCE(b.total_amount,0)"
      .($hasDisc?"-COALESCE(b.discount_amount,0)":"")
      .($hasPen?"+COALESCE(b.penalty_fee,0)":"")
      .($hasExtra?"+COALESCE(b.extra_hour_fee,0)":"");
  } else {
    $amountExpr="0";
  }

  $st=$conn->prepare("
    SELECT $tierExpr AS tier_name,
           COUNT(*) AS total_bookings,
           SUM($amountExpr) AS total_spent
    FROM bookings b
    INNER JOIN customers cu ON cu.customer_id=b.customer_id
    LEFT JOIN faculty f ON f.id=cu.faculty_id
    $joinRegion
    $joinStatusB
    WHERE $whereSql
    GROUP BY tier_name
    ORDER BY total_spent DESC, total_bookings DESC
  ");
  stmtBindDynamic($st,$types,$vals);
  $st->execute();
  $tierRows=fetchAll($st);
  $st->close();

  $member_tier_summary = array_map(fn($r)=>[
    "tier_name"=>$r["tier_name"] ?? "ไม่ระบุ",
    "total_bookings"=>(int)($r["total_bookings"] ?? 0),
    "total_spent"=>(float)($r["total_spent"] ?? 0),
  ], $tierRows);

  /* -------------------------
     Student condition (ตรง DB คุณ)
     - ใช้ customer_type='student' เป็นหลัก
     - fallback: มี study_year > 0
  ------------------------- */
  $studentCondParts = [];
  if (hasColumn($conn,"customers","customer_type")){
    $studentCondParts[] = "(LOWER(TRIM(cu.customer_type)) IN ('student','นักศึกษา'))";
  }
  if (hasColumn($conn,"customers","study_year")){
    $studentCondParts[] = "(cu.study_year IS NOT NULL AND cu.study_year <> 0)";
  }
  $studentCond = count($studentCondParts) ? "(".implode(" OR ",$studentCondParts).")" : "0=1";

  /* -------------------------
     Equipment joins (รองรับ equipment_master หรือ equipment)
  ------------------------- */
  $equipJoin = "";
  $equipName = "";
  if($hasEM){
    $equipJoin = "LEFT JOIN equipment_master em ON em.equipment_id = d.equipment_id";
    $equipName = "em.name";
  } else if($hasE){
    $equipJoin = "LEFT JOIN equipment em ON em.equipment_id = d.equipment_id";
    $equipName = hasColumn($conn,"equipment","equipment_name") ? "em.equipment_name" : "em.name";
  }

  /* -------------------------
     top_equipment + student_top_equipment
  ------------------------- */
  $top_equipment = [];
  $student_top_equipment = [];

  if($hasBD && $equipJoin !== "" && $equipName !== ""){
    // overall top 5
    $st=$conn->prepare("
      SELECT $equipName AS name, COALESCE(SUM(d.quantity),0) AS cnt
      FROM booking_details d
      INNER JOIN bookings b ON b.booking_id = d.booking_id
      INNER JOIN customers cu ON cu.customer_id=b.customer_id
      LEFT JOIN faculty f ON f.id=cu.faculty_id
      $joinRegion
      $joinStatusB
      $equipJoin
      WHERE $whereSql
        AND $equipName IS NOT NULL AND TRIM($equipName)<>'' 
      GROUP BY $equipName
      ORDER BY cnt DESC
      LIMIT 5
    ");
    stmtBindDynamic($st,$types,$vals);
    $st->execute();
    $rows=fetchAll($st);
    $st->close();
    $top_equipment = array_map(fn($r)=>["name"=>$r["name"],"count"=>(int)$r["cnt"]], $rows);

    // student top 5 ✅
    $st=$conn->prepare("
      SELECT $equipName AS name, COALESCE(SUM(d.quantity),0) AS cnt
      FROM booking_details d
      INNER JOIN bookings b ON b.booking_id = d.booking_id
      INNER JOIN customers cu ON cu.customer_id=b.customer_id
      LEFT JOIN faculty f ON f.id=cu.faculty_id
      $joinRegion
      $joinStatusB
      $equipJoin
      WHERE $whereSql
        AND $studentCond
        AND $equipName IS NOT NULL AND TRIM($equipName)<>'' 
      GROUP BY $equipName
      ORDER BY cnt DESC
      LIMIT 5
    ");
    stmtBindDynamic($st,$types,$vals);
    $st->execute();
    $rows=fetchAll($st);
    $st->close();
    $student_top_equipment = array_map(fn($r)=>["name"=>$r["name"],"count"=>(int)$r["cnt"]], $rows);
  }

  /* -------------------------
     Peak time + Daily usage
  ------------------------- */
  $st=$conn->prepare("
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
    INNER JOIN customers cu ON cu.customer_id=b.customer_id
    LEFT JOIN faculty f ON f.id=cu.faculty_id
    $joinRegion
    $joinStatusB
    WHERE $whereSql
    GROUP BY tbin
    ORDER BY FIELD(tbin,'08:00-10:00','10:00-12:00','12:00-14:00','14:00-16:00','16:00-18:00','18:00-20:00','อื่นๆ')
  ");
  stmtBindDynamic($st,$types,$vals);
  $st->execute();
  $peakRows=fetchAll($st);
  $st->close();

  $peak_time = array_map(fn($r)=>["label"=>$r["tbin"],"count"=>(int)$r["cnt"]], $peakRows);

  $st=$conn->prepare("
    SELECT WEEKDAY(b.pickup_time) AS wd, COUNT(*) AS cnt
    FROM bookings b
    INNER JOIN customers cu ON cu.customer_id=b.customer_id
    LEFT JOIN faculty f ON f.id=cu.faculty_id
    $joinRegion
    $joinStatusB
    WHERE $whereSql
    GROUP BY WEEKDAY(b.pickup_time)
    ORDER BY wd ASC
  ");
  stmtBindDynamic($st,$types,$vals);
  $st->execute();
  $dailyRows=fetchAll($st);
  $st->close();

  $wdMap=["จ.","อ.","พ.","พฤ.","ศ.","ส.","อา."];
  $dailyCounts=array_fill(0,7,0);
  foreach($dailyRows as $r){
    $i=(int)$r["wd"];
    if($i>=0 && $i<=6) $dailyCounts[$i]=(int)$r["cnt"];
  }
  $daily_usage=["labels"=>$wdMap,"counts"=>$dailyCounts];

  /* -------------------------
     payment_method_summary
     - ใช้ paid/not-cancelled ผ่าน $whereSql (bookings)
     - และ payments ก็กรอง PAID/REFUNDED (ถ้ามี)
  ------------------------- */
  $payment_method_summary = [];

  if($hasPaymentMethods){
    $aCol = hasColumn($conn,"payments","amount") ? "pay.amount"
          : (hasColumn($conn,"payments","net_amount") ? "pay.net_amount" : "0");
    $refundCol = hasColumn($conn,"payments","refund_amount") ? "COALESCE(pay.refund_amount,0)" : "0";
    $netExpr = "COALESCE($aCol,0) - $refundCol";
    $pmNameExpr = "COALESCE(NULLIF(TRIM(pm.name_th),''), NULLIF(TRIM(pm.name_en),''), 'ไม่ระบุช่องทาง')";

    $joinPS2 = ($hasPayStatusP ? "LEFT JOIN payment_status ps2 ON ps2.id = pay.payment_status_id" : "");
    $wherePS2 = ($hasPayStatusP ? "AND ps2.code IN ('PAID','REFUNDED')" : "");

    $st=$conn->prepare("
      SELECT
        pm.code AS method_code,
        $pmNameExpr AS method_name,
        COUNT(*) AS tx_count,
        COALESCE(SUM($netExpr),0) AS net_amount
      FROM payments pay
      INNER JOIN bookings b ON b.booking_id = pay.booking_id
      INNER JOIN customers cu ON cu.customer_id=b.customer_id
      LEFT JOIN faculty f ON f.id=cu.faculty_id
      $joinRegion
      $joinStatusB
      $joinPS2
      LEFT JOIN payment_methods pm ON pm.method_id = pay.method_id
      WHERE $whereSql
        $wherePS2
      GROUP BY pm.code, method_name
      ORDER BY net_amount DESC, tx_count DESC
    ");
    stmtBindDynamic($st,$types,$vals);
    $st->execute();
    $rows=fetchAll($st);
    $st->close();

    $payment_method_summary = array_map(fn($r)=>[
      "method_code"=>$r["method_code"] ?? null,
      "method_name"=>$r["method_name"] ?? "ไม่ระบุช่องทาง",
      "tx_count"=>(int)($r["tx_count"] ?? 0),
      "net_amount"=>(float)($r["net_amount"] ?? 0),
    ], $rows);
  }

  /* -------------------------
     equipment_ratings
     - review.detail_id -> booking_details.detail_id
  ------------------------- */
  $equipment_ratings = [
    "total_reviews" => 0,
    "avg_rating_overall" => 0.0,
    "items" => []
  ];

  if($reviewHasDetail && $reviewHasRating && $hasBD && $equipJoin !== "" && $equipName !== ""){
    // total reviews (ตาม filters + paid/not-cancelled จาก bookings)
    $st=$conn->prepare("
      SELECT COUNT(*) AS c, AVG(r.rating) AS a
      FROM review r
      INNER JOIN booking_details d ON d.detail_id = r.detail_id
      INNER JOIN bookings b ON b.booking_id = d.booking_id
      INNER JOIN customers cu ON cu.customer_id=b.customer_id
      LEFT JOIN faculty f ON f.id=cu.faculty_id
      $joinRegion
      $joinStatusB
      WHERE $whereSql
    ");
    stmtBindDynamic($st,$types,$vals);
    $st->execute();
    $sum=fetchOne($st);
    $st->close();

    $totalReviews = (int)($sum["c"] ?? 0);
    $avgOverall = (float)($sum["a"] ?? 0);

    $items = [];
    if($totalReviews > 0){
      $st=$conn->prepare("
        SELECT
          $equipName AS equipment_name,
          COUNT(*) AS review_count,
          AVG(r.rating) AS avg_rating
        FROM review r
        INNER JOIN booking_details d ON d.detail_id = r.detail_id
        INNER JOIN bookings b ON b.booking_id = d.booking_id
        INNER JOIN customers cu ON cu.customer_id=b.customer_id
        LEFT JOIN faculty f ON f.id=cu.faculty_id
        $joinRegion
        $joinStatusB
        $equipJoin
        WHERE $whereSql
          AND $equipName IS NOT NULL AND TRIM($equipName)<>'' 
        GROUP BY $equipName
        ORDER BY review_count DESC, avg_rating DESC
        LIMIT 10
      ");
      stmtBindDynamic($st,$types,$vals);
      $st->execute();
      $rows=fetchAll($st);
      $st->close();

      foreach($rows as $r){
        $c = (int)$r["review_count"];
        $pct = ($totalReviews>0) ? round($c*100.0/$totalReviews, 1) : 0.0;
        $items[] = [
          "equipment_name" => $r["equipment_name"],
          "review_count" => $c,
          "avg_rating" => round((float)$r["avg_rating"], 2),
          "percent" => $pct
        ];
      }
    }

    $equipment_ratings = [
      "total_reviews" => $totalReviews,
      "avg_rating_overall" => round($avgOverall, 2),
      "items" => $items
    ];
  }

  echo json_encode([
    "success"=>true,
    "meta"=>[
      "academic_years"=>$metaYears,
      "faculties"=>$metaFac,
      "study_years"=>$metaSY,
    ],
    "kpi"=>[
      "total_usage"=>$total_usage,
      "top_faculty"=>$top_faculty,
      "usage_rate"=>$usage_rate,
      "active_users"=>$active_users,
      "total_users"=>$total_users,
    ],
    "by_faculty"=>array_map(fn($r)=>["faculty"=>$r["faculty"],"count"=>(int)$r["cnt"]],$byFaculty),
    "by_study_year"=>array_map(fn($r)=>["study_year"=>(int)$r["study_year"],"count"=>(int)$r["cnt"]],$bySY),

    "top_equipment"=>$top_equipment,
    "student_top_equipment"=>$student_top_equipment,

    "peak_time"=>$peak_time,
    "daily_usage"=>$daily_usage,

    "member_tier_summary"=>$member_tier_summary,
    "payment_method_summary"=>$payment_method_summary,

    "equipment_ratings"=>$equipment_ratings
  ], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e){
  http_response_code(500);
  echo json_encode(["success"=>false,"error"=>$e->getMessage()], JSON_UNESCAPED_UNICODE);
}