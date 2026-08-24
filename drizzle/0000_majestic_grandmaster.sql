CREATE TABLE `account` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`cash` integer NOT NULL,
	`initial_cash` integer NOT NULL,
	`total_checkin` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `checkin` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`checkin_date` text NOT NULL,
	`reward` integer NOT NULL,
	`streak` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_checkin_user_date` ON `checkin` (`user_id`,`checkin_date`);--> statement-breakpoint
CREATE TABLE `dca_plan` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`fund_code` text NOT NULL,
	`amount` integer NOT NULL,
	`frequency` text NOT NULL,
	`day_of_week` integer,
	`day_of_month` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`next_run` text NOT NULL,
	`run_count` integer DEFAULT 0 NOT NULL,
	`total_invested` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_dca_status_next` ON `dca_plan` (`status`,`next_run`);--> statement-breakpoint
CREATE INDEX `idx_dca_user` ON `dca_plan` (`user_id`);--> statement-breakpoint
CREATE TABLE `fund` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT '' NOT NULL,
	`purchase_rate` integer DEFAULT 0 NOT NULL,
	`redeem_tiers` text NOT NULL,
	`min_purchase` integer DEFAULT 1000 NOT NULL,
	`risk_level` integer DEFAULT 3 NOT NULL,
	`status` text DEFAULT '开放申购' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fund_nav` (
	`fund_code` text NOT NULL,
	`nav_date` text NOT NULL,
	`unit_nav` integer NOT NULL,
	`acc_nav` integer DEFAULT 0 NOT NULL,
	`growth_rate` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`fund_code`, `nav_date`)
);
--> statement-breakpoint
CREATE INDEX `idx_fund_nav_code_date` ON `fund_nav` (`fund_code`,`nav_date`);--> statement-breakpoint
CREATE TABLE `holding` (
	`user_id` integer NOT NULL,
	`fund_code` text NOT NULL,
	`total_shares` integer DEFAULT 0 NOT NULL,
	`total_cost` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `fund_code`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`fund_code` text NOT NULL,
	`side` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`amount` integer,
	`shares` integer,
	`place_date` text NOT NULL,
	`confirm_date` text NOT NULL,
	`deal_nav` integer,
	`deal_shares` integer,
	`deal_amount` integer,
	`fee` integer,
	`fail_reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_orders_status_confirm` ON `orders` (`status`,`confirm_date`);--> statement-breakpoint
CREATE INDEX `idx_orders_user_created` ON `orders` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `session` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_session_user` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `share_lot` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`fund_code` text NOT NULL,
	`shares` integer NOT NULL,
	`cost` integer NOT NULL,
	`confirm_date` text NOT NULL,
	`order_id` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_share_lot_fifo` ON `share_lot` (`user_id`,`fund_code`,`confirm_date`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`type` text NOT NULL,
	`amount` integer NOT NULL,
	`balance` integer NOT NULL,
	`order_id` integer,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_tx_user_created` ON `transactions` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`salt` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_username_unique` ON `user` (`username`);