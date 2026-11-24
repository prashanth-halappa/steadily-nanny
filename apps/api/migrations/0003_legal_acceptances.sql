CREATE TABLE `legal_acceptances` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`version` text NOT NULL,
	`accepted_at` text NOT NULL,
	`ip` text,
	`user_agent` text,
	`platform` text,
	`app_version` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `legal_acceptances_user_version_key` ON `legal_acceptances` (`user_id`,`version`);--> statement-breakpoint
CREATE INDEX `legal_acceptances_user_accepted_idx` ON `legal_acceptances` (`user_id`,`accepted_at`);