<?php
require_once('auth.php'); // Include auth.php for password hashing function

$registration_error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = $_POST['username'];
    $password = $_POST['password'];
    $email = $_POST['email']; // Get email from the form
    global $mysqli;

    // Validate input (add more robust validation as needed)
    if (empty($username) || empty($password) || empty($email)) { // Check if email is empty
        $registration_error = 'All fields are required.';
    }  elseif (!filter_var($email, FILTER_VALIDATE_EMAIL)) { // Validate email format
        $registration_error = 'Invalid email format.';
    } else {
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
            // Insert the new user into the database (including email)
            $insert_query = "INSERT INTO users (username, password, email) VALUES ('$username', '$hashed_password', '$email')";

            if ($mysqli->query($insert_query)) {
                // Registration successful, redirect to login
                header("Location: login.php");
                exit;
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
    <title>Register</title>
</head>
<body>
<h1>Register</h1>
<?php if ($registration_error): ?>
    <p style="color: red;"><?php echo $registration_error; ?></p>
<?php endif; ?>
<form method="post">
    <label for="username">Username:</label><br>
    <input type="text" id="username" name="username" required><br><br>
    <label for="password">Password:</label><br>
    <input type="password" id="password" name="password" required><br><br>
    <label for="email">Email:</label><br> <!-- Added email field -->
    <input type="email" id="email" name="email" required><br><br> <!-- Added email input -->
    <button type="submit">Register</button>
</form>
<p>Already have an account? <a href="login.php">Login</a></p>
</body>
</html>