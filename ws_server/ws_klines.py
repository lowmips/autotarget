#!/usr/bin/env python
import asyncio
import json
import logging
import websockets
import ssl
import sys
from zmysqla import mysqlDBCa

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
subs_to_ws = {}

async def handle_closed_ws(websocket):
    del ws_connected[websocket.id.hex]


async def main_loop():
    mdb = await mysqlDBCa(config['mysql']['username'], config['mysql']['password'], config['mysql']['host'], config['mysql']['database'])
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
    }

    #asyncio.create_task(send(websocket))
    while True:
        try:
            message = await websocket.recv()
            handle_msg(message)
        # client disconnected?
        except websockets.ConnectionClosedOK:
            print('websockets.ConnectionClosedOK' + websocket.id.hex)
            await handle_closed_ws(websocket)
            break

def handle_msg(websocket, msg):
    print('handle_msg()')
    print(msg)

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