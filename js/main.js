import Datafeed from './datafeed.js';
import {makeApiRequest} from "./helpers_mexc.js";
import {getAllSymbols} from "./datafeed.js";


window.tvWidget = new TradingView.widget({
    symbol: 'MEXC:BTC/USDT',            // Default symbol pair
    interval: '60',                        // Default interval
    fullscreen: true,                      // Displays the chart in the fullscreen mode
    container: 'tv_chart_container',       // Reference to an attribute of a DOM element
    datafeed: Datafeed,
    library_path: 'charting_library/charting_library/',
    debug: true,
});

window.getAllSymbols = getAllSymbols;
window.makeApiRequest = makeApiRequest;