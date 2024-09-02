const ws_targets = new RobustWebSocket('wss://www.lowmips.com/autotarget/targets/');
const targetCache = {}; // exchange -> token_from -> token_to ->


ws_targets.addEventListener('open', function(event) {
    console.log('ws_targets [open]' + event);
});
ws_targets.addEventListener('close', function(event) {
    console.log('ws_targets [close]: code['+event.code+'] reason['+event.reason+'] wasClean['+event.wasClean+']');
});
ws_targets.addEventListener('error', function(event) {
    console.log('ws_targets [error]: ' + event);
});
ws_targets.addEventListener('message', function(event) {
    console.log('ws_targets [message]: ' + event.data);
    console.log('    [origin] '+event.origin);
});

export default {


}