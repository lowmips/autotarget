<?php
// dialogs/new_user_modal.php
// This file is included in index.php, so auth.php is already included and force_login() called.
// We only process the form if the user is an admin.

$modal_registration_error = '';   // Use a different variable name to avoid conflicts
$modal_registration_success = ''; // if index.php has similar vars.

if (is_admin() && $_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['new_user_submit'])) {
    $username = $_POST['username_modal'] ?? ''; // Use unique names for modal inputs
    $password = $_POST['password_modal'] ?? '';
    $email = $_POST['email_modal'] ?? '';
    $admin_flag = isset($_POST['admin_modal']) && $_POST['admin_modal'] === '1';

    global $mysqli; // From the including file (index.php -> auth.php -> mysqli.php)

    // Validate input
    if (empty($username) || empty($password) || empty($email)) {
        $modal_registration_error = 'All fields are required.';
    } elseif (!validate_username($username)) { // Assuming validate_username is from auth.php
        $modal_registration_error = 'Invalid username format (3-20 chars, alphanumeric, underscore).';
    } elseif (!validate_password($password)) { // Assuming validate_password is from auth.php
        $modal_registration_error = 'Invalid password format (min 8 chars, 1 upper, 1 lower, 1 digit).';
    } elseif (!validate_email($email)) { // Assuming validate_email is from auth.php
        $modal_registration_error = 'Invalid email format.';
    } else {
        // Sanitize input (already done by prepared statements mostly, but good for non-DB use)
        // $username_clean = $mysqli->real_escape_string($username); // Not needed if using prepared statements correctly
        // $email_clean = $mysqli->real_escape_string($email);

        // Hash the password
        $hashed_password = password_hash_my($password);

        // Check if the username or email already exists using prepared statements
        $stmt_check = $mysqli->prepare("SELECT id FROM users WHERE username = ? OR email = ?");
        if (!$stmt_check) {
            $modal_registration_error = 'Database error (check prep).';
        } else {
            $stmt_check->bind_param("ss", $username, $email);
            $stmt_check->execute();
            $result_check = $stmt_check->get_result();

            if ($result_check && $result_check->num_rows > 0) {
                $existing_user = $result_check->fetch_assoc();
                if (strcasecmp($existing_user['username'], $username) == 0) { // Case-insensitive check for username
                    $modal_registration_error = 'Username already exists.';
                } else {
                    $modal_registration_error = 'Email already exists.';
                }
            } else {
                // Insert the new user into the database
                $stmt_insert = $mysqli->prepare("INSERT INTO users (username, password, email, admin) VALUES (?, ?, ?, ?)");
                if (!$stmt_insert) {
                    $modal_registration_error = 'Database error (insert prep).';
                } else {
                    $admin_int = $admin_flag ? 1 : 0; // Convert boolean to int for DB
                    $stmt_insert->bind_param("sssi", $username, $hashed_password, $email, $admin_int);

                    if ($stmt_insert->execute()) {
                        $modal_registration_success = 'User registered successfully!';
                        // Clear form fields by not re-populating them (handled by page reload or JS)
                    } else {
                        $modal_registration_error = 'Registration failed: ' . $stmt_insert->error;
                    }
                    $stmt_insert->close();
                }
            }
            $stmt_check->close();
        }
    }
    // Store messages in session to survive a potential redirect or to be picked up by JS
    // This is useful if you decide to handle form submission with a full page reload
    // instead of pure AJAX inside the modal (which is more complex for this simple case).
    if ($modal_registration_error) $_SESSION['modal_registration_error'] = $modal_registration_error;
    if ($modal_registration_success) $_SESSION['modal_registration_success'] = $modal_registration_success;

    // If submitting within the modal, we might not redirect, but rather update the modal content with JS.
    // For now, this PHP will re-render the modal if index.php is reloaded after POST.
    // A better UX would use AJAX to submit the form and update the modal without page reload.
}

// Retrieve messages from session if they exist (e.g., after a POST causing page reload)
if (isset($_SESSION['modal_registration_error'])) {
    $modal_registration_error = $_SESSION['modal_registration_error'];
    unset($_SESSION['modal_registration_error']);
}
if (isset($_SESSION['modal_registration_success'])) {
    $modal_registration_success = $_SESSION['modal_registration_success'];
    unset($_SESSION['modal_registration_success']);
}

?>
<!-- New User Modal -->
<div class="modal fade" id="newUserModal" tabindex="-1" role="dialog" aria-labelledby="newUserModalLabel" aria-hidden="true">
    <div class="modal-dialog" role="document">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title" id="newUserModalLabel">New User Registration</h5>
                <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                    <span aria-hidden="true">&times;</span>
                </button>
            </div>
            <div class="modal-body">
                <?php if (!empty($modal_registration_success)): ?>
                    <div class="alert alert-success" role="alert"><?php echo htmlspecialchars($modal_registration_success); ?></div>
                <?php endif; ?>
                <?php if (!empty($modal_registration_error)): ?>
                    <div class="alert alert-danger" role="alert"><?php echo htmlspecialchars($modal_registration_error); ?></div>
                <?php endif; ?>
                <!-- The form action can be empty to submit to the current page (index.php) -->
                <form method="post" action="<?php echo htmlspecialchars($_SERVER["PHP_SELF"]); ?>">
                    <div class="form-group">
                        <label for="username_modal">Username:</label>
                        <input type="text" class="form-control" id="username_modal" name="username_modal" required>
                    </div>
                    <div class="form-group">
                        <label for="password_modal">Password:</label>
                        <input type="password" class="form-control" id="password_modal" name="password_modal" required>
                    </div>
                    <div class="form-group">
                        <label for="email_modal">Email:</label>
                        <input type="email" class="form-control" id="email_modal" name="email_modal" required>
                    </div>
                    <div class="form-group">
                        <div class="form-check">
                            <input type="checkbox" class="form-check-input" id="admin_modal" name="admin_modal" value="1">
                            <label class="form-check-label" for="admin_modal">Admin</label>
                        </div>
                    </div>
                    <button type="submit" class="btn btn-primary" name="new_user_submit">Register User</button>
                </form>
            </div>
        </div>
    </div>
</div>
<script>
    // Optional: Script to clear modal form/messages when hidden if not using AJAX submission that handles this.
    // Or if form is submitted via POST and page reloads, PHP handles showing messages.
    // If you want to clear messages when modal is manually closed:
    /*
    $('#newUserModal').on('hidden.bs.modal', function (e) {
        // Clear any success/error messages displayed inside the modal
        $(this).find('.alert-success').remove();
        $(this).find('.alert-danger').remove();
        // Optionally reset form fields
        // $(this).find('form')[0].reset();
    });
    */
    // If form submission via POST causes a page reload, PHP should handle displaying messages.
    // This script could be used if the modal is shown again without a full reload.
    <?php if (!empty($modal_registration_error) || !empty($modal_registration_success)): ?>
    // If there was a submission (error or success), re-open the modal on page load.
    // This is a simple way to show feedback if not using full AJAX for the modal form.
    $(document).ready(function(){
        $('#newUserModal').modal('show');
    });
    <?php endif; ?>
</script>