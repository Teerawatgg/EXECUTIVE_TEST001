<?php
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

if (!isset($_SESSION["staff_id"])) {
    http_response_code(401);
    echo json_encode(["success"=>false,"message"=>"Unauthorized"]);
    exit;
}