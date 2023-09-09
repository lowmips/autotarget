<?php
echo __FILE__.':'.__LINE__.'<br/>';
$credentials = file('variable/mysql_credentials.txt', FILE_IGNORE_NEW_LINES);

echo __FILE__.':'.__LINE__.'<br/>';
$host = $credentials[0];
$username = $credentials[1];
$password = $credentials[2];
$database = $credentials[3];
// Connect to the MySQL database
echo __FILE__.':'.__LINE__.'<br/>';
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

echo __FILE__.':'.__LINE__.'<br/>';
$mysqli = new mysqli($host, $username, $password, $database);

// Check for connection errors
echo __FILE__.':'.__LINE__.'<br/>';
if ($mysqli->connect_error) die('Connection failed: ' . $mysqli->connect_error."\n");
