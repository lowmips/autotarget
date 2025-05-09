export const configurationData =  {
    // Represents the resolutions for bars supported by your datafeed
    supported_resolutions: ['1','5','15','30','60','120','180','240','D'], // D for Daily, 1W for weekly, 1M for monthly if supported
    // exchanges and symbols_types are used for the Symbol Search UI
    exchanges: [
        { value: 'MEXC', name: 'MEXC', desc: 'MEXC Exchange'},
        // Add other exchanges if your datafeed supports them
    ],
    symbols_types: [
        { name: 'Crypto', value: 'crypto'}, // 'crypto' is a common value
        // Add other symbol types if applicable (e.g., 'stock', 'forex')
    ],
    supports_marks: false, // Enable if you support marks on bars
    supports_timescale_marks: false, // Enable if you support timescale marks
    supports_group_request: false, // true if your searchSymbols can handle it
    supports_search: true, // Enable if you have searchSymbols implementation
    supports_time: true, // Enable if you have getServerTime implementation
};

// Generates a symbol ID from a pair of the coins (less used if full_name is the standard)
export function generateSymbol(exchange, fromSymbol, toSymbol) {
    const short = `${fromSymbol}${toSymbol}`; // e.g., BTCUSDT
    return {
        short,
        full: `${exchange}:${fromSymbol}/${toSymbol}`, // e.g., MEXC:BTC/USDT (more standard for TV)
    };
}

// Utility to split a pair like "BTC/USDT"
export function splitSymbolPair(pairString){
    if (!pairString || !pairString.includes('/')) return {ls: null, rs: null};
    const pair_arr = pairString.split('/');
    return {ls: pair_arr[0], rs:pair_arr[1]};
}