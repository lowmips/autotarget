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
if(!array_key_exists('ticker', $_REQUEST) || !array_key_exists('from', $_REQUEST) || !array_key_exists('min_ts', $_REQUEST))
    die("Missing required request params");

$ts_from = (int)$_REQUEST['from'];
$min_ts = (int)$_REQUEST['min_ts'];
if($ts_from <= 0) error_and_end('from must be a timestamp > 0');
if($min_ts <= 0) error_and_end('min_ts must be > 0');
$min_target_count = (isset($_REQUEST['min_target_count'])?(int)$_REQUEST['min_target_count']:1);

$ts_from_sql = $mysqli->real_escape_string($ts_from);
$min_ts = $mysqli->real_escape_string($min_ts);

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

$tbl_targets_name = "target_groups_{$pair_id}";
$tbl_targets_name_sql = $mysqli->real_escape_string($tbl_targets_name);
$tbl_ranges = "span_targets_ranges_{$pair_id}";
$tbl_ranges_sql = $mysqli->real_escape_string($tbl_ranges);

// target_groups table exist?
$q = "SELECT * FROM `INFORMATION_SCHEMA`.`TABLES` WHERE `TABLE_NAME`='$tbl_targets_name_sql' LIMIT 1";
if(($result = $mysqli->query($q)) === false) empty_set_and_end($exchange, $from_token, $to_token);

// build the return object
$update_obj = [
    'pair_info' => [
        'exchange' => $exchange,
        'from_token' => $from_token,
        'to_token' => $to_token,
    ],
    'targets' => [],
    'ranges' => [],
    'dbg' => [],
];

// find recently updated targets
$q ="select MAX(moo.ts_end) as max_ts, MIN(moo.ts_end) as min_ts ".
    "FROM ".
    "( ".
    " select distinct(`ts_end`) ".
    " FROM `$tbl_targets_name_sql` ".
    " where 1 ".
    " AND `target_type`='1.786' ".
    //"AND `target_type` != 'all' ".
    " AND `ts_end`<='$ts_from' ".
    " AND `ts_end` >= '$min_ts' ".
    " ORDER BY `ts_end` DESC ".
    //" LIMIT $max_sql ".
    ") as moo ";
#echo $q."<br>";
if(($result = $mysqli->query($q)) === false) error_and_end("query failure: $q");
$row = $result->fetch_assoc();
if($row === false) error_and_end("query failure: $q");
if($row === null) empty_set_and_end($exchange, $from_token, $to_token);
$max_found_ts = (int)$row['max_ts'];
$min_found_ts = (int)$row['min_ts'];

$q = "SELECT * ".
    "FROM `$tbl_targets_name_sql` ".
    "WHERE 1 ".
    //"AND `target_price`='62690.22' ". // DEBUG
    "AND `target_type`='1.786' ".
    //"AND `target_type` != 'all' ".
    "AND `ts_end`>='$min_found_ts' ".
    "AND `ts_end`<='$max_found_ts' ".
    //"AND `target_count`>='$min_target_count' ".
    "AND `target_count`>='20' ".
    "ORDER BY `ts_end` DESC ";
#echo $q; exit;
//$update_obj['dbg'][] = $q;
if(($result = $mysqli->query($q)) === false) error_and_end("query failure: $q");

while(($row = $result->fetch_assoc()) !== false){
    if($row === null) break;
    //$update_obj['dbg'][] = $row;
    $updt = [
        'ts_start' => (int)$row['ts_end'],
        'ts_latest' => (int)$row['last_update_ts'],
        'ts_hit' => (int)$row['ts_hit'],
        'target_price' => (double)$row['target_price'],
        'target_count' => (int)$row['target_count'],
    ];
    $update_obj['targets'][] = $updt;
}

// Find ranges
$q = "SELECT * ".
    "FROM `$tbl_ranges_sql` ".
    "WHERE 1 ".
    "AND `target_type`='1.786' ".
    //"AND `target_type` != 'all' ".
    "AND `ts`<='$ts_from' ".
    "AND `ts` >= '$min_ts' ".
    "AND `target_count`>1 ".
    "ORDER BY `ts` DESC"
;
if(($result = $mysqli->query($q)) === false) error_and_end("query failure: $q");
while(($row = $result->fetch_assoc()) !== false){
    if($row === null) break;
    //$update_obj['dbg'][] = $row;
    $updt = [
        'ts' => (int)$row['ts'],
        'price_high' => $row['price_high'],
        'price_low' => $row['price_low'],
        'price_when_made' => $row['price_when_made'],
        'target_count' => (int)$row['target_count'],
        'target_type' => $row['target_type'],
    ];
    $update_obj['ranges'][] = $updt;
}

// DONE
json_and_end($update_obj);