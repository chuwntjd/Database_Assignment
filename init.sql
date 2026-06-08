CREATE TYPE loan_status_type AS ENUM ('ACTIVE', 'RETURNED');
CREATE TYPE copy_status_type AS ENUM ('AVAILABLE', 'UNAVAILABLE');

CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    penalty_end_date TIMESTAMPTZ NULL,
    deleted_at TIMESTAMPTZ NULL,
    email VARCHAR(100) UNIQUE NULL,
    COLUMN phone VARCHAR(20) UNIQUE NULL
);
CREATE INDEX idx_users_active ON users(deleted_at) WHERE deleted_at IS NULL;

CREATE TABLE books (
    isbn CHAR(13) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    author VARCHAR(100) NOT NULL,
    publisher VARCHAR(100) NOT NULL,
    pub_year SMALLINT NOT NULL
);

CREATE TABLE book_copies (
    copy_id SERIAL PRIMARY KEY,
    isbn CHAR(13) NOT NULL REFERENCES books(isbn) ON DELETE CASCADE,
    status copy_status_type NOT NULL DEFAULT 'AVAILABLE'
);

CREATE INDEX idx_book_copies_isbn ON book_copies(isbn); 

CREATE TABLE loans (
    loan_id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    copy_id INT NOT NULL REFERENCES book_copies(copy_id) ON DELETE RESTRICT,
    status loan_status_type NOT NULL,
    loan_date TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    due_date TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '7 days'),
    return_date TIMESTAMPTZ NULL,
    is_extended BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT chk_return_date CHECK (return_date IS NULL OR return_date >= loan_date),
    CONSTRAINT chk_status_return_date CHECK (
        (status = 'ACTIVE' AND return_date IS NULL) OR 
        (status = 'RETURNED' AND return_date IS NOT NULL)
    )
);

CREATE UNIQUE INDEX trk_active_copy_loan ON loans(copy_id) WHERE status = 'ACTIVE';

CREATE INDEX idx_loans_user_active ON loans(user_id) WHERE status = 'ACTIVE';
CREATE INDEX idx_loans_user_history ON loans(user_id) WHERE status = 'RETURNED';
CREATE INDEX idx_loans_copy_id ON loans(copy_id);
CREATE INDEX idx_loans_active_due_date ON loans(due_date) WHERE status = 'ACTIVE';

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_books_title_trgm ON books USING gin (title gin_trgm_ops);
CREATE INDEX idx_books_author ON books(author);

CREATE OR REPLACE VIEW penalty_users_view AS
SELECT u.user_id, u.name, u.penalty_end_date
FROM users u
WHERE u.penalty_end_date > CURRENT_TIMESTAMP 
   OR EXISTS (
       SELECT 1 
       FROM loans l 
       WHERE l.user_id = u.user_id 
         AND l.status = 'ACTIVE'
         AND l.due_date < CURRENT_TIMESTAMP
   );

CREATE OR REPLACE VIEW available_books_view AS
SELECT bc.copy_id, bc.isbn, b.title
FROM book_copies bc
JOIN books b ON bc.isbn = b.isbn
WHERE bc.status = 'AVAILABLE'
  AND NOT EXISTS (
    SELECT 1 
    FROM loans l 
    WHERE l.copy_id = bc.copy_id
      AND l.status = 'ACTIVE'
);

CREATE OR REPLACE VIEW user_loan_status_view AS
SELECT 
    loan_id,
    user_id,
    copy_id,
    status,
    loan_date,
    due_date,
    return_date,
    CASE 
        WHEN status = 'ACTIVE' AND CURRENT_DATE > due_date::DATE 
            THEN (CURRENT_DATE - due_date::DATE)
        WHEN status = 'RETURNED' AND return_date::DATE > due_date::DATE 
            THEN (return_date::DATE - due_date::DATE)
        ELSE 0 
    END AS current_overdue_days
FROM loans;

CREATE OR REPLACE FUNCTION update_penalty_on_return()
RETURNS TRIGGER AS $$
DECLARE
    overdue_days INT;
BEGIN
    IF NEW.status = 'RETURNED' AND OLD.status = 'ACTIVE' AND NEW.return_date > NEW.due_date THEN
        
        overdue_days := (NEW.return_date::DATE - NEW.due_date::DATE);
        
        IF overdue_days > 0 THEN
            UPDATE users 
            SET penalty_end_date = GREATEST(COALESCE(penalty_end_date, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP) + (overdue_days * INTERVAL '1 day')
            WHERE user_id = NEW.user_id;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_penalty_on_return
AFTER UPDATE OF status ON loans
FOR EACH ROW
EXECUTE FUNCTION update_penalty_on_return();