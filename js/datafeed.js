import { /*makeApiRequest, */ generateSymbol, configurationData, splitSymbolPair } from './helpers_mexc.js';
import { subscribeOnStream, unsubscribeFromStream } from './streaming.js';
import { checkEarliestTarget } from './targets.js'; // Make sure targets.js is imported if checkEarliestTarget is used
import {parseFullSymbol} from './helpers.js';

const lastBarsCache = new Map();

// Helper to get the current symbol from the global state or chart
function getCurrentSymbolInfo() {
    let symbol = 'MEXC:BTC/USDT'; // Default
    if (window.tvStuff && window.tvStuff.current_symbol) {
        symbol = window.tvStuff.current_symbol;
    } else if (window.tvWidget && typeof window.tvWidget.activeChart === 'function') {
        try {
            symbol = window.tvWidget.activeChart().symbol();
        } catch (e) {
            // console.warn("Could not get symbol from active chart");
        }
    }
    const parsed = parseFullSymbol(symbol);
    return parsed ? { exchange: parsed.exchange, name: `${parsed.fromSymbol}/${parsed.toSymbol}`, full_name: symbol, symbol: `${parsed.fromSymbol}/${parsed.toSymbol}` }
        : { exchange: 'MEXC', name: 'BTC/USDT', full_name: 'MEXC:BTC/USDT', symbol: 'BTC/USDT' };
}


export default {
    onReady: (callback) => {
        console.log('[onReady]: Method call');
        setTimeout(() => callback(configurationData));
    },
    searchSymbols: (userInput, exchange, symbolType, onResultReadyCallback) => {
        console.log('[searchSymbols]: Method call');
        // This should ideally fetch symbols from a backend or a predefined list
        const symbols = [
            {
                "symbol": "BTC/USDT", // Changed to include pair
                "description": "Bitcoin / Tether",
                "exchange": "MEXC",
                "ticker": "MEXC:BTC/USDT",
                "type": "crypto"
            },
            {
                "symbol": "ETH/USDT", // Changed to include pair
                "description": "Ethereum / Tether",
                "exchange": "MEXC",
                "ticker": "MEXC:ETH/USDT",
                "type": "crypto"
            },
        ];
        // Filter symbols based on userInput if necessary
        const filteredSymbols = userInput ? symbols.filter(s => s.symbol.toLowerCase().includes(userInput.toLowerCase()) || s.description.toLowerCase().includes(userInput.toLowerCase())) : symbols;
        onResultReadyCallback(filteredSymbols);
    },
    resolveSymbol: async (symbolName, onSymbolResolvedCallback, onResolveErrorCallback, extension) => {
        console.log('[resolveSymbol]: Method call', symbolName);
        const symbols = await getAllSymbols(); // ensure this returns a comprehensive list or fetches from API
        const symbolItem = symbols.find(({ full_name }) => full_name === symbolName);

        if (!symbolItem) {
            console.log('[resolveSymbol]: Cannot resolve symbol', symbolName);
            onResolveErrorCallback('Cannot resolve symbol: ' + symbolName + '. Ensure it is in the format EXCHANGE:FROM/TO');
            return;
        }

        const symbolInfo = {
            ticker: symbolItem.full_name,
            name: symbolItem.symbol, // e.g., "BTC/USDT"
            full_name: symbolItem.full_name, // e.g., "MEXC:BTC/USDT"
            description: symbolItem.description,
            type: symbolItem.type,
            session: '24x7',
            timezone: 'Etc/UTC', // Use 'Etc/UTC' for universal time; TV will handle display timezone
            exchange: symbolItem.exchange,
            listed_exchange: symbolItem.exchange, // Often same as exchange for crypto
            minmov: 1, // Minimum price movement
            pricescale: 100000000, // For BTC/USDT, 8 decimal places (10^8). Adjust per pair!
            // ETH/USDT might be 100 (2 decimal places) or 1000000 (6 for precision)
            // This needs to be dynamic per symbol or a reasonable default.
            has_intraday: true,
            has_seconds: false, // If you don't have second-based data
            has_daily: true,
            has_weekly_and_monthly: false, // If you don't explicitly provide W/M bars
            supported_resolutions: configurationData.supported_resolutions,
            volume_precision: 2, // Precision for volume display
            data_status: 'streaming', // or 'pulsed' or 'delayed_streaming'
            // delay: 120, // Only if data_status is 'delayed_streaming'
            format: 'price', // For price formatting options
            // currency_code: symbolItem.toSymbol, // e.g. 'USDT' from MEXC:BTC/USDT
        };

        // Dynamic pricescale based on toSymbol (example)
        const parsed = parseFullSymbol(symbolItem.full_name);
        if (parsed && parsed.toSymbol.toUpperCase() === 'USDT') {
            if (parsed.fromSymbol.toUpperCase() === 'BTC') {
                symbolInfo.pricescale = 100; // For display purposes, like 2 decimal places for price axis
                symbolInfo.minmov = 1; // Smallest price change unit relative to pricescale
            } else if (parsed.fromSymbol.toUpperCase() === 'ETH') {
                symbolInfo.pricescale = 100;
                symbolInfo.minmov = 1;
            }
            // Add more rules for other pairs if their typical display precision differs.
            // The actual data values should be numbers, TV handles formatting.
        }


        console.log('[resolveSymbol]: Symbol resolved', symbolName, symbolInfo);
        onSymbolResolvedCallback(symbolInfo);
    },
    getBars: (symbolInfo, resolution, periodParams, onHistoryCallback, onErrorCallback) => {
        console.log('[getBars]: Method call', symbolInfo, resolution, periodParams );
        const { from, to, firstDataRequest, countBack } = periodParams;

        // Construct URL for fetching klines
        const kline_request_url = `${location.protocol}//${location.host}${location.pathname}ajax-handlers/get_klines.php?symbol=${encodeURIComponent(symbolInfo.ticker)}&resolution=${encodeURIComponent(resolution)}&from=${from}&to=${to}`;
        // Note: get_klines.php needs to be updated to handle a 'symbol' parameter if it's going to serve multiple symbols.
        // Currently, it seems hardcoded or implicitly for one symbol.

        console.log('Kline request URL: ' + kline_request_url);

        fetch(kline_request_url)
            .then((response) => {
                if (response.ok) {
                    return response.json();
                }
                throw new Error(`Failed to fetch klines: ${response.status} ${response.statusText}`);
            })
            .then((responseJson) => {
                if (!Array.isArray(responseJson)) {
                    console.error("Invalid kline data received:", responseJson);
                    throw new Error("Received non-array kline data from server.");
                }
                console.log('Klines received count:', responseJson.length);
                let bars = [];
                if (responseJson.length > 0) {
                    for(let rj of responseJson){
                        bars.push({
                            time: parseInt(rj.time * 1000), // UDF expects milliseconds
                            open: Number(rj.open),
                            high: Number(rj.high),
                            low: Number(rj.low),
                            close: Number(rj.close),
                            // volume: Number(rj.volume) // Include if you have volume data
                        });
                    }
                    if (firstDataRequest) {
                        lastBarsCache.set(symbolInfo.full_name, { ...bars[bars.length - 1] });
                    }
                    onHistoryCallback(bars, { noData: false });
                } else {
                    onHistoryCallback([], { noData: true });
                }
                // Check for earliest target *after* chart has processed the bars
                setTimeout(function(){
                    if (typeof checkEarliestTarget === 'function') { // Check if function exists
                        checkEarliestTarget();
                    }
                }, 500);
            })
            .catch((error) => {
                console.error('Error fetching klines:', error);
                onErrorCallback(error.message); // Notify TV chart about the error
                // onHistoryCallback([], { noData: true }); // Also call this as per TV docs on error
            });
    },
    subscribeBars: (
        symbolInfo,
        resolution,
        onRealtimeCallback,
        subscriberUID,
        onResetCacheNeededCallback // This callback is not used in this example stream
    ) => {
        console.log('[subscribeBars]: Method call with subscriberUID:', subscriberUID, symbolInfo.full_name, resolution);
        let lastBar = lastBarsCache.get(symbolInfo.full_name);
        if (!lastBar) {
            // If no cached bar, might need to fetch one or use a placeholder.
            // For simplicity, if it's missing, the stream will create the first bar.
            console.warn(`No lastBar in cache for ${symbolInfo.full_name}. Stream will create one.`);
        }
        subscribeOnStream(
            symbolInfo,
            resolution,
            onRealtimeCallback,
            subscriberUID,
            onResetCacheNeededCallback, // Pass it along
            lastBar // Can be undefined
        );
    },
    unsubscribeBars: (subscriberUID) => {
        console.log('[unsubscribeBars]: Method call with subscriberUID:', subscriberUID);
        unsubscribeFromStream(subscriberUID);
    },
    // Optional:
    // getServerTime: (callback) => {
    //     // Fetch server time if your data is not UTC or needs alignment
    //     fetch('/api/time') // Example endpoint
    //         .then(res => res.json())
    //         .then(data => callback(Math.floor(data.serverTime / 1000))) // Expects UNIX timestamp in seconds
    //         .catch(err => console.error("Failed to fetch server time"));
    // }
};

export async function getAllSymbols() {
    // In a real scenario, this would fetch from an API or a well-maintained list.
    // For now, keep it simple, but ensure `full_name` is what `resolveSymbol` expects.
    // `name` is what's displayed in symbol search. `ticker` is often same as `full_name`.
    return [
        {
            symbol: 'BTC/USDT', // Short name for display
            full_name: 'MEXC:BTC/USDT', // Unique identifier used by TV
            description: 'Bitcoin / Tether USDT',
            exchange: 'MEXC',
            type: 'crypto',
            // currency_code: 'USDT', // Optional: quote currency
            // pricescale: 100 // Suggestion for display (e.g. 2 decimals) - resolveSymbol should set the final one
        },
        {
            symbol: 'ETH/USDT',
            full_name: 'MEXC:ETH/USDT',
            description: 'Ethereum / Tether USDT',
            exchange: 'MEXC',
            type: 'crypto',
            // currency_code: 'USDT',
            // pricescale: 100
        },
        // Add more symbols as needed
    ];
}