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

#if($from % 60 != 0) die("from[$from] not centered on 1 minute interval");
#if($to % 60 != 0) die("to[$to] not centered on 1 minute interval");
if($to < $from) die("to < from");
#if( (($to - $from) % $resolution) != 0) die("range does not end on [$resolution] interval");

// align requests on 1 minute intervals
if($from % 60 != 0) $from = $from - ($from % 60);
if($to % 60 != 0) $to = $to + (60 - ($to % 60));

#echo "from $from to $to<br/>\n";

/*$q = "CALL get_klines($resolution, $from, $to)";
$result = $mysqli->query($q);
while( $row = $result->fetch_assoc() ){
    print_r($row);
}*/
$rows = [];
$loop_ts = $from;
while($loop_ts < $to){
    $span_end_ts = $loop_ts + ($resolution * 60) - 60;

    // OPEN
    $q = "SELECT `open` FROM `btc_usdt_klines_reduced` WHERE `kline_timestamp`>=$loop_ts ORDER BY `kline_timestamp` ASC LIMIT 1;";
    #echo $q."<br/>\n";
    if(($result = $mysqli->query($q)) === false) die("kline query failure: $q");
    if(!is_array($row = $result->fetch_assoc())) {
        // Probably requesting klines for data we don't have yet....
        break;

        //die("kline query fetch_assoc failure: $q");
    }
    $open = (float)$row['open'];

    // CLOSE -- requested kline migh be an overshoot on a unfinished span -- find the latest close price
    $q = "SELECT `close` FROM `btc_usdt_klines_reduced` WHERE `kline_timestamp`<=$span_end_ts ORDER BY kline_timestamp DESC LIMIT 1;";
    #echo $q."<br/>\n";
    if(($result = $mysqli->query($q)) === false) die("kline query failure: $q");
    if(!is_array($row = $result->fetch_assoc())) die("kline query fetch_assoc failure: $q");
    $close = (float)$row['close'];

    $q = "SELECT MAX(`high`) AS high FROM `btc_usdt_klines_reduced` WHERE `kline_timestamp` BETWEEN $loop_ts AND $span_end_ts";
    #echo $q."<br/>\n";
    if(($result = $mysqli->query($q)) === false) die("kline query failure: $q");
    if(!is_array($row = $result->fetch_assoc())) die("kline query fetch_assoc failure: $q");
    $high = (float)$row['high'];

    $q = "SELECT MIN(`low`) AS low FROM `btc_usdt_klines_reduced` WHERE `kline_timestamp` BETWEEN $loop_ts AND $span_end_ts";
    #echo $q."<br/>\n";
    if(($result = $mysqli->query($q)) === false) die("kline query failure: $q");
    if(!is_array($row = $result->fetch_assoc())) die("kline query fetch_assoc failure: $q");
    $low = (float)$row['low'];

    $rows[] = [
        'time' => $loop_ts,
        'open' => $open,
        'high' => $high,
        'low' => $low,
        'close' => $close,
    ];

    $loop_ts += ($resolution * 60);
}

echo json_encode($rows);