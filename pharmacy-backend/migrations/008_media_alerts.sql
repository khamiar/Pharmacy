CREATE TABLE IF NOT EXISTS image_uploads (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 purpose ENUM('medicine','logo') NOT NULL,
 content MEDIUMBLOB NOT NULL,
 content_type VARCHAR(30) NOT NULL,
 width INT NOT NULL,
 height INT NOT NULL,
 created_by INT NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS medicine_images (
 medicine_id INT PRIMARY KEY,
 image_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 FOREIGN KEY(medicine_id) REFERENCES medicines(id) ON DELETE RESTRICT,
 FOREIGN KEY(image_id) REFERENCES image_uploads(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS pharmacy_preferences (
 id INT PRIMARY KEY,
 alerts_enabled TINYINT NOT NULL DEFAULT 1,
 alert_expiry_days INT NOT NULL DEFAULT 10,
 alert_stock_quantity INT NOT NULL DEFAULT 10,
 alert_interval_minutes INT NOT NULL DEFAULT 10,
 invoice_title VARCHAR(60) NOT NULL DEFAULT 'SALES INVOICE',
 invoice_terms VARCHAR(1000) NULL,
 invoice_show_logo TINYINT NOT NULL DEFAULT 1,
 website VARCHAR(250) NULL,
 business_hours VARCHAR(250) NULL,
 FOREIGN KEY(id) REFERENCES pharmacy_settings(id) ON DELETE RESTRICT,
 CHECK(id=1 AND alerts_enabled IN (0,1) AND invoice_show_logo IN (0,1)),
 CHECK(alert_expiry_days BETWEEN 1 AND 365 AND alert_stock_quantity BETWEEN 0 AND 1000000 AND alert_interval_minutes BETWEEN 1 AND 1440)
) ENGINE=InnoDB;
INSERT IGNORE INTO pharmacy_preferences(id) VALUES(1);
