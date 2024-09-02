<?php session_start(); ?>
<!DOCTYPE HTML>
<html>
<head>

    <title>AutoTarget - test</title>
    <script type="text/javascript" src="robust-websocket/robust-websocket.js"></script>
    <script type="text/javascript">
        const ws = new RobustWebSocket('wss://www.lowmips.com/autotarget/targets/');
        ws.addEventListener('open', function(event) {
            console.log('ws [open]');
        });
        ws.addEventListener('close', function(event) {
            console.log('ws [close]: ' + event.data)
        });
        ws.addEventListener('error', function(event) {
            console.log('ws [error]: ' + event.data)
        });
        ws.addEventListener('message', function(event) {
            console.log('ws [message]: ' + event.data)
        });


    </script>

</head>

<body style="margin:0px; color: black; background: black;">

</body>

</html>
