CREATE TABLE user_preferences (
      user_id INT NOT NULL,
      preference_key VARCHAR(50) NOT NULL,
      preference_value JSON NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, preference_key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);