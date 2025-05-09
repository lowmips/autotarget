#!/usr/bin/env python
import asyncio
import json
import logging
import websockets
import ssl
import sys
import time
from zmysql import mysqlDBC # Assuming zmysql.py is in the same directory or Python path

# --- Configuration ---
CONFIG_FILE = 'config.ws_klines.json'
config = None
mdb = None # mysqlDBC instance
main_loop_max_wait = 2 # Default, can be overridden by config
TBL_KLINES_HISTORY_PREFIX = "klines_" # For fetching historical klines e.g., klines_1

# --- Global State ---
ws_connections = {} # websocket_id_hex -> {"ws": websocket_object, "subs": set_of_channel_strings}
channel_to_clients = {} # channel_string -> set_of_websocket_id_hex
# Example: channel_string = "0~MEXC~BTC~USDT"

# Cache for kline data to detect changes
# pair_id -> latest_kline_data_dict (from klines_latest)
pair_id_to_latest_kline_cache = {}
# Structure to map pair_id to its string identifiers (exchange, from, to)
pair_id_to_info_map = {}
# Structure to map channel_string to pair_id
channel_string_to_pair_id = {}


def load_config():
    global config, main_loop_max_wait
    try:
        with open(CONFIG_FILE, 'r') as f:
            config = json.load(f)
            main_loop_max_wait = config.get('main_loop_max_wait', main_loop_max_wait)
            logging.info(f"Kline WS Config loaded. Main loop wait: {main_loop_max_wait}s")
    except FileNotFoundError:
        logging.critical(f"Configuration file {CONFIG_FILE} not found.")
        sys.exit(1)
    except json.JSONDecodeError:
        logging.critical(f"Error decoding JSON from {CONFIG_FILE}.")
        sys.exit(1)

async def cleanup_client(websocket):
    hex_id = websocket.id.hex
    if hex_id in ws_connections:
        client_subs = ws_connections[hex_id].get("subs", set())
        for channel_str in client_subs:
            if channel_str in channel_to_clients and hex_id in channel_to_clients[channel_str]:
                channel_to_clients[channel_str].remove(hex_id)
                if not channel_to_clients[channel_str]: # No more clients for this channel
                    del channel_to_clients[channel_str]
                    logging.info(f"Kline WS: No more clients for channel {channel_str}, removed from tracking.")
        del ws_connections[hex_id]
        logging.info(f"Kline WS: Cleaned up client {hex_id}. Active clients: {len(ws_connections)}")

async def main_data_loop():
    global mdb, pair_id_to_latest_kline_cache, pair_id_to_info_map, channel_string_to_pair_id
    logging.info("Kline WebSocket data loop started.")
    mdb = mysqlDBC(config['mysql']['username'], config['mysql']['password'],
                   config['mysql']['host'], config['mysql']['database'],
                   port=config['mysql'].get('port', 3306)) # Added port from config
    if not mdb.is_connected():
        logging.critical("Kline WS: Failed to connect to MySQL. Exiting data loop.")
        return

    # Populate pair_id_to_info_map and channel_string_to_pair_id
    try:
        meta_query = """
            SELECT km.id AS pair_id, e.exchange AS exchange_name, km.pair_l, km.pair_r
            FROM klines_meta km
            JOIN exchanges e ON km.exchange_id = e.id
        """
        meta_rows = mdb.query_get_all(meta_query)
        if not meta_rows:
            logging.warning("Kline WS: No klines_meta data found. Cannot map pair_ids to symbols.")
        for row in meta_rows:
            pair_id = row['pair_id']
            exchange_name = row['exchange_name']
            from_token = row['pair_l']
            to_token = row['pair_r']
            pair_id_to_info_map[pair_id] = {
                "exchange": exchange_name,
                "from_token": from_token,
                "to_token": to_token
            }
            channel_str = f"0~{exchange_name}~{from_token}~{to_token}"
            channel_string_to_pair_id[channel_str] = pair_id
            pair_id_to_latest_kline_cache[pair_id] = None # Initialize cache
        logging.info(f"Kline WS: Loaded {len(pair_id_to_info_map)} pair mappings.")
    except Exception as e:
        logging.error(f"Kline WS: Error loading klines_meta: {e}", exc_info=True)

    while True:
        loop_start_time = time.monotonic()
        try:
            # Query klines_latest for all pairs, select specific columns
            latest_klines_rows = mdb.query_get_all("SELECT meta_id, timestamp, open, high, low, close FROM `klines_latest`")
            if latest_klines_rows is None:
                logging.error("Kline WS: Failed to fetch from klines_latest or table is empty.")
                await asyncio.sleep(main_loop_max_wait * 2) # Longer sleep on DB error
                if not mdb.is_connected(): # Attempt reconnect if DB query failed
                    logging.warning("Kline WS: MySQL connection lost, attempting reconnect in data loop.")
                    mdb.reconnect()
                continue

            updated_pair_ids = set()

            for kline_data in latest_klines_rows:
                pair_id = kline_data.get('meta_id')
                if pair_id not in pair_id_to_info_map:
                    continue # Skip if pair_id is unknown

                current_data_for_cache = {
                    "ts": int(kline_data['timestamp']), # 'timestamp' from DB
                    "o": str(kline_data['open']),
                    "h": str(kline_data['high']),
                    "l": str(kline_data['low']),
                    "c": str(kline_data['close']),
                }

                if pair_id_to_latest_kline_cache.get(pair_id) != current_data_for_cache:
                    pair_id_to_latest_kline_cache[pair_id] = current_data_for_cache
                    updated_pair_ids.add(pair_id)

            for pair_id_updated in updated_pair_ids:
                pair_info = pair_id_to_info_map.get(pair_id_updated)
                kline_update_data = pair_id_to_latest_kline_cache.get(pair_id_updated)

                if not pair_info or not kline_update_data: continue

                msg_str = (f"0~{pair_info['exchange']}~{pair_info['from_token']}~{pair_info['to_token']}"
                           f"~{kline_update_data['ts']}"
                           f"~{kline_update_data['o']}~{kline_update_data['h']}"
                           f"~{kline_update_data['l']}~{kline_update_data['c']}")

                channel_str_for_broadcast = f"0~{pair_info['exchange']}~{pair_info['from_token']}~{pair_info['to_token']}"

                if channel_str_for_broadcast in channel_to_clients:
                    clients_for_channel = list(channel_to_clients[channel_str_for_broadcast]) # Iterate over a copy
                    # logging.debug(f"Kline WS: Broadcasting kline update for {channel_str_for_broadcast} to {len(clients_for_channel)} client(s).")
                    for client_hex_id in clients_for_channel:
                        if client_hex_id in ws_connections:
                            ws_client_socket = ws_connections[client_hex_id]["ws"]
                            try:
                                await ws_client_socket.send(msg_str)
                            except websockets.ConnectionClosed:
                                logging.warning(f"Kline WS: Connection closed for client {client_hex_id} while sending kline. Will be cleaned up.")
                            except Exception as e:
                                logging.error(f"Kline WS: Error sending kline to client {client_hex_id}: {e}")
        except Exception as e:
            logging.error(f"Kline WS: Error in data loop: {e}", exc_info=True)
            if not mdb.is_connected():
                logging.warning("Kline WS: MySQL connection lost in data loop, attempting reconnect.")
                if not mdb.reconnect():
                    logging.error("Kline WS: Failed to reconnect to MySQL after data loop error. Waiting before retry.")
                    await asyncio.sleep(main_loop_max_wait * 3) # Longer wait on DB error + reconnect failure
                    continue # Skip to next iteration after waiting

        elapsed_time = time.monotonic() - loop_start_time
        sleep_duration = max(0, main_loop_max_wait - elapsed_time)
        if sleep_duration > 0 : await asyncio.sleep(sleep_duration)

async def handle_websocket_connection(websocket, path):
    hex_id = websocket.id.hex
    logging.info(f"Kline WS Client {hex_id} connected from {websocket.remote_address}")
    ws_connections[hex_id] = {"ws": websocket, "subs": set()}

    try:
        async for message in websocket:
            logging.debug(f"Kline WS Received from {hex_id}: {message[:200]}") # Log snippet
            try:
                data = json.loads(message)
                # Ensure client connection data still exists (it might have been cleaned up if error occurred)
                if hex_id not in ws_connections:
                    logging.warning(f"Kline WS: Message received from already cleaned up client {hex_id}. Ignoring.")
                    break # Exit the message loop for this now-defunct connection

                client_subs_set = ws_connections[hex_id]["subs"]

                if 'SubAdd' in data and 'subs' in data['SubAdd']:
                    for channel_str_to_add in data['SubAdd']['subs']:
                        if not isinstance(channel_str_to_add, str) or not channel_str_to_add.startswith("0~"):
                            logging.warning(f"Kline WS: Invalid channel format in SubAdd from {hex_id}: {channel_str_to_add}")
                            continue
                        if channel_str_to_add not in channel_string_to_pair_id:
                            logging.warning(f"Kline WS: SubAdd for unknown channel {channel_str_to_add} from {hex_id}")
                            continue

                        client_subs_set.add(channel_str_to_add)
                        if channel_str_to_add not in channel_to_clients:
                            channel_to_clients[channel_str_to_add] = set()
                        channel_to_clients[channel_str_to_add].add(hex_id)
                        logging.info(f"Kline WS: Client {hex_id} subscribed to {channel_str_to_add}")

                        pair_id_for_sub = channel_string_to_pair_id.get(channel_str_to_add)
                        if pair_id_for_sub and pair_id_to_latest_kline_cache.get(pair_id_for_sub):
                            # Send current kline data on new subscription
                            pair_info_on_sub = pair_id_to_info_map[pair_id_for_sub]
                            kline_on_sub = pair_id_to_latest_kline_cache[pair_id_for_sub]
                            msg_str_on_sub = (f"0~{pair_info_on_sub['exchange']}~{pair_info_on_sub['from_token']}~{pair_info_on_sub['to_token']}"
                                              f"~{kline_on_sub['ts']}~{kline_on_sub['o']}~{kline_on_sub['h']}"
                                              f"~{kline_on_sub['l']}~{kline_on_sub['c']}")
                            await websocket.send(msg_str_on_sub)

                elif 'SubRemove' in data and 'subs' in data['SubRemove']:
                    for channel_str_to_remove in data['SubRemove']['subs']:
                        if channel_str_to_remove in client_subs_set:
                            client_subs_set.remove(channel_str_to_remove)
                        if channel_str_to_remove in channel_to_clients and hex_id in channel_to_clients[channel_str_to_remove]:
                            channel_to_clients[channel_str_to_remove].remove(hex_id)
                            if not channel_to_clients[channel_str_to_remove]: # If set is empty
                                del channel_to_clients[channel_str_to_remove]
                                logging.info(f"Kline WS: No more clients for channel {channel_str_to_remove}, removed from tracking.")
                        logging.info(f"Kline WS: Client {hex_id} unsubscribed from {channel_str_to_remove}")

                elif 'SubResume' in data:
                    resume_info_dict = data['SubResume']
                    channel_str_to_resume = resume_info_dict.get('channel')
                    last_known_ts = int(resume_info_dict.get('last_ts', 0))

                    if channel_str_to_resume and channel_str_to_resume.startswith("0~") and last_known_ts > 0:
                        pair_id_for_resume = channel_string_to_pair_id.get(channel_str_to_resume)
                        pair_info_for_resume = pair_id_to_info_map.get(pair_id_for_resume)

                        if pair_id_for_resume and pair_info_for_resume:
                            client_subs_set.add(channel_str_to_resume)
                            if channel_str_to_resume not in channel_to_clients:
                                channel_to_clients[channel_str_to_resume] = set()
                            channel_to_clients[channel_str_to_resume].add(hex_id)
                            logging.info(f"Kline WS: Client {hex_id} resumed subscription to {channel_str_to_resume} from ts {last_known_ts}")

                            # Fetch and send missed klines from the pair-specific history table
                            # This assumes table names like 'klines_1', 'klines_2', etc.
                            history_table_name = f"{TBL_KLINES_HISTORY_PREFIX}{pair_id_for_resume}"

                            # Basic validation of table name to prevent injection if TBL_KLINES_HISTORY_PREFIX could be manipulated
                            # or if pair_id_for_resume was from untrusted source (not the case here as it's from our map)
                            if not history_table_name.isalnum() and '_' not in history_table_name : # Simple check
                                logging.error(f"Kline WS: Invalid history table name generated: {history_table_name}")
                                continue

                            # Use prepared statement for fetching missed klines
                            q_missed_klines = f"SELECT timestamp, open, high, low, close FROM `{history_table_name}` WHERE `timestamp` > %s ORDER BY `timestamp` ASC"
                            missed_klines_data = mdb.query_get_all(q_missed_klines, (last_known_ts,))

                            if missed_klines_data:
                                logging.info(f"Kline WS: Sending {len(missed_klines_data)} missed klines to {hex_id} for {channel_str_to_resume}")
                                for kline_row in missed_klines_data:
                                    msg_str_missed_kline = (f"0~{pair_info_for_resume['exchange']}~{pair_info_for_resume['from_token']}~{pair_info_for_resume['to_token']}"
                                                            f"~{int(kline_row['timestamp'])}"
                                                            f"~{str(kline_row['open'])}~{str(kline_row['high'])}"
                                                            f"~{str(kline_row['low'])}~{str(kline_row['close'])}")
                                    await websocket.send(msg_str_missed_kline)
                            else: # If no missed klines, send the current latest one from cache
                                if pair_id_to_latest_kline_cache.get(pair_id_for_resume):
                                    kline_on_resume = pair_id_to_latest_kline_cache[pair_id_for_resume]
                                    msg_str_current = (f"0~{pair_info_for_resume['exchange']}~{pair_info_for_resume['from_token']}~{pair_info_for_resume['to_token']}"
                                                       f"~{kline_on_resume['ts']}~{kline_on_resume['o']}~{kline_on_resume['h']}"
                                                       f"~{kline_on_resume['l']}~{kline_on_resume['c']}")
                                    await websocket.send(msg_str_current)

                        else:
                            logging.warning(f"Kline WS: Cannot resume for {channel_str_to_resume}: pair_id or pair_info not found.")
                    else:
                        logging.warning(f"Kline WS: Invalid SubResume from {hex_id}: {resume_info_dict}")
                else:
                    logging.warning(f"Kline WS: Unknown message structure from {hex_id}: {data}")

            except json.JSONDecodeError:
                logging.warning(f"Kline WS: Invalid JSON from {hex_id}: {message}")
            except Exception as e:
                logging.error(f"Kline WS: Error processing message from {hex_id}: {e}", exc_info=True)

    except websockets.ConnectionClosedOK:
        logging.info(f"Kline WS Client {hex_id} disconnected gracefully.")
    except websockets.ConnectionClosedError as e:
        logging.warning(f"Kline WS Client {hex_id} connection closed with error: {e}")
    except Exception as e:
        logging.error(f"Kline WS: Unhandled exception for client {hex_id}: {e}", exc_info=True)
    finally:
        await cleanup_client(websocket)

async def start_server():
    load_config()
    # Configure logging
    log_level_str = config.get("log_level", "INFO").upper()
    log_level = getattr(logging, log_level_str, logging.INFO)
    logging.basicConfig(level=log_level, format='%(asctime)s %(levelname)s (KlinesWS): %(message)s')


    ssl_context_to_use = None
    if config.get('use_ssl', False):
        try:
            ssl_context_to_use = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ssl_context_to_use.load_cert_chain(config['ssl']['fullchain'], keyfile=config['ssl']['privkey'])
            logging.info("Kline WS: SSL context loaded.")
        except FileNotFoundError:
            logging.error(f"Kline WS: SSL cert or key file not found. Paths: {config['ssl'].get('fullchain')}, {config['ssl'].get('privkey')}. Starting without SSL.")
        except Exception as e:
            logging.error(f"Kline WS: Failed to load SSL context: {e}. Starting without SSL.")
            ssl_context_to_use = None

    port = int(config.get('port', 8888))
    host = config.get('host', '0.0.0.0')

    # Start the data loop as a separate task
    asyncio.create_task(main_data_loop())

    server = await websockets.serve(handle_websocket_connection, host, port, ssl=ssl_context_to_use,
                                    ping_interval=20, ping_timeout=20,
                                    max_size=2**20) # Default max_size is 1MB, increase if needed

    protocol_type = 'wss' if ssl_context_to_use else 'ws'
    logging.info(f"Kline WebSocket Server started on {protocol_type}://{host}:{port}")

    try:
        await server.wait_closed() # Keep server running until explicitly closed or error
    finally:
        logging.info("Kline WebSocket Server is shutting down.")
        if mdb and mdb.is_connected():
            mdb.close_connection()


if __name__ == "__main__":
    try:
        asyncio.run(start_server())
    except KeyboardInterrupt:
        logging.info("Kline WS: Server shutting down due to KeyboardInterrupt...")
    except Exception as e:
        logging.critical(f"Kline WS: Unhandled exception at top level: {e}", exc_info=True)
    finally:
        logging.info("Kline WS: Shutdown complete.")