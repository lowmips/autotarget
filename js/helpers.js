export function parseFullSymbol(fullSymbol) {
    const match = fullSymbol.match(/^(\w+):(\w+)\/(\w+)$/);
    if (!match) {
        return null;
    }
    return { exchange: match[1], fromSymbol: match[2], toSymbol: match[3] };
}

export function waitForSocketConnection(socket, callback){
    setTimeout(
        function () {
            if (socket.readyState === 1) {
                //console.log("Connection is made")
                if (callback != null) callback();
            } else {
                //console.log("wait for connection...")
                waitForSocketConnection(socket, callback);
            }
        }, 10); // wait 5 milisecond for the connection...
}