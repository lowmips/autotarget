import { parseFullSymbol } from './helpers.js';
import { colors }from './colors.js';

const ws_targets = new RobustWebSocket('wss://www.lowmips.com/autotarget/targets/');
let targetCache = {};
/*
ticker -> {
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
    //console.log('ws_targets [message]');
    //console.log(event.data);
    //console.log('    [origin] '+event.origin);
    let z = handleMsg(event.data);
});

async function handleMsg(msg_str){
    //console.log('handleMsg()');
    let msg = JSON.parse(msg_str);
    //console.log(msg);
    if('updates' in msg) await handleUpdateMsg(msg);
}

async function handleUpdateMsg(msg){
    //console.log('handleUpdates');
    if(!('pair_info' in msg)){
        console.log('Invalid update message, missing pair_info');
        return false;
    }
    let ticker = msg.pair_info.exchange + ':' + msg.pair_info.from_token + '/' + msg.pair_info.to_token;
    //console.log('Got pair_info['+ticker+']');
    if(!(ticker in subs)) {
        console.log('No subscription for ['+ticker+']');
        return;
    }
    if(!(ticker in targetCache)) targetCache[ticker] = {shape_id_to_target: {}, target_to_shape_id: {}, resolution_revise: []};
    msg.updates.forEach((update) => {
        //console.log('Got update:');
        //console.log(update);
        let ts_start = parseInt(update.ts_start);
        let ts_end = parseInt(update.ts_hit);
        let ts_latest = parseInt(update.ts_latest);
        let target_price = parseFloat(update.target_price);
        let target_count = parseInt(update.target_count);
        let new_target = {
            ts_start,
            ts_end,
            ts_latest,
            target_price,
            target_count,
        };

        // determine target color
        let target_color;
        switch(true){
            case (new_target.target_count == 1): target_color = colors.COLOR_TIER_1; break;
            case (new_target.target_count < 5): target_color = colors.COLOR_TIER_2; break;
            case (new_target.target_count < 10): target_color = colors.COLOR_TIER_3; break;
            case (new_target.target_count < 15): target_color = colors.COLOR_TIER_4; break;
            case (new_target.target_count < 20): target_color = colors.COLOR_TIER_5; break;
            case (new_target.target_count < 25): target_color = colors.COLOR_TIER_6; break;
            default: target_color = colors.COLOR_TIER_7;
        }
        let shape_type = (new_target.ts_end > new_target.ts_start?'trend_line':'horizontal_ray');

        // is there already a shape for this time/price?
        if(new_target.ts_start in targetCache[ticker]['target_to_shape_id'] &&
            new_target.target_price in targetCache[ticker]['target_to_shape_id'][new_target.ts_start]
        ){
            let existing_shape_id =  targetCache[ticker]['target_to_shape_id'][new_target.ts_start][new_target.target_price];
            let existing_target = targetCache[ticker]['shape_id_to_target'][existing_shape_id];

            // Is this a newly hit target?
            if(new_target.ts_end > 0 && existing_target.ts_end == 0){
                removeDrawing(ticker, existing_shape_id);
            }
            // Are we just updating target counts?
            if(new_target.ts_end == 0 && new_target.target_count != existing_target.target_count){
                let entity = window.tvStuff.widget.activeChart().getShapeById(existing_shape_id);
                let props = {
                    overrides: {
                    },
                };
                if(shape_type == 'horizontal_ray'){
                    props.overrides['linetoolhorzray.linecolor'] = target_color;
                }
                if(shape_type == 'trend_line'){
                    props.overrides['linetooltrendline.linecolor'] = target_color;
                }
                entity.setProperties(props);
                return;
            }
        }

        let shape_points = [];

        shape_points.push({ time: ts_start, price: target_price });
        if(shape_type == 'trend_line'){
            shape_points.push({ time: ts_end, price: target_price });
        }
        //console.log('shape_points:');
        //console.log(shape_points);

        let shape_opts = {
            shape: shape_type,
            lock: true,
            //disableSelection: true,
            disableUndo: true,
        };

        switch (shape_type){
            case 'horizontal_ray':
                shape_opts['overrides'] =
                    {
                        //text: 'hi ya',
                        showPrice: false,
                        showLabel: false,
                        linecolor: target_color,
                        //'linetoolhorzray.fontsize': 30,
                        //'linetoolhorzray.horzLabelsAlign': 'left',
                        //'linetoolhorzray.showLabel': false,
                        //'linetoolhorzray.showPrice': false,
                        //'linetoolhorzray.linecolor': target_color,

                    };
                break;
            case 'trend_line':
                shape_opts['overrides'] =
                    {
                        showPriceLabels: false,
                        showLabel: false,
                        linecolor: target_color,
                        //'linetooltrendline.linecolor': target_color,
                        //'linetooltrendline.showBarsRange': false,
                        //'linetooltrendline.showDateTimeRange': false,
                        //'linetooltrendline.showLabel': false,
                        //'linetooltrendline.showPriceLabels': false,
                        //'linetooltrendline.showPriceRange': false,
                    };
                break;
        }

        let shape_id = window.tvStuff.widget.activeChart().createMultipointShape(shape_points, shape_opts);
        targetCache[ticker]['shape_id_to_target'][shape_id] = new_target;
        if (!(ts_start in targetCache[ticker]['target_to_shape_id'])) targetCache[ticker]['target_to_shape_id'][ts_start] = {};
        if (!(target_price in targetCache[ticker]['target_to_shape_id'][ts_start])) targetCache[ticker]['target_to_shape_id'][ts_start][target_price] = shape_id;

        // is the timestamp correctly set? (shape drawing at large resolution issue)
        let shape = window.tvStuff.widget.activeChart().getShapeById(shape_id);
        let points = shape.getPoints();
        for(let idx in points){
            if(points[idx].time != shape_points[idx].time){
                console.log('shape_id['+shape_id+'] starting timestamp not correct!');
                if(targetCache[ticker]['resolution_revise'].indexOf(target_id) == -1)
                    targetCache[ticker]['resolution_revise'].push(target_id);
                break;
            }
        }

    });
}

async function removeDrawing(ticker, shape_id){
    console.log('removeDrawing('+ticker+','+shape_id+')');
    const index = targetCache[ticker]['resolution_revise'].indexOf(shape_id);
    if (index > -1) targetCache[ticker]['resolution_revise'].splice(index, 1);
    let target = targetCache[ticker]['shape_id_to_target'][shape_id];
    delete targetCache[ticker]['target_to_shape_id'][target.ts_start][target.target_price];
    delete targetCache[ticker]['shape_id_to_target'][shape_id];
    window.tvStuff.widget.activeChart().removeEntity(shape_id);
}


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