const ws = new RobustWebSocket('wss://www.lowmips.com/autotarget/wss/');

import { parseFullSymbol } from './helpers.js';


ws.addEventListener('open', function(event) {
    //console.log('ws [open]');
})

ws.addEventListener('message', function(event) {
    //console.log('ws [message]: ' + event.data)
    const [
        eventTypeStr,
        exchange,
        fromSymbol,
        toSymbol,
        tradeTimeStr,
        tradePriceOpen,
        tradePriceHigh,
        tradePriceLow,
        tradePriceClose
    ] = event.data.split('~');
    if (parseInt(eventTypeStr) !== 0) {
        // Skip all non-trading events
        return;
    }
    //const tradeTime = parseInt(tradeTimeStr) * 1000;
    const tradeTime = parseInt(tradeTimeStr);
    const channelString = `0~${exchange}~${fromSymbol}~${toSymbol}`;
    const subscriptionItem = channelToSubscription.get(channelString);
    if (subscriptionItem === undefined) {
        return;
    }

    // determine starting timestamp for current bar, in case an old subscription started too early
    // prevent putToCacheNewBar: time violation
    let bar;
    let barTime;
    let oldBar = subscriptionItem.lastBar;

    //console.log('resolution: ' + subscriptionItem.resolution);
    if(subscriptionItem.resolution == 1){
        barTime = tradeTime * 1000;
    }else{
        // todo: use window.tvWidget.activeChart().barTimeToEndOfPeriod() to determine start of day?
        let seconds_in_resolution = subscriptionItem.resolution * 60;
        let dt_startOfDay = new Date();
        let dt_barStart = new Date();
        let dt_tradeTime = new Date();
        let sod_trade_diff;
        let bars_in_diff;
        let bars_in_diff_int;
        let seconds_in_bars_in_diff;
        dt_tradeTime.setTime(tradeTime * 1000);
        dt_startOfDay.setTime(tradeTime * 1000);
        dt_startOfDay.setUTCHours(0);
        dt_startOfDay.setUTCMinutes(0);
        dt_startOfDay.setUTCSeconds(0);
        dt_startOfDay.setUTCMilliseconds(0);
        sod_trade_diff = parseInt((dt_tradeTime.getTime() - dt_startOfDay.getTime()) / 1000);
        bars_in_diff = sod_trade_diff / seconds_in_resolution;
        bars_in_diff_int = Math.floor(bars_in_diff);
        seconds_in_bars_in_diff = bars_in_diff_int * seconds_in_resolution;
        barTime = (seconds_in_bars_in_diff * 1000) + dt_startOfDay.getTime();
    }
    //console.log('barTime is: '+barTime);

    if(oldBar.time == barTime){
        bar = {
            ...oldBar,
            high: Math.max(oldBar.high, tradePriceHigh),
            low: Math.min(oldBar.low, tradePriceLow),
            close: parseInt(tradePriceClose),
        };
    }else{
        bar = {
            time: parseInt(barTime),
            open: tradePriceOpen,
            high: tradePriceHigh,
            low: tradePriceLow,
            close: parseInt(tradePriceClose),
        };
    }


    //console.log('[socket] updated bar: ', bar);
    subscriptionItem.lastBar = bar;

    // Send data to every subscriber of that symbol
    subscriptionItem.handlers.forEach(handler => handler.callback(bar));

});

const channelToSubscription = new Map();
export function subscribeOnStream(
    symbolInfo,
    resolution,
    onRealtimeCallback,
    subscriberUID,
    onResetCacheNeededCallback,
    lastBar
)
{
    //console.log('subscribeOnStream(,'+resolution+',,'+subscriberUID+',,)');
    //console.log('lastBar:');
    //console.log(lastBar);

    //console.log(symbolInfo);
    const symbolStr = `${symbolInfo.exchange}:${symbolInfo.name}`;
    //console.log('symbolStr: '+symbolStr);
    const parsedSymbol = parseFullSymbol(symbolStr);
    const channelString = `0~${parsedSymbol.exchange}~${parsedSymbol.fromSymbol}~${parsedSymbol.toSymbol}`;
    const handler = {
        id: subscriberUID,
        callback: onRealtimeCallback,
    };
    let subscriptionItem = channelToSubscription.get(channelString);
    if (subscriptionItem) {
        // update the resolution
        subscriptionItem.resolution = resolution;
        channelToSubscription.set(channelString, subscriptionItem);

        // Already subscribed to the channel, use the existing subscription
        subscriptionItem.handlers.push(handler);
        return;
    }
    subscriptionItem = {
        subscriberUID,
        resolution,
        lastBar,
        handlers: [handler],
    };
    channelToSubscription.set(channelString, subscriptionItem);
    //console.log('[subscribeBars]: Subscribe to streaming. Channel:', channelString);
    let json_str = JSON.stringify({'SubAdd': { subs: [channelString] }});
    ws.send(json_str);
}

export function unsubscribeFromStream(subscriberUID) {
    //console.log('unsubscribeFromStream('+subscriberUID+')')

    // Find a subscription with id === subscriberUID
    for (const channelString of channelToSubscription.keys()) {
        const subscriptionItem = channelToSubscription.get(channelString);
        const handlerIndex = subscriptionItem.handlers
            .findIndex(handler => handler.id === subscriberUID);

        if (handlerIndex !== -1) {
            // Remove from handlers
            subscriptionItem.handlers.splice(handlerIndex, 1);

            if (subscriptionItem.handlers.length === 0) {
                // Unsubscribe from the channel if it is the last handler
                //console.log('[unsubscribeBars]: Unsubscribe from streaming. Channel:', channelString);
                let json_str = JSON.stringify({'SubRemove': { subs: [channelString] }});
                ws.send(json_str);
                channelToSubscription.delete(channelString);
                break;
            }
        }
    }
}