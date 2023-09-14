<?php
error_reporting(E_ALL);
require_once('../defines.php');
require_once('../mysqli.php');

if(!array_key_exists('resolution', $_REQUEST) || !array_key_exists('from', $_REQUEST) || !array_key_exists('to', $_REQUEST))
    die("Missing required request params");

print_r($_REQUEST);