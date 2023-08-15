export default {
    onReady: (callback) => {
        console.log('[onReady]: Method call');
        const configurationData = {
            // Represents the resolutions for bars supported by your datafeed
            supported_resolutions: ['1H','6H','12H', '1D', '1W', '1M'],
            // The `exchanges` arguments are used for the `searchSymbols` method if a user selects the exchange
            exchanges: [
                { value: 'MEXC', name: 'MEXC', desc: 'MEXC'},
            ],
            // The `symbols_types` arguments are used for the `searchSymbols` method if a user selects this symbol type
            symbols_types: [
                { name: 'crypto', value: 'crypto'}
            ]
        };
        setTimeout(() => callback(configurationData));
    },
    searchSymbols: (userInput, exchange, symbolType, onResultReadyCallback) => {
        console.log('[searchSymbols]: Method call');
    },
    resolveSymbol: (symbolName, onSymbolResolvedCallback, onResolveErrorCallback, extension) => {
        console.log('[resolveSymbol]: Method call', symbolName);
    },
    getBars: (symbolInfo, resolution, periodParams, onHistoryCallback, onErrorCallback) => {
        console.log('[getBars]: Method call', symbolInfo);
    },
    subscribeBars: (symbolInfo, resolution, onRealtimeCallback, subscriberUID, onResetCacheNeededCallback) => {
        console.log('[subscribeBars]: Method call with subscriberUID:', subscriberUID);
    },
    unsubscribeBars: (subscriberUID) => {
        console.log('[unsubscribeBars]: Method call with subscriberUID:', subscriberUID);
    },
};