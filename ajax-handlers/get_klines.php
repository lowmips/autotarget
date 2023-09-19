<?php
error_reporting(E_ALL);
ini_set('display_errors', 1);
require_once('../defines.php');
require_once('../mysqli.php');

#print_r($_REQUEST);

if(!array_key_exists('resolution', $_REQUEST) || !array_key_exists('from', $_REQUEST) || !array_key_exists('to', $_REQUEST))
    die("Missing required request params");

$resolution = $mysqli->real_escape_string($_REQUEST['resolution']);
$from = $mysqli->real_escape_string($_REQUEST['from']);
$to = $mysqli->real_escape_string($_REQUEST['to']);

$q = "CALL get_klines($resolution, $from, $to)";
$result = $mysqli->query($q);
print_r($result);