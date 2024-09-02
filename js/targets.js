import { parseFullSymbol } from './helpers.js';

const ws_targets = new RobustWebSocket('wss://www.lowmips.com/autotarget/targets/');
const targetCache = {}; // exchange -> token_from -> token_to ->
let subs = {};

ws_targets.addEventListener('open', function(event) {
    console.log('ws_targets [open]' + event);
});
ws_targets.addEventListener('close', function(event) {
    console.log('ws_targets [close]: code['+event.code+'] reason['+event.reason+'] wasClean['+event.wasClean+']');
});
ws_targets.addEventListener('error', function(event) {
    console.log('ws_targets [error]: ' + event);
    subs = {};
});
ws_targets.addEventListener('message', function(event) {
    console.log('ws_targets [message]: ' + event.data);
    //console.log('    [origin] '+event.origin);

    let msg = JSON.parse(event.data);
    //console.log(msg);
    if('pair_info' in msg){
        let ticker = msg.exchange + ':' + msg.from_token + '/' + msg.to_token;
        if(!(ticker in subs)) {
            console.log('No subscription for ['+ticker+']');
            return;
        }
        if('updates' in msg){

        }
    }

});

export async function stopSub(ticker) {
    console.log('stopSub('+ticker+')');
    if(!(ticker in subs)) return;
    delete subs[ticker];
    const parsedSymbol = parseFullSymbol(ticker);
    const channelString = `0~${parsedSymbol.exchange}~${parsedSymbol.fromSymbol}~${parsedSymbol.toSymbol}`;
    let substr = JSON.stringify({
        'SubRemove': {
            'subs': [channelString],
        },
    });
    ws_targets.send(substr);
}

export async function startSub(ticker) {
    console.log('startSub('+ticker+')');
    if(ticker in subs) return;
    const parsedSymbol = parseFullSymbol(ticker);
    const channelString = `0~${parsedSymbol.exchange}~${parsedSymbol.fromSymbol}~${parsedSymbol.toSymbol}`;
    let substr = JSON.stringify({
        'SubAdd': {
            'subs': [channelString],
        },
    });
    ws_targets.send(substr);
    subs[ticker] = 1;
}