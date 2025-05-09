<?php
require_once('auth.php');
force_login(); // Must be logged in

header('Content-Type: application/json'); // Set content type for JSON response

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Expecting JSON payload
    $input = json_decode(file_get_contents('php://input'), true);

    if (isset($input['selected_types']) && is_array($input['selected_types'])) {
        $selected_types = array_map('strval', $input['selected_types']); // Sanitize to strings
        $user_id = $_SESSION['user_id'];

        // Optional: Validate selected_types against available types if needed

        if (save_user_preference($user_id, 'selected_target_types', $selected_types)) {
            $_SESSION['selected_target_types'] = $selected_types; // Update session immediately
            echo json_encode(['success' => true, 'message' => 'Preferences saved.']);
        } else {
            http_response_code(500); // Internal Server Error
            echo json_encode(['success' => false, 'message' => 'Failed to save preferences.']);
        }
    } else {
        http_response_code(400); // Bad Request
        echo json_encode(['success' => false, 'message' => 'Invalid data format. Expected selected_types array.']);
    }
} else {
    http_response_code(405); // Method Not Allowed
    echo json_encode(['success' => false, 'message' => 'Method not allowed. Use POST.']);
}
exit;
?>