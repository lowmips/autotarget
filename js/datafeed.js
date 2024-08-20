import { makeApiRequest, generateSymbol, configurationData, splitSymbolPair } from './helpers_mexc.js';
import { subscribeOnStream, unsubscribeFromStream } from './streaming.js';
import {parseFullSymbol} from './helpers.js';

const lastBarsCache = new Map();
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
            timezone: 'America/New_York',
            exchange: symbolItem.exchange,
            minmov: 1,
            pricescale: 100,
            has_intraday: true,
            visible_plots_set: 'ohlc',
            has_weekly_and_monthly: false,
            supported_resolutions: configurationData.supported_resolutions,
            volume_precision: 2,
            data_status: 'delayed_streaming',
            delay: 120,
        };
        console.log('[resolveSymbol]: Symbol resolved', symbolName);
        onSymbolResolvedCallback(symbolInfo);
    },
    getBars: (symbolInfo, resolution, periodParams, onHistoryCallback, onErrorCallback) => {
        console.log('[getBars]: Method call', symbolInfo, resolution, periodParams );
        const { from, to, firstDataRequest } = periodParams;
        //const bars = new Array(periodParams.countBack + 1);
        const kline_request_url = window.location.href + 'ajax-handlers/get_klines.php?resolution=' + resolution + '&from=' + periodParams.from + '&to=' + periodParams.to;
        //console.log('kline_request_url: ' + kline_request_url);
        //const response = fetch(kline_request_url);
        //console.log(response);...

        fetch(kline_request_url)
            .then((response) => {
                if (response.ok) {
                    return response.json();
                }
                throw new Error('Something went wrong');
            })
            .then((responseJson) => {
                console.log(responseJson);
                let bars = Array();
                for(let rj of responseJson){
                    bars.push({
                        time: rj.time * 1000,
                        open: rj.open,
                        high: rj.high,
                        low: rj.low,
                        close: rj.close
                    });
                }
                if (firstDataRequest) {
                    lastBarsCache.set(`${symbolInfo.exchange}:${symbolInfo.name}`, { ...bars[bars.length - 1] });
                }
                onHistoryCallback(bars);
            })
            .catch((error) => {
                console.log(error);
                console.log("response error catch");
                onHistoryCallback([], {
                    noData: true
                });
            });
    },
    subscribeBars: (
        symbolInfo,
        resolution,
        onRealtimeCallback,
        subscriberUID,
        onResetCacheNeededCallback
    ) => {
        console.log('[subscribeBars]: Method call with symbolInfo:', symbolInfo);
        console.log('[subscribeBars]: Method call with resolution:', resolution);
        console.log('[subscribeBars]: Method call with subscriberUID:', subscriberUID);
        subscribeOnStream(
            symbolInfo,
            resolution,
            onRealtimeCallback,
            subscriberUID,
            onResetCacheNeededCallback,
            lastBarsCache.get(`${symbolInfo.exchange}:${symbolInfo.name}`)
        );
    },
    unsubscribeBars: (subscriberUID) => {
        console.log('[unsubscribeBars]: Method call with subscriberUID:', subscriberUID);
        unsubscribeFromStream(subscriberUID);
    },
};

export async function getAllSymbols() {
    //const data = await makeApiRequest('api/v3/defaultSymbols');
    const data = {data:['BTCUSDT']};
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
