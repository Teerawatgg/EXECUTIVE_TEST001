<?php
require_once __DIR__ . "/_db.php";
require_once __DIR__ . "/_helpers.php";

ini_set('display_errors','0');
ini_set('html_errors','0');
header("Content-Type: application/json; charset=utf-8");

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
$conn->set_charset("utf8mb4");

function hasTable($conn, $table){
  $sql="SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? LIMIT 1";
  $st=$conn->prepare($sql); $st->bind_param("s",$table); $st->execute();
  $ok=$st->get_result()->num_rows>0; $st->close(); return $ok;
}
function hasColumn($conn, $table, $col){
  $sql="SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=? LIMIT 1";
  $st=$conn->prepare($sql); $st->bind_param("ss",$table,$col); $st->execute();
  $ok=$st->get_result()->num_rows>0; $st->close(); return $ok;
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

try{
  $types=""; $vals=[];
  $where=[];
  $where[] = dateWhere("b.pickup_time",$types,$vals);

  // ฟิลเตอร์ปีการศึกษา
  $academic_year=q("academic_year","ALL");
  if($academic_year!=="ALL" && $academic_year!==""){
    $where[]="(YEAR(b.pickup_time)+543)=?";
    addParam($types,$vals,"i",(int)$academic_year);
  }

  // ฟิลเตอร์คณะ (id หรือชื่อ)
  $faculties=qcsv("faculties");
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

  // ฟิลเตอร์ชั้นปี
  $study_years=qcsv("study_years");
  if(count($study_years)){
    $ph=[];
    foreach($study_years as $y){ $ph[]="?"; addParam($types,$vals,"i",(int)$y); }
    $where[]="cu.study_year IN (".implode(",",$ph).")";
  }

  $whereSql = implode(" AND ",$where);

  // META
  $metaYears=[];
  $rsY=$conn->query("SELECT DISTINCT (YEAR(pickup_time)+543) AS y FROM bookings WHERE pickup_time IS NOT NULL ORDER BY y DESC LIMIT 20");
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

  // KPI
  $sqlKpi="
    SELECT COUNT(*) AS total_usage, COUNT(DISTINCT b.customer_id) AS active_users
    FROM bookings b
    INNER JOIN customers cu ON cu.customer_id=b.customer_id
    LEFT JOIN faculty f ON f.id=cu.faculty_id
    WHERE $whereSql
  ";
  $st=$conn->prepare($sqlKpi);
  stmtBindDynamic($st,$types,$vals);
  $st->execute(); $k1=fetchOne($st); $st->close();

  $total_usage=(int)($k1["total_usage"]??0);
  $active_users=(int)($k1["active_users"]??0);

  // denominator total_users (คณะ/ชั้นปี)
  $typesU=""; $valsU=[]; $wU=["1=1"];
  if(count($faculties)){
    $ph=[];
    foreach($faculties as $f){ $ph[]="?"; addParam($typesU,$valsU,$facultyIsAllNumeric?"i":"s",$facultyIsAllNumeric?(int)$f:$f); }
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
  $st->execute(); $den=fetchOne($st); $st->close();
  $total_users=(int)($den["total_users"]??0);
  $usage_rate = ($total_users>0) ? ($active_users*100.0/$total_users) : 0.0;

  // by_faculty
  $st=$conn->prepare("
    SELECT f.name AS faculty, COUNT(*) AS cnt
    FROM bookings b
    INNER JOIN customers cu ON cu.customer_id=b.customer_id
    LEFT JOIN faculty f ON f.id=cu.faculty_id
    WHERE $whereSql AND f.name IS NOT NULL AND TRIM(f.name)<>'' 
    GROUP BY f.name ORDER BY cnt DESC
  ");
  stmtBindDynamic($st,$types,$vals);
  $st->execute(); $facultyRows=fetchAll($st); $st->close();
  $top_faculty=["name"=>"-","count"=>0];
  if(count($facultyRows)){ $top_faculty=["name"=>$facultyRows[0]["faculty"]??"-","count"=>(int)($facultyRows[0]["cnt"]??0)]; }

  // by_study_year
  $st=$conn->prepare("
    SELECT cu.study_year AS study_year, COUNT(*) AS cnt
    FROM bookings b
    INNER JOIN customers cu ON cu.customer_id=b.customer_id
    LEFT JOIN faculty f ON f.id=cu.faculty_id
    WHERE $whereSql AND cu.study_year IS NOT NULL
    GROUP BY cu.study_year ORDER BY cu.study_year ASC
  ");
  stmtBindDynamic($st,$types,$vals);
  $st->execute(); $syRows=fetchAll($st); $st->close();

  // top_equipment (ตัด item_type ทิ้ง กันค่าจริงไม่ตรง)
  $eqRows=[];
  if(hasTable($conn,"booking_details") && hasTable($conn,"equipment_master")){
    $st=$conn->prepare("
      SELECT em.name AS name, COALESCE(SUM(d.quantity),0) AS cnt
      FROM booking_details d
      INNER JOIN bookings b ON b.booking_id=d.booking_id
      INNER JOIN customers cu ON cu.customer_id=b.customer_id
      LEFT JOIN faculty f ON f.id=cu.faculty_id
      LEFT JOIN equipment_master em ON em.equipment_id=d.equipment_id
      WHERE $whereSql AND em.name IS NOT NULL AND TRIM(em.name)<>'' 
      GROUP BY em.name
      ORDER BY cnt DESC
      LIMIT 5
    ");
    stmtBindDynamic($st,$types,$vals);
    $st->execute(); $eqRows=fetchAll($st); $st->close();
  }

  // peak_time
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
    WHERE $whereSql
    GROUP BY tbin
    ORDER BY FIELD(tbin,'08:00-10:00','10:00-12:00','12:00-14:00','14:00-16:00','16:00-18:00','18:00-20:00','อื่นๆ')
  ");
  stmtBindDynamic($st,$types,$vals);
  $st->execute(); $peakRows=fetchAll($st); $st->close();

  // daily
  $st=$conn->prepare("
    SELECT WEEKDAY(b.pickup_time) AS wd, COUNT(*) AS cnt
    FROM bookings b
    INNER JOIN customers cu ON cu.customer_id=b.customer_id
    LEFT JOIN faculty f ON f.id=cu.faculty_id
    WHERE $whereSql
    GROUP BY WEEKDAY(b.pickup_time)
    ORDER BY wd ASC
  ");
  stmtBindDynamic($st,$types,$vals);
  $st->execute(); $dailyRows=fetchAll($st); $st->close();

  $wdMap=["จ.","อ.","พ.","พฤ.","ศ.","ส.","อา."];
  $daily=array_fill(0,7,0);
  foreach($dailyRows as $r){ $i=(int)$r["wd"]; if($i>=0 && $i<=6) $daily[$i]=(int)$r["cnt"]; }

  // ===== member_tier_summary =====
  $tierCols=[];
  foreach(["membership_level","membership_tier","member_level","tier","level"] as $c){
    if(hasColumn($conn,"customers",$c)) $tierCols[]="NULLIF(TRIM(cu.$c),'')";
  }
  $tierExpr = count($tierCols) ? "COALESCE(".implode(",",$tierCols).",'ไม่ระบุ')" : "'ไม่ระบุ'";

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
    SELECT $tierExpr AS tier_name, COUNT(*) AS total_bookings, SUM($amountExpr) AS total_spent
    FROM bookings b
    INNER JOIN customers cu ON cu.customer_id=b.customer_id
    LEFT JOIN faculty f ON f.id=cu.faculty_id
    WHERE $whereSql
    GROUP BY tier_name
    ORDER BY total_spent DESC, total_bookings DESC
  ");
  stmtBindDynamic($st,$types,$vals);
  $st->execute(); $tierRows=fetchAll($st); $st->close();

  // ===== student_coupon_top ===== (นิยามนักศึกษา: มี study_year)
  $studentCouponTop=[];
  if(hasColumn($conn,"bookings","coupon_code")){
    $st=$conn->prepare("
      SELECT b.coupon_code AS coupon_code, COUNT(*) AS cnt
      FROM bookings b
      INNER JOIN customers cu ON cu.customer_id=b.customer_id
      LEFT JOIN faculty f ON f.id=cu.faculty_id
      WHERE $whereSql
        AND cu.study_year IS NOT NULL
        AND b.coupon_code IS NOT NULL AND TRIM(b.coupon_code)<>'' 
      GROUP BY b.coupon_code
      ORDER BY cnt DESC
      LIMIT 5
    ");
    stmtBindDynamic($st,$types,$vals);
    $st->execute(); $rows=fetchAll($st); $st->close();
    $studentCouponTop = array_map(fn($r)=>["coupon_code"=>$r["coupon_code"],"count"=>(int)$r["cnt"]], $rows);
  }

  // ===== payment_method_summary ===== (พยายามอ่านจาก payments ก่อน ถ้าไม่มีใช้จาก bookings)
  $paymentSummary=[];
  if(hasTable($conn,"payments")){
    // คอลัมน์ที่พบบ่อย
    $mCol = hasColumn($conn,"payments","method_code") ? "p.method_code" :
            (hasColumn($conn,"payments","payment_method") ? "p.payment_method" :
            (hasColumn($conn,"payments","method") ? "p.method" : "NULL"));
    $aCol = hasColumn($conn,"payments","net_amount") ? "p.net_amount" :
            (hasColumn($conn,"payments","amount") ? "p.amount" : "0");

    $sql="
      SELECT $mCol AS method, COUNT(*) AS tx_count, SUM(COALESCE($aCol,0)) AS net_amount
      FROM payments p
      INNER JOIN bookings b ON b.booking_id=p.booking_id
      INNER JOIN customers cu ON cu.customer_id=b.customer_id
      LEFT JOIN faculty f ON f.id=cu.faculty_id
      WHERE $whereSql
      GROUP BY method
      ORDER BY net_amount DESC, tx_count DESC
    ";
    $st=$conn->prepare($sql);
    stmtBindDynamic($st,$types,$vals);
    $st->execute(); $rows=fetchAll($st); $st->close();
    $paymentSummary = array_map(fn($r)=>["method_name"=>($r["method"]??"-"),"tx_count"=>(int)($r["tx_count"]??0),"net_amount"=>(float)($r["net_amount"]??0)], $rows);
  } else if(hasColumn($conn,"bookings","payment_method")){
    $st=$conn->prepare("
      SELECT b.payment_method AS method, COUNT(*) AS tx_count, SUM($amountExpr) AS net_amount
      FROM bookings b
      INNER JOIN customers cu ON cu.customer_id=b.customer_id
      LEFT JOIN faculty f ON f.id=cu.faculty_id
      WHERE $whereSql AND b.payment_method IS NOT NULL AND TRIM(b.payment_method)<>'' 
      GROUP BY b.payment_method
      ORDER BY net_amount DESC, tx_count DESC
    ");
    stmtBindDynamic($st,$types,$vals);
    $st->execute(); $rows=fetchAll($st); $st->close();
    $paymentSummary = array_map(fn($r)=>["method_name"=>$r["method"],"tx_count"=>(int)$r["tx_count"],"net_amount"=>(float)$r["net_amount"]], $rows);
  }

  // ===== reviews =====
  $reviewSummary=["total_reviews"=>0,"avg_rating"=>0.0];
  $recentReviews=[];
  if(hasTable($conn,"review")){
    $ratingCol = hasColumn($conn,"review","rating") ? "rating" : null;
    $textCol   = hasColumn($conn,"review","review_text") ? "review_text" :
                 (hasColumn($conn,"review","comment") ? "comment" : null);
    $dateCol   = hasColumn($conn,"review","created_at") ? "created_at" :
                 (hasColumn($conn,"review","review_date") ? "review_date" : null);

    if($ratingCol){
      $rs=$conn->query("SELECT COUNT(*) AS c, AVG($ratingCol) AS a FROM review");
      $r=$rs->fetch_assoc();
      $reviewSummary=["total_reviews"=>(int)($r["c"]??0),"avg_rating"=>(float)($r["a"]??0)];
    }

    if($ratingCol && $textCol){
      $sql="
        SELECT ".($dateCol?$dateCol:"NOW()")." AS review_date, $textCol AS review_text, $ratingCol AS rating
        FROM review
        ORDER BY ".($dateCol?$dateCol:"1")." DESC
        LIMIT 5
      ";
      $rs=$conn->query($sql);
      while($r=$rs->fetch_assoc()){
        $recentReviews[]=[
          "review_date"=> substr((string)$r["review_date"],0,10),
          "review_text"=> (string)$r["review_text"],
          "rating"=> (int)$r["rating"]
        ];
      }
    }
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
    "by_faculty"=>array_map(fn($r)=>["faculty"=>$r["faculty"],"count"=>(int)$r["cnt"]],$facultyRows),
    "by_study_year"=>array_map(fn($r)=>["study_year"=>(int)$r["study_year"],"count"=>(int)$r["cnt"]],$syRows),
    "top_equipment"=>array_map(fn($r)=>["name"=>$r["name"],"count"=>(int)$r["cnt"]],$eqRows),
    "peak_time"=>array_map(fn($r)=>["label"=>$r["tbin"],"count"=>(int)$r["cnt"]],$peakRows),
    "daily_usage"=>["labels"=>$wdMap,"counts"=>$daily],

    "member_tier_summary"=>array_map(fn($r)=>[
      "tier_name"=>$r["tier_name"] ?? "ไม่ระบุ",
      "total_bookings"=>(int)($r["total_bookings"] ?? 0),
      "total_spent"=>(float)($r["total_spent"] ?? 0),
    ], $tierRows),

    "student_coupon_top"=>$studentCouponTop,
    "payment_method_summary"=>$paymentSummary,
    "review_summary"=>$reviewSummary,
    "recent_reviews"=>$recentReviews,
  ], JSON_UNESCAPED_UNICODE);

}catch(Throwable $e){
  http_response_code(500);
  echo json_encode(["success"=>false,"error"=>$e->getMessage()], JSON_UNESCAPED_UNICODE);
}