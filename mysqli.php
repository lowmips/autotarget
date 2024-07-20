<?php
$creds_file = '/var/www/mysql_credentials.txt';
if(!file_exists($creds_file)) die("Could not find [$creds_file]");

$credentials = file($creds_file, FILE_IGNORE_NEW_LINES);
$host = $credentials[0];
$username = $credentials[1];
$password = $credentials[2];
$database = $credentials[3];

// Connect to the MySQL database
#mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
$mysqli = new mysqli($host, $username, $password, $database);

// Check for connection errors
if ($mysqli->connect_error) die('Connection failed: ' . $mysqli->connect_error."\n");
