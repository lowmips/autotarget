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

if($from % 60 != 0) die("from[$from] not centered on 1 minute interval");
if($to % 60 != 0) die("to[$to] not centered on 1 minute interval");
if($to < $from) die("to < from");
if( (($to - $from) % $resolution) != 0) die("range does not end on [$resolution] interval");

/*$q = "CALL get_klines($resolution, $from, $to)";
$result = $mysqli->query($q);
while( $row = $result->fetch_assoc() ){
    print_r($row);
}*/

