<?php
// dialogs/new_user_modal.php

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['new_user_submit'])) {
    $username = $_POST['username'];
    $password = $_POST['password'];
    $email = $_POST['email'];
    $admin = isset($_POST['admin']) && $_POST['admin'] === '1';

    global $mysqli;

    // Validate input (add more robust validation as needed)
    if (empty($username) || empty($password) || empty($email)) {
        $registration_error = 'All fields are required.';
    } elseif (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $registration_error = 'Invalid email format.';
    } else {
        // Sanitize input
        $username = $mysqli->real_escape_string($username);
        $email = $mysqli->real_escape_string($email);

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
<!-- New User Modal -->
<div class="modal fade" id="newUserModal" tabindex="-1" role="dialog" aria-labelledby="newUserModalLabel" aria-hidden="true">
    <div class="modal-dialog" role="document">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title" id="newUserModalLabel">New User Registration</h5>
                <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                    <span aria-hidden="true">×</span>
                </button>
            </div>
            <div class="modal-body">
                <?php if (isset($registration_success)): ?>
                    <p style="color: green;"><?php echo $registration_success; ?></p>
                <?php endif; ?>
                <?php if ($registration_error): ?>
                    <p style="color: red;"><?php echo $registration_error; ?></p>
                <?php endif; ?>
                <form method="post">
                    <div class="form-group">
                        <label for="username">Username:</label>
                        <input type="text" class="form-control" id="username" name="username" required>
                    </div>
                    <div class="form-group">
                        <label for="password">Password:</label>
                        <input type="password" class="form-control" id="password" name="password" required>
                    </div>
                    <div class="form-group">
                        <label for="email">Email:</label>
                        <input type="email" class="form-control" id="email" name="email" required>
                    </div>
                    <div class="form-group">
                        <div class="form-check">
                            <input type="checkbox" class="form-check-input" id="admin" name="admin" value="1">
                            <label class="form-check-label" for="admin">Admin</label>
                        </div>
                    </div>
                    <button type="submit" class="btn btn-primary" name="new_user_submit">Register User</button>
                </form>
            </div>
        </div>
    </div>
</div>