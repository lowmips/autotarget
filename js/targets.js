import { parseFullSymbol } from './helpers.js';

const ws_targets = new RobustWebSocket('wss://www.lowmips.com/autotarget/targets/');
let targetCache = {};
/*
ticker -> {
    cache -> shape_id -> {}
    shape_id_to_target -> shape_id -> [ts_start, price]
    target_to_shape_id -> ts_start -> price -> shape_id
    resolution_revise -> [target_id]
}
 */
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
    console.log('ws_targets [message]');
    //console.log(event.data);
    //console.log('    [origin] '+event.origin);

    let msg = JSON.parse(event.data);
    //console.log(msg);
    if('pair_info' in msg){
        let ticker = msg.pair_info.exchange + ':' + msg.pair_info.from_token + '/' + msg.pair_info.to_token;
        //console.log('Got pair_info['+ticker+']');
        if(!(ticker in subs)) {
            console.log('No subscription for ['+ticker+']');
            return;
        }
        if(!(ticker in targetCache)) targetCache[ticker] = {cache: {}, resolution_revise: []};

        if('updates' in msg){
            msg.updates.forEach((update) => {
                //console.log('Got update:');
                //console.log(update);




                let shape_points = [
                    { time: parseInt(update.ts_start), price: parseFloat(update.target_price) }
                ];
                //console.log('shape_points:');
                //console.log(shape_points);

                let shape_opts = {
                    shape: "horizontal_ray",
                    lock: true,
                    disableSelection: true,
                    overrides: {
                        //text: 'hi ya',
                        showLabel: false,
                        fontSize: 30,
                        horzLabelsAlign: 'left',
                        showPrice: false,
                    },
                };
                let shape_id = window.tvStuff.widget.activeChart().createMultipointShape(shape_points, shape_opts);
                targetCache[ticker][shape_id] = update;
            });
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
    if(ws_targets.readyState == 0){  // Websocket.CONNECTING
        console.log('ebsocket.CONNECTING, waiting....');
        setTimeout(startSub,500, ticker);
        return;
    }
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