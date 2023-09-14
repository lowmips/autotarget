DELIMITER $$
CREATE PROCEDURE get_klines (IN resolution INT, IN ts_from INT UNSIGNED, IN ts_to INT UNSIGNED)
BEGIN
    DECLARE loop INT UNSIGNED DEFAULT '0';
    SET loop = ts_from;
    WHILE loop < ts_to DO

        SET loop = loop + resolution;
    END WHILE;

END $$
DELIMITER ;