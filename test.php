<?php session_start(); ?>
<!DOCTYPE HTML>
<html>
<head>

    <title>AutoTarget - test</title>
    <script type="text/javascript" src="robust-websocket/robust-websocket.js"></script>
    <script type="text/javascript">
        const ws = new RobustWebSocket('wss://www.lowmips.com/autotarget/targets/');
        ws.addEventListener('open', function(event) {
            console.log('ws [open]' + event);

            let channelString = '0~MEXC~BTC~USDT';
            let json_str = JSON.stringify({'SubAdd': { subs: [channelString] }});
            ws.send(json_str);

        });
        ws.addEventListener('close', function(event) {
            console.log('ws [close]: code['+event.code+'] reason['+event.reason+'] wasClean['+event.wasClean+']');
        });
        ws.addEventListener('error', function(event) {
            console.log('ws [error]: ' + event);
        });
        ws.addEventListener('message', function(event) {
            console.log('ws [message]: ' + event.data);
            console.log('    [origin] '+event.origin);
        });


    </script>

</head>

<body style="margin:0px; color: black; background: black;">

</body>

</html>
