<?php session_start(); ?>
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

	</head>

	<body style="margin:0px;">
		<div id="tv_chart_container"></div>
	</body>

</html>
