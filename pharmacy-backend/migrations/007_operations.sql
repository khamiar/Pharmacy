CREATE TABLE IF NOT EXISTS customers (
 id INT AUTO_INCREMENT PRIMARY KEY,
 full_name VARCHAR(150) NOT NULL,
 phone VARCHAR(30) NULL,
 email VARCHAR(150) NULL,
 address VARCHAR(1000) NULL,
 date_of_birth DATE NULL,
 notes TEXT NULL,
 version INT NOT NULL DEFAULT 1,
 created_by INT NOT NULL,
 updated_by INT NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE RESTRICT,
 FOREIGN KEY(updated_by) REFERENCES users(id) ON DELETE RESTRICT,
 INDEX idx_customer_name(full_name),
 INDEX idx_customer_phone(phone)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS prescriptions (
 id INT AUTO_INCREMENT PRIMARY KEY,
 prescription_number VARCHAR(60) NOT NULL UNIQUE,
 customer_id INT NOT NULL,
 doctor VARCHAR(150) NOT NULL,
 prescription_date DATE NOT NULL,
 notes TEXT NULL,
 status ENUM('PENDING','DISPENSED','PARTIALLY_DISPENSED','CANCELLED') NOT NULL DEFAULT 'PENDING',
 version INT NOT NULL DEFAULT 1,
 request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
 created_by INT NOT NULL,
 updated_by INT NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
 FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE RESTRICT,
 FOREIGN KEY(updated_by) REFERENCES users(id) ON DELETE RESTRICT,
 INDEX idx_prescription_status(status),
 INDEX idx_prescription_date(prescription_date)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS prescription_items (
 id INT AUTO_INCREMENT PRIMARY KEY,
 prescription_id INT NOT NULL,
 medicine_id INT NOT NULL,
 dosage VARCHAR(150) NOT NULL,
 frequency VARCHAR(150) NOT NULL,
 duration VARCHAR(150) NOT NULL,
 quantity INT NOT NULL,
 dispensed_quantity INT NOT NULL DEFAULT 0,
 instructions VARCHAR(1000) NULL,
 FOREIGN KEY(prescription_id) REFERENCES prescriptions(id) ON DELETE RESTRICT,
 FOREIGN KEY(medicine_id) REFERENCES medicines(id) ON DELETE RESTRICT,
 UNIQUE KEY uq_prescription_medicine(prescription_id,medicine_id),
 CHECK(quantity > 0 AND dispensed_quantity >= 0 AND dispensed_quantity <= quantity)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS pharmacy_settings (
 id INT PRIMARY KEY,
 pharmacy_name VARCHAR(150) NOT NULL DEFAULT 'Pharmacy System',
 address VARCHAR(1000) NULL,
 phone VARCHAR(30) NULL,
 email VARCHAR(150) NULL,
 logo_url VARCHAR(1000) NULL,
 registration_number VARCHAR(150) NULL,
 currency CHAR(3) NOT NULL DEFAULT 'TZS',
 low_stock_threshold INT NOT NULL DEFAULT 10,
 expiry_warning_days INT NOT NULL DEFAULT 30,
 invoice_prefix VARCHAR(12) NOT NULL DEFAULT 'INV',
 invoice_footer VARCHAR(500) NULL,
 version INT NOT NULL DEFAULT 1,
 CHECK (id=1 AND low_stock_threshold >= 0 AND expiry_warning_days BETWEEN 1 AND 365 AND currency='TZS')
) ENGINE=InnoDB;
INSERT IGNORE INTO pharmacy_settings(id) VALUES(1);
CREATE TABLE IF NOT EXISTS sale_details (
 sale_id INT PRIMARY KEY,
 customer_id INT NULL,
 prescription_id INT NULL,
 pharmacy_profile JSON NOT NULL,
 FOREIGN KEY(sale_id) REFERENCES sales(id) ON DELETE RESTRICT,
 FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
 FOREIGN KEY(prescription_id) REFERENCES prescriptions(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS notification_reads (
 user_id INT NOT NULL,
 notification_key VARCHAR(160) NOT NULL,
 read_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(user_id,notification_key),
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
