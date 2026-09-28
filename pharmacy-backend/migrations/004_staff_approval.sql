CREATE TABLE IF NOT EXISTS user_access (
  user_id INT PRIMARY KEY,
  status ENUM('PENDING','ACTIVE','REJECTED','SUSPENDED') NOT NULL DEFAULT 'PENDING',
  version INT NOT NULL DEFAULT 1,
  reviewed_by INT NULL,
  reviewed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_user_access_status (status)
) ENGINE=InnoDB;

-- Existing non-admin accounts require approval. Never reset an already reviewed account.
INSERT IGNORE INTO user_access (user_id, status)
SELECT id, CASE WHEN role = 'admin' THEN 'ACTIVE' ELSE 'PENDING' END FROM users;

-- Serializes administration changes, including one-time administrator setup.
CREATE TABLE IF NOT EXISTS administration_lock (
  id INT PRIMARY KEY
) ENGINE=InnoDB;
INSERT IGNORE INTO administration_lock (id) VALUES (1);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  action VARCHAR(100) NOT NULL,
  entity VARCHAR(100) NOT NULL,
  entity_id INT NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_audit_entity (entity, entity_id, created_at)
) ENGINE=InnoDB;
