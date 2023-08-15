// Makes requests to MEXC API
export async function makeApiRequest(path) {
    try {
        const response = await fetch(`https://api.mexc.com/${path}`,{
            headers:{
                'X-Proxy-Url': window.location.href + 'php-cross-domain-proxy/proxy.php',
            },
        });
        return response.json();
    } catch(error) {
        throw new Error(`MEXC request error: ${error.status}`);
    }
}

// Generates a symbol ID from a pair of the coins
export function generateSymbol(exchange, fromSymbol, toSymbol) {
    const short = `${fromSymbol}${toSymbol}`;
    return {
        short,
        full: `${exchange}:${short}`,
    };
}