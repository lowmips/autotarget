<?php
require_once('auth.php');
force_login(); // Redirect to login page if not logged in

global $mysqli; // Assuming $mysqli is your connection object from mysqli.php

// --- Dynamically Fetch Available Target Types ---
$available_target_types = [];
// DEFAULT_TARGET_TYPE is defined in auth.php

// Query the database for distinct target types, excluding 'all'
$types_query = "SELECT DISTINCT target_type FROM target_groups_latest WHERE target_type IS NOT NULL AND target_type != 'all' ORDER BY target_type";
$types_result = $mysqli->query($types_query);

if ($types_result) {
    while ($row = $types_result->fetch_assoc()) {
        $available_target_types[] = $row['target_type'];
    }
    $types_result->free(); // Free the result set
} else {
    error_log("Failed to query available target types: " . $mysqli->error);
    // Fallback in case of query error
    $available_target_types = [DEFAULT_TARGET_TYPE];
}

// Ensure the default type is included if the query somehow missed it or was empty
if (!in_array(DEFAULT_TARGET_TYPE, $available_target_types) && !empty($available_target_types)) {
    // If default is missing but others exist, add it first for consistency
    array_unshift($available_target_types, DEFAULT_TARGET_TYPE);
} elseif (empty($available_target_types)) {
    // If the query returned absolutely nothing, use only the default
    $available_target_types = [DEFAULT_TARGET_TYPE];
}
// --- End Dynamic Fetch ---


// Ensure selected types are valid and available (sync session with available types)
// PREF_KEY_SELECTED_TARGET_TYPES is defined in auth.php
$selected_target_types = $_SESSION[PREF_KEY_SELECTED_TARGET_TYPES] ?? [DEFAULT_TARGET_TYPE]; // Load from session or use default
$selected_target_types = array_intersect($selected_target_types, $available_target_types); // Filter based on actually available types

// If the intersection resulted in an empty selection (e.g., saved prefs were for types no longer available),
// reset to default or the first available type.
if (empty($selected_target_types)) {
    if (in_array(DEFAULT_TARGET_TYPE, $available_target_types)) {
        $selected_target_types = [DEFAULT_TARGET_TYPE];
    } elseif (!empty($available_target_types)) {
        $selected_target_types = [$available_target_types[0]]; // Select the first available one
    } else {
        // Should not happen if fallback above works, but defensively set to empty array
        $selected_target_types = [];
    }
}
$_SESSION[PREF_KEY_SELECTED_TARGET_TYPES] = $selected_target_types; // Update session with the clean list


?>
<!DOCTYPE HTML>
<html>
<head>
    <title>AutoTarget - Lowmips.com - Powered by TradingView</title>
    <!-- Fix for iOS Safari zooming bug -->
    <meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,minimum-scale=1.0">
    <!-- Charting Library -->
    <script type="text/javascript" src="charting_library/charting_library/charting_library.standalone.js"></script>
    <script type="text/javascript" src="charting_library/datafeeds/udf/dist/bundle.js"></script>
    <!-- Robust Websocket -->
    <script type="text/javascript" src="robust-websocket/robust-websocket.js"></script>
    <!-- Bootstrap CSS -->
    <link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/css/bootstrap.min.css">
    <!-- Custom CSS -->
    <link rel="stylesheet" href="style.css">
    <!-- Bootstrap requires jQuery and Popper.js -->
    <script src="https://code.jquery.com/jquery-3.5.1.min.js"></script> <!-- Use full jQuery for AJAX -->
    <script src="https://cdn.jsdelivr.net/npm/@popperjs/core@2.5.3/dist/umd/popper.min.js"></script>
    <script src="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/js/bootstrap.min.js"></script>
    <!-- Custom JS (Load main.js last or use DOMContentLoaded) -->
    <script type="module" src="js/main.js"></script>

    <script type="text/javascript">
        // Pass PHP variables to JavaScript
        window.tvStuff = window.tvStuff || {}; // Ensure tvStuff exists
        // Pass the dynamically fetched available types
        window.tvStuff.availableTargetTypes = <?php echo json_encode($available_target_types); ?>;
        // Pass the validated selected types from the session
        window.tvStuff.selectedTargetTypes = <?php echo json_encode($selected_target_types); ?>;
        // Current symbol can be initialized here if needed, or set later by main.js/TV widget
        window.tvStuff.current_symbol = 'MEXC:BTC/USDT'; // Example, ensure this aligns with your default
    </script>

</head>
<body>
<div class="top-bar">
    <div class="top-bar-left">
        <!-- Target Type Selector Dropdown -->
        <div class="dropdown mr-2"> <!-- Added margin-right for spacing -->
            <button class="dropbtn" type="button" id="targetTypeDropdown" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
                Target Types
            </button>
            <div class="dropdown-menu p-2 target-type-dropdown-menu" aria-labelledby="targetTypeDropdown" id="targetTypeDropdownMenu">
                <form id="targetTypeForm">
                    <!-- Checkboxes will be populated by JavaScript using window.tvStuff.availableTargetTypes -->
                    <button type="button" class="btn btn-primary btn-sm btn-block mt-2" id="applyTargetTypes">Apply</button>
                </form>
            </div>
        </div>

        <?php if (is_admin()): ?>
            <div class="dropdown">
                <button class="dropbtn">Admin</button>
                <div class="dropdown-content">
                    <a href="#" data-toggle="modal" data-target="#newUserModal">New User</a>
                </div>
            </div>
        <?php endif; ?>
    </div>
    <div class="top-bar-right">
        Logged in as <?php echo htmlspecialchars($_SESSION['username']); ?>  <a href="logout.php">Logout</a>
    </div>
</div>
<div id="tv_chart_container"></div>

<?php if (is_admin()) { include 'dialogs/new_user_modal.php'; } ?>

</body>
</html>