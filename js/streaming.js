import { parseFullSymbol, waitForSocketConnection } from './helpers.js';

const ws_klines_url = 'wss://www.lowmips.com/autotarget/wss/'; // Define URL once

let ws_klines; // Declare ws_klines here, initialize in connect function
let ws_was_closed = false;
const channelToSubscription = new Map(); // Symbol full_name to subscription details

function connectKlinesWebSocket() {
    console.log('Attempting to connect klines WebSocket...');
    ws_klines = new RobustWebSocket(ws_klines_url, null, {
        timeout: 4000, // Time to wait for a connection to be established
        shouldReconnect: function(event, ws) {
            if (event.code === 1000 || event.code === 1008 || event.code === 1011) { // Normal closure or policy violation
                console.log("Klines WS: Not attempting reconnect due to event code:", event.code);
                return; // Do not reconnect
            }
            // Exponential backoff for retries
            const delay = Math.pow(1.5, ws.attempts) * 500;
            console.log(`Klines WS: Reconnecting in ${delay}ms (attempt ${ws.attempts + 1})`);
            return delay;
        },
        automaticOpen: true, // Attempt to open connection immediately
    });

    ws_klines.addEventListener('open', function(event) {
        console.log('ws_klines [open]');
        ws_was_closed = false; // Reset flag

        // Re-subscribe to all active channels if connection was previously closed and reopened
        channelToSubscription.forEach((subscriptionItem, channelString) => {
            if (subscriptionItem.handlers && subscriptionItem.handlers.length > 0) {
                console.log(`Re-subscribing to ${channelString} on klines WS open.`);
                const lastBar = subscriptionItem.lastBar;
                const ts = lastBar ? (lastBar.time / 1000) : 0; // Get timestamp of last bar or 0 if none

                // Determine if SubResume or SubAdd is more appropriate
                // If ts is recent, SubResume might be good. Otherwise, a fresh SubAdd.
                // For simplicity, always SubAdd on open, or implement more complex resume logic.
                // Here, we'll just make sure the subscription exists.
                // The actual send for SubAdd/SubResume happens in subscribeOnStream
                // or if we explicitly call it here.

                // If we want to resend subscription requests:
                const parsedSymbol = parseFullSymbol(subscriptionItem.symbolInfo.full_name); // Assuming symbolInfo is stored
                if (parsedSymbol) {
                    const command = (ts > 0 && ws_was_closed) ? 'SubResume' : 'SubAdd';
                    let payload;
                    if (command === 'SubResume') {
                        payload = { 'SubResume': { channel: channelString, last_ts: ts } };
                    } else {
                        payload = { 'SubAdd': { subs: [channelString] } };
                    }
                    console.log(`Sending ${command} for ${channelString} on reconnect.`);
                    ws_klines.send(JSON.stringify(payload));
                }
            }
        });
    });

    ws_klines.addEventListener('close', function(event) {
        console.log(`ws_klines [close] Code: ${event.code}, Reason: ${event.reason}, WasClean: ${event.wasClean}`);
        ws_was_closed = true;
    });

    ws_klines.addEventListener('error', function(event) {
        console.error('ws_klines [error]', event);
    });

    ws_klines.addEventListener('message', function(event) {
        // console.log('ws_klines [message]: ' + event.data)
        const parts = event.data.split('~');
        if (parts.length < 9) {
            console.warn("Received malformed kline data:", event.data);
            return;
        }

        const [
            eventTypeStr, exchange, fromSymbol, toSymbol,
            tradeTimeStr, tradePriceOpenStr, tradePriceHighStr,
            tradePriceLowStr, tradePriceCloseStr
            // Potentially volumeStr here if your WS sends it
        ] = parts;

        if (parseInt(eventTypeStr) !== 0) { // Assuming 0 is the kline update type
            return; // Skip non-trading events
        }

        const tradeTime = parseInt(tradeTimeStr); // This is the start of the 1-minute kline in seconds
        const channelStringFromMessage = `0~${exchange}~${fromSymbol}~${toSymbol}`; // Reconstruct for lookup

        const subscriptionItem = channelToSubscription.get(channelStringFromMessage);
        if (!subscriptionItem) {
            // console.warn(`Received kline for unsubscribed channel: ${channelStringFromMessage}`);
            return;
        }

        const resolution = subscriptionItem.resolution; // Resolution in minutes (string or number)
        const lastBar = subscriptionItem.lastBar;

        // Convert incoming prices to numbers
        const open = parseFloat(tradePriceOpenStr);
        const high = parseFloat(tradePriceHighStr);
        const low = parseFloat(tradePriceLowStr);
        const close = parseFloat(tradePriceCloseStr);
        // const volume = parseFloat(volumeStr); // If you have volume

        let currentBarTime; // This will be the timestamp for the bar TV expects (start of period in MS)

        if (resolution === '1' || parseInt(resolution) === 1) {
            currentBarTime = tradeTime * 1000; // Start of the 1-minute bar
        } else {
            // Calculate the start of the current resolution's bar
            const resolutionSeconds = parseInt(resolution) * 60;
            // Align tradeTime (which is start of a 1-min bar) to the resolution block
            currentBarTime = (Math.floor(tradeTime / resolutionSeconds) * resolutionSeconds) * 1000;
        }

        let newBar;
        if (lastBar && lastBar.time === currentBarTime) {
            // Update existing bar
            newBar = {
                ...lastBar,
                high: Math.max(lastBar.high, high),
                low: Math.min(lastBar.low, low),
                close: close,
                // volume: lastBar.volume + volume // Accumulate volume
            };
        } else {
            // Create new bar
            newBar = {
                time: currentBarTime,
                open: open, // For a new bar, the first 1-min kline's open is the resolution's open
                high: high,
                low: low,
                close: close,
                // volume: volume,
            };
        }

        subscriptionItem.lastBar = newBar;
        subscriptionItem.handlers.forEach(handler => handler.callback(newBar));
    });
}

// Call connect on script load or when appropriate
connectKlinesWebSocket();


export function subscribeOnStream(
    symbolInfo,
    resolution,
    onRealtimeCallback,
    subscriberUID,
    onResetCacheNeededCallback, // Callback from TV, not used for sending to WS
    lastBar // The last bar from history, TV provides this
) {
    const fullSymbolName = symbolInfo.full_name; // e.g., MEXC:BTC/USDT
    const parsedSymbol = parseFullSymbol(fullSymbolName);

    if (!parsedSymbol) {
        console.error("Cannot subscribe to kline stream: invalid symbolInfo", symbolInfo);
        return;
    }

    // The channel string for WebSocket communication (matches server expectation)
    const channelString = `0~${parsedSymbol.exchange}~${parsedSymbol.fromSymbol}~${parsedSymbol.toSymbol}`;

    const handler = {
        id: subscriberUID,
        callback: onRealtimeCallback,
    };

    let subscriptionItem = channelToSubscription.get(channelString);

    if (subscriptionItem) {
        // Already subscribed to this channel string, add new handler
        subscriptionItem.handlers.push(handler);
        subscriptionItem.resolution = resolution; // Update resolution if it changed
        if (lastBar && (!subscriptionItem.lastBar || lastBar.time > subscriptionItem.lastBar.time)) {
            subscriptionItem.lastBar = lastBar; // Update lastBar if TV provided a newer one
        }
    } else {
        // New subscription for this channel string
        subscriptionItem = {
            subscriberUID: subscriberUID, // UID of the first subscriber for this symbol
            symbolInfo: symbolInfo, // Store for potential re-subscription logic
            resolution: resolution,
            lastBar: lastBar, // Initial last bar
            handlers: [handler],
        };
        channelToSubscription.set(channelString, subscriptionItem);
        console.log('[subscribeBars]: New subscription to klines. Channel:', channelString, "UID:", subscriberUID);

        // Send subscription message to WebSocket server
        waitForSocketConnection(ws_klines, function(){
            // If ws_was_closed and we have a lastBar, we might send SubResume
            // For now, simple SubAdd
            let payload = { 'SubAdd': { subs: [channelString] } };
            if (ws_was_closed && subscriptionItem.lastBar && subscriptionItem.lastBar.time > 0) {
                const resume_ts = subscriptionItem.lastBar.time / 1000;
                payload = { 'SubResume': { channel: channelString, last_ts: resume_ts }};
                console.log(`Sending SubResume for ${channelString} from ts ${resume_ts}`);
            } else {
                console.log(`Sending SubAdd for ${channelString}`);
            }
            ws_klines.send(JSON.stringify(payload));
        });
    }
}

export function unsubscribeFromStream(subscriberUID) {
    console.log('[unsubscribeBars]: Attempting to unsubscribe UID:', subscriberUID);
    let channelToRemove = null;

    for (const [channelString, subscriptionItem] of channelToSubscription.entries()) {
        const handlerIndex = subscriptionItem.handlers.findIndex(handler => handler.id === subscriberUID);

        if (handlerIndex !== -1) {
            subscriptionItem.handlers.splice(handlerIndex, 1);
            console.log(`Removed handler ${subscriberUID} from channel ${channelString}. Remaining: ${subscriptionItem.handlers.length}`);

            if (subscriptionItem.handlers.length === 0) {
                // No more handlers for this channel string, so unsubscribe from WebSocket
                channelToRemove = channelString;
                break;
            }
        }
    }

    if (channelToRemove) {
        console.log('[unsubscribeBars]: Unsubscribing from klines stream. Channel:', channelToRemove);
        waitForSocketConnection(ws_klines, function(){
            const payload = { 'SubRemove': { subs: [channelToRemove] } };
            ws_klines.send(JSON.stringify(payload));
        });
        channelToSubscription.delete(channelToRemove); // Remove from our map
    }
}