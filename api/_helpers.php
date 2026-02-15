<?php
// executive/api/_helpers.php  (mysqli helpers)

header("Content-Type: application/json; charset=utf-8");

function q($key, $default = "") {
  return isset($_GET[$key]) ? trim((string)$_GET[$key]) : $default;
}

/**
 * addParam: ช่วยสะสม types/vals สำหรับ bind_param
 */
function addParam(&$types, &$vals, $typeChar, $val) {
  $types .= $typeChar;
  $vals[] = $val;
}

/**
 * stmtBindDynamic: bind_param แบบ dynamic
 */
function stmtBindDynamic($stmt, $types, $vals) {
  if ($types === "" || empty($vals)) return;

  // bind_param ต้องการ reference
  $refs = [];
  $refs[] = $types;
  foreach ($vals as $k => $v) {
    $refs[] = &$vals[$k];
  }

  call_user_func_array([$stmt, "bind_param"], $refs);
}

/**
 * fetchAll / fetchOne: ดึงผลจาก mysqli_stmt
 */
function fetchAll($stmt) {
  $res = $stmt->get_result();
  if (!$res) return [];
  $rows = [];
  while ($row = $res->fetch_assoc()) $rows[] = $row;
  return $rows;
}

function fetchOne($stmt) {
  $res = $stmt->get_result();
  if (!$res) return [];
  $row = $res->fetch_assoc();
  return $row ? $row : [];
}

/**
 * dateWhereSQL:
 * range = 7d | 30d | 1y | custom
 * custom ใช้ from/to (YYYY-MM-DD)
 */
function dateWhereSQL($col, &$types, &$vals) {
  $range = q("range", "30d");
  $from  = q("from", "");
  $to    = q("to", "");

  if ($range === "custom") {
    $w = [];
    if ($from !== "") { $w[] = "$col >= ?"; addParam($types, $vals, "s", $from . " 00:00:00"); }
    if ($to   !== "") { $w[] = "$col <= ?"; addParam($types, $vals, "s", $to   . " 23:59:59"); }
    return count($w) ? "(" . implode(" AND ", $w) . ")" : "1=1";
  }

  if ($range === "7d")  return "$col >= (NOW() - INTERVAL 7 DAY)";
  if ($range === "30d") return "$col >= (NOW() - INTERVAL 30 DAY)";
  if ($range === "1y")  return "$col >= (NOW() - INTERVAL 1 YEAR)";
  return "$col >= (NOW() - INTERVAL 30 DAY)";
}

/**
 * bookingTypeWhereSQL:
 * channels จาก UI: Walk-in,Online
 * map เป็น booking_types.code: WALK_IN / ONLINE
 */
function bookingTypeWhereSQL(&$types, &$vals, $col = "bt.code") {
  $channels = q("channels", "Walk-in,Online");
  $arr = array_values(array_filter(array_map("trim", explode(",", $channels))));
  if (!count($arr)) $arr = ["Walk-in", "Online"];

  $mapped = [];
  foreach ($arr as $ch) {
    if (strcasecmp($ch, "Walk-in") === 0) $mapped[] = "WALK_IN";
    if (strcasecmp($ch, "Online")  === 0) $mapped[] = "ONLINE";
  }
  if (!count($mapped)) $mapped = ["WALK_IN", "ONLINE"];

  $placeholders = [];
  foreach ($mapped as $code) {
    $placeholders[] = "?";
    addParam($types, $vals, "s", $code);
  }

  return "$col IN (" . implode(",", $placeholders) . ")";
}