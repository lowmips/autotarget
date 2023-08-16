import { makeApiRequest, generateSymbol, configurationData, splitSymbolPair } from './helpers_mexc.js';
import {parseFullSymbol} from './helpers.js';
export default {


    onReady: (callback) => {
        console.log('[onReady]: Method call');
        setTimeout(() => callback(configurationData));
    },
    searchSymbols: (userInput, exchange, symbolType, onResultReadyCallback) => {
        console.log('[searchSymbols]: Method call');
    },
    resolveSymbol: async (symbolName, onSymbolResolvedCallback, onResolveErrorCallback, extension) => {
        console.log('[resolveSymbol]: Method call', symbolName);
        const symbols = await getAllSymbols();
        const symbolItem = symbols.find(({ full_name }) => full_name === symbolName);
        if (!symbolItem) {
            console.log('[resolveSymbol]: Cannot resolve symbol', symbolName);
            onResolveErrorCallback('Cannot resolve symbol');
            return;
        }
        // Symbol information object
        const symbolInfo = {
            ticker: symbolItem.full_name,
            name: symbolItem.symbol,
            description: symbolItem.description,
            type: symbolItem.type,
            session: '24x7',
            timezone: 'Etc/UTC',
            exchange: symbolItem.exchange,
            minmov: 1,
            pricescale: 100,
            has_intraday: false,
            visible_plots_set: 'ohlc',
            has_weekly_and_monthly: false,
            supported_resolutions: configurationData.supported_resolutions,
            volume_precision: 2,
            data_status: 'streaming',
        };
        console.log('[resolveSymbol]: Symbol resolved', symbolName);
        onSymbolResolvedCallback(symbolInfo);

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

export async function getAllSymbols() {
    const data = await makeApiRequest('api/v3/defaultSymbols');
    console.log('data:');console.log(data);

    let allSymbols = [];

    for (const exchange of configurationData.exchanges) {
        const pairs = data.data;
        for(const pair of pairs){
            let lsRs = null;
            try{
                lsRs = splitSymbolPair(pair);
            }catch(e){
                console.log(e);
                continue;
            }
            //console.log('pair: '+pair+' ls: '+lsRs.ls+' rs: '+lsRs.rs);
            const symbol = generateSymbol(exchange.value, lsRs.ls, lsRs.rs);
            allSymbols.push({
                symbol: symbol.short,
                full_name: symbol.full,
                description: symbol.short,
                exchange: exchange.value,
                type: 'crypto',
            });
        }
    }
    return allSymbols;
}
