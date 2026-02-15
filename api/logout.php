<?php
session_start();
header("Content-Type: application/json; charset=utf-8");

unset($_SESSION["exec_staff_id"]);
unset($_SESSION["exec_name"]);
unset($_SESSION["exec_role_id"]);
unset($_SESSION["exec_branch_id"]);
unset($_SESSION["exec_branch_name"]);

session_destroy();

echo json_encode(["success"=>true]);