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

    window.tvWidget.activeChart().onDataLoaded().subscribe(
        null,
        () => console.log('tvWidget.activeChart().onDataLoaded().subscribe() - New history bars are loaded'),
        true
    );

    window.tvWidget.activeChart().dataReady(() => {
        console.log('dataReady()');
    });

});

window.tvWidget.subscribe('onChartReady', function(){
    console.log('onChartReady from subscribe');
});

window.tvWidget.subscribe('series_properties_changed', function(){
    console.log('series_properties_changed');
    let symbol;

    try{
        symbol = window.tvWidget.activeChart().getSeries().symbolSource().symbol;
    }catch(e){
        //console.log(e);
    }

    console.log('symbol: '+symbol);

});
