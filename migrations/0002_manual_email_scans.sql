-- A saved foreground scan uses a fixed range across all pagination requests.
ALTER TABLE email_accounts ADD COLUMN scan_from INTEGER;
-- Do not resume an old automatic scan with an unknown range.
UPDATE email_accounts SET next_scan=0,scan_start=NULL,page_token=NULL;
