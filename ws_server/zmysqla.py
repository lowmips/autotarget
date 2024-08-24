import mysql.connector.aio

class mysqlDBCa:
    async def __init__(self, user, pw, host, db):
        self.user = user
        self.pw = pw
        self.host = host
        self.db = db
        self.mysql_connection = None
        self.__connect()

    async def __connect(self):
        try:
            self.mysql_connection = await mysql.connector.connect(
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

    async def __getCursor(self):
        try:
            await self.mysql_connection.ping(reconnect=True, attempts=3, delay=5)
        except mysql.connector.Error as err:
            self.mysql_connection = await init_db()
        cursor = await self.mysql_connection.cursor(dictionary=True)
        return cursor

    def rows_affected(self):
        return self.affected_rows

    async def query_and_commit(self, q):
        self.affected_rows = 0
        cursor = await self.__getCursor()
        result = await cursor.execute(q)
        self.affected_rows = cursor.rowcount
        await self.mysql_connection.commit()
        await cursor.close()

    async def query_get_all(self, q):
        self.affected_rows = 0
        cursor = await self.__getCursor()
        result = await cursor.execute(q)
        rows = await cursor.fetchall()
        await self.mysql_connection.commit()
        await cursor.close()
        return rows

    async def query_get_first_value(self, q):
        self.affected_rows = 0
        cursor = await self.__getCursor()
        result = await cursor.execute(q)
        row = await cursor.fetchone()
        await self.mysql_connection.commit()
        await cursor.close()
        return row[0]

    async def query_get_one(self, q):
        self.affected_rows = 0
        cursor = await self.__getCursor()
        result = await cursor.execute(q)
        row = await cursor.fetchone()
        await self.mysql_connection.commit()
        await cursor.close()
        return row

    async def query_get_result(self, q):
        self.affected_rows = 0
        cursor = await self.__getCursor()
        result = await cursor.execute(q)
        self.affected_rows = cursor.rows
        await self.mysql_connection.commit()
        await cursor.close()
        return result