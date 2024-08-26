#!/usr/bin/env python
import asyncio
import json
import logging
import websockets
import ssl
import sys
import time
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
subs_to_ws = {} # pair_id -> [] websocket id's
klines_available = {} # exchange -> exchange_id, pairs -> from_token -> to_token -> pair_id
pair_id_latest = {} # pair_id => latest_kline
main_loop_max_wait = 5 # we'll wait at most 5 seconds between update klines lookups

async def handle_closed_ws(websocket):


    del ws_connected[websocket.id.hex]



async def main_loop():
    mdb = mysqlDBC(config['mysql']['username'], config['mysql']['password'], config['mysql']['host'], config['mysql']['database'])
    pair_count = 0

    # find available exchanges and pairs
    q = "SELECT * FROM `exchanges` WHERE 1"
    exchange_rows = mdb.query_get_all(q)
    if len(exchange_rows) == 0:
        print('No exchanges')
        quit()
    for ex_row in exchange_rows:
        exchange_id = ex_row['id']
        exchange = ex_row['exchange']
        print('exchange: ' + exchange)
        klines_available[exchange] = {
            "exchange_id": exchange_id,
            "pairs": {}
        }
        q = ("SELECT * FROM `klines_meta` WHERE `exchange_id`={eid} ORDER BY `pair_l`,`pair_r`").format(eid=exchange_id)
        pair_rows = mdb.query_get_all(q)
        for pair_row in pair_rows:
            pair_id = pair_row['id']
            pair_l = pair_row['pair_l']
            pair_r = pair_row['pair_r']
            if not pair_l in klines_available[exchange]["pairs"]:
                klines_available[exchange]["pairs"][pair_l] = {}
            if not pair_r in klines_available[exchange]["pairs"][pair_l]:
                klines_available[exchange]["pairs"][pair_l][pair_r] = {
                    "pair_id": pair_id,
                    "latest_kline": None,
                }
            if not pair_id in pair_id_latest:
                pair_id_latest[pair_id] = {"latest_kline": None}
            pair_count += 1

    if pair_count == 0:
        print('No available pairs.')
        quit()
    print('klines_available:')
    print(klines_available)

    while True:
        print('main_loop()')
        print('client count: ' + str(len(ws_connected)))
        loop_start = int(time.time())

        # get the latest klines for all pairs
        q = "SELECT * FROM `klines_latest`"
        latest_rows = mdb.query_get_all(q)
        for latest_row in latest_rows:
            pair_id = latest_row['meta_id']
            timestamp = latest_row['timestamp']
            open = latest_row['open']
            high = latest_row['high']
            low = latest_row['low']
            close = latest_row['close']

            if (    (pair_id_latest[pair_id]['latest_kline'] is None) or
                    (pair_id_latest[pair_id]['latest_kline']['timestamp'] != timestamp) or
                    (pair_id_latest[pair_id]['latest_kline']['open'] != open) or
                    (pair_id_latest[pair_id]['latest_kline']['high'] != high) or
                    (pair_id_latest[pair_id]['latest_kline']['low'] != low) or
                    (pair_id_latest[pair_id]['latest_kline']['close'] != close)
                ):
                await send_kline_update(pair_id, timestamp, open, high, low, close)
            pair_id_latest[pair_id]['latest_kline'] = {
                "timestamp": timestamp,
                "open": open,
                "high": high,
                "low": low,
                "close":close
            }

        loop_end = int(time.time())
        loop_diff = loop_end - loop_start
        if loop_diff < main_loop_max_wait:
            sleep_time = main_loop_max_wait - loop_diff
            print('sleeping ['+str(sleep_time)+']')
            await asyncio.sleep(sleep_time)

async def send_kline_update(pair_id, timestamp, open, high, low, close):
    print('send_kline_update('+str(pair_id)+','+str(timestamp)+','+open+','+high+','+low+','+close+')')
    await asyncio.sleep(1)



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

            # check for valid exchange and token
            # find the pair_id





            # add to subscription structures
            if not exchange in ws_connected[websocket.id.hex]['subs']:
                ws_connected[websocket.id.hex]['subs'][exchange] = {}
            if not from_token in ws_connected[websocket.id.hex]['subs'][exchange]:
                ws_connected[websocket.id.hex]['subs'][exchange][from_token] = {}
            if to_token in ws_connected[websocket.id.hex]['subs'][exchange][from_token]:
                print('already subscribed')
            else:
                ws_connected[websocket.id.hex]['subs'][exchange][from_token][to_token] = 1




            # add the pair_id -> websocket[] reverse lookup




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