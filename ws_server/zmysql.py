#!/usr/bin/env python
# Overall purpose:
# A wrapper class for mysql.connector to provide a simplified and resilient
# interface for database operations. It handles connection, reconnection,
# and provides helper methods for common query patterns.

import mysql.connector
from mysql.connector import errorcode
import logging

class mysqlDBC:
    def __init__(self, user, pw, host, db, port=3306):
        self.user = user
        self.pw = pw
        self.host = host
        self.db = db
        self.port = port
        self.mysql_connection = None
        self.affected_rows = 0
        self.__connect()

    def __connect(self):
        try:
            self.mysql_connection = mysql.connector.connect(
                user=self.user,
                password=self.pw,
                host=self.host,
                database=self.db,
                port=self.port,
                autocommit=True
            )
            logging.info("MySQL connected.")
            return True
        except mysql.connector.Error as err:
            if err.errno == errorcode.ER_ACCESS_DENIED_ERROR:
                logging.critical("MySQL Error: Access denied. Check username/password.")
            elif err.errno == errorcode.ER_BAD_DB_ERROR:
                logging.critical(f"MySQL Error: Database '{self.db}' does not exist.")
            else:
                logging.critical(f"MySQL Error: {err}")
            # The server scripts depend on a database connection to function.
            # Terminate if a connection cannot be established on startup.
            quit()
        return False

    def is_connected(self):
        if self.mysql_connection:
            return self.mysql_connection.is_connected()
        return False

    def reconnect(self):
        logging.info("Attempting to reconnect to MySQL...")
        self.close_connection()
        return self.__connect()

    def close_connection(self):
        if self.mysql_connection and self.mysql_connection.is_connected():
            self.mysql_connection.close()
            logging.info("MySQL connection closed.")

    def __getCursor(self):
        try:
            # Re-establish connection if it has been dropped.
            self.mysql_connection.ping(reconnect=True, attempts=3, delay=5)
        except mysql.connector.Error as err:
            logging.warning(f"MySQL connection lost (ping failed). Attempting full reconnect. Error: {err}")
            self.__connect()
        return self.mysql_connection.cursor(dictionary=True)

    def table_exists(self, table_name):
        q = "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = %s AND table_name = %s"
        params = (self.db, table_name)
        count = self.query_get_first_value(q, params)
        return count == 1

    def escape_string(self, value):
        # This is a basic escape for values intended to be placed inside quotes in an SQL query string.
        # It is highly recommended to use parameterized queries instead.
        # This implementation is provided for compatibility with existing code that builds IN clauses dynamically.
        if value is None:
            return 'NULL'
        return str(value).replace("'", "''").replace("\\", "\\\\")

    def rows_affected(self):
        return self.affected_rows

    def query_and_commit(self, q, params=None):
        self.affected_rows = 0
        cursor = self.__getCursor()
        try:
            cursor.execute(q, params or ())
            self.affected_rows = cursor.rowcount
            self.mysql_connection.commit()
        finally:
            cursor.close()

    def query_get_all(self, q, params=None):
        self.affected_rows = 0
        cursor = self.__getCursor()
        try:
            cursor.execute(q, params or ())
            rows = cursor.fetchall()
            self.affected_rows = cursor.rowcount
            return rows
        finally:
            cursor.close()

    def query_get_first_value(self, q, params=None):
        self.affected_rows = 0
        cursor = self.__getCursor()
        try:
            cursor.execute(q, params or ())
            row = cursor.fetchone()
            self.affected_rows = 1 if row else 0
            if row:
                # Assumes the first column is the desired value
                return next(iter(row.values()))
            return None
        finally:
            cursor.close()

    def query_get_one(self, q, params=None):
        self.affected_rows = 0
        cursor = self.__getCursor()
        try:
            cursor.execute(q, params or ())
            row = cursor.fetchone()
            self.affected_rows = 1 if row else 0
            return row
        finally:
            cursor.close()

    def query_get_result(self, q, params=None):
        # Note: cursor.execute() returns None. This method's return value is not useful.
        # It is maintained for potential compatibility, but its use is discouraged.
        self.affected_rows = 0
        cursor = self.__getCursor()
        try:
            result = cursor.execute(q, params or ())
            self.affected_rows = cursor.rowcount
            return result
        finally:
            cursor.close()