import Datafeed from './datafeed.js';

window.tvWidget = new TradingView.widget({
    container: 'tv_chart_container',       // Reference to an attribute of a DOM element
    datafeed: Datafeed,
    debug: true,
    fullscreen: true,                      // Displays the chart in the fullscreen mode
    interval: '60',                        // Default interval
    library_path: 'charting_library/charting_library/',
    overrides: {
        "mainSeriesProperties.showCountdown": true,
    },
    symbol: 'MEXC:BTC/USDT',            // Default symbol pair
    theme: "dark",
    timezone: 'America/New_York',
});

window.tvWidget.onChartReady(function() {
    console.log('onChartReady()');

    window.tvWidget.activeChart().dataReady(() => {
        console.log('dataReady()');
    });
});

window.tvWidget.subscribe('activeChartChanged', function(){
    console.log('activeChartChanged');
});
