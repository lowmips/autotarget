<?php
require_once('../auth.php');
force_login(); // Ensure user is logged in
error_reporting(E_ALL);
ini_set('display_errors', 1); // Consider turning off for production, log errors instead
require_once('../defines.php');
require_once('../mysqli.php');

#print_r($_REQUEST);

if(!array_key_exists('resolution', $_REQUEST) || !array_key_exists('from', $_REQUEST) || !array_key_exists('to', $_REQUEST)) {
    http_response_code(400);
    die(json_encode(["error" => "Missing required request params"]));
}

$resolution = $mysqli->real_escape_string($_REQUEST['resolution']);
$from = (int)$_REQUEST['from']; // Cast to int
$to = (int)$_REQUEST['to'];     // Cast to int

if($to < $from) {
    http_response_code(400);
    die(json_encode(["error" => "to < from"]));
}

// align requests on 1 minute intervals
if($from % 60 != 0) $from = $from - ($from % 60);
if($to % 60 != 0) $to = $to + (60 - ($to % 60));

#echo "from $from to $to<br/>\n";
// determine the correct start for this bar, aligned by resolution minutes, starting at the start of day GMT (00:00:00)
$resolution_aligned_start_ts = $from;
$seconds_in_resolution = (int)$resolution * 60; // Cast resolution to int
if ($seconds_in_resolution <= 0) { // Basic validation for resolution
    http_response_code(400);
    die(json_encode(["error" => "Invalid resolution"]));
}

$dt_from = new DateTime('now', new DateTimeZone('GMT'));
$dt_from->setTimestamp($from);

if((int)$resolution > 1){ // Cast resolution
    $dt_day_start = clone $dt_from;
    $dt_day_start->setTime(0,0,0);
    $start_from_seconds_diff = $dt_from->getTimestamp() - $dt_day_start->getTimestamp();
    $bars_in_diff = $start_from_seconds_diff / $seconds_in_resolution;
    $resolution_aligned_start_ts = ((int)$bars_in_diff * $seconds_in_resolution) + $dt_day_start->getTimestamp();
    $dt_from->setTimestamp($resolution_aligned_start_ts);
}

$rows = [];
$loop_ts = $resolution_aligned_start_ts;
while($loop_ts < $to){
    $original_day_of_month = $dt_from->format('d');
    $span_end_ts = $loop_ts + $seconds_in_resolution - 60;

    // align span end on new day
    $dt_span_end = new DateTime('now', new DateTimeZone('GMT'));
    $dt_span_end->setTimestamp($span_end_ts);
    $span_end_day_of_month = $dt_span_end->format('d');
    if($original_day_of_month != $span_end_day_of_month){
        $dt_span_end->setTime(0,0,0);
        $dt_span_end->sub(new DateInterval('PT1M'));
        $span_end_ts = $dt_span_end->getTimestamp();
    }

    // Using prepared statements is highly recommended here if table names or columns were variable.
    // Since they are fixed, real_escape_string for $loop_ts and $span_end_ts (already ints) is less critical
    // but good practice if they were ever strings.

    // OPEN
    $q = "SELECT `open` FROM `klines_1` WHERE `timestamp`>=$loop_ts ORDER BY `timestamp` ASC LIMIT 1;";
    if(($result = $mysqli->query($q)) === false) {
        error_log("Kline query failure: $q - " . $mysqli->error);
        http_response_code(500);
        die(json_encode(["error" => "Database query error for open price."]));
    }
    if(!is_array($row = $result->fetch_assoc())) {
        // Probably requesting klines for data we don't have yet....
        break;
    }
    $open = (float)$row['open'];
    $result->free();

    // CLOSE -- requested kline might be an overshoot on a unfinished span -- find the latest close price
    $q = "SELECT `close` FROM `klines_1` WHERE `timestamp`<=$span_end_ts ORDER BY timestamp DESC LIMIT 1;";
    if(($result = $mysqli->query($q)) === false) {
        error_log("Kline query failure: $q - " . $mysqli->error);
        http_response_code(500);
        die(json_encode(["error" => "Database query error for close price."]));
    }
    if(!is_array($row = $result->fetch_assoc())) {
        error_log("Kline query fetch_assoc failure for close: $q");
        http_response_code(500);
        die(json_encode(["error" => "Could not fetch close price."]));
    }
    $close = (float)$row['close'];
    $result->free();

    $q = "SELECT MAX(`high`) AS high FROM `klines_1` WHERE `timestamp` BETWEEN $loop_ts AND $span_end_ts";
    if(($result = $mysqli->query($q)) === false) {
        error_log("Kline query failure: $q - " . $mysqli->error);
        http_response_code(500);
        die(json_encode(["error" => "Database query error for high price."]));
    }
    if(!is_array($row = $result->fetch_assoc())) {
        error_log("Kline query fetch_assoc failure for high: $q");
        http_response_code(500);
        die(json_encode(["error" => "Could not fetch high price."]));
    }
    $high = (float)$row['high'];
    $result->free();

    $q = "SELECT MIN(`low`) AS low FROM `klines_1` WHERE `timestamp` BETWEEN $loop_ts AND $span_end_ts";
    if(($result = $mysqli->query($q)) === false) {
        error_log("Kline query failure: $q - " . $mysqli->error);
        http_response_code(500);
        die(json_encode(["error" => "Database query error for low price."]));
    }
    if(!is_array($row = $result->fetch_assoc())) {
        error_log("Kline query fetch_assoc failure for low: $q");
        http_response_code(500);
        die(json_encode(["error" => "Could not fetch low price."]));
    }
    $low = (float)$row['low'];
    $result->free();

    $rows[] = [
        'time' => (int)$loop_ts, // Ensure time is integer
        'open' => $open,
        'high' => $high,
        'low' => $low,
        'close' => $close,
    ];

    // find next span timestamp
    if((int)$resolution == 1){ // Cast resolution
        $loop_ts += 60;
    }else{
        $loop_ts += $seconds_in_resolution;
    }

    $dt_from->setTimestamp($loop_ts);
    $new_day_of_month = $dt_from->format('d');
    if($original_day_of_month != $new_day_of_month){
        // the day changed, align spans to the new day
        $dt_from->setTime(0,0,0);
        $loop_ts = $dt_from->getTimestamp();
    }
}
header('Content-Type: application/json');
echo json_encode($rows);