<?php
require_once('../auth.php');
force_login(); // Ensure user is logged in

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
if($to < $from) die("to < from");

// align requests on 1 minute intervals
if($from % 60 != 0) $from = $from - ($from % 60);
if($to % 60 != 0) $to = $to + (60 - ($to % 60));

#echo "from $from to $to<br/>\n";
// determine the correct start for this bar, aligned by resolution minutes, starting at the start of day GMT (00:00:00)
$resolution_aligned_start_ts = $from;
$seconds_in_resolution = $resolution * 60;
$dt_from = new DateTime('now', new DateTimeZone('GMT'));
$dt_from->setTimestamp((int)$from);
if($resolution > 1){
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

    // OPEN
    $q = "SELECT `open` FROM `klines_1` WHERE `timestamp`>=$loop_ts ORDER BY `timestamp` ASC LIMIT 1;";
    #echo $q."<br/>\n";
    if(($result = $mysqli->query($q)) === false) die("kline query failure: $q");
    if(!is_array($row = $result->fetch_assoc())) {
        // Probably requesting klines for data we don't have yet....
        break;
    }
    $open = (float)$row['open'];

    // CLOSE -- requested kline might be an overshoot on a unfinished span -- find the latest close price
    $q = "SELECT `close` FROM `klines_1` WHERE `timestamp`<=$span_end_ts ORDER BY timestamp DESC LIMIT 1;";
    #echo $q."<br/>\n";
    if(($result = $mysqli->query($q)) === false) die("kline query failure: $q");
    if(!is_array($row = $result->fetch_assoc())) die("kline query fetch_assoc failure: $q");
    $close = (float)$row['close'];

    $q = "SELECT MAX(`high`) AS high FROM `klines_1` WHERE `timestamp` BETWEEN $loop_ts AND $span_end_ts";
    #echo $q."<br/>\n";
    if(($result = $mysqli->query($q)) === false) die("kline query failure: $q");
    if(!is_array($row = $result->fetch_assoc())) die("kline query fetch_assoc failure: $q");
    $high = (float)$row['high'];

    $q = "SELECT MIN(`low`) AS low FROM `klines_1` WHERE `timestamp` BETWEEN $loop_ts AND $span_end_ts";
    #echo $q."<br/>\n";
    if(($result = $mysqli->query($q)) === false) die("kline query failure: $q");
    if(!is_array($row = $result->fetch_assoc())) die("kline query fetch_assoc failure: $q");
    $low = (float)$row['low'];

    $rows[] = [
        'time' => (int)$loop_ts,
        'open' => $open,
        'high' => $high,
        'low' => $low,
        'close' => $close,
    ];

    // find next span timestamp
    if($resolution == 1){
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

echo json_encode($rows);