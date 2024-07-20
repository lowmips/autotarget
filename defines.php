<?php
$debug = false;

if(php_sapi_name() == 'cli'){
    $tmp = get_argv_var('debug');
    if($tmp != null && $tmp == 1) $debug = true;

}else{
    if(isset($_REQUEST['debug']) && $_REQUEST['debug'] == 1){
        $debug = true;
    }
}
define('DEBUG', $debug);

class MYSQLI_result_false extends Exception {};
class MYSQL_fetch_assoc_false extends Exception {};
class KLINE_Span_Not_Enough_Data extends Exception {};  // Not enough historical data
class KLINE_Span_Missing_Data extends Exception {}; // Have open & close data, but missing in-between data
class KLINE_Sequence_Empty extends Exception {};
class KLINE_Sequence_Invalid extends Exception {};
