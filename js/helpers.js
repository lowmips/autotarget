export function parseFullSymbol(fullSymbol) {
    if (!fullSymbol || typeof fullSymbol !== 'string') return null;
    const match = fullSymbol.match(/^(\w+):([A-Z0-9]+)\/([A-Z0-9]+)$/i); // Made regex more general for symbols
    if (!match) {
        console.warn("parseFullSymbol: No match for", fullSymbol);
        return null;
    }
    return { exchange: match[1].toUpperCase(), fromSymbol: match[2].toUpperCase(), toSymbol: match[3].toUpperCase() };
}

export function waitForSocketConnection(socket, callback){
    if (socket.readyState === 1) { // WebSocket.OPEN
        // console.log("Connection is made");
        if (callback != null) callback();
    } else {
        // console.log("wait for connection...");
        // Consider adding a timeout or max retries to prevent infinite loops
        setTimeout(() => {
            waitForSocketConnection(socket, callback);
        }, 50); // Increased wait time slightly
    }
}