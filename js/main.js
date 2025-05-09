import Datafeed from './datafeed.js';
import { startTargetsSub, stopTargetsSub, checkFixDrawingsResolution, checkSelection, applyTargetTypePreferences, updateTargetTypeSubscription } from './targets.js';
import { hasItem, removeItem } from "./waitqueue.js"; // Assuming waitqueue is still used

const queryString = window.location.search;
const urlParams = new URLSearchParams(queryString);
const tf = urlParams.get('tf') || '60'; // Default to 60 minutes if not specified

// Initialize tvStuff from PHP-injected variables or set defaults
window.tvStuff = window.tvStuff || {
    current_symbol: 'MEXC:BTC/USDT', // Default symbol
    previous_symbol: null,
    current_resolution: tf.toString(), // Ensure it's a string for TV
    previous_resolution: null,
    ranges: {
        highlight: true,
        min_distance: 0.0005,
        color: "rgba(255, 152, 0, 0.25)",
        show: true,
    },
    targets: {
        filtering: {
            target_count: { min: 25 },
        },
        requesting: {
            target_count: { min: 25 },
        },
    },
    // availableTargetTypes and selectedTargetTypes are expected to be set by PHP in index.php
    availableTargetTypes: window.tvStuff.availableTargetTypes || ['1.786'],
    selectedTargetTypes: window.tvStuff.selectedTargetTypes || ['1.786'],
};

window.tvStuff.widget_options = {
    container_id: 'tv_chart_container', // Changed from 'container' to 'container_id' as per latest TV docs
    datafeed: Datafeed,
    debug: true,
    fullscreen: true,
    interval: window.tvStuff.current_resolution,
    library_path: 'charting_library/charting_library/', // Ensure this path is correct
    locale: "en",
    disabled_features: ["use_localstorage_for_settings"],
    enabled_features: ["study_templates"],
    // charts_storage_url: 'http://saveload.tradingview.com', // Example, use your own backend for save/load
    // charts_storage_api_version: "1.1",
    // client_id: 'your_client_id', // Example
    // user_id: 'your_user_id', // Example
    symbol: window.tvStuff.current_symbol,
    theme: "Dark", // "Light" or "Dark"
    timezone: 'Etc/UTC', // Recommended to keep data in UTC
    // overrides: { // Example overrides
    //     "mainSeriesProperties.showCountdown": true,
    //     "paneProperties.background": "#131722",
    //     "paneProperties.vertGridProperties.color": "#363c4e",
    //     "paneProperties.horzGridProperties.color": "#363c4e",
    //     "symbolWatermarkProperties.color": "rgba(0, 0, 0, 0)",
    // },
    // studies_overrides: { // Example study overrides
    //     "volume.volume.color.0": "#00FFFF",
    //     "volume.volume.color.1": "#0000FF",
    // }
};

// Ensure the container element exists before initializing the widget
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById(window.tvStuff.widget_options.container_id)) {
        window.tvWidget = new TradingView.widget(window.tvStuff.widget_options);
        window.tvStuff.widget = window.tvWidget; // For compatibility if other parts use tvStuff.widget

        setupTvEventHandlers(window.tvWidget);
        initializeTargetTypeSelector(); // Initialize the new dropdown
    } else {
        console.error("TradingView chart container not found:", window.tvStuff.widget_options.container_id);
    }
});


function setupTvEventHandlers(widget) {
    widget.onChartReady(() => {
        console.log('TradingView Chart Ready');
        const chart = widget.activeChart();
        if (chart) {
            chart.getSeries().priceScale().setAutoScale(false); // Example: disable autoscale

            // Subscribe to symbol change
            chart.symbolInterval().subscribe(null, (o) => {
                console.log('Symbol or Interval changed:', o);
                const newSymbol = o.symbol;
                const newInterval = widget.activeChart().interval(); // Get interval in string format (e.g., '60', 'D')

                if (newSymbol !== window.tvStuff.current_symbol) {
                    window.tvStuff.previous_symbol = window.tvStuff.current_symbol;
                    window.tvStuff.current_symbol = newSymbol;
                    console.log(`Symbol changed from [${window.tvStuff.previous_symbol}] to [${window.tvStuff.current_symbol}]`);

                    if (window.tvStuff.previous_symbol) {
                        stopTargetsSub(window.tvStuff.previous_symbol);
                    }
                    if (window.tvStuff.current_symbol) {
                        startTargetsSub(window.tvStuff.current_symbol, window.tvStuff.selectedTargetTypes);
                    }
                }

                if (newInterval !== window.tvStuff.current_resolution) {
                    window.tvStuff.previous_resolution = window.tvStuff.current_resolution;
                    window.tvStuff.current_resolution = newInterval;
                    console.log(`Resolution changed from [${window.tvStuff.previous_resolution}] to [${window.tvStuff.current_resolution}]`);
                    setTimeout(() => { checkFixDrawingsResolution(); }, 2000);
                }
            });

            chart.onDataLoaded().subscribe(null, () => {
                console.log('Chart Data Loaded (history or update)');
                // This is a good place to check if more historical targets are needed
                // checkEarliestTarget(); // Already called from datafeed.js's getBars
            });

            chart.selection().onChanged().subscribe(null, () => checkSelection());
        }

        // Initial target subscription after chart is ready and symbol is known
        if (window.tvStuff.current_symbol) {
            startTargetsSub(window.tvStuff.current_symbol, window.tvStuff.selectedTargetTypes);
        }
    });

    // widget.subscribe('chart_loaded', () => console.log('Event [chart_loaded]'));
    // widget.subscribe('drawing', (event) => console.log('Event [drawing]', event));
    widget.subscribe('drawing_event', (drawing_id, event_type) => {
        // console.log('Event [drawing_event]', drawing_id, event_type);
        if(hasItem('drawing_event',event_type, drawing_id)) removeItem('drawing_event', event_type, drawing_id);
    });
}


function initializeTargetTypeSelector() {
    const dropdownMenu = document.getElementById('targetTypeDropdownMenu');
    const applyButton = document.getElementById('applyTargetTypes');
    const targetTypeForm = document.getElementById('targetTypeForm');

    if (!dropdownMenu || !applyButton || !targetTypeForm || !window.tvStuff.availableTargetTypes || !window.tvStuff.selectedTargetTypes) {
        console.error("Preference UI elements or data not found for target type selector.");
        return;
    }

    // --- Populate Dropdown ---
    const availableTypes = window.tvStuff.availableTargetTypes;
    const currentSelectedTypes = new Set(window.tvStuff.selectedTargetTypes);
    let checkboxesHtml = '';

    availableTypes.forEach(type => {
        const isChecked = currentSelectedTypes.has(type);
        checkboxesHtml += `
            <div class="form-check">
                <input class="form-check-input target-type-checkbox" type="checkbox" value="${type}" id="type-checkbox-${type.replace('.', '-')}" ${isChecked ? 'checked' : ''}>
                <label class="form-check-label" for="type-checkbox-${type.replace('.', '-')}">
                    ${type}
                </label>
            </div>`;
    });
    // Insert checkboxes before the Apply button inside the form
    targetTypeForm.insertAdjacentHTML('afterbegin', checkboxesHtml);

    // --- Apply Button Click Handler ---
    applyButton.addEventListener('click', () => {
        const checkboxes = dropdownMenu.querySelectorAll('.target-type-checkbox:checked');
        const newlySelectedTypes = Array.from(checkboxes).map(cb => cb.value);

        if (newlySelectedTypes.length === 0) {
            alert("Please select at least one target type.");
            // Optionally, re-check the default or first available type
            // const firstCheckbox = dropdownMenu.querySelector('.target-type-checkbox');
            // if(firstCheckbox) firstCheckbox.checked = true;
            return;
        }

        console.log('Applying new target types:', newlySelectedTypes);
        window.tvStuff.selectedTargetTypes = newlySelectedTypes; // Update global JS state

        // 1. Update UI & Cache in targets.js
        applyTargetTypePreferences(newlySelectedTypes); // This will clear old drawings

        // 2. Save preferences to backend
        savePreferencesToServer(newlySelectedTypes);

        // 3. Notify WebSocket Server about new preferences for the current symbol
        // This could trigger the WS server to send data for the new types.
        // Or, if startTargetsSub handles clearing and re-subscribing:
        if (window.tvStuff.current_symbol) {
            stopTargetsSub(window.tvStuff.current_symbol); // Stop old sub
            startTargetsSub(window.tvStuff.current_symbol, newlySelectedTypes); // Start new sub with new types
        } else {
            // If no current symbol, just update the preference. WS will use it on next connect/sub.
            updateTargetTypeSubscription(newlySelectedTypes);
        }


        // Manually close Bootstrap dropdown if it doesn't close automatically
        // This requires jQuery if you used Bootstrap's data-toggle.
        // $('#targetTypeDropdown').dropdown('toggle'); // or 'hide'
    });

    // Prevent dropdown from closing when clicking inside the form (except on the apply button)
    $(dropdownMenu).on('click', function (e) {
        if (!$(e.target).is('#applyTargetTypes')) {
            e.stopPropagation();
        }
    });
}

function savePreferencesToServer(selectedTypes) {
    fetch('ajax-handlers/save_preferences.php', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({ selected_types: selectedTypes })
    })
        .then(response => {
            if (!response.ok) {
                return response.json().then(err => { throw new Error(err.message || `HTTP error ${response.status}`) });
            }
            return response.json();
        })
        .then(data => {
            if (data.success) {
                console.log('Preferences saved successfully on server.');
            } else {
                console.error('Error saving preferences on server:', data.message);
                // alert('Error saving preferences: ' + data.message); // User feedback
            }
        })
        .catch(error => {
            console.error('Network error saving preferences:', error);
            // alert('Network error saving preferences. Please try again.'); // User feedback
        });
}