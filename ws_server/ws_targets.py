#!/usr/bin/env python
import asyncio
import decimal
import json
import logging
import websockets
import ssl
import sys
import time
import datetime # Kept for DecimalEncoder, though not directly used for date math here
from zmysql import mysqlDBC

# --- Decimal Encoder ---
class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, decimal.Decimal):
            return str(o)
        elif isinstance(o, (datetime.date, datetime.datetime)):
            return o.isoformat()
        return super(DecimalEncoder, self).default(o)

# --- Configuration ---
CONFIG_FILE = 'config.ws_targets.json'
config = None
mdb = None
main_loop_max_wait = 5 # Default, can be overridden by config

# --- Global State ---
# ws_connected: hex_id -> {"ws": websocket, "subs": {pair_id: {"types": set_of_strings, "last_ts_sent": 0}}}
# "last_ts_sent" for a pair_id under a client refers to the latest timestamp (either target's last_update_ts or range's ts)
# that was included in the last data packet sent *to that specific client* for that pair.
# This helps in SubResume to fetch only data newer than what the client last saw *for its subscribed types*.
ws_connected = {}

# pair_id_info: pair_id -> {"exchange": "MEXC", "from_token": "BTC", "to_token": "USDT"}
pair_id_info = {}

# targets_available_map: For validating subscriptions (exchange_name -> from_token -> to_token -> pair_id)
targets_available_map = {}

# Global cache for all target data, fetched by main_loop, organized by type for easier filtering
# pair_id -> {
#   "targets_by_type": { "type1": [target_dicts], "type2": [target_dicts] },
#   "ranges_by_type":  { "type1": [range_dicts],  "type2": [range_dicts] },
#   "last_db_check_ts": timestamp_of_last_db_query_for_this_pair
# }
pair_id_to_global_data_cache = {}

# Define default target type from auth.php (or make it configurable here)
DEFAULT_TARGET_TYPE_PY = '1.786' # Ensure this matches PHP's DEFAULT_TARGET_TYPE


def load_config():
    global config, main_loop_max_wait
    try:
        with open(CONFIG_FILE, 'r') as f:
            config = json.load(f)
            main_loop_max_wait = config.get('main_loop_max_wait', main_loop_max_wait)
            logging.info(f"Targets WS Config loaded. Main loop wait: {main_loop_max_wait}s")
    except FileNotFoundError:
        logging.critical(f"Targets WS: Configuration file {CONFIG_FILE} not found.")
        sys.exit(1)
    except json.JSONDecodeError:
        logging.critical(f"Targets WS: Error decoding JSON from {CONFIG_FILE}.")
        sys.exit(1)

async def cleanup_client(websocket):
    hex_id = websocket.id.hex
    if hex_id in ws_connected:
        del ws_connected[hex_id]
        logging.info(f"Targets WS: Cleaned up client {hex_id}. Active clients: {len(ws_connected)}")

async def main_target_data_loop():
    global mdb, pair_id_to_global_data_cache, pair_id_info, targets_available_map
    logging.info("Target WebSocket data loop started.")
    mdb = mysqlDBC(config['mysql']['username'], config['mysql']['password'],
                   config['mysql']['host'], config['mysql']['database'],
                   port=config['mysql'].get('port', 3306))
    if not mdb.is_connected():
        logging.critical("Targets WS: Failed to connect to MySQL. Exiting data loop.")
        return

    # Populate pair_id_info and targets_available_map
    try:
        meta_query = """
            SELECT km.id AS pair_id, e.exchange AS exchange_name, km.pair_l, km.pair_r
            FROM klines_meta km
            JOIN exchanges e ON km.exchange_id = e.id
        """ # Consider adding "WHERE km.id = 1" or similar if only specific pairs are targeted
        meta_rows = mdb.query_get_all(meta_query)
        if not meta_rows: logging.warning("Targets WS: No klines_meta data found for targets.")

        for row in meta_rows:
            pair_id = row['pair_id']
            exchange_name = row['exchange_name']
            pair_l, pair_r = row['pair_l'], row['pair_r']
            pair_id_info[pair_id] = {"exchange": exchange_name, "from_token": pair_l, "to_token": pair_r}
            if exchange_name not in targets_available_map: targets_available_map[exchange_name] = {}
            if pair_l not in targets_available_map[exchange_name]: targets_available_map[exchange_name][pair_l] = {}
            targets_available_map[exchange_name][pair_l][pair_r] = pair_id
            pair_id_to_global_data_cache[pair_id] = {
                "targets_by_type": {}, "ranges_by_type": {},
                "last_db_check_ts": 0 # Timestamp of last successful full fetch for this pair
            }
        logging.info(f"Targets WS: Loaded {len(pair_id_info)} pair mappings.")
    except Exception as e:
        logging.error(f"Targets WS: Error loading klines_meta: {e}", exc_info=True)

    while True:
        loop_start_time = time.monotonic()
        current_time_for_db_check = int(time.time())
        try:
            # Determine all unique pair_ids and target_types currently subscribed by any client
            all_needed_pair_ids_and_types = {} # pair_id -> set of types
            for conn_data in ws_connected.values():
                for pid, sub_info in conn_data.get('subs', {}).items():
                    if pid not in all_needed_pair_ids_and_types:
                        all_needed_pair_ids_and_types[pid] = set()
                    all_needed_pair_ids_and_types[pid].update(sub_info.get('types', []))

            for pair_id, needed_types_for_pair_set in all_needed_pair_ids_and_types.items():
                if not needed_types_for_pair_set: continue

                pair_global_cache = pair_id_to_global_data_cache.get(pair_id)
                if not pair_global_cache: continue # Should be initialized

                data_changed_for_this_pair = False
                types_sql_in_clause_content = "','".join([mdb.escape_string(t) for t in needed_types_for_pair_set])

                # Fetch latest targets from `target_groups_latest` for this pair and needed types
                # `target_groups_latest` is assumed to contain only the most recent entry per target_price/target_type.
                q_latest_targets = f"SELECT * FROM `target_groups_latest` WHERE `meta_id`='{pair_id}' AND `target_type` IN ('{types_sql_in_clause_content}')"
                db_latest_targets = mdb.query_get_all(q_latest_targets)
                if db_latest_targets is None: db_latest_targets = [] # Handle query error as empty

                # Fetch latest ranges from `span_targets_ranges_{pid}`
                # Get the most recent range(s) for each needed type
                db_latest_ranges = []
                range_table_name = f"span_targets_ranges_{pair_id}"
                if mdb.table_exists(range_table_name): # Check if table exists first
                    q_latest_ranges = (f"SELECT r1.* FROM `{range_table_name}` r1 "
                                       f"INNER JOIN (SELECT target_type, MAX(ts) as max_ts FROM `{range_table_name}` "
                                       f"            WHERE target_type IN ('{types_sql_in_clause_content}') AND `target_count` > 1 GROUP BY target_type) r2 "
                                       f"ON r1.target_type = r2.target_type AND r1.ts = r2.max_ts "
                                       f"WHERE r1.target_type IN ('{types_sql_in_clause_content}') AND r1.`target_count` > 1")
                    ranges_from_db = mdb.query_get_all(q_latest_ranges)
                    if ranges_from_db is not None: db_latest_ranges = ranges_from_db
                else:
                    logging.debug(f"Targets WS: Range table {range_table_name} does not exist for pair_id {pair_id}.")


                # --- Update global cache if data has changed ---
                # Reorganize fetched data by type for easier comparison and filtering
                new_targets_by_type = {}
                for t_item in db_latest_targets:
                    t_type = t_item['target_type']
                    if t_type not in new_targets_by_type: new_targets_by_type[t_type] = []
                    new_targets_by_type[t_type].append(t_item)

                new_ranges_by_type = {}
                for r_item in db_latest_ranges:
                    r_type = r_item['target_type']
                    if r_type not in new_ranges_by_type: new_ranges_by_type[r_type] = []
                    new_ranges_by_type[r_type].append(r_item)

                # Compare with existing cache (by type)
                if json.dumps(new_targets_by_type, cls=DecimalEncoder, sort_keys=True) != \
                   json.dumps(pair_global_cache['targets_by_type'], cls=DecimalEncoder, sort_keys=True):
                    pair_global_cache['targets_by_type'] = new_targets_by_type
                    data_changed_for_this_pair = True
                    logging.debug(f"Targets WS: Target data updated for pair {pair_id}.")

                if json.dumps(new_ranges_by_type, cls=DecimalEncoder, sort_keys=True) != \
                   json.dumps(pair_global_cache['ranges_by_type'], cls=DecimalEncoder, sort_keys=True):
                    pair_global_cache['ranges_by_type'] = new_ranges_by_type
                    data_changed_for_this_pair = True
                    logging.debug(f"Targets WS: Range data updated for pair {pair_id}.")

                if data_changed_for_this_pair:
                    await send_update_to_pair_subscribers(pair_id)

                pair_global_cache['last_db_check_ts'] = current_time_for_db_check


        except Exception as e:
            logging.error(f"Targets WS: Error in data loop: {e}", exc_info=True)
            if not mdb.is_connected():
                logging.warning("Targets WS: MySQL connection lost, attempting reconnect.")
                if not mdb.reconnect():
                    logging.error("Targets WS: Failed to reconnect MySQL. Waiting.")
                    await asyncio.sleep(main_loop_max_wait * 3)
                    continue

        elapsed_time = time.monotonic() - loop_start_time
        sleep_duration = max(0, main_loop_max_wait - elapsed_time)
        if sleep_duration > 0 : await asyncio.sleep(sleep_duration)

async def send_update_to_pair_subscribers(pair_id):
    logging.debug(f"Targets WS: Preparing to send update for pair_id: {pair_id}")
    if pair_id not in pair_id_info:
        logging.warning(f"Targets WS: No pair_info for pair_id {pair_id} during send.")
        return

    pair_meta_info = pair_id_info[pair_id]
    global_data_for_pair = pair_id_to_global_data_cache.get(pair_id)
    if not global_data_for_pair:
        logging.warning(f"Targets WS: No global data cache for pair_id {pair_id}.")
        return

    clients_to_notify = []
    for hex_id, conn_data in ws_connected.items():
        if pair_id in conn_data.get("subs", {}):
            clients_to_notify.append({
                "ws": conn_data["ws"],
                "hex_id": hex_id,
                "types": conn_data["subs"][pair_id].get("types", set()),
                "last_ts_sent_ref": conn_data["subs"][pair_id] # Pass reference to update last_ts_sent
            })

    if not clients_to_notify: return

    max_ts_in_this_update = 0 # To track the latest timestamp sent in this batch

    for client_info in clients_to_notify:
        websocket = client_info["ws"]
        client_subscribed_types_set = client_info["types"]

        client_specific_targets = []
        for type_str, targets_list in global_data_for_pair["targets_by_type"].items():
            if type_str in client_subscribed_types_set:
                client_specific_targets.extend(targets_list)
                for t in targets_list: max_ts_in_this_update = max(max_ts_in_this_update, t.get('last_update_ts', 0))


        client_specific_ranges = []
        for type_str, ranges_list in global_data_for_pair["ranges_by_type"].items():
            if type_str in client_subscribed_types_set:
                client_specific_ranges.extend(ranges_list)
                for r in ranges_list: max_ts_in_this_update = max(max_ts_in_this_update, r.get('ts', 0))


        if not client_specific_targets and not client_specific_ranges:
            # logging.debug(f"Targets WS: No relevant data for client {client_info['hex_id']} on pair {pair_id} after type filtering.")
            continue

        update_payload = {
            'pair_info': pair_meta_info,
            'targets': client_specific_targets,
            'ranges': client_specific_ranges
        }
        update_str = json.dumps(update_payload, cls=DecimalEncoder)

        try:
            # logging.debug(f"Targets WS: Sending to {client_info['hex_id']} for pair {pair_id}, types {client_subscribed_types_set}: {update_str[:150]}...")
            await websocket.send(update_str)
            # Update last_ts_sent for this client for this pair_id
            client_info["last_ts_sent_ref"]["last_ts_sent"] = max_ts_in_this_update

        except websockets.ConnectionClosed:
            logging.warning(f"Targets WS: Connection closed for client {client_info['hex_id']}. Will be cleaned up.")
        except Exception as e:
            logging.error(f"Targets WS: Error sending to client {client_info['hex_id']}: {e}")


async def handle_websocket_connection_targets(websocket, path):
    hex_id = websocket.id.hex
    logging.info(f"Target WS Client {hex_id} connected from {websocket.remote_address}")
    ws_connected[hex_id] = {"ws": websocket, "subs": {}} # subs: pair_id -> {"types": set(), "last_ts_sent": 0}

    try:
        async for message in websocket:
            logging.debug(f"Target WS Received from {hex_id}: {message[:200]}")
            try:
                data = json.loads(message)
                current_client_conn_data = ws_connected.get(hex_id)
                if not current_client_conn_data:
                    logging.warning(f"Targets WS: Message from already cleaned up client {hex_id}. Ignoring.")
                    break

                if 'SubAdd' in data and 'subs' in data['SubAdd']:
                    for sub_item in data['SubAdd']['subs']:
                        channel_str = sub_item.get('channel')
                        types_list = sub_item.get('types', [DEFAULT_TARGET_TYPE_PY])
                        if not channel_str or not isinstance(types_list, list):
                            logging.warning(f"Targets WS: Invalid SubAdd item from {hex_id}: {sub_item}")
                            continue

                        parts = channel_str.split('~')
                        if len(parts) != 4: continue
                        _, exchange, from_token, to_token = parts
                        pair_id = targets_available_map.get(exchange, {}).get(from_token, {}).get(to_token)
                        if pair_id is None:
                            logging.warning(f"Targets WS: Unknown pair for SubAdd from {hex_id}: {channel_str}")
                            continue

                        if pair_id not in current_client_conn_data['subs']:
                            current_client_conn_data['subs'][pair_id] = {"types": set(), "last_ts_sent": 0}
                        current_client_conn_data['subs'][pair_id]['types'].update(types_list)
                        logging.info(f"Targets WS: Client {hex_id} subscribed to pair_id {pair_id} with types {current_client_conn_data['subs'][pair_id]['types']}")
                        await send_update_to_pair_subscribers(pair_id) # Send current data


                elif 'SubRemove' in data and 'subs' in data['SubRemove']:
                    for channel_str_to_remove in data['SubRemove']['subs']:
                        if not isinstance(channel_str_to_remove, str): continue
                        parts = channel_str_to_remove.split('~')
                        if len(parts) != 4: continue
                        _, exchange, from_token, to_token = parts
                        pair_id_to_remove = targets_available_map.get(exchange, {}).get(from_token, {}).get(to_token)
                        if pair_id_to_remove and pair_id_to_remove in current_client_conn_data.get('subs', {}):
                            del current_client_conn_data['subs'][pair_id_to_remove]
                            logging.info(f"Targets WS: Client {hex_id} unsubscribed from pair_id {pair_id_to_remove}")


                elif 'UpdatePreferences' in data:
                    pref_data = data['UpdatePreferences']
                    channel_str_pref = pref_data.get('channel')
                    new_types_list_pref = pref_data.get('types')
                    if not channel_str_pref or not isinstance(new_types_list_pref, list):
                        logging.warning(f"Targets WS: Invalid UpdatePreferences from {hex_id}: {pref_data}")
                        continue

                    parts_pref = channel_str_pref.split('~')
                    if len(parts_pref) != 4: continue
                    _, exchange_pref, from_token_pref, to_token_pref = parts_pref
                    pair_id_pref = targets_available_map.get(exchange_pref, {}).get(from_token_pref, {}).get(to_token_pref)

                    if pair_id_pref and pair_id_pref in current_client_conn_data.get('subs', {}):
                        current_client_conn_data['subs'][pair_id_pref]['types'] = set(new_types_list_pref)
                        current_client_conn_data['subs'][pair_id_pref]['last_ts_sent'] = 0 # Reset to force send all relevant
                        logging.info(f"Targets WS: Client {hex_id} updated preferences for pair_id {pair_id_pref} to types {new_types_list_pref}")
                        await send_update_to_pair_subscribers(pair_id_pref) # Resend data based on new preferences
                    else:
                        logging.warning(f"Targets WS: Client {hex_id} tried to update preferences for non-subscribed/unknown pair {pair_id_pref if pair_id_pref else channel_str_pref}")

                elif 'SubResume' in data:
                    resume_info = data['SubResume']
                    channel_str_resume = resume_info.get('channel')
                    types_list_resume = resume_info.get('types', [DEFAULT_TARGET_TYPE_PY])
                    last_ts_from_client = int(resume_info.get('last_ts', 0))

                    if not channel_str_resume or not isinstance(types_list_resume, list) or last_ts_from_client <= 0:
                        logging.warning(f"Targets WS: Invalid SubResume from {hex_id}: {resume_info}")
                        continue

                    parts_resume = channel_str_resume.split('~')
                    if len(parts_resume) != 4: continue
                    _, exchange_res, from_token_res, to_token_res = parts_resume
                    pair_id_resume = targets_available_map.get(exchange_res, {}).get(from_token_res, {}).get(to_token_res)

                    if pair_id_resume:
                        if pair_id_resume not in current_client_conn_data['subs']:
                            current_client_conn_data['subs'][pair_id_resume] = {"types": set(), "last_ts_sent": 0}
                        current_client_conn_data['subs'][pair_id_resume]['types'].update(types_list_resume)
                        # Important: We need to fetch data newer than last_ts_from_client for THIS client's types.
                        # The main loop fetches globally. Here, we construct what this client missed.
                        logging.info(f"Targets WS: Client {hex_id} resumed sub for pair_id {pair_id_resume}, types {types_list_resume}, from ts {last_ts_from_client}")

                        missed_targets_data = []
                        missed_ranges_data = []
                        types_sql_in_res = "','".join([mdb.escape_string(t) for t in types_list_resume])

                        # Query for missed targets using `target_groups_{pid}` (full history table)
                        # and `last_update_ts` from that table.
                        # This requires `target_groups_{pid}` to exist and be populated.
                        target_history_table = f"target_groups_{pair_id_resume}"
                        if mdb.table_exists(target_history_table):
                            q_missed_targets = (f"SELECT * FROM `{target_history_table}` "
                                                f"WHERE `target_type` IN ('{types_sql_in_res}') "
                                                f"AND `last_update_ts` > {last_ts_from_client}")
                            missed_t_rows = mdb.query_get_all(q_missed_targets)
                            if missed_t_rows: missed_targets_data.extend(missed_t_rows)

                        # Query for missed ranges from `span_targets_ranges_{pid}` and `ts` column
                        range_history_table = f"span_targets_ranges_{pair_id_resume}"
                        if mdb.table_exists(range_history_table):
                            q_missed_ranges = (f"SELECT * FROM `{range_history_table}` "
                                               f"WHERE `target_type` IN ('{types_sql_in_res}') "
                                               f"AND `ts` > {last_ts_from_client} AND `target_count` > 1")
                            missed_r_rows = mdb.query_get_all(q_missed_ranges)
                            if missed_r_rows: missed_ranges_data.extend(missed_r_rows)

                        max_ts_in_missed_data = last_ts_from_client
                        if missed_targets_data: max_ts_in_missed_data = max(max_ts_in_missed_data, max(t.get('last_update_ts',0) for t in missed_targets_data))
                        if missed_ranges_data: max_ts_in_missed_data = max(max_ts_in_missed_data, max(r.get('ts',0) for r in missed_ranges_data))


                        if missed_targets_data or missed_ranges_data:
                            resume_payload = {
                                'pair_info': pair_id_info[pair_id_resume],
                                'targets': missed_targets_data,
                                'ranges': missed_ranges_data,
                                'is_resume_data': True
                            }
                            await websocket.send(json.dumps(resume_payload, cls=DecimalEncoder))
                            current_client_conn_data['subs'][pair_id_resume]['last_ts_sent'] = max_ts_in_missed_data
                            logging.info(f"Targets WS: Sent {len(missed_targets_data)} missed targets & {len(missed_ranges_data)} ranges to {hex_id} for {pair_id_resume}")
                        else: # No specific missed data, send current latest based on global cache
                            await send_update_to_pair_subscribers(pair_id_resume) # This will filter by types
                    else:
                        logging.warning(f"Targets WS: Cannot resume for unknown pair in {channel_str_resume} from {hex_id}")
                else:
                    logging.warning(f"Targets WS: Unknown message structure from {hex_id}: {data}")

            except json.JSONDecodeError:
                logging.warning(f"Targets WS: Invalid JSON from client {hex_id}: {message}")
            except Exception as e:
                logging.error(f"Targets WS: Error processing message from client {hex_id}: {e}", exc_info=True)

    except websockets.ConnectionClosedOK:
        logging.info(f"Target WS Client {hex_id} disconnected gracefully.")
    except websockets.ConnectionClosedError as e:
        logging.warning(f"Target WS Client {hex_id} connection closed with error: {e}")
    except Exception as e:
        logging.error(f"Targets WS: Unhandled exception for client {hex_id}: {e}", exc_info=True)
    finally:
        await cleanup_client(websocket)


async def start_target_server():
    load_config()
    log_level_str = config.get("log_level", "INFO").upper()
    log_level = getattr(logging, log_level_str, logging.INFO)
    logging.basicConfig(level=log_level, format='%(asctime)s %(levelname)s (TargetsWS): %(message)s')

    ssl_context_to_use = None
    if config.get('use_ssl', False):
        try:
            ssl_context_to_use = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ssl_context_to_use.load_cert_chain(config['ssl']['fullchain'], keyfile=config['ssl']['privkey'])
            logging.info("Targets WS: SSL context loaded.")
        except FileNotFoundError:
            logging.error(f"Targets WS: SSL cert or key file not found. Paths: {config['ssl'].get('fullchain')}, {config['ssl'].get('privkey')}. Starting without SSL.")
        except Exception as e:
            logging.error(f"Targets WS: Failed to load SSL context: {e}. Starting without SSL.")
            ssl_context_to_use = None

    port = int(config.get('port', 8889))
    host = config.get('host', '0.0.0.0')

    asyncio.create_task(main_target_data_loop())

    server = await websockets.serve(handle_websocket_connection_targets, host, port, ssl=ssl_context_to_use,
                                    ping_interval=20, ping_timeout=20, max_size=2**20)

    protocol_type = 'wss' if ssl_context_to_use else 'ws'
    logging.info(f"Targets WebSocket Server started on {protocol_type}://{host}:{port}")

    try:
        await server.wait_closed()
    finally:
        logging.info("Targets WebSocket Server is shutting down.")
        if mdb and mdb.is_connected():
            mdb.close_connection()

if __name__ == "__main__":
    try:
        asyncio.run(start_target_server())
    except KeyboardInterrupt:
        logging.info("Targets WS: Server shutting down due to KeyboardInterrupt...")
    except Exception as e:
        logging.critical(f"Targets WS: Unhandled exception at top level: {e}", exc_info=True)
    finally:
        logging.info("Targets WS: Shutdown complete.")