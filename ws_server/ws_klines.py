#!/usr/bin/env python
import asyncio
import json
import logging
import websockets
import ssl
from os import path
import sys


directory = os.path.path(__file__).abspath()
sys.path.append(directory.parent)
from autotarget.connector.mysql import mysqlDBC

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
mdb = mysqlDBC(config['mysql']['username'], config['mysql']['password'], config['mysql']['host'], config['mysql']['database'])

async def main_loop():
    while True:
        print('main_loop()')
        await asyncio.sleep(10)


async def handle_ws(ws,path):
    print('websocket:')
    print(websocket)
    print('path:')
    print(path)

async def main():
    async with asyncio.TaskGroup() as group:
        group.create_task(main_loop())
        group.create_task(websockets.serve(handle_ws, "0.0.0.0", 8765, ssl=ssl_context))

asyncio.run(main())