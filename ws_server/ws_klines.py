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
server_port = None
ssl_context = None
ssl_cert = None
ssl_key = None
ws_connected = {}
subs_to_ws = {} # pair_id -> [] websocket id's
klines_available = {} # exchange -> exchange_id, pairs -> from_token -> to_token -> pair_id
pair_id_info = {} # pair_id => exchange, from_token, to_token
pair_id_latest = {} # pair_id => latest_kline
main_loop_max_wait = 5 # we'll wait at most 5 seconds between update klines lookups

tbl_klines_template = "klines_{pid}"


def get_config():
    global config
    with open('config.ws_klines.json','r') as f:
        config = json.load(f)

async def handle_closed_ws(websocket):
    del ws_connected[websocket.id.hex]
    for pair_id in subs_to_ws:
        if websocket.id.hex in subs_to_ws[pair_id]:
            subs_to_ws[pair_id].remove(websocket.id.hex)

async def main_loop():
    global mdb
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
            if not pair_id in pair_id_info:
                pair_id_info[pair_id] = {
                    "exchange": exchange,
                    "from_token": pair_l,
                    "to_token": pair_r
                }
            pair_count += 1

    if pair_count == 0:
        print('No available pairs.')
        quit()
    print('klines_available:')
    print(klines_available)

    while True:
        #print('main_loop()')
        #print('client count: ' + str(len(ws_connected)))
        #print('subs_to_ws:')
        #print(subs_to_ws)

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
            #print('sleeping ['+str(sleep_time)+']')
            await asyncio.sleep(sleep_time)

async def send_kline_update(pair_id, timestamp, open, high, low, close):
    print('send_kline_update('+str(pair_id)+','+str(timestamp)+','+open+','+high+','+low+','+close+')')
    if not pair_id in subs_to_ws:
        print('No subs for pair!')
        return
    # get the exchange name
    if not pair_id in pair_id_info:
        print('pair_id['+str(pair_id)+'] not in pair_id_info')
        return
    pair_info = pair_id_info[pair_id]

    # format the update string
    update_str = "0~{ex}~{fsym}~{tsym}~{ts}~{open}~{high}~{low}~{close}".format(
        ex=pair_info['exchange'], fsym=pair_info['from_token'], tsym=pair_info['to_token'], ts=timestamp,
        open=open, high=high, low=low, close=close
        )
    print('update is [{us}]'.format(us=update_str))

    for ws_hex_id in subs_to_ws[pair_id]:
        if not ws_hex_id in ws_connected:
            print(ws_hex_id + ' not in ws_connected!')
            continue
        print('sending update to websocket ['+ws_hex_id+']')
        try:
            await ws_connected[ws_hex_id]['ws'].send(update_str)
        except websockets.ConnectionClosedOK:
            print('websockets.ConnectionClosedOK' + websocket.id.hex)
            await handle_closed_ws(ws_connected[ws_hex_id]['ws'])
        except websockets.exceptions.ConnectionClosedError:
            print('websockets.exceptions.ConnectionClosedError')
            await handle_closed_ws(ws_connected[ws_hex_id]['ws'])
        except e:
            print('generic exception caught: ' + e)

def pair_id_to_exchange(pair_id):
    print('pair_id_to_exchange('+str(pair_id)+')')
    # klines_available = {} # exchange -> exchange_id, pairs -> from_token -> to_token -> pair_id
    for exchange in klines_available:
        for from_token in klines_available[exchange]['pairs']:
            for to_token in klines_available[exchange]['pairs'][from_token]:
                if klines_available[exchange]['pairs'][from_token][to_token] == pair_id:
                    return exchange
    return None

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
    global mdb
    print('handle_msg()')
    print(msg)
    ws_hex_id = websocket.id.hex
    msg_obj = None
    try:
        msg_obj = json.loads(msg)
    except ValueError as e:
        reason = 'invalid json, closing connection'
        print(reason)
        await websocket.close(code=1000, reason=reason)
        return

    #print('msg_obj:')
    #print(msg_obj)

    if 'SubAdd' in msg_obj:
        if not 'subs' in msg_obj['SubAdd']:
            reason = 'invalid SubAdd definition, closing connection'
            print(reason)
            await websocket.close(code=1000, reason=reason)
            return
        for sub in msg_obj['SubAdd']['subs']:
            print('sub: '+sub)
            sub_list = sub.split('~')
            if len(sub_list) != 4:
                reason = 'invalid sub definition, closing connection'
                print(reason)
                await websocket.close(code=1000, reason=reason)
                return
            ignore_me = sub_list[0]
            exchange = sub_list[1]
            from_token = sub_list[2]
            to_token = sub_list[3]

            # check for valid exchange and token
            if not check_subscription(exchange, from_token, to_token):
                reason = 'invalid sub: {e}:{f}:{t}, closing connection'.format(e=exchange, f=from_token, t=to_token)
                print(reason)
                await websocket.close(code=1000, reason=reason)
                return

            # find the pair_id
            pair_id = klines_available[exchange]['pairs'][from_token][to_token]['pair_id']

            # add to subscription structures
            if not exchange in ws_connected[websocket.id.hex]['subs']:
                ws_connected[websocket.id.hex]['subs'][exchange] = {}
            if not from_token in ws_connected[websocket.id.hex]['subs'][exchange]:
                ws_connected[websocket.id.hex]['subs'][exchange][from_token] = {}
            if to_token in ws_connected[websocket.id.hex]['subs'][exchange][from_token]:
                print('already subscribed')
                return
            else:
                ws_connected[websocket.id.hex]['subs'][exchange][from_token][to_token] = pair_id

            # add the pair_id -> websocket[] reverse lookup
            if not pair_id in subs_to_ws:
                subs_to_ws[pair_id] = []
            subs_to_ws[pair_id].append(websocket.id.hex)

    if 'SubResume' in msg_obj:
        print('SubResume')
        if not 'channel' in msg_obj['SubResume'] or not 'last_ts' in msg_obj['SubResume']:
            reason = 'invalid SubResume definition, closing connection'
            print(reason)
            await websocket.close(code=1000, reason=reason)
            return
        sub_list = msg_obj['SubResume']['channel'].split('~')
        if len(sub_list) != 4:
            reason = 'invalid sub definition, closing connection'
            print(reason)
            await websocket.close(code=1000, reason=reason)
            return
        ignore_me = sub_list[0]
        exchange = sub_list[1]
        from_token = sub_list[2]
        to_token = sub_list[3]

        # check for valid exchange and token
        if not check_subscription(exchange, from_token, to_token):
            reason = 'invalid sub: {e}:{f}:{t}, closing connection'.format(e=exchange, f=from_token, t=to_token)
            print(reason)
            await websocket.close(code=1000, reason=reason)
            return

        # find the pair_id
        pair_id = klines_available[exchange]['pairs'][from_token][to_token]['pair_id']
        pair_info = pair_id_info[pair_id]

        # add to subscription structures
        if not exchange in ws_connected[websocket.id.hex]['subs']:
            ws_connected[websocket.id.hex]['subs'][exchange] = {}
        if not from_token in ws_connected[websocket.id.hex]['subs'][exchange]:
            ws_connected[websocket.id.hex]['subs'][exchange][from_token] = {}
        if to_token in ws_connected[websocket.id.hex]['subs'][exchange][from_token]:
            print('already subscribed')
            return
        else:
            ws_connected[websocket.id.hex]['subs'][exchange][from_token][to_token] = pair_id

        # find klines that were missed, if any
        tbl_klines = tbl_klines_template.format(pid=pair_id)
        q = "select * from `{tbl}` WHERE `timestamp`>'{ts}' ORDER BY `timestamp` ASC".format(tbl=tbl_klines, ts=msg_obj['SubResume']['last_ts'])
        update_rows = mdb.query_get_all(q)
        for urow in update_rows:
            timestamp = urow['timestamp']
            open = urow['open']
            high = urow['high']
            low = urow['low']
            close = urow['close']
            # format the update string
            update_str = "0~{ex}~{fsym}~{tsym}~{ts}~{open}~{high}~{low}~{close}".format(
                ex=pair_info['exchange'], fsym=pair_info['from_token'], tsym=pair_info['to_token'], ts=timestamp,
                open=open, high=high, low=low, close=close
                )
            print('update is [{us}]'.format(us=update_str))
            print('sending update to websocket ['+ws_hex_id+']')
            try:
                await ws_connected[ws_hex_id]['ws'].send(update_str)
            except websockets.ConnectionClosedOK:
                print('websockets.ConnectionClosedOK' + websocket.id.hex)
                await handle_closed_ws(ws_connected[ws_hex_id]['ws'])
            except websockets.exceptions.ConnectionClosedError:
                print('websockets.exceptions.ConnectionClosedError')
                await handle_closed_ws(ws_connected[ws_hex_id]['ws'])
            except e:
                print('generic exception caught: ' + e)

        # add the pair_id -> websocket[] reverse lookup to continue sending updates
        if not pair_id in subs_to_ws:
            subs_to_ws[pair_id] = []
        subs_to_ws[pair_id].append(websocket.id.hex)

    if 'SubRemove' in msg_obj:
        if 'subs' in msg_obj['SubRemove']:
            for sub in msg_obj['SubRemove']['subs']:
                print('sub: '+sub)
                sub_list = sub.split('~')
                if len(sub_list) != 4:
                    reason = 'invalid SubRemove definition'
                    print(reason)
                    continue
                ignore_me = sub_list[0]
                exchange = sub_list[1]
                from_token = sub_list[2]
                to_token = sub_list[3]
                if not check_subscription(exchange, from_token, to_token):
                    print('invalid SubRemove definition')
                    continue
                pair_id = klines_available[exchange]['pairs'][from_token][to_token]['pair_id']
                for pair_id in subs_to_ws:
                    if websocket.id.hex in subs_to_ws[pair_id]:
                        subs_to_ws[pair_id].remove(websocket.id.hex)
                if exchange in ws_connected[websocket.id.hex]['subs'] and from_token in ws_connected[websocket.id.hex]['subs'][exchange] and to_token in ws_connected[websocket.id.hex]['subs'][exchange][from_token]:
                    del ws_connected[websocket.id.hex]['subs'][exchange][from_token][to_token]
                    # todo: check for last from_token, exchange, and clean up 'subs'

                print('Unsubscribed ws[{ws}] exchange[{ex}] from_token[{ft}] to_token[{tt}] '.format(ws=websocket.id.hex, ex=exchange, ft=from_token, tt=to_token))

def check_subscription(exchange, from_token, to_token):
    print('check_subscription('+exchange+','+from_token+','+to_token+')')
    # klines_available = {} # exchange -> exchange_id, pairs -> from_token -> to_token -> pair_id
    if not exchange in klines_available: return False
    if not from_token in klines_available[exchange]['pairs']: return False
    if not to_token in klines_available[exchange]['pairs'][from_token]: return False
    return True

async def init_ws():
    print('init_ws()')
    async with websockets.serve(handle_ws, "0.0.0.0", server_port, ssl=ssl_context):
        await asyncio.Future()  # run forever

async def main():
    async with asyncio.TaskGroup() as group:
        group.create_task(main_loop())
        group.create_task(init_ws())

if __name__ == "__main__":
    get_config()
    logging.basicConfig()
    server_port = config['port']
    if config['use_ssl']:
        print('ssl enabled')
        ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ssl_cert = config['ssl']['fullchain']
        ssl_key = config['ssl']['privkey']
        ssl_context.load_cert_chain(ssl_cert, keyfile=ssl_key)
    asyncio.run(main())