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
ws = None

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
mdb = mysqlDBC(config['mysql']['username'], config['mysql']['password'], config['mysql']['host'], config['mysql']['database'])

async def main_loop():
    while True:
        print('main_loop()')
        print('websocket:')
        print(ws)
        await asyncio.sleep(10)


async def handle_ws(websocket,path):
    print('websocket:')
    print(websocket)
    print('path:')
    print(path)

async def init_ws():
    ws = websockets.serve(handle_ws, "0.0.0.0", 8765, ssl=ssl_context)

async def main():
    async with asyncio.TaskGroup() as group:
        group.create_task(main_loop())
        group.create_task(init_ws())

asyncio.run(main())