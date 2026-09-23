CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL UNIQUE,
  description TEXT NULL,
  status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS medicines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  generic_name VARCHAR(150) NULL,
  brand_name VARCHAR(150) NULL,
  category_id INT NULL,
  medicine_type ENUM('Tablet','Capsule','Syrup','Injection','Cream','Ointment','Drops','Inhaler','Other') NOT NULL DEFAULT 'Other',
  description TEXT NULL,
  manufacturer VARCHAR(150) NULL,
  barcode VARCHAR(100) NULL UNIQUE,
  purchase_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  selling_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  minimum_stock INT NOT NULL DEFAULT 10,
  storage_location VARCHAR(150) NULL,
  status ENUM('ACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
  version INT NOT NULL DEFAULT 1,
  created_by INT NOT NULL,
  updated_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_medicine_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
  CONSTRAINT fk_medicine_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_medicine_editor FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT ck_medicine_prices CHECK (purchase_price >= 0 AND selling_price >= 0),
  CONSTRAINT ck_medicine_minimum CHECK (minimum_stock >= 0),
  INDEX idx_medicine_name (name),
  INDEX idx_medicine_status (status)
) ENGINE=InnoDB;

-- Read-only in Phase 2. Receipt/issue transactions will populate this table in later phases.
CREATE TABLE IF NOT EXISTS medicine_batches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  medicine_id INT NOT NULL,
  batch_number VARCHAR(100) NOT NULL,
  expiry_date DATE NOT NULL,
  quantity INT NOT NULL DEFAULT 0,
  purchase_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_batch_medicine FOREIGN KEY (medicine_id) REFERENCES medicines(id) ON DELETE RESTRICT,
  CONSTRAINT ck_batch_quantity CHECK (quantity >= 0),
  CONSTRAINT ck_batch_price CHECK (purchase_price >= 0),
  UNIQUE KEY uq_medicine_batch (medicine_id, batch_number),
  INDEX idx_batch_expiry (expiry_date)
) ENGINE=InnoDB;
