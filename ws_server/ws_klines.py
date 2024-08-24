#!/usr/bin/env python
import asyncio
import json
import logging
import websockets
import ssl
import sys
from zmysql import mysqlDBC

config = None
mdb = None # mysqlDBC instance

def get_config():
    global config
    with open('config.json','r') as f:
        config = json.load(f)

get_config()
logging.basicConfig()
ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ssl_cert = config['ssl']['fullchain']
ssl_key = config['ssl']['privkey']
ssl_context.load_cert_chain(ssl_cert, keyfile=ssl_key)


ws_connected = {}
subs_to_ws = {} # exchange -> from symbol -> to symbol -> [] websocket id's

async def handle_closed_ws(websocket):


    del ws_connected[websocket.id.hex]



async def main_loop():
    mdb = mysqlDBC(config['mysql']['username'], config['mysql']['password'], config['mysql']['host'], config['mysql']['database'])
    while True:
        print('main_loop()')
        print(len(ws_connected))
        print(ws_connected)
        await asyncio.sleep(10)


async def handle_ws(websocket,path):
    print('websocket:')
    print(websocket)
    print(websocket.id.hex)
    print(websocket.local_address)
    print(websocket.remote_address)
    print(websocket.subprotocol)

    ws_connected[websocket.id.hex] = {
        "ws": websocket,
        "subs": {},
    }

    #asyncio.create_task(send(websocket))
    while True:
        try:
            message = await websocket.recv()
            await handle_msg(websocket, message)
        # client disconnected?
        except websockets.ConnectionClosedOK:
            print('websockets.ConnectionClosedOK' + websocket.id.hex)
            await handle_closed_ws(websocket)
            break

async def handle_msg(websocket, msg):
    print('handle_msg()')
    print(msg)
    msg_obj = None
    try:
        msg_obj = json.loads(msg)
    except ValueError as e:
        reason = 'invalid json, closing connection'
        print(reason)
        await websocket.close(code=CloseCode.NORMAL_CLOSURE, reason=reason)
        return

    #print('msg_obj:')
    #print(msg_obj)

    if 'SubAdd' in msg_obj:
        if not 'subs' in msg_obj['SubAdd']:
            reason = 'invalid SubAdd definition, closing connection'
            print(reason)
            await websocket.close(code=CloseCode.NORMAL_CLOSURE, reason=reason)
            return
        for sub in msg_obj['SubAdd']['subs']:
            print('sub: '+sub)
            sub_list = sub.split('~')
            if len(sub_list) != 4:
                reason = 'invalid sub definition, closing connection'
                print(reason)
                await websocket.close(code=CloseCode.NORMAL_CLOSURE, reason=reason)
                return
            ignore_me = sub_list[0]
            exchange = sub_list[1]
            from_token = sub_list[2]
            to_token = sub_list[3]

            if not exchange in ws_connected[websocket.id.hex]['subs']:
                ws_connected[websocket.id.hex]['subs'][exchange] = {}


async def send(websocket):
    while True:
        print('send()')
        if False:
            try:
                await websocket.send(json.dumps(data))
            # client disconnected?
            except websockets.ConnectionClosedOK:
                print('websockets.ConnectionClosedOK' + websocket.id.hex)
                await handle_closed_ws(websocket)
                break
        await asyncio.sleep(5)

async def init_ws():
    print('init_ws()')
    async with websockets.serve(handle_ws, "0.0.0.0", 8765, ssl=ssl_context):
        await asyncio.Future()  # run forever

async def main():
    async with asyncio.TaskGroup() as group:
        group.create_task(main_loop())
        group.create_task(init_ws())

if __name__ == "__main__":
    asyncio.run(main())