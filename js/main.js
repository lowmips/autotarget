import Datafeed from './datafeed.js';
import {startTargetsSub, stopTargetsSub, checkFixDrawingsResolution, checkSelection} from './targets.js';
import {hasItem, removeItem} from "./waitqueue.js";

const queryString = window.location.search;
const urlParams = new URLSearchParams(queryString);
const tf = parseInt(urlParams.get('tf')||'60');

window.tvStuff = {
    current_symbol: null,   // "MEXC:BTC/USDT"
    previous_symbol: null,
    current_resolution: null,
    previous_resolution: null,
    ranges:{
        highlight: true,
        min_distance: 0.0005,
        color: "rgba(255, 152, 0, 0.25)",   // default color
    },
    targets: {
        filtering: {
            target_count: {
                min: 6,
            },
        },
        requesting: {
            target_count: {
                min: 6,
            },
        },
    },
    widget_options: {
        container: 'tv_chart_container',       // Reference to an attribute of a DOM element
        datafeed: Datafeed,
        debug: true,
        fullscreen: true,                      // Displays the chart in the fullscreen mode
        interval: tf,                        // Default interval
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
    //console.log('event [drawing] ' + ((new Date).toLocaleString('en-US')) );
    //console.log(a);
});
window.tvStuff.widget.subscribe('drawing_event', function(drawing_id, event_type){
    //console.log('event [drawing_event] ');
    //console.log(drawing_id);
    //console.log(event_type);

    switch(event_type){
        case 'properties_changed':
            //let shape = window.tvStuff.widget.activeChart().getShapeById(drawing_id);
            //console.log(shape.getProperties());
            break;
        case 'click':

            break;
    }
    if(hasItem('drawing_event',event_type, drawing_id)) removeItem('drawing_event', event_type, drawing_id);
});
window.tvStuff.widget.subscribe('onChartReady', function(){
    console.log('event [onChartReady]');

    window.tvStuff.widget.activeChart().getSeries().priceScale().setAutoScale(false);
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
    let new_interval = parseInt(a.label);
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

    window.tvStuff.widget.activeChart().selection().onChanged().subscribe(null, () => checkSelection());

});




