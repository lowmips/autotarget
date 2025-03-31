<?php
require_once('mysqli.php'); // Assuming mysqli.php contains database connection
session_start(); // Start the session at the top of the file

// Function to securely hash the password
function password_hash_my(string $password): string {
    $options = [
        'cost' => 12, // Higher cost for more security
    ];
    return password_hash($password, PASSWORD_BCRYPT, $options);
}

// Function to verify the password
function password_verify_my(string $password, string $hash): bool {
    return password_verify($password, $hash);
}

// Function to check if the user is logged in
function is_logged_in(): bool {
    return isset($_SESSION['user_id']);
}

// Function to check if the user is an admin
function is_admin(): bool {
    return isset($_SESSION['admin']) && $_SESSION['admin'] === true;
}

// Function to force login (redirect if not logged in)
function force_login() {
    if (!is_logged_in()) {
        $redirect_url = $_SERVER['REQUEST_URI'];
        header("Location: login.php?redirect=" . urlencode($redirect_url));  // Redirect to login page with redirect URL
        exit;
    }
}

// Function to force admin login (redirect if not admin)
function force_admin() {
    force_login(); // Must be logged in first
    if (!is_admin()) {
        die("You do not have permission to access this page."); // Or redirect to an error page
    }
}


// Function to validate username
function validate_username(string $username): bool {
    // Example: Only allow alphanumeric characters and underscores, length between 3 and 20
    return preg_match('/^[a-zA-Z0-9_]{3,20}$/', $username) === 1;
}

// Function to validate password
function validate_password(string $password): bool {
    // Example: Minimum 8 characters, at least one uppercase, one lowercase, and one number
    return preg_match('/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/', $password) === 1;
}

// Function to validate email
function validate_email(string $email): bool {
    return filter_var($email, FILTER_VALIDATE_EMAIL) !== false;
}

// Login function
function login_user(string $username, string $password): bool {
    global $mysqli;

    if (!validate_username($username)) {
        return false; // Invalid username format
    }
    if (!validate_password($password)){
        return false; // Invalid password format.
    }

    $username = $mysqli->real_escape_string($username); // Prevent SQL injection

    $query = "SELECT id, username, password, admin FROM users WHERE username = '$username'";
    $result = $mysqli->query($query);

    if ($result && $result->num_rows === 1) {
        $user = $result->fetch_assoc();
        if (password_verify_my($password, $user['password'])) {
            // Password is correct, create session
            $_SESSION['user_id'] = $user['id'];
            $_SESSION['username'] = $user['username'];
            $_SESSION['admin'] = (bool)$user['admin']; // Store admin status in session
            session_regenerate_id(true); // Prevent session fixation
            return true; // Login successful
        }
    }

    return false; // Login failed
}

// Logout function
function logout_user() {
    $_SESSION = array(); // Clear all session variables
    session_destroy(); // Destroy the session
    setcookie(session_name(), '', time() - 3600, '/'); // Delete the session cookie
}