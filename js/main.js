import Datafeed from './datafeed.js';

window.tvWidget = new TradingView.widget({
    symbol: 'MEXC:BTC/USDT',            // Default symbol pair
    interval: '60',                        // Default interval
    fullscreen: true,                      // Displays the chart in the fullscreen mode
    container: 'tv_chart_container',       // Reference to an attribute of a DOM element
    datafeed: Datafeed,
    library_path: 'charting_library/charting_library/',
    debug: true,
    //timezone: 'America/New_York',
});

window.tvWidget.activeChart().setTimezone("America/New_York");