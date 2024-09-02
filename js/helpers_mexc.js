// Makes requests to MEXC API

export const configurationData =  {
    // Represents the resolutions for bars supported by your datafeed
    supported_resolutions: ['1','5','15','30','60','2H','3H','4H','6H','12H','1D','1W'],
    // The `exchanges` arguments are used for the `searchSymbols` method if a user selects the exchange
    exchanges: [
        { value: 'MEXC', name: 'MEXC', desc: 'MEXC'},
    ],
    // The `symbols_types` arguments are used for the `searchSymbols` method if a user selects this symbol type
    symbols_types: [
        { name: 'crypto', value: 'crypto'}
    ]
}

/*export async function makeApiRequest(path) {
    try {
        const response = await fetch(window.location.href + 'php-cross-domain-proxy/proxy.php',{
            headers:{
                'X-Proxy-Url': `https://api.mexc.com/${path}`,
            },
        });
        console.log(response);
        return response.json();
    } catch(error) {
        throw new Error(`MEXC request error: ${error.status}`);
    }
}*/

// Generates a symbol ID from a pair of the coins
export function generateSymbol(exchange, fromSymbol, toSymbol) {
    const short = `${fromSymbol}${toSymbol}`;
    return {
        short,
        full: `${exchange}:${short}`,
    };
}

export function splitSymbolPair(sp){
    let pair_arr = sp.split('/');
    return {ls: pair_arr[0], rs:pair_arr[1]};
}

export async function getBarsForSymbolStartEnd(){

}