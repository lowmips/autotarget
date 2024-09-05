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
    exit;
}

function json_and_end($obj){
    echo json_encode($obj);
    exit;
}


#print_r($_REQUEST);
// Check login
// TODO: read session info

// NOTE! "max" is the maximum number of 1 minute timestamp points for targets.  there may be multiple targets per timestamp!

// Check request
if(!array_key_exists('ticker', $_REQUEST) || !array_key_exists('from', $_REQUEST) || !array_key_exists('max', $_REQUEST))
    die("Missing required request params");

$ts_from = (int)$_REQUEST['from'];
$max = (int)$_REQUEST['max'];
if($ts_from <= 0) error_and_end('from must be a timestamp > 0');
if($max <= 0) error_and_end('max must be > 0');

$ts_from_sql = $mysqli->real_escape_string($ts_from);
$max_sql = $mysqli->real_escape_string($max);

// resolve the ticker into exchange, from_token, to_token
$ticker_parts1 = explode(':', $_REQUEST['ticker']);
if(count($ticker_parts1)!=2) error_and_end("Invalid request");
$exchange = strtoupper($ticker_parts1[0]);
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

// build the return object
$update_obj = [
    'pair_info' => [
        'exchange' => $exchange,
        'from_token' => $from_token,
        'to_token' => $to_token,
    ],
    'update_info' => [],
];

// find recently updated targets!
$q ="select MAX(moo.ts_end) as max_ts, MIN(moo.ts_end) as min_ts ".
    "FROM ".
    "( ".
    " select distinct(`ts_end`) ".
    " FROM `$table_name_sql` ".
    " where 1 ".
    " AND `ts_end`<='$ts_from' ".
    " `ts_end`<='$ts_from' ".
    ") as moo ".
    "ORDER BY `ts_end` DESC ".
    "LIMIT $max_sql ";
if(($result = $mysqli->query($q)) === false) error_and_end("query failure: $q");
$row = $result->fetch_assoc();
if($row === false) error_and_end("query failure: $q");
if($row === null) empty_set_and_end($exchange, $from_token, $to_token);
$max_ts = (int)$row['nax_ts'];
$min_ts = (int)$row['nin_ts'];



$q = "SELECT * FROM `$table_name_sql` WHERE `ts_end`>='$min_ts' AND `ts_end`<='$max_ts' ORDER BY `ts_end` DESC ";
if(($result = $mysqli->query($q)) === false) error_and_end("query failure: $q");

while(($row = $result->fetch_assoc()) !== false){
    if($row === null) break;
    $updt = [
        'ts_start' => (int)$row['ts_end'],
        'ts_latest' => (int)$row['last_update_ts'],
        'ts_end' => (int)$row['ts_hit'],
        'target_price' => (double)$row['target_price'],
        'target_count' => (int)$row['target_count'],
    ];
    $update_obj['update_info'][] = $updt;
}
json_and_end($update_obj);