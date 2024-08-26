const ws = new RobustWebSocket('wss://www.lowmips.com:8765/')
import { parseFullSymbol } from './helpers.js';


ws.addEventListener('open', function(event) {
    console.log('ws [open]');
})

ws.addEventListener('message', function(event) {
    console.log('ws [message]: ' + event.data)
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
    const tradeTime = parseInt(tradeTimeStr);
    const channelString = `0~${exchange}~${fromSymbol}~${toSymbol}`;
    const subscriptionItem = channelToSubscription.get(channelString);
    if (subscriptionItem === undefined) {
        return;
    }
    const lastBar = subscriptionItem.lastBar;
    const nextBarTime = getNextBarTime(lastBar.time, subscriptionItem.resolution);
    console.log('lastBar.time['+lastBar.time+'] nextBarTime['+nextBarTime+']');

    let bar;
    if (tradeTime >= nextBarTime) {
        bar = {
            time: nextBarTime,
            open: tradePriceOpen,
            high: tradePriceHigh,
            low: tradePriceLow,
            close: tradePriceClose,
        };
        console.log('[socket] Generate new bar', bar);
    } else {
        bar = {
            ...lastBar,
            high: tradePriceHigh,
            low: tradePriceLow,
            close: tradePriceClose,
        };
        console.log('[socket] Update the latest bar by price', tradePriceClose);
    }
    console.log('[socket] updated bar', bar);

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
    console.log('subscribeOnStream(,'+resolution+',,'+subscriberUID+',,)');
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
    console.log('[subscribeBars]: Subscribe to streaming. Channel:', channelString);
    let json_str = JSON.stringify({'SubAdd': { subs: [channelString] }});
    ws.send(json_str);
}

export function unsubscribeFromStream(subscriberUID) {
    console.log('unsubscribeFromStream('+subscriberUID+')')

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
                console.log('[unsubscribeBars]: Unsubscribe from streaming. Channel:', channelString);
                let json_str = JSON.stringify({'SubRemove': { subs: [channelString] }});
                ws.send(json_str);
                channelToSubscription.delete(channelString);
                break;
            }
        }
    }
}


function getNextBarTime(barTime, resolution){
    console.log('getNextBarTime('+barTime+','+resolution+')');
    const date = new Date(barTime / 1000);
    date.setMinutes(date.getMinutes() + resolution);
    return date.getTime();
}
/*function getNextDailyBarTime(barTime) {
    const date = new Date(barTime * 1000);
    date.setDate(date.getDate() + 1);
    return date.getTime() / 1000;
}*/