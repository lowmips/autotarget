<?php
$creds_file = '/var/www/mysql_credentials.txt';
if(!file_exists($creds_file)) die("Could not find [$creds_file]");

$credentials = file($creds_file, FILE_IGNORE_NEW_LINES);
$host = $credentials[0];
$username = $credentials[1];
$password = $credentials[2];
$database = $credentials[3];

// Connect to the MySQL database
#mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT); // Good for development, but consider carefully for production
$mysqli = new mysqli($host, $username, $password, $database);

// Check for connection errors
if ($mysqli->connect_error) {
    // Log the error instead of dying for production
    error_log('Connection failed: ' . $mysqli->connect_error);
    die('Database connection error. Please try again later.'); // User-friendly message
}

// Set character set to UTF-8 for proper handling of various characters
if (!$mysqli->set_charset("utf8mb4")) {
    error_log("Error loading character set utf8mb4: " . $mysqli->error);
    // Potentially die or handle this as a critical error
}