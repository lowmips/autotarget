import { parseFullSymbol, waitForSocketConnection } from './helpers.js';
import { colors, tierRanges } from './colors.js';
import { addItem, waitForAndRemoveItem, hasItem, removeItem } from "./waitqueue.js";

const ws_targets_url = 'wss://www.lowmips.com:8889/autotarget/';
let ws_targets;
let ws_targets_was_closed = false;
let targetCache = {}; // ticker -> { shape_id_to_target, target_to_shape_id, etc. }
window.targetCache = targetCache; // For debugging access
let currentSubscriptions = {}; // ticker -> { types: [], last_ts_received: 0 }

function connectTargetsWebSocket() {
    console.log('Attempting to connect targets WebSocket...');
    ws_targets = new RobustWebSocket(ws_targets_url, null, {
        timeout: 4000,
        shouldReconnect: function(event, ws) {
            if (event.code === 1000 || event.code === 1008 || event.code === 1011) { // Normal closure, policy violation
                console.log("Targets WS: Not attempting reconnect due to event code:", event.code);
                return;
            }
            const delay = Math.pow(1.5, ws.attempts) * 500;
            console.log(`Targets WS: Reconnecting in ${delay}ms (attempt ${ws.attempts + 1})`);
            return delay;
        },
        automaticOpen: true,
    });

    ws_targets.addEventListener('open', function(event) {
        console.log('ws_targets [open]');
        const was_really_closed = ws_targets_was_closed; // Capture state before resetting
        ws_targets_was_closed = false;

        for (const ticker in currentSubscriptions) {
            if (currentSubscriptions.hasOwnProperty(ticker)) {
                const subInfo = currentSubscriptions[ticker];
                console.log(`Targets WS re-opened, handling subscription for ${ticker} with types:`, subInfo.types);
                const parsedSymbol = parseFullSymbol(ticker);
                if (parsedSymbol) {
                    const channelString = `0~${parsedSymbol.exchange}~${parsedSymbol.fromSymbol}~${parsedSymbol.toSymbol}`;
                    let subMsg;
                    // If it was previously closed and we have a last known timestamp for this sub, try to resume
                    if (was_really_closed && subInfo.last_ts_received && subInfo.last_ts_received > 0) {
                        subMsg = {
                            'SubResume': {
                                channel: channelString,
                                types: subInfo.types,
                                last_ts: subInfo.last_ts_received
                            }
                        };
                        console.log("Sending SubResume for targets WS:", JSON.stringify(subMsg));
                    } else { // Otherwise, send a fresh SubAdd
                        subMsg = {
                            'SubAdd': {
                                'subs': [{
                                    channel: channelString,
                                    types: subInfo.types
                                }],
                            },
                        };
                        console.log("Sending SubAdd for targets WS (on open/reopen):", JSON.stringify(subMsg));
                    }
                    ws_targets.send(JSON.stringify(subMsg));
                }
            }
        }
    });

    ws_targets.addEventListener('close', function(event) {
        console.log(`ws_targets [close] Code: ${event.code}, Reason: ${event.reason}, WasClean: ${event.wasClean}`);
        ws_targets_was_closed = true;
    });

    ws_targets.addEventListener('error', function(event) {
        console.error('ws_targets [error]', event);
    });

    ws_targets.addEventListener('message', function(event) {
        try {
            let msg = JSON.parse(event.data);
            if (msg && msg.pair_info && (msg.targets || msg.ranges)) {
                const ticker = msg.pair_info.exchange + ':' + msg.pair_info.from_token + '/' + msg.pair_info.to_token;
                if (currentSubscriptions[ticker]) { // Only process if we are actually subscribed
                    // Update last_ts_received for SubResume logic if message contains relevant data
                    let maxTsLatestInMsg = 0;
                    if (msg.targets && msg.targets.length > 0) {
                        maxTsLatestInMsg = Math.max(...msg.targets.map(t => parseInt(t.ts_latest || 0)));
                    }
                    // Also consider range timestamps if they are more frequent or relevant for "latest"
                    if (msg.ranges && msg.ranges.length > 0) {
                        const maxTsRange = Math.max(...msg.ranges.map(r => parseInt(r.ts || 0)));
                        maxTsLatestInMsg = Math.max(maxTsLatestInMsg, maxTsRange);
                    }

                    if (maxTsLatestInMsg > (currentSubscriptions[ticker].last_ts_received || 0)) {
                        currentSubscriptions[ticker].last_ts_received = maxTsLatestInMsg;
                    }
                    handleIncomingTargetData(msg);
                } else {
                    // console.warn(`Received target data for unsubscribed ticker ${ticker}:`, msg);
                }
            } else if (msg && msg.subscription_confirmation) {
                console.log("Targets WS Subscription confirmation:", msg.subscription_confirmation);
            } else if (msg && msg.error) {
                console.error("Error message from targets WS:", msg.error);
            } else {
                // console.warn('Received unknown message format from targets WS:', msg);
            }
        } catch(e) {
            console.error("Failed to parse ws_targets message:", e, "Data:", event.data);
        }
    });
}

connectTargetsWebSocket();

function addTickerToCache(ticker) {
    if (!(ticker in targetCache)) {
        targetCache[ticker] = {
            shape_id_to_target: {},
            target_to_shape_id: {}, // ts_start_type_price -> shape_id
            range_to_shape_id: {},  // type_ts -> shape_id
            range_id_to_fib_id: {},
            resolution_revise: [],
            earliest_target_ts: null, // Earliest 'ts_latest' from DB target group (for AJAX historical)
            latest_target_ts: null,   // Latest 'ts_latest' from DB target group (not the same as last_ts_received for WS)
        };
    }
}

async function handleIncomingTargetData(msg) {
    const ticker = msg.pair_info.exchange + ':' + msg.pair_info.from_token + '/' + msg.pair_info.to_token;
    if (!targetCache[ticker]) addTickerToCache(ticker); // Ensure cache exists

    const currentSelectedTypes = new Set(window.tvStuff.selectedTargetTypes || [window.tvStuff.availableTargetTypes[0] || '1.786']);

    if (msg.targets) {
        const filteredTargets = msg.targets.filter(target =>
            target.target_type && currentSelectedTypes.has(target.target_type.toString())
        );
        if (filteredTargets.length > 0) {
            await processTargetArray({ ...msg, targets: filteredTargets }, ticker);
        }
    }

    if (msg.ranges) {
        const filteredRanges = msg.ranges.filter(range =>
            range.target_type && currentSelectedTypes.has(range.target_type.toString())
        );
        if (filteredRanges.length > 0) {
            await processRangeArray({ ...msg, ranges: filteredRanges }, ticker);
        }
    }
}

async function processRangeArray(msg, ticker) {
    const chart = window.tvStuff.widget.activeChart();
    if (!chart) return;

    msg.ranges.forEach((update) => {
        const ts = parseInt(update.ts);
        const price_high = parseFloat(update.price_high);
        const price_low = parseFloat(update.price_low);
        const price_when_made = parseFloat(update.price_when_made);
        const target_count = parseInt(update.target_count);
        const target_type = update.target_type.toString();

        if (target_count < (window.tvStuff.targets.filtering.target_count.min || 1)) return;

        const cacheKeyForRange = `${target_type}-${ts}`;
        if(targetCache[ticker]?.range_to_shape_id?.[cacheKeyForRange]) return;

        const shape_points = [ {time: ts, price: price_high}, {time: ts, price: price_low} ];
        const shape_opts = {
            shape: "trend_line", lock: true, disableUndo: true,
            overrides: { showPriceLabels: false, showLabel: false, linecolor: window.tvStuff.ranges.color, linewidth: 1, }
        };
        const shape_id = chart.createMultipointShape(shape_points, shape_opts);
        const shape = chart.getShapeById(shape_id);
        if (shape && typeof shape.sendToBack === 'function') shape.sendToBack();

        const rangeData = {
            is_range: true, target_type: target_type, ts: ts, price_high: price_high, price_low: price_low,
            price_when_made: price_when_made, target_count: target_count, shape_points: shape_points
        };
        targetCache[ticker].shape_id_to_target[shape_id] = rangeData;
        targetCache[ticker].range_to_shape_id[cacheKeyForRange] = shape_id;
        checkDrawingStart(ticker, shape_id, shape_points);
    });
}

async function processTargetArray(msg, ticker, sendtoback = false) {
    const chart = window.tvStuff.widget.activeChart();
    if (!chart) return;

    // Update earliest/latest 'ts_latest' for historical AJAX fetching logic
    if (msg.targets.length > 0) {
        const latest_ts_in_batch = Math.max(...msg.targets.map(t => parseInt(t.ts_latest || 0)));
        const earliest_ts_in_batch = Math.min(...msg.targets.map(t => parseInt(t.ts_latest || Infinity)));
        if (targetCache[ticker].latest_target_ts === null || latest_ts_in_batch > targetCache[ticker].latest_target_ts) {
            targetCache[ticker].latest_target_ts = latest_ts_in_batch;
        }
        if (targetCache[ticker].earliest_target_ts === null || earliest_ts_in_batch < targetCache[ticker].earliest_target_ts) {
            targetCache[ticker].earliest_target_ts = earliest_ts_in_batch;
        }
    }

    msg.targets.forEach((update) => {
        const ts_start = parseInt(update.ts_start);
        const ts_end_hit = parseInt(update.ts_hit);
        const target_price = parseFloat(update.target_price);
        const target_count = parseInt(update.target_count);
        const target_type = update.target_type.toString();

        if (target_count < (window.tvStuff.targets.filtering.target_count.min || 1)) return;

        const new_target_data = {
            target_type: target_type, ts_start: ts_start, ts_end_hit: ts_end_hit,
            target_price: target_price, target_count: target_count, is_range: false
        };

        let target_color = colors.COLOR_TIER_1;
        if (new_target_data.target_count > 50000) target_color = '#FFFFFF';
        else {
            const targetTier = tierRanges.find(range => new_target_data.target_count <= range.max);
            target_color = colors[`COLOR_TIER_${targetTier ? targetTier.tier : 1}`] || colors.COLOR_TIER_1;
        }
        new_target_data.shape_type = (ts_end_hit > 0 && ts_end_hit > ts_start) ? 'trend_line' : 'horizontal_ray';

        // More specific key for target_to_shape_id to avoid collisions if multiple types have same ts/price
        const cacheKeyForTarget = `${target_type}-${ts_start}-${target_price.toFixed(8)}`; // Using toFixed for price consistency
        let existing_shape_id = targetCache[ticker]?.target_to_shape_id?.[cacheKeyForTarget];

        if (existing_shape_id && targetCache[ticker].shape_id_to_target[existing_shape_id]) {
            const existing_target_data = targetCache[ticker].shape_id_to_target[existing_shape_id];
            let needsRedraw = false;
            let propsToUpdate = { overrides: {} };

            if (new_target_data.shape_type !== existing_target_data.shape_type ||
                (new_target_data.shape_type === 'trend_line' && new_target_data.ts_end_hit !== existing_target_data.ts_end_hit)) {
                needsRedraw = true;
            }

            if (needsRedraw) {
                removeDrawing(ticker, existing_shape_id); // Will delete from target_to_shape_id too
                existing_shape_id = null; // Force redraw
            } else {
                if (new_target_data.target_count !== existing_target_data.target_count) {
                    existing_target_data.target_count = new_target_data.target_count; // Update cache
                    propsToUpdate.overrides['linecolor'] = target_color;
                }
                if (Object.keys(propsToUpdate.overrides).length > 0) {
                    const shape = chart.getShapeById(existing_shape_id);
                    if (shape) shape.setProperties(propsToUpdate);
                }
                return;
            }
        }

        // If existing_shape_id is now null (either not found or removed for redraw)
        let shape_points = [{ time: ts_start, price: target_price }];
        if (new_target_data.shape_type === 'trend_line') shape_points.push({ time: ts_end_hit, price: target_price });

        const shape_opts = {
            shape: new_target_data.shape_type, lock: true, disableUndo: true,
            overrides: { linecolor: target_color, linewidth: 1, showPrice: false, showLabel: false }
        };
        if (new_target_data.shape_type === 'trend_line') shape_opts.overrides.showPriceLabels = false;

        const new_shape_id = chart.createMultipointShape(shape_points, shape_opts);
        const shape = chart.getShapeById(new_shape_id);
        if (sendtoback && shape && typeof shape.sendToBack === 'function') shape.sendToBack();
        else if (shape && typeof shape.sendToFront === 'function') shape.sendToFront();

        targetCache[ticker].shape_id_to_target[new_shape_id] = new_target_data;
        targetCache[ticker].target_to_shape_id[cacheKeyForTarget] = new_shape_id;
        checkDrawingStart(ticker, new_shape_id, shape_points);
    });
}

function checkDrawingStart(ticker, shape_id, shape_points) {
    const chart = window.tvStuff.widget.activeChart();
    if (!chart) return;
    const shape = chart.getShapeById(shape_id);
    if (!shape) return;

    const isVisibleInitially = shape.getProperties().visible;
    let pointsCorrect = true;

    function verifyPoints() {
        const currentPoints = shape.getPoints();
        if (currentPoints.length !== shape_points.length) {
            pointsCorrect = false;
        } else {
            for (let idx = 0; idx < currentPoints.length; idx++) { // Use standard for loop
                if (currentPoints[idx].time !== shape_points[idx].time || currentPoints[idx].price !== shape_points[idx].price) {
                    pointsCorrect = false;
                    break;
                }
            }
        }
        if (!pointsCorrect && targetCache[ticker] && targetCache[ticker].resolution_revise.indexOf(shape_id) === -1) {
            targetCache[ticker].resolution_revise.push(shape_id);
        }
        if (!isVisibleInitially && shape.getProperties().visible) {
            shape.setProperties({ visible: false });
        }
    }

    if (!isVisibleInitially) {
        addItem('drawing_event', 'properties_changed', shape_id);
        shape.setProperties({ visible: true });
        waitForAndRemoveItem('drawing_event', 'properties_changed', shape_id, 1000) // Added timeout
            .then(verifyPoints)
            .catch(() => { // Handle timeout from waitForAndRemoveItem
                console.warn(`Timeout waiting for properties_changed for shape ${shape_id}, proceeding with point verification.`);
                verifyPoints(); // Attempt verification anyway
            });
    } else {
        verifyPoints();
    }
}

export async function checkFixDrawingsResolution() {
    const ticker = window.tvStuff.current_symbol;
    const chart = window.tvStuff.widget.activeChart();
    if (!ticker || !targetCache[ticker] || !chart) return;

    const series = chart.getSeries();
    if (!series) return;
    const data = series.data();
    if (!data || data.isEmpty()) return;
    const firstBar = data.first();
    if (!firstBar) return;
    const earliestBarTs = firstBar.timeMs / 1000;

    const revs = [...targetCache[ticker].resolution_revise];
    for (const shape_id of revs) {
        const fixed = await fixDrawingResolution(ticker, shape_id, earliestBarTs);
        if (fixed === 1) {
            const index = targetCache[ticker].resolution_revise.indexOf(shape_id);
            if (index > -1) targetCache[ticker].resolution_revise.splice(index, 1);
        }
    }
}

async function fixDrawingResolution(ticker, shape_id, earliest_bar_ts) {
    const chart = window.tvStuff.widget.activeChart();
    if (!targetCache[ticker] || !targetCache[ticker].shape_id_to_target[shape_id] || !chart) return 0;

    const target = targetCache[ticker].shape_id_to_target[shape_id];
    const current_interval_str = chart.interval();
    const current_resolution_seconds = current_interval_str === 'D' ? 86400 : (parseInt(current_interval_str) * 60);
    if (isNaN(current_resolution_seconds) || current_resolution_seconds <= 0) {
        console.error("Invalid resolution seconds in fixDrawingResolution:", current_interval_str);
        return 0;
    }
    const earliest_movable_ts = earliest_bar_ts + current_resolution_seconds;

    let shape_points_correct = [];
    if (target.is_range) {
        if (target.shape_points[0].time < earliest_movable_ts) return 0;
        shape_points_correct = target.shape_points;
    } else {
        if (target.ts_start < earliest_movable_ts && target.shape_type === 'horizontal_ray') return 0;
        if (target.ts_start < earliest_movable_ts && target.shape_type === 'trend_line' && target.ts_end_hit < earliest_movable_ts) return 0;
        shape_points_correct.push({ time: target.ts_start, price: target.target_price });
        if (target.shape_type === 'trend_line') {
            shape_points_correct.push({ time: target.ts_end_hit, price: target.target_price });
        }
    }
    if(shape_points_correct.length === 0) return 0;

    const shape = chart.getShapeById(shape_id);
    if (!shape) return 0;

    const props = shape.getProperties();
    const isVisible = props.visible;
    const originalPoints = shape.getPoints();

    if (originalPoints.length > 0) {
        let alreadyCorrect = originalPoints.length === shape_points_correct.length;
        if(alreadyCorrect) {
            for(let i=0; i < originalPoints.length; i++) {
                if(originalPoints[i].time !== shape_points_correct[i].time || originalPoints[i].price !== shape_points_correct[i].price) {
                    alreadyCorrect = false; break;
                }
            }
        }
        if(alreadyCorrect) return 1;
    }

    if (!isVisible) {
        addItem('drawing_event', 'properties_changed', shape_id);
        shape.setProperties({ visible: true });
        await waitForAndRemoveItem('drawing_event', 'properties_changed', shape_id, 1000).catch(()=>{});
    }

    shape.setPoints(shape_points_correct);
    const newPoints = shape.getPoints();
    let success = newPoints.length === shape_points_correct.length;
    if (success) {
        for (let i = 0; i < newPoints.length; i++) {
            if (newPoints[i].time !== shape_points_correct[i].time || newPoints[i].price !== shape_points_correct[i].price) {
                success = false; break;
            }
        }
    }

    if (!isVisible) {
        shape.setProperties({ visible: false });
    }
    return success ? 1 : 0;
}

export function hideDrawingsByTargetCount() {
    const ticker = window.tvStuff.current_symbol;
    const chart = window.tvStuff.widget.activeChart();
    if (!ticker || !targetCache[ticker] || !chart) return;

    const min_count = window.tvStuff.targets.filtering.target_count.min;
    for (const shape_id in targetCache[ticker].shape_id_to_target) {
        const target = targetCache[ticker].shape_id_to_target[shape_id];
        if (target.is_range || !target.hasOwnProperty('target_count')) continue;
        const shape = chart.getShapeById(shape_id);
        if (shape) shape.setProperties({ visible: target.target_count >= min_count });
    }
}

async function removeDrawing(ticker, shape_id) {
    const chart = window.tvStuff.widget.activeChart();
    if (!ticker || !targetCache[ticker] || !targetCache[ticker].shape_id_to_target || !targetCache[ticker].shape_id_to_target[shape_id] || !chart) {
        return;
    }
    const targetData = targetCache[ticker].shape_id_to_target[shape_id];
    const resReviseIdx = targetCache[ticker].resolution_revise.indexOf(shape_id);
    if (resReviseIdx > -1) targetCache[ticker].resolution_revise.splice(resReviseIdx, 1);

    if (targetData.is_range) {
        const cacheKeyForRange = `${targetData.target_type}-${targetData.ts}`;
        if (targetCache[ticker].range_to_shape_id[cacheKeyForRange] === shape_id) {
            delete targetCache[ticker].range_to_shape_id[cacheKeyForRange];
        }
        if (targetCache[ticker].range_id_to_fib_id?.[shape_id]) {
            try { chart.removeEntity(targetCache[ticker].range_id_to_fib_id[shape_id]); } catch(e){}
            delete targetCache[ticker].range_id_to_fib_id[shape_id];
        }
    } else {
        const cacheKeyForTarget = `${targetData.target_type}-${targetData.ts_start}-${targetData.target_price.toFixed(8)}`;
        if (targetCache[ticker].target_to_shape_id[cacheKeyForTarget] === shape_id) {
            delete targetCache[ticker].target_to_shape_id[cacheKeyForTarget];
        }
    }
    delete targetCache[ticker].shape_id_to_target[shape_id];
    try { chart.removeEntity(shape_id); } catch (e) {}
}

export function applyTargetTypePreferences(newlySelectedTypes) {
    const ticker = window.tvStuff.current_symbol;
    if (!ticker || !targetCache[ticker]) return;
    console.log(`Applying target type preferences for ${ticker}:`, newlySelectedTypes);
    const selectedTypesSet = new Set(newlySelectedTypes);
    const shapesToRemove = Object.keys(targetCache[ticker].shape_id_to_target).filter(shape_id => {
        const targetData = targetCache[ticker].shape_id_to_target[shape_id];
        return targetData && targetData.target_type && !selectedTypesSet.has(targetData.target_type.toString());
    });
    shapesToRemove.forEach(shape_id => removeDrawing(ticker, shape_id));
}

export async function startTargetsSub(ticker, selectedTypesArray) {
    if (!ticker) { console.error("startTargetsSub: Ticker is undefined."); return; }
    if (!selectedTypesArray || selectedTypesArray.length === 0) {
        selectedTypesArray = window.tvStuff.selectedTargetTypes || [window.tvStuff.availableTargetTypes[0] || '1.786'];
        if (selectedTypesArray.length === 0) { console.error("Cannot start: No selected types."); return; }
    }
    console.log(`Starting target subscription for ${ticker} with types:`, selectedTypesArray);
    addTickerToCache(ticker);
    if (targetCache[ticker]?.shape_id_to_target) {
        Object.keys(targetCache[ticker].shape_id_to_target).forEach(shapeId => removeDrawing(ticker, shapeId));
        targetCache[ticker].target_to_shape_id = {}; targetCache[ticker].range_to_shape_id = {};
        targetCache[ticker].range_id_to_fib_id = {}; targetCache[ticker].resolution_revise = [];
    }

    const parsedSymbol = parseFullSymbol(ticker);
    if (!parsedSymbol) { console.error("Invalid ticker for target sub:", ticker); return; }
    const channelString = `0~${parsedSymbol.exchange}~${parsedSymbol.fromSymbol}~${parsedSymbol.toSymbol}`;
    const subMsg = { 'SubAdd': { 'subs': [{ channel: channelString, types: selectedTypesArray }] } };

    waitForSocketConnection(ws_targets, () => {
        console.log("Sending target subscription to WS:", JSON.stringify(subMsg));
        ws_targets.send(JSON.stringify(subMsg));
        currentSubscriptions[ticker] = { types: selectedTypesArray, last_ts_received: 0 };
    });
}

export async function stopTargetsSub(ticker) {
    if (!ticker || !currentSubscriptions[ticker]) return;
    console.log('Stopping target subscription for ticker:', ticker);
    const parsedSymbol = parseFullSymbol(ticker);
    if (!parsedSymbol) return;
    const channelString = `0~${parsedSymbol.exchange}~${parsedSymbol.fromSymbol}~${parsedSymbol.toSymbol}`;
    const unsubMsg = { 'SubRemove': { 'subs': [channelString] } }; // Server expects channel string
    waitForSocketConnection(ws_targets, () => {
        if(ws_targets.readyState === 1) ws_targets.send(JSON.stringify(unsubMsg));
    });
    delete currentSubscriptions[ticker];
    if (targetCache[ticker]?.shape_id_to_target) {
        Object.keys(targetCache[ticker].shape_id_to_target).forEach(shapeId => removeDrawing(ticker, shapeId));
        delete targetCache[ticker];
    }
}

export function updateTargetTypeSubscription(newlySelectedTypes) {
    const ticker = window.tvStuff.current_symbol;
    if (!ticker) { console.warn("No current symbol to update target type subscription for."); return; }

    // The flow in main.js: apply (clears client), save prefs, then stop old sub, start new sub.
    // This function becomes less about sending a specific 'UpdatePreferences' message,
    // and more about ensuring the global selectedTypes is up-to-date for the next startTargetsSub.
    // However, if `startTargetsSub` is NOT called immediately after by main.js,
    // then sending an `UpdatePreferences` message here would be necessary.
    // For now, assuming main.js handles the full stop/start cycle.

    console.log(`Global selected target types updated to: ${newlySelectedTypes}. Next subscription for ${ticker} will use these.`);
    // If you wanted to send an explicit update message without full resubscribe:
    /*
    if (currentSubscriptions[ticker]) {
        const parsedSymbol = parseFullSymbol(ticker);
        if (parsedSymbol) {
            const channelString = `0~${parsedSymbol.exchange}~${parsedSymbol.fromSymbol}~${parsedSymbol.toSymbol}`;
            const updateMsg = {
                'UpdatePreferences': { channel: channelString, types: newlySelectedTypes }
            };
            waitForSocketConnection(ws_targets, () => {
                if(ws_targets.readyState === 1) {
                     ws_targets.send(JSON.stringify(updateMsg));
                     currentSubscriptions[ticker].types = newlySelectedTypes;
                     currentSubscriptions[ticker].last_ts_received = 0; // Reset to get fresh data for new types
                }
            });
        }
    }
    */
}

export function checkEarliestTarget() {
    const ticker = window.tvStuff.current_symbol;
    const chart = window.tvStuff.widget.activeChart();
    if (!ticker || !chart || !targetCache[ticker]) return;
    const data = chart.getSeries().data();
    if (!data || data.isEmpty()) return;
    const earliestVisibleBarTime = data.first().timeMs / 1000;
    const currentMinTargetTsInCache = targetCache[ticker].earliest_target_ts; // ts_latest from target_groups

    if (currentMinTargetTsInCache === null || earliestVisibleBarTime < currentMinTargetTsInCache) {
        // console.log(`Visible range (${new Date(earliestVisibleBarTime*1000).toISOString()}) is before earliest target group TS (${currentMinTargetTsInCache ? new Date(currentMinTargetTsInCache*1000).toISOString() : 'N/A'}). Fetching older targets via AJAX.`);
        getTargets(earliestVisibleBarTime); // This fetches historical targets
    }
}

export function getTargets(min_ts_on_chart) { // min_ts_on_chart is the leftmost bar's timestamp
    const ticker = window.tvStuff.current_symbol;
    if (!ticker) return;
    addTickerToCache(ticker);

    // Request data *before* our current earliest known target group timestamp (`earliest_target_ts`)
    // If `earliest_target_ts` is null, it means we haven't fetched historical yet, so request from "now" backwards.
    const from_ts_for_request = targetCache[ticker].earliest_target_ts ? targetCache[ticker].earliest_target_ts - 1 : Math.floor(Date.now()/1000);
    const min_target_count_req = window.tvStuff.targets.requesting.target_count.min || 1;
    // Use currently globally selected target types for the AJAX request
    const selectedTypesParam = (window.tvStuff.selectedTargetTypes || []).join(',');

    const request_url = `${location.protocol}//${location.host}${location.pathname}ajax-handlers/get_targets.php?` +
        `ticker=${encodeURIComponent(ticker)}` +
        `&from=${from_ts_for_request}` +
        `&min_ts=${Math.floor(min_ts_on_chart)}` + // Don't fetch beyond the chart's left edge
        `&min_target_count=${min_target_count_req}` +
        `&target_types=${encodeURIComponent(selectedTypesParam)}`; // AJAX endpoint needs to handle this

    console.log("Requesting historical targets via AJAX:", request_url);
    fetch(request_url)
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error ${response.status} for getTargets`);
            return response.json();
        })
        .then(data => {
            if (data.error) { console.error("Error from get_targets.php:", data.error); return; }
            handleIncomingTargetData(data); // Process AJAX response
        })
        .catch(error => console.error('Error fetching historical targets:', error));
}

export function checkSelection() {
    const ticker = window.tvStuff.current_symbol;
    const chart = window.tvStuff.widget.activeChart();
    if (!ticker || !chart || !targetCache[ticker]) return;
    const selectedEntities = chart.selection().allSources();
    if (selectedEntities.length === 0) return;

    selectedEntities.forEach(selectedId => {
        const targetData = targetCache[ticker].shape_id_to_target[selectedId];
        if (targetData && targetData.is_range) {
            if (targetCache[ticker].range_id_to_fib_id[selectedId]) {
                try { chart.removeEntity(targetCache[ticker].range_id_to_fib_id[selectedId]); } catch (e) {}
                delete targetCache[ticker].range_id_to_fib_id[selectedId];
            } else {
                const points = targetData.shape_points;
                if (points && points.length === 2) {
                    const intervalStr = chart.interval();
                    let timeExtensionFactor = 5; // Default extension factor
                    if (intervalStr === 'D') timeExtensionFactor = 1; // Shorter extension for daily
                    else if (!isNaN(parseInt(intervalStr))) timeExtensionFactor = Math.max(1, Math.floor(300 / parseInt(intervalStr))); // Try to extend by ~5 hours of bars

                    const timeExtension = parseInt(intervalStr === 'D' ? 86400 : (parseInt(intervalStr) * 60)) * timeExtensionFactor;

                    const fibPoints = [
                        { time: points[0].time, price: points[0].price },
                        // Ensure second point is after first, even if original range line was vertical
                        { time: Math.max(points[1].time, points[0].time + 60) + timeExtension, price: points[1].price }
                    ];
                    const fibOverrides = {}; // Customize Fib levels
                    const rgb = [Math.floor(Math.random()*150 + 50), Math.floor(Math.random()*150 + 50), Math.floor(Math.random()*150 + 50)];
                    for(let lvl=1; lvl <= 12; lvl++){ // Standard Fibs have fewer levels
                        fibOverrides[`level${lvl}`] = { color: `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.7)` };
                    }
                    const fibShapeId = chart.createMultipointShape(fibPoints, {
                        shape: "fib_retracement", lock: false, disableSelection: false, overrides: fibOverrides
                    });
                    targetCache[ticker].range_id_to_fib_id[selectedId] = fibShapeId;
                }
            }
        }
    });
}