---- create_hash.php ----
<?php
/**
 * Standalone tool to create a password hash compatible with the main application.
 * This script uses the same hashing algorithm and options as defined in auth.php.
 */

/**
 * Creates a password hash using BCRYPT.
 * This function is an exact copy of the one in auth.php to ensure compatibility.
 *
 * @param string $password The password to hash.
 * @return string The resulting password hash.
 */
function password_hash_my(string $password): string {
    $options = [
        'cost' => 12, // Must match the cost in auth.php
    ];
    return password_hash($password, PASSWORD_BCRYPT, $options);
}


$hashed_password = '';
$error_message = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!empty($_POST['password'])) {
        $password = $_POST['password'];
        $hashed_password = password_hash_my($password);
    } else {
        $error_message = 'Please enter a password.';
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Create Password Hash</title>
    <style>
        body { font-family: sans-serif; margin: 2em; }
        textarea { width: 100%; max-width: 600px; }
        .error { color: red; }
    </style>
</head>
<body>
<h1>Create Password Hash</h1>
<p>Use this tool to generate a password hash for manual database insertion.</p>
<form method="post">
    <label for="password">Password:</label><br>
    <input type="password" id="password" name="password" required size="40"><br><br>
    <button type="submit">Generate Hash</button>
</form>

<?php if ($error_message): ?>
    <p class="error"><?php echo htmlspecialchars($error_message); ?></p>
<?php endif; ?>

<?php if ($hashed_password): ?>
    <h2>Hashed Password:</h2>
    <p>Copy the entire string below.</p>
    <textarea rows="4" cols="70" readonly><?php echo htmlspecialchars($hashed_password); ?></textarea>
<?php endif; ?>
</body>
</html>