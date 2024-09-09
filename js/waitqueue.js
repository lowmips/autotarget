export const eventWaitQueue = {};

export function addItem(event, event_type, drawing_id){
    //console.log('addItem('+event+','+event_type+','+drawing_id+')');
    if(!(event in eventWaitQueue)) eventWaitQueue[event] = {};
    if(!(event_type in eventWaitQueue[event])) eventWaitQueue[event][event_type] = [];
    eventWaitQueue[event][event_type].push(drawing_id);
}

export function hasItem(event, event_type, drawing_id){
    if(!(event in eventWaitQueue)) return false;
    if(!(event_type in eventWaitQueue[event])) return false;
    return eventWaitQueue[event][event_type].find(e => e === drawing_id) !== undefined;
}

export function removeItem(event, event_type, drawing_id){
    //console.log('removeItem('+event+','+event_type+','+drawing_id+')');
    if(!(event in eventWaitQueue)) return false;
    if(!(event_type in eventWaitQueue[event])) return false;
    let pos = eventWaitQueue[event][event_type].indexOf(drawing_id);
    eventWaitQueue[event][event_type].splice(pos,1);
    return true;
}

export async function waitForAndRemoveItem(event, event_type, drawing_id){
    //console.log('waitForAndRemoveItem('+event+','+event_type+','+drawing_id+')');
    while(hasItem(event, event_type, drawing_id)){
        await aSleep(250);
    }
    console.log('DONE - waitForAndRemoveItem('+event+','+event_type+','+drawing_id+')');
}


function aSleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}