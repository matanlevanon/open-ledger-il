-- R09 access. Supports the expiry cron (accountants near or past their end date) and the
-- access log screen (audit_log filtered by user). No new tables: users, user_features and
-- audit_log already carry everything this run needs.

CREATE INDEX users_role_active_ends ON users (role, active, access_ends_on);
CREATE INDEX audit_log_user_email ON audit_log (user_email, id);
