<?php
require_once('auth.php');
force_login(); // Redirect to login page if not logged in

?>
<!DOCTYPE HTML>
<html>
<head>
    <title>AutoTarget - Lowmips.com - Powered by TradingView</title>
    <!-- Fix for iOS Safari zooming bug -->
    <meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,minimum-scale=1.0">
    <script type="text/javascript" src="charting_library/charting_library/charting_library.standalone.js"></script>
    <script type="text/javascript" src="charting_library/datafeeds/udf/dist/bundle.js"></script>
    <script type="text/javascript" src="robust-websocket/robust-websocket.js"></script>
    <!-- Custom datafeed module -->
    <script type="module" src="js/main.js"></script>
    <!-- Bootstrap CSS -->
    <link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/css/bootstrap.min.css">
    <!-- Bootstrap JavaScript (Popper.js and jQuery are required) -->
    <script src="https://code.jquery.com/jquery-3.5.1.slim.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/@popperjs/core@2.5.3/dist/umd/popper.min.js"></script>
    <script src="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/js/bootstrap.min.js"></script>
    <link rel="stylesheet" href="style.css">
</head>
<body style="margin:0px;">
<div style="background-color: #000; padding: 5px; margin-bottom: 0; font-size: 10px; color: #fff; line-height: 1; text-align: right; display: flex; justify-content: space-between; align-items: center;">
    <div style="text-align: left;">
        <?php if (is_admin()): ?>
            <div class="dropdown">
                <button class="dropbtn">Admin</button>
                <div class="dropdown-content">
                    <a href="#" data-toggle="modal" data-target="#newUserModal">New User</a>
                </div>
            </div>
        <?php endif; ?>
    </div>
    <div>
        Logged in as <?php echo htmlspecialchars($_SESSION['username']); ?>  <a href="logout.php" style="color: #fff;">Logout</a>
    </div>
</div>
<div id="tv_chart_container"></div>

<?php include 'dialogs/new_user_modal.php'; ?>

</body>
</html>