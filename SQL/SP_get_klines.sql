DROP PROCEDURE IF EXISTS get_klines;
DELIMITER $$
CREATE PROCEDURE get_klines (IN resolution INT, IN ts_from INT UNSIGNED, IN ts_to INT UNSIGNED)
BEGIN
    DECLARE looper INT UNSIGNED;
    DECLARE pOPEN  DECIMAL(10,2);
    DECLARE pHIGH  DECIMAL(10,2);
    DECLARE pLOW   DECIMAL(10,2);
    DECLARE pCLOSE DECIMAL(10,2);

    CREATE TEMPORARY TABLE ohlc (`timestamp` INT, `open` DECIMAL(10,2), `high` DECIMAL(10,2), `low` DECIMAL(10,2), `close` DECIMAL(10,2));
    SET looper = ts_from;
    WHILE looper <= ts_to DO
        SET pOPEN  = 0.00;
        SET pHIGH  = 0.00;
        SET pLOW   = 0.00;
        SET pCLOSE = 0.00;
        SELECT COALESCE(`open`,0.00) INTO @pOPEN FROM `btc_usdt_klines_reduced` WHERE `kline_timestamp` = looper LIMIT 1;
        SELECT COALESCE(`close`,0.00) INTO @pCLOSE FROM `btc_usdt_klines_reduced` WHERE `kline_timestamp` = ts_to LIMIT 1;
        SELECT COALESCE(MAX(`high`),0) INTO @pHIGH FROM `btc_usdt_klines_reduced` WHERE `kline_timestamp` BETWEEN ts_from AND ts_to;
        SELECT COALESCE(MIN(`low`),0) INTO @pLOW FROM `btc_usdt_klines_reduced` WHERE `kline_timestamp` BETWEEN ts_from AND ts_to;
        INSERT INTO ohlc VALUES (@looper, @pOPEN, @pHIGH, @pLOW, @pCLOSE);
        SET looper = looper + resolution;
    END WHILE;
    SELECT * FROM ohlc;
    DROP TABLE IF EXISTS ohlc;
END $$
DELIMITER ;