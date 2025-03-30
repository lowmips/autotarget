<?php
require_once('auth.php');
logout_user();
header("Location: login.php"); // Redirect to login page after logout
exit;
?>