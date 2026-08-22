-- Adds the persona captured by the redesigned landing page toggle.
-- Values are allowlisted in worker.js to 'parent' | 'nanny'; NULL = signed up
-- before the toggle shipped, or posted without a role.
ALTER TABLE waitlist ADD COLUMN role TEXT;
