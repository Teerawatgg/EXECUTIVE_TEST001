<?php
require_once __DIR__ . "/../../database.php";

/* ===== SESSION FIX (สำคัญมาก) ===== */
$savePath = __DIR__ . "/../_sessions";
if (!is_dir($savePath)) {
    @mkdir($savePath, 0777, true);
}

session_save_path($savePath);
session_name("EXECSESSID");   // ต้องเหมือน login.php
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

header("Content-Type: application/json; charset=utf-8");

/* ===== AUTH CHECK ===== */
if (!isset($_SESSION["exec_staff_id"])) {
    http_response_code(401);
    echo json_encode([
        "success" => false,
        "message" => "Unauthorized"
    ], JSON_UNESCAPED_UNICODE);
    exit;
}