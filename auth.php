<?php
// Consider enabling strict types for better type safety in new projects or when refactoring.
// declare(strict_types=1);

require_once('mysqli.php'); // Assuming mysqli.php contains database connection
session_start(); // Start the session at the top of the file

// --- Constants for Preference Keys ---
define('PREF_KEY_SELECTED_TARGET_TYPES', 'selected_target_types');
define('DEFAULT_TARGET_TYPE', '1.786'); // Centralize default target type

// --- Password Hashing ---
function password_hash_my(string $password): string {
    $options = [
        'cost' => 12, // Good default, adjust if server performance allows for higher
    ];
    return password_hash($password, PASSWORD_BCRYPT, $options);
}

function password_verify_my(string $password, string $hash): bool {
    return password_verify($password, $hash);
}

// --- User Preference Management ---
/**
 * Retrieves a user preference from the database.
 *
 * @param int $user_id The ID of the user.
 * @param string $key The preference key.
 * @param mixed $default The default value to return if the preference is not found or invalid.
 * @return mixed The preference value or the default.
 */
function get_user_preference(int $user_id, string $key, $default = null) {
    global $mysqli; // Consider dependency injection for $mysqli in a larger refactor

    // Use prepared statements for security and consistency
    $stmt = $mysqli->prepare("SELECT preference_value FROM user_preferences WHERE user_id = ? AND preference_key = ?");
    if (!$stmt) {
        error_log("Preference Get Prepare failed: (" . $mysqli->errno . ") " . $mysqli->error);
        return $default;
    }
    $stmt->bind_param("is", $user_id, $key);
    if (!$stmt->execute()) {
        error_log("Preference Get Execute failed: " . $stmt->error);
        $stmt->close();
        return $default;
    }
    $result = $stmt->get_result();
    $preference_value = $default;

    if ($result && $result->num_rows === 1) {
        $row = $result->fetch_assoc();
        $decoded = json_decode($row['preference_value'], true);
        if (json_last_error() === JSON_ERROR_NONE) {
            $preference_value = $decoded;
        } else {
            error_log("Failed to decode JSON preference for user $user_id, key $key. JSON error: " . json_last_error_msg());
            // Return default if JSON is invalid
        }
    }
    $stmt->close();
    return $preference_value;
}

/**
 * Saves a user preference to the database.
 *
 * @param int $user_id The ID of the user.
 * @param string $key The preference key.
 * @param mixed $value The preference value to save.
 * @return bool True on success, false on failure.
 */
function save_user_preference(int $user_id, string $key, $value): bool {
    global $mysqli;

    $value_json = json_encode($value);
    if ($value_json === false) {
        error_log("Failed to encode preference value to JSON for user $user_id, key $key. JSON error: " . json_last_error_msg());
        return false;
    }

    // Use prepared statements for INSERT ... ON DUPLICATE KEY UPDATE
    $query = "INSERT INTO user_preferences (user_id, preference_key, preference_value)
              VALUES (?, ?, ?)
              ON DUPLICATE KEY UPDATE preference_value = VALUES(preference_value)"; // VALUES() is more robust
    $stmt = $mysqli->prepare($query);
    if (!$stmt) {
        error_log("Preference Save Prepare failed: (" . $mysqli->errno . ") " . $mysqli->error);
        return false;
    }
    $stmt->bind_param("iss", $user_id, $key, $value_json);

    if ($stmt->execute()) {
        $stmt->close();
        return true;
    } else {
        error_log("Failed to save user preference for user $user_id, key $key: " . $stmt->error);
        $stmt->close();
        return false;
    }
}

// --- Session and Authentication Status ---

/**
 * Checks if the current session is valid against the database.
 *
 * @return bool True if the session is valid, false otherwise.
 */
function check_session_validity(): bool {
    global $mysqli;
    if (!isset($_SESSION['user_id'])) {
        return false;
    }

    $user_id = (int)$_SESSION['user_id']; // Ensure integer
    $current_session_id = session_id();

    $stmt = $mysqli->prepare("SELECT session_id FROM users WHERE id = ?");
    if (!$stmt) {
        error_log("Session Validity Check Prepare failed: (" . $mysqli->errno . ") " . $mysqli->error);
        return false;
    }
    $stmt->bind_param("i", $user_id);
    if (!$stmt->execute()) {
        error_log("Session Validity Check Execute failed: " . $stmt->error);
        $stmt->close();
        return false;
    }
    $result = $stmt->get_result();
    $is_valid = false;

    if ($result && $result->num_rows === 1) {
        $user = $result->fetch_assoc();
        if ($user['session_id'] === $current_session_id) {
            $is_valid = true;
        } else {
            // Log session mismatch for debugging, could indicate old session or attempted reuse
            error_log("Session ID mismatch for user ID $user_id. DB: '{$user['session_id']}', Current: '$current_session_id'. Invalidating session.");
        }
    } else {
        error_log("User ID $user_id not found in database during session validity check.");
    }
    $stmt->close();
    return $is_valid;
}

/**
 * Checks if the user is logged in and their session is valid.
 * Loads preferences into the session if not already present.
 *
 * @return bool True if logged in and session is valid, false otherwise.
 */
function is_logged_in(): bool {
    if (isset($_SESSION['user_id']) && check_session_validity()) {
        // Load preferences if they aren't in the session
        // This ensures preferences are available on each request if the session is valid
        if (!isset($_SESSION[PREF_KEY_SELECTED_TARGET_TYPES])) {
            $_SESSION[PREF_KEY_SELECTED_TARGET_TYPES] = get_user_preference(
                (int)$_SESSION['user_id'],
                PREF_KEY_SELECTED_TARGET_TYPES,
                [DEFAULT_TARGET_TYPE] // Default
            );
        }
        return true;
    }
    return false;
}

function is_admin(): bool {
    return is_logged_in() && isset($_SESSION['admin']) && $_SESSION['admin'] === true;
}

// --- Access Control ---
function force_login() {
    if (!is_logged_in()) {
        // More robust session destruction before redirect
        $_SESSION = array(); // Clear session array
        if (ini_get("session.use_cookies")) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000,
                $params["path"], $params["domain"],
                $params["secure"], $params["httponly"]
            );
        }
        @session_destroy(); // Suppress errors if session already destroyed or headers sent

        $redirect_url = $_SERVER['REQUEST_URI'];
        if (basename($_SERVER['PHP_SELF']) !== 'login.php') {
            header("Location: login.php?redirect=" . urlencode($redirect_url));
            exit; // Crucial to stop script execution after header
        }
        // If on login.php and not logged in, do nothing, let login page render.
    }
}

function force_admin() {
    force_login(); // Ensures user is logged in and session is valid
    if (!is_admin()) {
        // Consider a more user-friendly access denied page or message
        http_response_code(403); // Forbidden
        die("Access Denied: You do not have administrative privileges.");
    }
}

// --- Input Validation ---
function validate_username(string $username): bool {
    // Username: 3-20 chars, alphanumeric and underscores.
    // Consider if other characters should be allowed or if length constraints are different.
    return preg_match('/^[a-zA-Z0-9_]{3,20}$/', $username) === 1;
}

function validate_password(string $password): bool {
    // Password: min 8 chars, 1 uppercase, 1 lowercase, 1 number.
    // This is a common baseline; adjust complexity as per security policy.
    // Consider not enforcing this too strictly on login if password_verify will handle it,
    // but good for registration.
    return preg_match('/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/', $password) === 1;
}

function validate_email(string $email): bool {
    return filter_var($email, FILTER_VALIDATE_EMAIL) !== false;
}

// --- Core Authentication Logic ---
/**
 * Attempts to log in a user.
 * Handles single-session enforcement by invalidating old sessions.
 *
 * @param string $username The username.
 * @param string $password The password.
 * @return bool True on successful login, false otherwise.
 */
function login_user(string $username, string $password): bool {
    global $mysqli;

    if (!validate_username($username)) {
        error_log("Login attempt failed: Invalid username format for '{$username}'");
        return false;
    }
    // Password format validation on login is optional, as password_verify handles matching.
    // Useful primarily for providing specific feedback if formats are very strict.

    $stmt = $mysqli->prepare("SELECT id, username, password, admin, session_id FROM users WHERE username = ?");
    if (!$stmt) {
        error_log("Login User Prepare failed: (" . $mysqli->errno . ") " . $mysqli->error);
        return false;
    }
    $stmt->bind_param("s", $username);
    if (!$stmt->execute()) {
        error_log("Login User Execute failed: " . $stmt->error);
        $stmt->close();
        return false;
    }
    $result = $stmt->get_result();

    if ($result && $result->num_rows === 1) {
        $user = $result->fetch_assoc();
        $stmt->close();

        if (password_verify_my($password, $user['password'])) {
            // Password correct
            $old_session_id_from_db = $user['session_id'];

            // Regenerate session ID first to prevent session fixation *before* any DB operations
            // or session variable setting for the new session.
            if (!session_regenerate_id(true)) {
                error_log("Failed to regenerate session ID for user '{$username}'.");
                // This is a critical failure, might prevent further session operations.
                return false;
            }
            $new_session_id = session_id(); // Get the newly generated session ID

            // Invalidate old session file if it existed and is different from the new one
            if ($old_session_id_from_db !== null && $old_session_id_from_db !== $new_session_id) {
                $session_save_path = ini_get('session.save_path');
                if (empty($session_save_path)) { // Ensure session.save_path is configured
                    $session_save_path = sys_get_temp_dir(); // Fallback, but should be configured
                    error_log("session.save_path is not configured in php.ini, falling back to sys_get_temp_dir(). This is not recommended for production.");
                }
                $old_session_file_path = rtrim($session_save_path, '/\\') . DIRECTORY_SEPARATOR . 'sess_' . $old_session_id_from_db;

                if (file_exists($old_session_file_path)) {
                    if (!@unlink($old_session_file_path)) { // Suppress errors if file is gone, log failure
                        $error = error_get_last();
                        error_log("Failed to delete old session file '{$old_session_file_path}' for user '{$username}'. Error: " . ($error['message'] ?? 'Unknown unlink error'));
                        // Decide if this is a critical failure. Usually, we can proceed.
                    } else {
                        error_log("Successfully deleted old session file '{$old_session_file_path}' for user '{$username}'.");
                    }
                }
            }

            // Update user's session ID in the database
            $update_stmt = $mysqli->prepare("UPDATE users SET session_id = ? WHERE id = ?");
            if (!$update_stmt) {
                error_log("Login User DB Update Prepare failed: (" . $mysqli->errno . ") " . $mysqli->error);
                // Should we destroy the newly regenerated session? Yes, to be safe.
                @session_destroy();
                return false;
            }
            $user_id = (int)$user['id'];
            $update_stmt->bind_param("si", $new_session_id, $user_id);
            if (!$update_stmt->execute()) {
                error_log("Failed to update session ID in database for user '{$username}': " . $update_stmt->error);
                $update_stmt->close();
                @session_destroy();
                return false;
            }
            $update_stmt->close();

            // Set session variables for the new session
            $_SESSION['user_id'] = $user_id;
            $_SESSION['username'] = $user['username'];
            $_SESSION['admin'] = (bool)$user['admin'];
            $_SESSION[PREF_KEY_SELECTED_TARGET_TYPES] = get_user_preference(
                $user_id,
                PREF_KEY_SELECTED_TARGET_TYPES,
                [DEFAULT_TARGET_TYPE]
            );

            return true; // Login successful
        } else {
            error_log("Password verification failed for user '{$username}'.");
        }
    } else {
        if ($stmt) $stmt->close(); // Ensure statement is closed if it was prepared
        error_log("User '{$username}' not found or database query error during login.");
    }
    return false;
}

function logout_user() {
    global $mysqli;

    if (isset($_SESSION['user_id'])) {
        $user_id = (int)$_SESSION['user_id'];
        $stmt = $mysqli->prepare("UPDATE users SET session_id = NULL WHERE id = ?");
        if ($stmt) {
            $stmt->bind_param("i", $user_id);
            if (!$stmt->execute()) {
                error_log("Failed to clear session ID in database on logout for user ID {$user_id}: " . $stmt->error);
            }
            $stmt->close();
        } else {
            error_log("Logout DB Update Prepare failed: (" . $mysqli->errno . ") " . $mysqli->error);
        }
    }

    $_SESSION = array(); // Clear all session variables

    if (ini_get("session.use_cookies")) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000,
            $params["path"], $params["domain"],
            $params["secure"], $params["httponly"]
        );
    }
    @session_destroy(); // Destroy the session on the server
}