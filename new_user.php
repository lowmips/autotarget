<?php
require_once('auth.php');
force_admin(); // Only admins can access this page

$registration_error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = $_POST['username'];
    $password = $_POST['password'];
    $email = $_POST['email']; // Get email from the form
    $admin = isset($_POST['admin']) && $_POST['admin'] === '1'; // Check if admin checkbox is checked

    global $mysqli;

    // Validate input (add more robust validation as needed)
    if (empty($username) || empty($password) || empty($email)) { // Check if email is empty
        $registration_error = 'All fields are required.';
    }  elseif (!filter_var($email, FILTER_VALIDATE_EMAIL)) { // Validate email format
        $registration_error = 'Invalid email format.';
    }  else {
        // Sanitize input
        $username = $mysqli->real_escape_string($username);
        $email = $mysqli->real_escape_string($email); // Sanitize the email

        // Hash the password
        $hashed_password = password_hash_my($password);

        // Check if the username already exists
        $check_query = "SELECT id FROM users WHERE username = '$username'";
        $check_result = $mysqli->query($check_query);

        if ($check_result && $check_result->num_rows > 0) {
            $registration_error = 'Username already exists.';
        } else {
            // Insert the new user into the database (including admin)
            $insert_query = "INSERT INTO users (username, password, email, admin) VALUES ('$username', '$hashed_password', '$email', '$admin')";

            if ($mysqli->query($insert_query)) {
                // Registration successful
                $registration_success = 'User registered successfully!';
                // Optionally, clear the form fields after successful registration
                $username = '';
                $email = '';
            } else {
                $registration_error = 'Registration failed: ' . $mysqli->error;
            }
        }
    }
}
?>
<!DOCTYPE html>
<html>
<head>
    <title>New User Registration (Admin Only)</title>
</head>
<body>
<h1>New User Registration (Admin Only)</h1>
<?php if (isset($registration_success)): ?>
    <p style="color: green;"><?php echo $registration_success; ?></p>
<?php endif; ?>
<?php if ($registration_error): ?>
    <p style="color: red;"><?php echo $registration_error; ?></p>
<?php endif; ?>
<form method="post">
    <label for="username">Username:</label><br>
    <input type="text" id="username" name="username" required><br><br>
    <label for="password">Password:</label><br>
    <input type="password" id="password" name="password" required><br><br>
    <label for="email">Email:</label><br>
    <input type="email" id="email" name="email" required><br><br>
    <label for="admin">Admin:</label>
    <input type="checkbox" id="admin" name="admin" value="1"><br><br>
    <button type="submit">Register User</button>
</form>
<p><a href="index.php">Back to Chart</a></p>
</body>
</html>