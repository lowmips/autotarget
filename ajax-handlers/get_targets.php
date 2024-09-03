<?php
error_reporting(E_ALL);
ini_set('display_errors', 1);
require_once('../defines.php');
require_once('../mysqli.php');

function error_and_end(string $error){
    echo json_encode(['error' => $error,]);
    exit;
}
function empty_set_and_end($exchange, $from_token, $to_token){
    echo json_encode([
        'pair_info' => [
            'exchange' => $exchange,
            'from_token' => $from_token,
            'to_token' => $to_token,
        ],
        'update_info' => [],
    ]);
}


#print_r($_REQUEST);
// Check login
// TODO: read session info

// Check request
if(!array_key_exists('ticker', $_REQUEST) || !array_key_exists('from', $_REQUEST) || !array_key_exists('to', $_REQUEST))
    die("Missing required request params");

$from = $mysqli->real_escape_string($_REQUEST['from']);
$to = $mysqli->real_escape_string($_REQUEST['to']);
if($to < $from) die("to < from");

// resolve the ticker into exchange, from_token, to_token
$ticker_parts1 = explode(':', $_REQUEST['ticker']);
if(count($ticker_parts1)!=2) error_and_end("Invalid request");
$exchange = $ticker_parts1[0];
$tokens = $ticker_parts1[1];
$token_parts = explode('/', $tokens);
if(count($token_parts)!=2) error_and_end("Invalid request");
$from_token = $token_parts[0];
$to_token = $token_parts[1];

// Exchange exist?
$exchange_sql = $mysqli->real_escape_string($exchange);
$q = "SELECT * FROM `exchanges` WHERE `exchange`='$exchange_sql' LIMIT 1";
if(($result = $mysqli->query($q)) === false) error_and_end("query failure: $q");
if(!is_array($row = $result->fetch_assoc())) error_and_end("query fetch_assoc failure: $q");
$exchange_id = (int)$row['id'];
if($exchange_id<=0) error_and_end("query row failure: $q");

// Pair exist?
$from_token_sql = $mysqli->real_escape_string($from_token);
$to_token_sql = $mysqli->real_escape_string($to_token);
$q = "SELECT * FROM `klines_meta` WHERE `exchange_id`='$exchange_id' AND `pair_l`='$from_token_sql' AND `pair_r`='$to_token_sql' LIMIT 1";
if(($result = $mysqli->query($q)) === false) error_and_end("query failure: $q");
if(!is_array($row = $result->fetch_assoc())) error_and_end("query fetch_assoc failure: $q");
$pair_id = (int)$row['id'];
if($pair_id<=0) error_and_end("query row failure: $q");

// target_groups table exist?
$table_name = "target_groups_{$pair_id}";
$table_name_sql = $mysqli->real_escape_string($table_name);
$q = "SELECT * FROM `INFORMATION_SCHEMA`.`TABLES` WHERE `TABLE_NAME`='$table_name_sql' LIMIT 1";
if(($result = $mysqli->query($q)) === false) empty_set_and_end($exchange, $from_token, $to_token);

