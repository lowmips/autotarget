import mysql.connector

class mysqlDBC:
    def __init__(self, user, pw, host, db):
        self.user = user
        self.pw = pw
        self.host = host
        self.db = db
        self.mysql_connection = None
        self.__connect()

    def __connect(self):
        try:
            self.mysql_connection = mysql.connector.connect(
                                                user = self.user,
                                                password = self.pw,
                                                host = self.host,
                                                database = self.db,
                                                autocommit = True
                                                )
        except mysql.connector.Error as err:
            if err.errno == errorcode.ER_ACCESS_DENIED_ERROR:
                print("Something is wrong with your user name or password")
            elif err.errno == errorcode.ER_BAD_DB_ERROR:
                print("Database [{}] does not exist".format(self.db))
            else:
                print(err)
            quit()
        else:
            print("MySQL connected.")

    def __getCursor(self):
        try:
            self.mysql_connection.ping(reconnect=True, attempts=3, delay=5)
        except mysql.connector.Error as err:
            self.mysql_connection = init_db()
        return self.mysql_connection.cursor(dictionary=True)

    def rows_affected(self):
        return self.affected_rows

    def query_and_commit(self, q):
        self.affected_rows = 0
        cursor = self.__getCursor()
        result = cursor.execute(q)
        self.affected_rows = cursor.rowcount
        self.mysql_connection.commit()
        cursor.close()

    def query_get_all(self, q):
        self.affected_rows = 0
        cursor = self.__getCursor()
        result = cursor.execute(q)
        rows = cursor.fetchall()
        self.mysql_connection.commit()
        cursor.close()
        return rows

    def query_get_first_value(self, q):
        self.affected_rows = 0
        cursor = self.__getCursor()
        result = cursor.execute(q)
        row = cursor.fetchone()
        self.mysql_connection.commit()
        cursor.close()
        return row[0]

    def query_get_one(self, q):
        self.affected_rows = 0
        cursor = self.__getCursor()
        result = cursor.execute(q)
        row = cursor.fetchone()
        self.mysql_connection.commit()
        cursor.close()
        return row

    def query_get_result(self, q):
        self.affected_rows = 0
        cursor = self.__getCursor()
        result = cursor.execute(q)
        self.affected_rows = cursor.rows
        self.mysql_connection.commit()
        cursor.close()
        return result