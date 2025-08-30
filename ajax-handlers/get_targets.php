<?php
require_once('../auth.php');
force_login();
error_reporting(E_ALL);
ini_set('display_errors', 1); // Production: log errors instead
require_once('../defines.php');
require_once('../mysqli.php');

function error_and_end(string $error, int $http_code = 400){
    http_response_code($http_code);
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
        'targets' => [], // Ensure these arrays are present even for empty sets
        'ranges' => [],
        'update_info' => [], // Deprecated? Retained for compatibility if old JS uses it
    ]);
    exit;
}

function json_and_end($obj){
    header('Content-Type: application/json');
    echo json_encode($obj);
    exit;
}

// Check request
if(!isset($_REQUEST['ticker'], $_REQUEST['from'], $_REQUEST['min_ts'])) {
    error_and_end("Missing required request params: ticker, from, min_ts");
}

$ts_from = (int)$_REQUEST['from'];
$min_ts = (int)$_REQUEST['min_ts'];
if($ts_from <= 0) error_and_end('from must be a timestamp > 0');
if($min_ts <= 0) error_and_end('min_ts must be > 0');
$min_target_count_filter = (isset($_REQUEST['min_target_count'])?(int)$_REQUEST['min_target_count']:100); // For filtering fetched results, was 100 hardcoded

// Get selected target types from session (set by auth.php)
// PREF_KEY_SELECTED_TARGET_TYPES and DEFAULT_TARGET_TYPE defined in auth.php
$selected_target_types = $_SESSION[PREF_KEY_SELECTED_TARGET_TYPES] ?? [DEFAULT_TARGET_TYPE];
if (empty($selected_target_types)) {
    // This case should ideally be handled by auth.php ensuring a default is always set.
    // If somehow empty, fallback or error. For now, let's use the default.
    $selected_target_types = [DEFAULT_TARGET_TYPE];
    error_log("Warning: Selected target types empty in get_targets.php, falling back to default.");
}
$target_types_sql_in = "('".implode("','", array_map([$mysqli, 'real_escape_string'], $selected_target_types))."')";


// resolve the ticker into exchange, from_token, to_token
$ticker_parts1 = explode(':', $_REQUEST['ticker']);
if(count($ticker_parts1)!=2) error_and_end("Invalid ticker format (exchange:pair)");
$exchange = strtoupper($ticker_parts1[0]);
$tokens = $ticker_parts1[1];
$token_parts = explode('/', $tokens);
if(count($token_parts)!=2) error_and_end("Invalid ticker format (from/to)");
$from_token = $token_parts[0];
$to_token = $token_parts[1];

// Exchange exist?
$exchange_sql = $mysqli->real_escape_string($exchange);
$stmt_exchange = $mysqli->prepare("SELECT id FROM `exchanges` WHERE `exchange`=? LIMIT 1");
$stmt_exchange->bind_param("s", $exchange_sql);
$stmt_exchange->execute();
$result_exchange = $stmt_exchange->get_result();
if(!($row_exchange = $result_exchange->fetch_assoc())) error_and_end("Exchange not found: $exchange");
$exchange_id = (int)$row_exchange['id'];
$stmt_exchange->close();
if($exchange_id<=0) error_and_end("Invalid exchange ID for: $exchange");

// Pair exist?
$from_token_sql = $mysqli->real_escape_string($from_token);
$to_token_sql = $mysqli->real_escape_string($to_token);
$stmt_pair = $mysqli->prepare("SELECT id FROM `klines_meta` WHERE `exchange_id`=? AND `pair_l`=? AND `pair_r`=? LIMIT 1");
$stmt_pair->bind_param("iss", $exchange_id, $from_token_sql, $to_token_sql);
$stmt_pair->execute();
$result_pair = $stmt_pair->get_result();
if(!($row_pair = $result_pair->fetch_assoc())) error_and_end("Pair not found: $from_token/$to_token on $exchange");
$pair_id = (int)$row_pair['id'];
$stmt_pair->close();
if($pair_id<=0) error_and_end("Invalid pair ID for: $from_token/$to_token on $exchange");

$tbl_targets_name = "target_groups_{$pair_id}";
$tbl_targets_name_sql = $mysqli->real_escape_string($tbl_targets_name); // Still needed for table name in query
$tbl_ranges = "span_targets_ranges_{$pair_id}";
$tbl_ranges_sql = $mysqli->real_escape_string($tbl_ranges);

// target_groups table exist?
// Using prepared statements for schema queries is tricky, but table name is derived from validated pair_id.
$q_check_table = "SELECT COUNT(*) as count FROM `INFORMATION_SCHEMA`.`TABLES` WHERE `TABLE_SCHEMA` = DATABASE() AND `TABLE_NAME`='$tbl_targets_name_sql'";
$res_check_table = $mysqli->query($q_check_table);
$row_check_table = $res_check_table->fetch_assoc();
if (!$row_check_table || $row_check_table['count'] == 0) {
    empty_set_and_end($exchange, $from_token, $to_token); // Table doesn't exist for this pair
}


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

// find recently updated targets (ts_end is the target creation time)
// We need to find a range of ts_end values to query effectively.
// This logic for min_found_ts/max_found_ts could be simplified or adjusted based on how many historical targets TV needs.
$q_ts_range = "SELECT MAX(moo.ts_end) AS max_ts, MIN(moo.ts_end) AS min_ts ".
    "FROM ( ".
    " SELECT DISTINCT(`ts_end`) ".
    " FROM `$tbl_targets_name_sql` ".
    " WHERE `target_type` IN $target_types_sql_in ".
    " AND `ts_end` <= ? ". // $ts_from (how far back TV wants)
    " AND `ts_end` >= ? ". // $min_ts (earliest visible bar on chart)
    " ORDER BY `ts_end` DESC ".
    // " LIMIT X " // Consider limiting the number of distinct timestamps to scan if performance is an issue
    ") AS moo ";
$stmt_ts_range = $mysqli->prepare($q_ts_range);
$stmt_ts_range->bind_param("ii", $ts_from, $min_ts);
$stmt_ts_range->execute();
$result_ts_range = $stmt_ts_range->get_result();
$row_ts_range = $result_ts_range->fetch_assoc();
$stmt_ts_range->close();

if($row_ts_range === null || $row_ts_range['max_ts'] === null) {
    empty_set_and_end($exchange, $from_token, $to_token);
}
$max_found_ts = (int)$row_ts_range['max_ts'];
$min_found_ts = (int)$row_ts_range['min_ts'];


// Fetch actual targets within the found timestamp range and matching selected types
$q_targets = "SELECT * ".
    "FROM `$tbl_targets_name_sql` ".
    "WHERE `target_type` IN $target_types_sql_in ".
    "AND `ts_end` BETWEEN ? AND ? ". // $min_found_ts and $max_found_ts
    "AND `target_count` >= ? ".     // $min_target_count_filter
    "ORDER BY `ts_end` DESC, `target_price` ASC"; // Added price sort for consistency
$stmt_targets = $mysqli->prepare($q_targets);
$stmt_targets->bind_param("iii", $min_found_ts, $max_found_ts, $min_target_count_filter);
$stmt_targets->execute();
$result_targets = $stmt_targets->get_result();

while(($row = $result_targets->fetch_assoc()) !== null){
    $update_obj['targets'][] = [
        'ts_start' => (int)$row['ts_end'], // 'ts_start' for the chart is 'ts_end' from DB
        'ts_latest' => (int)$row['last_update_ts'],
        'ts_hit' => (int)$row['ts_hit'],
        'target_price' => (double)$row['target_price'],
        'target_count' => (int)$row['target_count'],
        'target_type' => $row['target_type'], // Include target_type in response
    ];
}
$stmt_targets->close();


// DONE
json_and_end($update_obj);