import Datafeed from './datafeed.js';

window.tvWidget = new TradingView.widget({
    symbol: 'MEXC:BTCUSDT',            // Default symbol pair
    interval: '1D',                        // Default interval
    fullscreen: true,                      // Displays the chart in the fullscreen mode
    container: 'tv_chart_container',       // Reference to an attribute of a DOM element
    datafeed: Datafeed,
    library_path: '../charting_library_cloned_data/charting_library/',
});