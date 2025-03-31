<?php
require_once('auth.php');

$login_error = '';
$redirect_url = isset($_GET['redirect']) ? $_GET['redirect'] : 'index.php';

// Rate Limiting - Store login attempts in session
$max_attempts = 5; // Maximum login attempts
$lockout_time = 60; // Lockout time in seconds

if (!isset($_SESSION['login_attempts'])) {
    $_SESSION['login_attempts'] = 0;
}

if (isset($_SESSION['lockout_time']) && time() < $_SESSION['lockout_time']) {
    $remaining_time = $_SESSION['lockout_time'] - time();
    $login_error = "Too many failed login attempts. Please wait " . $remaining_time . " seconds before trying again.";
    $disabled = 'disabled'; // Disable the login button
} else {
    $disabled = '';
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $disabled === '') {
    $username = $_POST['username'];
    $password = $_POST['password'];

    if (login_user($username, $password)) {
        // Reset login attempts on successful login
        $_SESSION['login_attempts'] = 0;
        unset($_SESSION['lockout_time']);

        header("Location: " . $redirect_url); // Redirect to the original page
        exit;
    } else {
        $_SESSION['login_attempts']++;
        if ($_SESSION['login_attempts'] >= $max_attempts) {
            $_SESSION['lockout_time'] = time() + $lockout_time;
            $login_error = "Too many failed login attempts. Please wait " . $lockout_time . " seconds before trying again.";
            $disabled = 'disabled'; // Disable the login button
        } else {
            $login_error = 'Invalid username or password.';
        }
    }
}
?>
<!DOCTYPE html>
<html>
<head>
    <title>Login</title>
    <link rel="stylesheet" href="login.css">
</head>
<body>
<form method="post">
    <h1>Login</h1>
    <?php if ($login_error): ?>
        <p class="error"><?php echo $login_error; ?></p>
    <?php endif; ?>
    <label for="username">Username:</label>
    <input type="text" id="username" name="username" required><br><br>
    <label for="password">Password:</label>
    <input type="password" id="password" name="password" required><br><br>
    <button type="submit" <?php echo $disabled; ?> >Login</button>
</form>
</body>
</html>