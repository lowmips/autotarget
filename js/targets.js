import { parseFullSymbol } from './helpers.js';
import { colors }from './colors.js';
import {addItem, waitForAndRemoveItem} from "./waitqueue.js";

const ws_targets = new RobustWebSocket('wss://www.lowmips.com/autotarget/targets/',{
    shouldReconnect: function(event, ws) {
        if (event.code === 1008 || event.code === 1011) return;
        return Math.pow(1.5, ws.attempts) * 500;
    }
});
let targetCache = {};
window.targetCache = targetCache;
function addTickerToCache(ticker){
    if(!(ticker in targetCache))
        targetCache[ticker] = {
            shape_id_to_target: {},
            target_to_shape_id: {},
            range_to_shape_id: {},
            range_id_to_fib_id: {},
            resolution_revise: [],
            earliest_target_ts: null,
            latest_target_ts: null,
        };
}

/*
    ticker -> {
        shape_id_to_target -> shape_id -> target
        shape_id_to_subtargets -> shape_id -> [targets]
        target_to_shape_id -> ts_start -> price -> shape_id
        range_to_shape_id -> ts -> target_type -> shape_id
        range_id_to_fib_id -> id -> id
        resolution_revise -> [shape_ids]
        earliest_target_ts -> [ts] # "ts_latest" timestamp of the earliest target we have so far, for requesting more when the chart is scrolled
        latest_targets_ts -> [ts]
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

export function getTargets(min_ts){
    //console.log('getTargets('+min_ts+')');
    let ticker = window.tvStuff.current_symbol;
    let earliest_ts = null;
    let from_ts;
    let min_target_count = window.tvStuff.targets.requesting.target_count.min;

    if(!(ticker in targetCache) || (targetCache[ticker]['earliest_target_ts'] === null))
        from_ts = parseInt(new Date().getTime()/1000);
    else
        from_ts = targetCache[ticker]['earliest_target_ts'];

    // https://www.lowmips.com/autotarget/ajax-handlers/get_targets.php?ticker=MEXC:BTC/USDT&from=1725534247&max=100
    const request_url = location.protocol + '//' + location.host + location.pathname+ 'ajax-handlers/get_targets.php?' +
        'ticker=' + ticker +
        '&from=' + from_ts +
        '&min_ts=' + min_ts +
        '&min_target_count=' + min_target_count;
    fetch(request_url)
        .then((response) => {
            //console.log('getTargets() - response handler')
            if (response.ok) {
                //console.log('getTargets() - response is OK');
                //return response.json();
                response.text().then((text) => {
                    handleMsg(text);
                });
                return true;
            }
            throw new Error('Something went wrong');
        })
        /*.then((responseJson) => {
            handleTargetMsg(responseJson, true);
            handleRangeMsg(responseJson);
        })*/
        .catch((error) => {
            console.log(error);
        });

}

export function checkEarliestTarget(){
    console.log('checkEarliestTarget()');
    let ticker = window.tvStuff.current_symbol;
    let earliestBar = window.tvStuff.widget.activeChart().getSeries().data().first().timeMs / 1000;
    let latestBar = window.tvStuff.widget.activeChart().getSeries().data().last().timeMs / 1000;
    console.log('ticker['+ticker+'] earliestBar['+earliestBar+'] latestBar['+latestBar+']');
    //if(ticker in targetCache)
        //console.log('targetCache[ticker][\'earliest_target_ts\']: '+targetCache[ticker]['earliest_target_ts']);
    if(earliestBar === null || latestBar === null) return;
    let z = checkFixDrawingsResolution();
    if((ticker in targetCache) && targetCache[ticker]['earliest_target_ts'] <= earliestBar) return;
    getTargets(earliestBar);
}

async function handleMsg(msg_str){
    //console.log('handleMsg()');
    //console.log(msg_str);
    let msg = JSON.parse(msg_str);
    //console.log(msg);
    //if('targets' in msg) await handleTargetMsg(msg);
    if('targets' in msg)
        handleTargetMsg(msg).then(result => {
            console.log('handleMsg ==> handleTargetMsg promise is done!');
        }).catch(error => alert(error.message));

    if('ranges' in msg) await handleRangeMsg(msg);
    //else console.log('no ranges in msg??');

    //console.log('here....');
}

async function handleRangeMsg(msg) {
    //console.log('handleRangeMsg');
    if(!('pair_info' in msg)){
        console.log('Invalid update message, missing pair_info');
        return true;
    }
    let ticker = msg.pair_info.exchange + ':' + msg.pair_info.from_token + '/' + msg.pair_info.to_token;
    /*if(!(ticker in subs)) {
        console.log('No subscription for ['+ticker+']');
        return true;
    }*/
    addTickerToCache(ticker);

    //console.log('looping ranges...');
    msg.ranges.forEach((update) => {
        let ts = parseInt(update.ts);
        let price_high = parseFloat(update.price_high);
        let price_low = parseFloat(update.price_low);
        let price_when_made = parseFloat(update.price_when_made);
        let target_count = parseInt(update.target_count);
        let target_type = update.target_type;

        // do we already have this range?
        if((target_type in targetCache[ticker]['range_to_shape_id']) &&
            (ts in targetCache[ticker]['range_to_shape_id'][target_type])) return;

        let shape_points = [];
        shape_points.push({time: ts, price: price_high});
        shape_points.push({time: ts, price: price_low});
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

        // add to tracking structure
        targetCache[ticker]['shape_id_to_target'][shape_id] =
            {
                is_range: true,
                price_when_made: price_when_made,
                shape_points: shape_points,
            };
        //console.log(shape_id);
        if(!(target_type in targetCache[ticker]['range_to_shape_id'])) targetCache[ticker]['range_to_shape_id'][target_type] = {}
        targetCache[ticker]['range_to_shape_id'][target_type][ts] = shape_id

        checkDrawingStart(ticker, shape_id, shape_points);
    });
    return true;
}

/*export function toggleRanges(show){
    let ticker = window.tvStuff.current_symbol;
    if(!(ticker in targetCache)) return;
    for(let shape_id in targetCache[ticker]['shape_id_to_target']){
        let is_range = targetCache[ticker]['shape_id_to_target'][shape_id].is_range;
        if(!is_range) continue;
        let shape = window.tvStuff.widget.activeChart().getShapeById(shape_id);
        shape.setProperties({visible: show});
    }
}*/

async function handleTargetMsg(msg, sendtoback){
    //console.log('handleTargetMsg');

    if((typeof sendtoback) != 'boolean') sendtoback = false;
    if(!('pair_info' in msg)){
        console.log('Invalid update message, missing pair_info');
        return false;
    }
    let ticker = msg.pair_info.exchange + ':' + msg.pair_info.from_token + '/' + msg.pair_info.to_token;
    //console.log('Got pair_info['+ticker+']');
    /*if(!(ticker in subs)) {
        console.log('No subscription for ['+ticker+']');
        return true;
    }*/
    addTickerToCache(ticker);

    //console.log('looping targets...');
    msg.targets.forEach((update) => {
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

        //if(target_price != 62690.22) return;

        if(target_count < window.tvStuff.targets.requesting.target_count.min) return;

        // update earliest/latest ts_latest
        if(targetCache[ticker]['earliest_target_ts'] === null || ts_latest < targetCache[ticker]['earliest_target_ts']) targetCache[ticker]['earliest_target_ts'] = ts_latest;
        if(targetCache[ticker]['latest_target_ts'] === null || ts_latest > targetCache[ticker]['latest_target_ts']) targetCache[ticker]['latest_target_ts'] = ts_latest;

        // determine target color
        let target_color;
        let target_tier_name = 'COLOR_TIER_' + new_target.target_count;
        if(!(target_tier_name in colors))  target_color = '#FFFFFF';
        else target_color = colors[target_tier_name];

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
                let shape = window.tvStuff.widget.activeChart().getShapeById(existing_shape_id);
                let props = {overrides: {},};
                if(shape_type === 'horizontal_ray')
                    props.overrides['linecolor'] = target_color;
                if(shape_type === 'trend_line')
                    props.overrides['linecolor'] = target_color;
                shape.setProperties(props);
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
                        //showLabel: false,
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
                        //showLabel: false,
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
        //console.log( ((new Date).toLocaleString('en-US')) + ': handleTargetMsg - shape_id['+shape_id+'] created');

        let shape = window.tvStuff.widget.activeChart().getShapeById(shape_id);
        if(sendtoback && ('sendToBack' in shape)) {
            //console.log( ((new Date).toLocaleString('en-US')) + ' handleTargetMsg - shape_id['+shape_id+']: sending to back');
            shape.sendToBack();
        }
        else if('sendToFront' in shape) {
            //console.log( ((new Date).toLocaleString('en-US')) + ' handleTargetMsg - shape_id['+shape_id+']: sending to front');
            shape.sendToFront();
        }

        // add to various tracking structures
        targetCache[ticker]['shape_id_to_target'][shape_id] = new_target;
        if (!(ts_start in targetCache[ticker]['target_to_shape_id'])) targetCache[ticker]['target_to_shape_id'][ts_start] = {};
        if (!(target_price in targetCache[ticker]['target_to_shape_id'][ts_start])) targetCache[ticker]['target_to_shape_id'][ts_start][target_price] = shape_id;
        checkDrawingStart(ticker, shape_id, shape_points);
    });
    //console.log('done looping targets...');
}

function checkDrawingStart(ticker, shape_id, shape_points){
    //console.log('checkDrawingStart('+ticker+','+shape_id+')');
    // is the timestamp correctly set? (shape drawing at large resolution issue)
    // if not, add to list of drawings whose resolution needs to be fixed
    let current_resolution = window.tvStuff.current_resolution;
    let shape = window.tvStuff.widget.activeChart().getShapeById(shape_id);
    let isVisible = shape.getProperties().visible;  // shape with no getPoints() bug
    /*if(!isVisible) {
        //console.log( ((new Date).toLocaleString('en-US')) + ' checkDrawingStart - shape_id['+shape_id+']: - setting visible');
        addItem('drawing_event','properties_changed',shape_id);
        shape.setProperties({visible: true});
        await waitForAndRemoveItem('drawing_event','properties_changed',shape_id);
    }*/
    let points = shape.getPoints();
    for(let idx in points){
        if(points[idx].time !== shape_points[idx].time){
            if(targetCache[ticker].resolution_revise.indexOf(shape_id) === -1)
                targetCache[ticker].resolution_revise.push(shape_id);
            break;
        }
    }
    /*if(!isVisible) shape.setProperties({visible: false});*/
}

export async function checkFixDrawingsResolution(){
    //console.log('checkFixDrawingsResolution()');
    let ticker = window.tvStuff.current_symbol;
    let earliestBar = window.tvStuff.widget.activeChart().getSeries().data().first().timeMs / 1000;
    if(!(ticker in targetCache)){
        //console.log('ticker['+ticker+'] not in targetCache');
        return;
    }
    let current_resolution = window.tvStuff.current_resolution;
    let revs = targetCache[ticker].resolution_revise;
    let revs_len = revs.length;
    while(revs_len--){
        let shape_id = revs[revs_len];
        //console.log('shape_id: '+shape_id);
        //console.log("calling async fixDrawingResolution("+ticker+","+ shape_id+")");
        let x =
            fixDrawingResolution(ticker, shape_id, earliestBar)
                .then(function(result){
                    if(result === 1) // fixed!
                        revs.splice(revs_len, 1);
                });
    }
}

async function fixDrawingResolution(ticker, shape_id, earliest_bar_ts){
    //console.log("fixDrawingResolution("+ticker+","+ resolution+","+ shape_id+")");
    let current_resolution = window.tvStuff.current_resolution;
    let revisions = targetCache[ticker].resolution_revise;
    let target = targetCache[ticker]['shape_id_to_target'][shape_id];
    let shape_type = (('is_range' in target)?'is_range':target.shape_type);
    let shape_points = [];  // the "correct" points
    let target_start_ts;
    let target_end_ts;
    let earliest_movable_ts = earliest_bar_ts + current_resolution;
    let shape = window.tvStuff.widget.activeChart().getShapeById(shape_id);
    let points = shape.getPoints();

    // build the correct points
    // if we've changed resolution, the target may be before the earliest bar we now have.
    // if we try to fix the drawings before the last bar, this will lead to a drawing bug.
    if(shape_type === 'is_range'){
        target_start_ts = target.shape_points[0].time;
        target_end_ts = target.shape_points[1].time;
        if(target_end_ts < earliest_movable_ts) return 0;
        if(points[0].time <= earliest_movable_ts) return 0; // the shape was drawn on a different timeframee whose earliest bar is earlier than this timeframe's earliest bar
        shape_points.push(target.shape_points[0]);
        shape_points.push(target.shape_points[1]);
    }else{
        target_start_ts = target.ts_start;
        //if(target_start_ts < earliest_bar_ts) return;
        shape_points.push({ time: target.ts_start, price: target.target_price });
        if(shape_type === 'horizontal_ray') {
            if(target_start_ts < earliest_movable_ts) return 0;
            if(points[0].time <= earliest_movable_ts) return 0;
        } else if(shape_type === 'trend_line'){
            target_end_ts = target.ts_end;
            if(target_end_ts < earliest_movable_ts && target_start_ts < earliest_movable_ts) return 0;
            if(points[0].time <= earliest_movable_ts && points[1].time <= earliest_movable_ts) return 0;
            shape_points.push({ time: target.ts_end, price: target.target_price });
        }
    }

    // get the shape's current info
    let isVisible = shape.getProperties().visible;  // shape with no getPoints() bug
    if(!isVisible) {
        //console.log( ((new Date).toLocaleString('en-US')) + ': checkFixDrawingsResolution - shape_id['+shape_id+'] making visible');
        addItem('drawing_event','properties_changed',shape_id); // NOTE! 'show' event fires immediately, but the shape may not be ready yet! wait for properties_changed instead.
        shape.setProperties({visible: true});
        await waitForAndRemoveItem('drawing_event','properties_changed',shape_id);
    }
    let original_shape_points = shape.getPoints();
    // bug -- sometimes we get a shape with no points
    if(original_shape_points.length === 0){
        console.log('BUG! shape_id['+shape_id+'] has no points!');
        //console.log(target);
        //removeDrawing(ticker, shape_id);
        return 0;
    }
    let original_start_ts = original_shape_points[0].time;
    let original_end_ts = (original_shape_points.length > 1?original_shape_points[1].time:null);

    // Attempt to set the correct points
    //console.log( ((new Date).toLocaleString('en-US')) + ': checkFixDrawingsResolution - shape_id['+shape_id+'] setting points');
    shape.setPoints(shape_points);

    // Did it work?
    let retVal = 0;
    let current_start_ts =  parseInt(shape.getPoints()[0].time);
    let current_end_ts = (target.shape_type === 'trend_line')? parseInt(shape.getPoints()[1].time):null;
    if(current_start_ts === target_start_ts && current_end_ts === target_end_ts){
        // it worked! remove from original revision list.
        retVal = 1;
    } else if(current_start_ts === original_start_ts && current_end_ts === original_end_ts){
        // nothing changed
        retVal = 0;
    } else{
        // partial success. move to finer time frame.
        retVal = 2;
    }
    if(!isVisible) {
        //console.log( ((new Date).toLocaleString('en-US')) + ': checkFixDrawingsResolution - shape_id['+shape_id+'] making hidden');
        shape.setProperties({visible: false});
    }
    return retVal;
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

async function removeDrawing(ticker, shape_id){
    console.log('removeDrawing('+ticker+','+shape_id+')');
    const index = targetCache[ticker].resolution_revise.indexOf(shape_id);
    if (index > -1) targetCache[ticker].resolution_revise.splice(index, 1);
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
    if(ws_targets.readyState === 0){  // Websocket.CONNECTING
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

export function checkSelection(){
    //console.log('checkSelection()');
    let ticker = window.tvStuff.current_symbol;
    let chart = window.tvStuff.widget.activeChart();
    let selected = chart.selection().allSources();

    let getRandArb = function(min, max) {
        return Math.random() * (max - min) + min;
    }
    let getRGB = function(){
        let r = 0;
        let g = 0;
        let b = 0;
        while(r<25 && g<25 && b<25){
            r = Math.floor(Math.random() * (256));
            g = Math.floor(Math.random() * (256));
            b = Math.floor(Math.random() * (256));
        }
        return [r,g,b];
    };

    for( let id of selected ){
        let shape_id;
        let shape_points;
        let obj = chart.getShapeById(id);
        //console.log(obj);

        // is this one of our drawings?
        if(!(id in targetCache[ticker].shape_id_to_target)) {
            //console.log('id['+id+'] not in shape_id_to_target - not our drawing - continuing');
            continue;
        }
        let target = targetCache[ticker].shape_id_to_target[id];

        switch(obj._source.toolname){
            case "LineToolTrendLine":
                //console.log('checkSelection() - toolname is LineToolTrendLine');
                // let's handle target ranges only, for now...
                if(!('is_range' in target)) break;
                if(id in targetCache[ticker]['range_id_to_fib_id']) {
                    //console.log('id is in range_id_to_fib_id');

                    // already had a fib drawn, just remove everything
                    shape_id = targetCache[ticker]['range_id_to_fib_id'][id];
                    //console.log('shape_id: '+shape_id);

                    // has it been manually deleted?
                    let oldShape;
                    try {
                        oldShape = chart.getShapeById(shape_id);
                        //console.log('oldShape:');
                        //console.log(oldShape);
                    }catch(e){}
                    if(oldShape){
                        //console.log('removing oldShape');
                        chart.removeEntity(shape_id);
                        delete targetCache[ticker]['range_id_to_fib_id'][id];
                        break;
                    }
                }
                // get the target range average price
                let ave_price = (target.shape_points[0].price + target.shape_points[1].price)/2;
                let is_reverse = false; //target.price_when_made < ave_price;
                shape_points = [];
                shape_points.push({time: target.shape_points[1].time, price: target.shape_points[1].price});
                shape_points.push({time: target.shape_points[0].time + 300, price: target.shape_points[0].price});

                let shape_opts = {
                    shape: "fib_retracement",
                    lock: true,
                    disableSelection: true,
                    //disableUndo: true,
                };
                shape_opts['overrides'] =
                    {
                        reverse: is_reverse,
                    }

                // get a random RGB value for levels line color
                let rgb = getRGB();
                let alpha = getRandArb(0.5, 0.92);
                for(let lvl=1; lvl <= 24; lvl++){
                    let lvl_name = 'level' + lvl;
                    shape_opts['overrides'][lvl_name] = {
                        'color':'rgba('+(rgb[0])+','+(rgb[1])+','+(rgb[2])+','+alpha+')',
                    };
                }
                // create the shape and add reference to our cache
                shape_id = chart.createMultipointShape(shape_points, shape_opts);
                targetCache[ticker]['range_id_to_fib_id'][id] = shape_id;
                break;

        }
    }
}