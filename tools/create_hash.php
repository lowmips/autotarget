<?php
// tools/create_hash.php
require_once('../auth.php'); // Adjust path to auth.php as needed

$hashed_password = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $password = $_POST['password'];
    if (!empty($password)) {
        $hashed_password = password_hash_my($password);
    } else {
        $hashed_password = 'Please enter a password.';
    }
}
?>
<!DOCTYPE html>
<html>
<head>
    <title>Create Password Hash</title>
</head>
<body>
<h1>Create Password Hash</h1>
<form method="post">
    <label for="password">Password:</label><br>
    <input type="password" id="password" name="password" required><br><br>
    <button type="submit">Generate Hash</button>
</form>
<?php if ($hashed_password): ?>
    <h2>Hashed Password:</h2>
    <textarea rows="5" cols="60" readonly><?php echo htmlspecialchars($hashed_password); ?></textarea>
<?php endif; ?>
</body>
</html>