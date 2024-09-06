import { parseFullSymbol } from './helpers.js';
import { colors }from './colors.js';

const ws_targets = new RobustWebSocket('wss://www.lowmips.com/autotarget/targets/');
let targetCache = {};
window.targetCache = targetCache;
/*
    ticker -> {
        shape_id_to_target -> shape_id -> [targets]
        target_to_shape_id -> ts_start -> price -> shape_id
        resolution_revise -> resolution_when_set -> [shape_ids]
        earliest_target_ts -> [ts] # "ts_latest" timestamp of the earliest target we have so far
    }
*/
let subs = {};
let max_history_targets = 10000;


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

export function getTargets(max){
    let ticker = window.tvStuff.current_symbol;
    let earliest_ts = null;
    let from_ts;

    if(!(ticker in targetCache) || (targetCache[ticker]['earliest_target_ts'] === null))
        from_ts = parseInt(new Date().getTime()/1000);
    else
        from_ts = targetCache[ticker]['earliest_target_ts'];

    // https://www.lowmips.com/autotarget/ajax-handlers/get_targets.php?ticker=MEXC:BTC/USDT&from=1725534247&max=100
    const request_url = window.location.href + 'ajax-handlers/get_targets.php?ticker=' + ticker + '&from=' + from_ts + '&max=' + max;
    fetch(request_url)
        .then((response) => {
            if (response.ok) {
                return response.json();
            }
            throw new Error('Something went wrong');
        })
        .then((responseJson) => {
            handleUpdateMsg(responseJson, true);
        })
        .catch((error) => {
            console.log(error);
        });

}
window.getTargets = getTargets;

export function checkEarliestTarget(){
    console.log('checkEarliestTarget()');
    let ticker = window.tvStuff.current_symbol;
    let earliestBar = window.tvStuff.widget.activeChart().getSeries().data().first().timeMs / 1000;
    let latestBar = window.tvStuff.widget.activeChart().getSeries().data().last().timeMs / 1000;


    if(earliestBar === null) return;
    earliestBar = parseInt(earliestBar);
    let max;
    if(!(ticker in targetCache) || (targetCache[ticker]['earliest_target_ts'] === null )){

    }

}

async function handleMsg(msg_str){
    //console.log('handleMsg()');
    let msg = JSON.parse(msg_str);
    //console.log(msg);
    if('updates' in msg) await handleUpdateMsg(msg);
}

async function handleUpdateMsg(msg, sendtoback){
    //console.log('handleUpdates');

    if((typeof sendtoback) != 'boolean') sendtoback = false;
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
    if(!(ticker in targetCache))
        targetCache[ticker] = {
            shape_id_to_target: {},
            target_to_shape_id: {},
            resolution_revise: {},
            earliest_target_ts: null,
        };
    let potential_ranges = [];

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

        // check groups stuff
        if(!(ts_start in potential_ranges)){
            potential_ranges[ts_start] = {
                count: 0,
                high: null,
                low: null,
            };
        }
        potential_ranges[ts_start]['count']++;
        if(potential_ranges[ts_start]['high']===null || potential_ranges[ts_start]['high'] < target_price) potential_ranges[ts_start]['high'] = target_price;
        if(potential_ranges[ts_start]['low']===null || potential_ranges[ts_start]['low'] > target_price) potential_ranges[ts_start]['low'] = target_price;

        // update earliest ts_latest
        if(targetCache[ticker]['earliest_target_ts'] === null || ts_latest < targetCache[ticker]['earliest_target_ts']) targetCache[ticker]['earliest_target_ts'] = ts_latest;

        // determine target color
        let target_color;
        switch(true){
            case (new_target.target_count === 1): target_color = colors.COLOR_TIER_1; break;
            case (new_target.target_count < 5): target_color = colors.COLOR_TIER_3; break;
            case (new_target.target_count < 10): target_color = colors.COLOR_TIER_5; break;
            case (new_target.target_count < 15): target_color = colors.COLOR_TIER_7; break;
            case (new_target.target_count < 20): target_color = colors.COLOR_TIER_9; break;
            case (new_target.target_count < 25): target_color = colors.COLOR_TIER_10; break;
            default: target_color = colors.COLOR_TIER_10;
        }
        let shape_type = (new_target.ts_end > new_target.ts_start?'trend_line':'horizontal_ray');
        new_target['shape_type'] = shape_type;

        // is there already a shape for this time/price?
        if(new_target.ts_start in targetCache[ticker]['target_to_shape_id'] &&
            new_target.target_price in targetCache[ticker]['target_to_shape_id'][new_target.ts_start]
        ){
            let existing_shape_id =  targetCache[ticker]['target_to_shape_id'][new_target.ts_start][new_target.target_price];
            let existing_target = targetCache[ticker]['shape_id_to_target'][existing_shape_id];

            // Is this a newly hit target?
            if(new_target.ts_end > 0 && existing_target.ts_end === 0){
                removeDrawing(ticker, existing_shape_id);
            }
            // Are we just updating target counts?
            if(new_target.ts_end === 0 && new_target.target_count !== existing_target.target_count){
                let entity = window.tvStuff.widget.activeChart().getShapeById(existing_shape_id);
                let props = {overrides: {},};
                if(shape_type === 'horizontal_ray'){
                    props.overrides['linetoolhorzray.linecolor'] = target_color;
                }
                if(shape_type === 'trend_line'){
                    props.overrides['linetooltrendline.linecolor'] = target_color;
                }
                entity.setProperties(props);
                return;
            }
        }

        let shape_points = [];
        shape_points.push({ time: ts_start, price: target_price });
        if(shape_type === 'trend_line'){
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
                        visible: (target_count >= window.tvStuff.targets.filtering.target_count.min),
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
                        visible: (target_count >= window.tvStuff.targets.filtering.target_count.min),
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
        let shape = window.tvStuff.widget.activeChart().getShapeById(shape_id);
        if(sendtoback && ('sendToBack' in shape))
            shape.sendToBack();
        else if('sendToFront' in shape)
            shape.sendToFront();
        targetCache[ticker]['shape_id_to_target'][shape_id] = new_target;
        if (!(ts_start in targetCache[ticker]['target_to_shape_id'])) targetCache[ticker]['target_to_shape_id'][ts_start] = {};
        if (!(target_price in targetCache[ticker]['target_to_shape_id'][ts_start])) targetCache[ticker]['target_to_shape_id'][ts_start][target_price] = shape_id;
        checkDrawingStart(ticker, shape_id, shape_points);    // did the drawing start at the correct timestamp?
    });


    // check ranges
    if(window.tvStuff.ranges.highlight) {
        for (let ts_start in potential_ranges) {
            let r = potential_ranges[ts_start];
            if (r['count'] < 2) continue;
            let distance_percent = 1 - (r['low'] / r['high']);
            if (distance_percent < window.tvStuff.ranges.min_distance) continue;
            let shape_points = [];
            shape_points.push({time: parseInt(ts_start), price: parseFloat(r['high'])});
            shape_points.push({time: parseInt(ts_start), price: parseFloat(r['low'])});
            let shape_opts = {
                shape: "trend_line",
                lock: true,
                //disableSelection: true,
                disableUndo: true,
            };
            shape_opts['overrides'] =
                {
                    showPriceLabels: false,
                    showLabel: false,
                    linecolor: window.tvStuff.ranges.color,
                    linewidth: 1,
                };
            let shape_id = window.tvStuff.widget.activeChart().createMultipointShape(shape_points, shape_opts);
            let shape = window.tvStuff.widget.activeChart().getShapeById(shape_id);
            shape.sendToBack();
            targetCache[ticker]['shape_id_to_target'][shape_id] =
                {
                    is_range: true,
                    shape_points: shape_points,
                };
            //console.log(shape_id);
            checkDrawingStart(ticker, shape_id, shape_points);
        }
    }

}

function checkDrawingStart(ticker, shape_id, shape_points){
    //console.log('checkDrawingStart('+ticker+','+shape_id+')');
    // is the timestamp correctly set? (shape drawing at large resolution issue)
    // if not, add to list of drawings whose resolution needs to be fixed
    let current_resolution = window.tvStuff.current_resolution;
    let shape = window.tvStuff.widget.activeChart().getShapeById(shape_id);
    let points = shape.getPoints();
    //let target = targetCache[ticker]['shape_id_to_target'][shape_id];
    for(let idx in points){
        if(points[idx].time !== shape_points[idx].time){
            console.log('shape_id['+shape_id+'] starting timestamp not correct!');
            if(!(current_resolution in targetCache[ticker]['resolution_revise']))
                targetCache[ticker]['resolution_revise'][current_resolution] = [];
            if(targetCache[ticker]['resolution_revise'][current_resolution].indexOf(shape_id) === -1)
                targetCache[ticker]['resolution_revise'][current_resolution].push(shape_id);
            break;
        }
    }
}

export function checkFixDrawingsResolution(){
    //console.log('checkFixDrawingsResolution()');
    let ticker = window.tvStuff.current_symbol;
    if(!(ticker in targetCache)){
        //console.log('ticker['+ticker+'] not in targetCache');
        return;
    }
    let current_resolution = window.tvStuff.current_resolution;
    let revisions = targetCache[ticker]['resolution_revise'];
    //console.log('current_resolution: '+current_resolution);
    //console.log(revisions);
    for(let resolution_when_set in revisions){
        if(current_resolution >= resolution_when_set) continue;
        //console.log('Checking resolution_when_set['+resolution_when_set+']');
        let revs = revisions[resolution_when_set];
        let revs_len = revs.length;
        while(revs_len--){
            let shape_id = revs[revs_len];
            //console.log('shape_id: '+shape_id);
            let target = targetCache[ticker]['shape_id_to_target'][shape_id];
            let shape_type = (('is_range' in target)?'is_range':target.shape_type);
            let entity = window.tvStuff.widget.activeChart().getShapeById(shape_id);
            let shape_points = [];
            let original_shape_points = entity.getPoints();
            let original_start_ts = original_shape_points[0].time;
            let original_end_ts = (original_shape_points.length > 1?original_shape_points[1].time:null);
            let target_start_ts;
            let target_end_ts;

            // Build the correct points
            if(shape_type === 'is_range'){
                target_start_ts = target.shape_points[0].time;
                target_end_ts = target.shape_points[1].time;
                shape_points.push(target.shape_points[0]);
                shape_points.push(target.shape_points[1]);
            }else{
                target_start_ts = target.ts_start;
                shape_points.push({ time: target.ts_start, price: target.target_price });
                if(shape_type === 'trend_line'){
                    target_end_ts = target.ts_end;
                    shape_points.push({ time: target.ts_end, price: target.target_price });
                }

            }

            // Attempt to set the correct points
            entity.setPoints(shape_points);

            // Did it work?
            let current_start_ts =  parseInt(entity.getPoints()[0].time);
            let current_end_ts = (target.shape_type === 'trend_line')? parseInt(entity.getPoints()[1].time):null;
            if(current_start_ts === target_start_ts && current_end_ts === target_end_ts){
                // it worked! remove from original revision list.
                revs.splice(revs_len, 1);
            } else if(current_start_ts === original_start_ts && current_end_ts === original_end_ts){
                // nothing changed
            } else{
                // partial success. move to finer time frame.
                revs.splice(revs_len, 1);
                if(!(current_resolution in revisions)) revisions[current_resolution] = [];
                revisions[current_resolution].push(shape_id);
            }
        }
    }
}

export function hideDrawingsByTargetCount(){
    let ticker = window.tvStuff.current_symbol;
    for(let shape_id in window.targetCache[ticker]['shape_id_to_target']){
        let target = window.targetCache[ticker]['shape_id_to_target'][shape_id];
        if('is_range' in target) continue;
        if(!('target_count' in target)) continue;
        let shape = window.tvStuff.widget.activeChart().getShapeById(shape_id);
        if(target.target_count >= window.tvStuff.targets.filtering.target_count.min) shape.setProperties({visible: true});
        else shape.setProperties({visible: false});
    }
}
window.hideDrawingsByTargetCount = hideDrawingsByTargetCount;

async function removeDrawing(ticker, shape_id){
    console.log('removeDrawing('+ticker+','+shape_id+')');
    for(let resolution_when_set in targetCache[ticker]['resolution_revise']){
        let revisions = targetCache[ticker]['resolution_revise'][resolution_when_set];
        const index = revisions.indexOf(shape_id);
        if (index > -1) revisions.splice(index, 1);
    }
    let target = targetCache[ticker]['shape_id_to_target'][shape_id];
    delete targetCache[ticker]['target_to_shape_id'][target.ts_start][target.target_price];
    delete targetCache[ticker]['shape_id_to_target'][shape_id];
    window.tvStuff.widget.activeChart().removeEntity(shape_id);
}


export async function stopTargetsSub(ticker) {
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

export async function startTargetsSub(ticker) {
    //console.log('startSub('+ticker+')');
    if(ticker in subs) return;
    if(ws_targets.readyState == 0){  // Websocket.CONNECTING
        //console.log('websocket.CONNECTING, waiting....');
        setTimeout(startTargetsSub,500, ticker);
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