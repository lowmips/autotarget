import Datafeed from './datafeed.js';
import {startTargetsSub, stopTargetsSub, checkFixDrawingsResolution} from './targets.js';

window.tvStuff = {
    current_symbol: null,   // ticker MEXC:BTC/USDT
    previous_symbol: null,
    current_resolution: null,
    previous_resolution: null,
    ranges:{
        highlight: true,
        min_distance: 0.001,
        color: "rgba(255, 152, 0, 0.25)",
    },
    targets: {
        filtering: {
            target_count: {
                min: 2,
            },
        },
    },
    widget_options: {
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
    },
};
window.tvStuff.current_resolution = window.tvStuff.widget_options.interval;
//window.tvStuff.current_symbol = window.tvStuff.widget_options.symbol;
window.tvStuff.widget = new TradingView.widget(window.tvStuff.widget_options);






window.tvStuff.widget.subscribe('chart_loaded', function(a){
    console.log('event [chart_loaded] ');
    console.log(a);
});
window.tvStuff.widget.subscribe('drawing', function(a){
    console.log('event [drawing] ' + ((new Date).toLocaleString('en-US')) );
    console.log(a);
});
window.tvStuff.widget.subscribe('drawing_event', function(drawing_id, b){
    console.log('event [drawing_event] ');
    console.log(drawing_id);
    console.log(b);
});
window.tvStuff.widget.subscribe('onChartReady', function(){
    console.log('event [onChartReady]');
});
window.tvStuff.widget.subscribe('onTick', function(a){
    console.log('event [onTick] ');
    console.log(a);
});
window.tvStuff.widget.subscribe('series_event', function(a){
    console.log('event [series_event] ');
    console.log(a);
});
window.tvStuff.widget.subscribe('series_properties_changed', function(){
    console.log('event [series_properties_changed]');
    let symbol;
    try{
        symbol = window.tvStuff.widget.activeChart().getSeries().symbolSource().symbol;
    }catch(e){
        //console.log(e);
    }
    console.log('symbol: '+symbol);
    if(!symbol) return;
    if(symbol == window.tvStuff.current_symbol) return;
    window.tvStuff.previous_symbol = window.tvStuff.current_symbol;
    window.tvStuff.current_symbol = symbol;
    console.log('Symbol changed from ['+window.tvStuff.previous_symbol+'] to ['+window.tvStuff.current_symbol+']');
    if(window.tvStuff.current_symbol) stopTargetsSub(window.tvStuff.current_symbol);
    async function bleh(symbol){
        await startTargetsSub(symbol);
    }
    let x = bleh(window.tvStuff.current_symbol);
});
window.tvStuff.widget.subscribe('time_interval', function(a){
    console.log('event [time_interval] ');
    console.log(a);
    // {
    //     "category": "GUI",
    //     "label": "120",
    //     "value": ""
    // }
    let new_interval = a.label;
    if(new_interval == window.tvStuff.current_resolution) return;
    window.tvStuff.previous_resolution = window.tvStuff.current_resolution;
    window.tvStuff.current_resolution = new_interval;
    console.log('Resolution changed from ['+window.tvStuff.previous_resolution+'] to ['+window.tvStuff.current_resolution+']');

    /*async function bleh(){
        await checkFixDrawingsResolution();
    }
    let x = bleh();*/
    setTimeout(function(){let x = checkFixDrawingsResolution();}, 2000); // directly calling bleh results in errors...
});


window.tvStuff.widget.onChartReady(function() {
    console.log('onChartReady()');

    window.tvStuff.widget.activeChart().onDataLoaded().subscribe(
        null,
        () => console.log('tvWidget.activeChart().onDataLoaded().subscribe() - New history bars are loaded'),
        true
    );

    window.tvStuff.widget.activeChart().dataReady(() => {
        console.log('dataReady()');
    });

});




